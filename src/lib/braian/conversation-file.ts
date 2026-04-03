/**
 * On-disk layout under each workspace (Rust is source of truth):
 * - `.braian/conversations/<id>.json` — thread meta, messages, draft, flags
 * - `.braian/canvas/<id>.md` — canonical markdown body for `document` canvas (when present)
 * - `.braian/artifacts/<id>.json` — tabular/visual payloads, or slim `{ kind: "document", title? }` (no `body`; body lives in `.md`)
 */
export const BRAIAN_ON_DISK_SCHEMA_VERSION = 1 as const
