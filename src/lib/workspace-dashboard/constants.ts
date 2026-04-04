/** Workspace-relative path to the main dashboard manifest (JSON). */
export const DASHBOARD_BOARD_RELATIVE_PATH = '.braian/dashboard/board.json'

/** Workspace-relative directory for full-page app JSON files. */
export const DASHBOARD_PAGES_DIR_RELATIVE_PATH = '.braian/dashboard/pages'

export function dashboardPageRelativePath(pageId: string): string {
  return `${DASHBOARD_PAGES_DIR_RELATIVE_PATH}/${pageId}.json`
}

/** Safe id segment for URLs and filenames (alphanumeric + hyphen). */
export const PAGE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/i
