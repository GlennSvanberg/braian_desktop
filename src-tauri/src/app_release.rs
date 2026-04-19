//! GitHub Releases metadata for desktop update prompts (no Tauri updater).

use serde::Serialize;

const GITHUB_LATEST: &str = "https://api.github.com/repos";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubReleaseAssetDto {
  pub name: String,
  pub browser_download_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubLatestReleaseDto {
  pub tag_name: String,
  pub html_url: String,
  pub body: Option<String>,
  pub assets: Vec<GithubReleaseAssetDto>,
  /// Best-effort direct installer URL for this OS, else null (use htmlUrl).
  pub preferred_download_url: Option<String>,
}

#[derive(serde::Deserialize)]
struct GhAsset {
  name: String,
  #[serde(rename = "browser_download_url")]
  browser_download_url: String,
}

#[derive(serde::Deserialize)]
struct GhRelease {
  #[serde(rename = "tag_name")]
  tag_name: String,
  #[serde(rename = "html_url")]
  html_url: String,
  body: Option<String>,
  assets: Vec<GhAsset>,
}

fn pick_preferred_download(assets: &[GithubReleaseAssetDto]) -> Option<String> {
  let pick_first = |suffixes: &[&str]| {
    for suf in suffixes {
      if let Some(a) = assets.iter().find(|a| a.name.ends_with(suf)) {
        return Some(a.browser_download_url.clone());
      }
    }
    None
  };

  if cfg!(target_os = "windows") {
    // Prefer WiX MSI, then NSIS-style setup exe, then any exe.
    pick_first(&[".msi", "-setup.exe", "_setup.exe", ".exe"])
  } else if cfg!(target_os = "macos") {
    pick_first(&[".dmg"])
  } else {
    pick_first(&[".AppImage", ".deb"])
  }
}

/// Returns the latest public GitHub release for `owner/repo`.
#[tauri::command]
pub fn check_github_release(owner: String, repo: String) -> Result<GithubLatestReleaseDto, String> {
  let owner = owner.trim();
  let repo = repo.trim();
  if owner.is_empty() || owner.contains('/') || repo.is_empty() || repo.contains('/') {
    return Err("Invalid owner or repo".into());
  }

  let url = format!("{GITHUB_LATEST}/{owner}/{repo}/releases/latest");
  let resp = ureq::get(&url)
    .set(
      "User-Agent",
      "BraianDesktop/1.0 (https://github.com/GlennSvanberg/braian_desktop)",
    )
    .set("Accept", "application/vnd.github+json")
    .call()
    .map_err(|e| format!("GitHub request failed: {e}"))?;

  if resp.status() == 404 {
    return Err("No published releases for this repository.".into());
  }
  if !(200..300).contains(&resp.status()) {
    return Err(format!("GitHub returned HTTP {}", resp.status()));
  }

  let text = resp
    .into_string()
    .map_err(|e| format!("GitHub response body: {e}"))?;
  let parsed: GhRelease =
    serde_json::from_str(&text).map_err(|e| format!("Invalid GitHub JSON: {e}"))?;

  let assets: Vec<GithubReleaseAssetDto> = parsed
    .assets
    .into_iter()
    .map(|a| GithubReleaseAssetDto {
      name: a.name,
      browser_download_url: a.browser_download_url,
    })
    .collect();

  let preferred_download_url = pick_preferred_download(&assets);

  Ok(GithubLatestReleaseDto {
    tag_name: parsed.tag_name,
    html_url: parsed.html_url,
    body: parsed.body,
    assets,
    preferred_download_url,
  })
}
