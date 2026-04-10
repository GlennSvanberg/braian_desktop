use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use http::{HeaderName, HeaderValue};
use rmcp::model::CallToolRequestParams;
use rmcp::service::RunningService;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::transport::{StreamableHttpClientTransport, TokioChildProcess};
use rmcp::{RoleClient, ServiceExt};
use serde::Serialize;
use serde_json::{Map, Value};

use crate::config::{load_workspace_mcp_config, WorkspaceMcpConfigDto};
use crate::http::{map_tools_to_summaries, McpToolSummaryDto};
use crate::stdio::{
    apply_augmented_path_to_command, augmented_path_env_for_stdio_entry, command_for_stdio_mcp,
    mcp_tool_call_finalize_string, resolve_stdio_cwd,
};

const MAX_SERVERS_PER_LIST: usize = 16;
const MAX_TOOLS_PER_SERVER: usize = 64;
const MAX_TOOLS_TOTAL: usize = 128;
const MAX_ARG_JSON_BYTES: usize = 256 * 1024;

type SessionKey = (String, String);
type ClientService = RunningService<RoleClient, ()>;

fn sessions_registry() -> &'static Mutex<HashMap<SessionKey, Arc<RmcpSession>>> {
    static REG: OnceLock<Mutex<HashMap<SessionKey, Arc<RmcpSession>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

fn async_runtime() -> &'static tokio::runtime::Runtime {
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("create MCP tokio runtime")
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TransportKind {
    Stdio,
    Remote,
}

struct RmcpSession {
    client: Mutex<ClientService>,
}

impl RmcpSession {
    fn new_stdio(
        workspace_root: &Path,
        canon_root: &Path,
        entry: &Map<String, Value>,
    ) -> Result<Self, String> {
        let command = entry
            .get("command")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "Missing command.".to_string())?;
        let args: Vec<String> = entry
            .get("args")
            .and_then(|a| a.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();

        let cwd_path = resolve_stdio_cwd(workspace_root, canon_root, entry)?;
        let augmented_path = augmented_path_env_for_stdio_entry(entry);

        let mut command_std = command_for_stdio_mcp(entry, command, &args);
        command_std.current_dir(&cwd_path);
        apply_augmented_path_to_command(&mut command_std, &augmented_path);
        if let Some(env_obj) = entry.get("env").and_then(|e| e.as_object()) {
            for (k, v) in env_obj {
                if k == "PATH" {
                    continue;
                }
                if let Some(s) = v.as_str() {
                    command_std.env(k, s);
                }
            }
        }

        let command_tokio = tokio::process::Command::from(command_std);
        let transport = TokioChildProcess::new(command_tokio).map_err(|e| e.to_string())?;
        let client = async_runtime()
            .block_on(async { ().serve(transport).await })
            .map_err(|e| e.to_string())?;
        Ok(Self {
            client: Mutex::new(client),
        })
    }

    fn new_remote(entry: &Map<String, Value>) -> Result<Self, String> {
        let url = entry
            .get("url")
            .and_then(|u| u.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "Missing url.".to_string())?;

        let mut custom_headers: HashMap<HeaderName, HeaderValue> = HashMap::new();
        if let Some(headers) = entry.get("headers").and_then(|x| x.as_object()) {
            for (k, v) in headers {
                let Some(raw_val) = v.as_str() else {
                    continue;
                };
                let Ok(name) = HeaderName::try_from(k.as_str()) else {
                    continue;
                };
                let Ok(value) = HeaderValue::try_from(raw_val) else {
                    continue;
                };
                custom_headers.insert(name, value);
            }
        }

        let mut cfg = StreamableHttpClientTransportConfig::with_uri(url.to_string())
            .custom_headers(custom_headers);
        if let Some(oauth) = entry.get("oauth").and_then(|v| v.as_object()) {
            if let Some(access_token) = oauth
                .get("accessToken")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                let token_type = oauth
                    .get("tokenType")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .unwrap_or("Bearer");
                if token_type.eq_ignore_ascii_case("bearer") {
                    cfg = cfg.auth_header(access_token.to_string());
                }
            }
        }
        let transport = StreamableHttpClientTransport::from_config(cfg);
        let client = async_runtime()
            .block_on(async { ().serve(transport).await })
            .map_err(|e| e.to_string())?;

        Ok(Self {
            client: Mutex::new(client),
        })
    }

    fn tools_list(&self) -> Result<Vec<Value>, String> {
        let client = self
            .client
            .lock()
            .map_err(|_| "MCP client lock poisoned.".to_string())?;
        let tools = async_runtime()
            .block_on(async { client.list_all_tools().await })
            .map_err(|e| e.to_string())?;
        let mut values: Vec<Value> = Vec::with_capacity(tools.len());
        for tool in tools {
            values.push(serde_json::to_value(tool).map_err(|e| e.to_string())?);
        }
        Ok(values)
    }

    fn tools_call(&self, tool_name: &str, arguments: Value) -> Result<String, String> {
        let arguments_obj = match arguments {
            Value::Null => None,
            Value::Object(obj) => Some(obj),
            _ => return Err("arguments must be a JSON object.".to_string()),
        };

        let request = CallToolRequestParams {
            meta: None,
            name: tool_name.to_string().into(),
            arguments: arguments_obj,
            task: None,
        };

        let client = self
            .client
            .lock()
            .map_err(|_| "MCP client lock poisoned.".to_string())?;
        let result = async_runtime()
            .block_on(async { client.call_tool(request).await })
            .map_err(|e| e.to_string())?;
        let result_value = serde_json::to_value(result).map_err(|e| e.to_string())?;
        mcp_tool_call_finalize_string(&result_value)
    }

    fn shutdown(&self) {
        if let Ok(mut client) = self.client.lock() {
            let _ = async_runtime().block_on(async { client.close().await });
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpListToolsServerDto {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub tools: Vec<Value>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpListToolsResultDto {
    pub servers: Vec<McpListToolsServerDto>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionProbeResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub transport: String,
    #[serde(default)]
    pub tools: Vec<McpToolSummaryDto>,
}

fn transport_kind(entry: &Map<String, Value>) -> Option<TransportKind> {
    let command = entry
        .get("command")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .trim();
    let url = entry
        .get("url")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .trim();
    if !url.is_empty() {
        return Some(TransportKind::Remote);
    }
    if !command.is_empty() {
        return Some(TransportKind::Stdio);
    }
    None
}

fn disabled_set(cfg: &WorkspaceMcpConfigDto) -> HashSet<String> {
    cfg.braian
        .as_ref()
        .map(|b| b.disabled_mcp_servers.iter().cloned().collect())
        .unwrap_or_default()
}

fn get_or_spawn_session(
    workspace_root: &Path,
    server_name: &str,
    entry: &Map<String, Value>,
) -> Result<Arc<RmcpSession>, String> {
    let key = (
        workspace_root.to_string_lossy().to_string(),
        server_name.to_string(),
    );
    let mut map = sessions_registry()
        .lock()
        .map_err(|_| "MCP session registry lock poisoned.".to_string())?;
    if let Some(s) = map.get(&key) {
        log::debug!(
          target: "braian_mcp_runtime",
          "reusing warm MCP session workspace={} server={}",
          workspace_root.display(),
          server_name
        );
        return Ok(Arc::clone(s));
    }

    let session = match transport_kind(entry) {
        Some(TransportKind::Stdio) => {
            let canon_root = workspace_root.canonicalize().map_err(|e| e.to_string())?;
            Arc::new(RmcpSession::new_stdio(workspace_root, &canon_root, entry)?)
        }
        Some(TransportKind::Remote) => Arc::new(RmcpSession::new_remote(entry)?),
        None => {
            return Err(
                "MCP server entry needs a non-empty \"url\" (remote) or \"command\" (stdio)."
                    .to_string(),
            )
        }
    };

    log::info!(
      target: "braian_mcp_runtime",
      "started cold MCP session workspace={} server={} transport={}",
      workspace_root.display(),
      server_name,
      match transport_kind(entry) {
        Some(TransportKind::Stdio) => "stdio",
        Some(TransportKind::Remote) => "remote",
        None => "unknown",
      }
    );
    map.insert(key, Arc::clone(&session));
    Ok(session)
}

pub fn list_tools(
    workspace_root: &Path,
    allow_servers: Option<&HashSet<String>>,
) -> Result<McpListToolsResultDto, String> {
    let cfg = load_workspace_mcp_config(workspace_root)?;
    let disabled = disabled_set(&cfg);
    let mut names: Vec<String> = cfg.mcp_servers.keys().cloned().collect();
    names.sort();

    let mut servers_out: Vec<McpListToolsServerDto> = Vec::new();
    let mut total_tools: usize = 0;
    let mut servers_started: usize = 0;

    for name in names {
        if servers_started >= MAX_SERVERS_PER_LIST {
            break;
        }
        if disabled.contains(&name) {
            continue;
        }
        if let Some(allow) = allow_servers {
            if !allow.contains(&name) {
                continue;
            }
        }
        let Some(entry_val) = cfg.mcp_servers.get(&name) else {
            continue;
        };
        let Some(entry) = entry_val.as_object() else {
            continue;
        };
        if transport_kind(entry).is_none() {
            continue;
        }

        servers_started += 1;
        let desc = entry
            .get("description")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        let list_started_at = Instant::now();
        match get_or_spawn_session(workspace_root, &name, entry) {
            Ok(sess) => match sess.tools_list() {
                Ok(mut tools) => {
                    if tools.len() > MAX_TOOLS_PER_SERVER {
                        tools.truncate(MAX_TOOLS_PER_SERVER);
                    }
                    let room = MAX_TOOLS_TOTAL.saturating_sub(total_tools);
                    if room == 0 {
                        servers_out.push(McpListToolsServerDto {
                            name,
                            description: desc,
                            error: Some(format!(
                                "Skipped: global tool cap ({MAX_TOOLS_TOTAL}) reached."
                            )),
                            tools: vec![],
                        });
                        continue;
                    }
                    if tools.len() > room {
                        tools.truncate(room);
                    }
                    total_tools += tools.len();
                    servers_out.push(McpListToolsServerDto {
                        name,
                        description: desc,
                        error: None,
                        tools,
                    });
                    log::info!(
                      target: "braian_mcp_runtime",
                      "mcp list success stage=list server={} latency_ms={}",
                      servers_out.last().map(|s| s.name.as_str()).unwrap_or("unknown"),
                      list_started_at.elapsed().as_millis()
                    );
                }
                Err(e) => {
                    log::warn!(
                      target: "braian_mcp_runtime",
                      "mcp list failed stage=list server={} error={}",
                      name,
                      e
                    );
                    servers_out.push(McpListToolsServerDto {
                        name,
                        description: desc,
                        error: Some(e),
                        tools: vec![],
                    });
                }
            },
            Err(e) => {
                log::warn!(
                  target: "braian_mcp_runtime",
                  "mcp list failed stage=init server={} error={}",
                  name,
                  e
                );
                servers_out.push(McpListToolsServerDto {
                    name,
                    description: desc,
                    error: Some(e),
                    tools: vec![],
                });
            }
        }
    }

    Ok(McpListToolsResultDto {
        servers: servers_out,
    })
}

pub fn call_tool(
    workspace_root: &Path,
    server_name: &str,
    tool_name: &str,
    arguments: Value,
) -> Result<String, String> {
    if server_name.trim().is_empty() || tool_name.trim().is_empty() {
        return Err("serverName and toolName are required.".to_string());
    }

    let cfg = load_workspace_mcp_config(workspace_root)?;
    if disabled_set(&cfg).contains(server_name) {
        return Err(format!("MCP server \"{server_name}\" is disabled."));
    }
    let entry_val = cfg
        .mcp_servers
        .get(server_name)
        .ok_or_else(|| format!("Unknown MCP server \"{server_name}\"."))?;
    let entry = entry_val
        .as_object()
        .ok_or_else(|| "Server entry must be a JSON object.".to_string())?;
    let arg_len = serde_json::to_vec(&arguments)
        .map_err(|e| e.to_string())?
        .len();
    if arg_len > MAX_ARG_JSON_BYTES {
        return Err("arguments JSON too large.".to_string());
    }
    let started_at = Instant::now();
    let sess = get_or_spawn_session(workspace_root, server_name, entry)?;
    let result = sess.tools_call(tool_name, arguments);
    match &result {
        Ok(_) => log::info!(
          target: "braian_mcp_runtime",
          "mcp call success stage=call server={} tool={} latency_ms={}",
          server_name,
          tool_name,
          started_at.elapsed().as_millis()
        ),
        Err(e) => log::warn!(
          target: "braian_mcp_runtime",
          "mcp call failed stage=call server={} tool={} error={}",
          server_name,
          tool_name,
          e
        ),
    }
    result
}

pub fn probe_connection(
    workspace_root: &Path,
    name: &str,
) -> Result<McpConnectionProbeResult, String> {
    let cfg = load_workspace_mcp_config(workspace_root)?;
    if disabled_set(&cfg).contains(name) {
        return Ok(McpConnectionProbeResult {
            ok: false,
            tool_count: None,
            error_message: Some(
                "This server is off in Braian; turn it on to check the connection.".to_string(),
            ),
            transport: "disabled".to_string(),
            tools: vec![],
        });
    }

    let entry_val = cfg
        .mcp_servers
        .get(name)
        .ok_or_else(|| format!("Unknown server \"{name}\"."))?;
    let entry = entry_val
        .as_object()
        .ok_or_else(|| "Server entry must be a JSON object.".to_string())?;

    let transport = match transport_kind(entry) {
        Some(TransportKind::Remote) => "remote",
        Some(TransportKind::Stdio) => "stdio",
        None => "unknown",
    };

    if transport == "unknown" {
        return Ok(McpConnectionProbeResult {
            ok: false,
            tool_count: None,
            error_message: Some("Need command (stdio) or url (remote).".to_string()),
            transport: "unknown".to_string(),
            tools: vec![],
        });
    }

    let out = match get_or_spawn_session(workspace_root, name, entry) {
        Ok(sess) => match sess.tools_list() {
            Ok(tools) => {
                let summaries = map_tools_to_summaries(&tools);
                McpConnectionProbeResult {
                    ok: true,
                    tool_count: Some(summaries.len() as u32),
                    error_message: None,
                    transport: transport.to_string(),
                    tools: summaries,
                }
            }
            Err(e) => McpConnectionProbeResult {
                ok: false,
                tool_count: None,
                error_message: Some(e),
                transport: transport.to_string(),
                tools: vec![],
            },
        },
        Err(e) => McpConnectionProbeResult {
            ok: false,
            tool_count: None,
            error_message: Some(e),
            transport: transport.to_string(),
            tools: vec![],
        },
    };
    Ok(out)
}

pub fn disconnect_workspace(workspace_root: &Path) -> Result<(), String> {
    let mut map = sessions_registry()
        .lock()
        .map_err(|_| "MCP session registry lock poisoned.".to_string())?;
    let ws = workspace_root.to_string_lossy().to_string();
    let keys: Vec<SessionKey> = map
        .keys()
        .filter(|(root, _)| root == &ws)
        .cloned()
        .collect();
    for k in keys {
        if let Some(sess) = map.remove(&k) {
            sess.shutdown();
        }
    }
    Ok(())
}
