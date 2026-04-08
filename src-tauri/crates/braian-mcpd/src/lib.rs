//! Small library surface so the desktop `app` crate can depend on this package.
//! That forces `cargo build -p app` / `tauri dev` to rebuild the `braian-mcpd` binary
//! whenever broker sources change (the app spawns `target/debug/braian-mcpd(.exe)`).

/// Call from `app` so the dependency is not optimized away.
#[inline]
pub fn build_dependency_anchor() {}

/// Normalize the request path from tiny_http: may be `/v1/probe` or an absolute URI
/// (`http://127.0.0.1:PORT/v1/probe`). We always match on the `/v1/...` suffix.
pub fn normalize_http_route_path(raw: &str) -> String {
  let no_query = raw.split('?').next().unwrap_or(raw).trim();
  if let Some(idx) = no_query.find("/v1/") {
    no_query[idx..].to_string()
  } else {
    no_query.to_string()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn normalizes_absolute_request_uri() {
    assert_eq!(
      normalize_http_route_path("http://127.0.0.1:19876/v1/probe"),
      "/v1/probe"
    );
  }

  #[test]
  fn keeps_plain_path() {
    assert_eq!(normalize_http_route_path("/v1/list-tools"), "/v1/list-tools");
  }

  #[test]
  fn strips_query() {
    assert_eq!(
      normalize_http_route_path("/v1/disconnect?x=1"),
      "/v1/disconnect"
    );
  }
}
