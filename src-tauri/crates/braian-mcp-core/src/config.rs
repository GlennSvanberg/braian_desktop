use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

fn mcp_json_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".braian").join("mcp.json")
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BraianMcpOverlayDto {
    #[serde(default)]
    pub disabled_mcp_servers: Vec<String>,
    #[serde(default)]
    pub default_active_mcp_servers: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_list_timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_idle_disconnect_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMcpConfigDto {
    #[serde(default)]
    pub mcp_servers: Map<String, Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub braian: Option<BraianMcpOverlayDto>,
}

impl Default for WorkspaceMcpConfigDto {
    fn default() -> Self {
        Self {
            mcp_servers: Map::new(),
            braian: None,
        }
    }
}

fn validate_string_map(obj: &Map<String, Value>, field: &str) -> Result<(), String> {
    let Some(v) = obj.get(field) else {
        return Ok(());
    };
    let Some(map) = v.as_object() else {
        return Err(format!(
            "\"{field}\" must be a JSON object of string values."
        ));
    };
    for (k, val) in map {
        if !val.is_string() && !val.is_null() {
            return Err(format!("\"{field}.{k}\" must be a string."));
        }
    }
    Ok(())
}

fn validate_args(obj: &Map<String, Value>) -> Result<(), String> {
    let Some(v) = obj.get("args") else {
        return Ok(());
    };
    if v.is_null() {
        return Ok(());
    }
    let Some(arr) = v.as_array() else {
        return Err("\"args\" must be a JSON array of strings.".to_string());
    };
    for (i, item) in arr.iter().enumerate() {
        if !item.is_string() {
            return Err(format!("args[{i}] must be a string."));
        }
    }
    Ok(())
}

fn validate_oauth(obj: &Map<String, Value>) -> Result<(), String> {
    let Some(v) = obj.get("oauth") else {
        return Ok(());
    };
    if v.is_null() {
        return Ok(());
    }
    let Some(oauth) = v.as_object() else {
        return Err("\"oauth\" must be an object.".to_string());
    };
    if let Some(token) = oauth.get("accessToken") {
        if !token.is_string() && !token.is_null() {
            return Err("\"oauth.accessToken\" must be a string.".to_string());
        }
    }
    if let Some(token_type) = oauth.get("tokenType") {
        if !token_type.is_string() && !token_type.is_null() {
            return Err("\"oauth.tokenType\" must be a string.".to_string());
        }
    }
    Ok(())
}

fn validate_mcp_servers(map: &Map<String, Value>) -> Result<(), String> {
    for (name, v) in map {
        let obj = v
            .as_object()
            .ok_or_else(|| format!("Server \"{name}\" must be a JSON object."))?;
        let url = obj.get("url").and_then(|x| x.as_str()).unwrap_or("").trim();
        let command = obj
            .get("command")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim();
        if !url.is_empty() {
            validate_string_map(obj, "headers")?;
            validate_oauth(obj)?;
            validate_args(obj)?;
            continue;
        }
        if !command.is_empty() {
            validate_args(obj)?;
            validate_string_map(obj, "env")?;
            continue;
        }
        return Err(format!(
            "Server \"{name}\": set a non-empty \"url\" (remote) or \"command\" (stdio)."
        ));
    }
    Ok(())
}

fn normalize_braian_overlay(dto: &mut WorkspaceMcpConfigDto) {
    fn clamp_timeout_ms(v: &mut Option<u64>, min_ms: u64, max_ms: u64) {
        if let Some(raw) = *v {
            *v = Some(raw.clamp(min_ms, max_ms));
        }
    }

    let keys: HashSet<_> = dto.mcp_servers.keys().cloned().collect();
    if let Some(ref mut b) = dto.braian {
        b.disabled_mcp_servers.retain(|n| keys.contains(n));
        b.disabled_mcp_servers.sort();
        b.disabled_mcp_servers.dedup();

        b.default_active_mcp_servers.retain(|n| keys.contains(n));
        b.default_active_mcp_servers.sort();
        b.default_active_mcp_servers.dedup();

        clamp_timeout_ms(&mut b.mcp_list_timeout_ms, 1_000, 300_000);
        clamp_timeout_ms(&mut b.mcp_idle_disconnect_ms, 5_000, 3_600_000);

        if b.disabled_mcp_servers.is_empty()
            && b.default_active_mcp_servers.is_empty()
            && b.mcp_list_timeout_ms.is_none()
            && b.mcp_idle_disconnect_ms.is_none()
        {
            dto.braian = None;
        }
    }
}

pub fn load_workspace_mcp_config(workspace_root: &Path) -> Result<WorkspaceMcpConfigDto, String> {
    let path = mcp_json_path(workspace_root);
    if !path.exists() {
        return Ok(WorkspaceMcpConfigDto::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut dto: WorkspaceMcpConfigDto =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid mcp.json: {e}"))?;
    validate_mcp_servers(&dto.mcp_servers)?;
    normalize_braian_overlay(&mut dto);
    Ok(dto)
}
