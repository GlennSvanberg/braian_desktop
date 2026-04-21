/** Workspace-relative index of Arrow sandbox apps (Git-friendly). */
export const ARROW_APPS_INDEX_PATH = '.braian/arrow-apps.json'

/** Per-app folder under workspace root. */
export const ARROW_APPS_DIR = '.braian/arrow-apps'

export function arrowAppDirRelative(appId: string): string {
  return `${ARROW_APPS_DIR}/${appId}`
}

export function arrowAppMainTsRelative(appId: string): string {
  return `${arrowAppDirRelative(appId)}/main.ts`
}

export function arrowAppMainCssRelative(appId: string): string {
  return `${arrowAppDirRelative(appId)}/main.css`
}

export function arrowAppManifestRelative(appId: string): string {
  return `${arrowAppDirRelative(appId)}/manifest.json`
}
