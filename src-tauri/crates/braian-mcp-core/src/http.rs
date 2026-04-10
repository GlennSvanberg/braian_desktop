use serde::Serialize;
use serde_json::Value;

const MAX_PROBE_TOOL_SUMMARIES: usize = 64;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolSummaryDto {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

pub fn map_tools_to_summaries(tools: &[Value]) -> Vec<McpToolSummaryDto> {
    let mut summaries = Vec::new();
    for t in tools.iter().take(MAX_PROBE_TOOL_SUMMARIES) {
        let name = t.get("name").and_then(|n| n.as_str()).unwrap_or("").trim();
        if name.is_empty() {
            continue;
        }
        let description = t
            .get("description")
            .and_then(|d| d.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        summaries.push(McpToolSummaryDto {
            name: name.to_string(),
            description,
        });
    }
    summaries
}
