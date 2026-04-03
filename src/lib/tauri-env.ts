/** True when running inside the Tauri WebView (not plain browser dev). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
