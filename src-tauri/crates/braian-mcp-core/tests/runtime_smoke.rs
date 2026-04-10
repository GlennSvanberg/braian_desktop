use std::fs;

use braian_mcp_core::runtime;
use tempfile::TempDir;

fn write_mcp_json(dir: &TempDir, body: &str) {
    let braian = dir.path().join(".braian");
    fs::create_dir_all(&braian).expect("create .braian");
    fs::write(braian.join("mcp.json"), body).expect("write mcp.json");
}

#[test]
fn list_tools_returns_empty_when_no_servers_configured() {
    let dir = TempDir::new().expect("tempdir");
    write_mcp_json(&dir, r#"{ "mcpServers": {} }"#);
    let out = runtime::list_tools(dir.path(), None).expect("list tools");
    assert!(out.servers.is_empty());
}

#[test]
fn call_tool_errors_for_unknown_server() {
    let dir = TempDir::new().expect("tempdir");
    write_mcp_json(
        &dir,
        r#"{ "mcpServers": { "demo": { "command": "node", "args": ["demo.js"] } } }"#,
    );
    let err = runtime::call_tool(
        dir.path(),
        "missing",
        "tool_name",
        serde_json::json!({ "a": 1 }),
    )
    .expect_err("unknown server should error");
    assert!(err.contains("Unknown MCP server"));
}

#[test]
fn stdio_server_everything_smoke_opt_in() {
    if std::env::var("BRAIAN_MCP_INTEGRATION").ok().as_deref() != Some("1") {
        // Keep regular test runs deterministic/offline; enable explicitly in CI or local checks.
        return;
    }

    let dir = TempDir::new().expect("tempdir");
    write_mcp_json(
        &dir,
        r#"{
  "mcpServers": {
    "everything": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    }
  }
}"#,
    );

    let listed = runtime::list_tools(dir.path(), None).expect("list tools");
    let everything = listed
        .servers
        .iter()
        .find(|s| s.name == "everything")
        .expect("everything server in list");
    assert!(
        everything.error.is_none(),
        "unexpected list error: {:?}",
        everything.error
    );
    assert!(
        !everything.tools.is_empty(),
        "expected server-everything to expose tools"
    );

    let tool_result = runtime::call_tool(
        dir.path(),
        "everything",
        "echo",
        serde_json::json!({ "message": "hello" }),
    );
    match tool_result {
        Ok(text) => {
            assert!(
                text.contains("hello"),
                "echo output should include payload; got: {text}"
            );
        }
        Err(err) => {
            panic!("expected echo tool call to succeed, got: {err}");
        }
    }
}
