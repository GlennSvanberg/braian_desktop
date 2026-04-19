/** `owner/name` for GitHub Releases (update check + download links). */
const DEFAULT_DESKTOP_RELEASES_REPO = 'GlennSvanberg/braian_desktop'

export function getDesktopReleasesRepo(): string {
  const raw = import.meta.env.VITE_DESKTOP_RELEASES_REPO as string | undefined
  const s = raw?.trim()
  if (s && s.includes('/') && !s.includes('..')) {
    return s
  }
  return DEFAULT_DESKTOP_RELEASES_REPO
}

export function getDesktopReleasesOwnerRepo(): { owner: string; repo: string } {
  const full = getDesktopReleasesRepo()
  const [owner, repo] = full.split('/', 2)
  return { owner: owner ?? 'GlennSvanberg', repo: repo ?? 'braian_desktop' }
}

export function desktopReleasesLatestPageUrl(): string {
  const repo = getDesktopReleasesRepo()
  return `https://github.com/${repo}/releases/latest`
}

export type GithubReleaseAssetDto = {
  name: string
  browserDownloadUrl: string
}

export type GithubLatestReleaseDto = {
  tagName: string
  htmlUrl: string
  body: string | null
  assets: GithubReleaseAssetDto[]
  preferredDownloadUrl: string | null
}
