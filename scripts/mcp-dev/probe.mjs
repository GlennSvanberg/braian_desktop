/**
 * Fast MCP iteration: builds `braian-mcpd`, starts it, POSTs /v1/probe for each server in mcp.json.
 * No Tauri / Vite. Usage from repo root: `npm run mcp:dev`
 *
 * Env:
 *   MCP_TEST_WORKSPACE — absolute or relative path to workspace root (folder containing `.braian/mcp.json`).
 *                        Default: fixtures/mcp-test-workspace
 *   MCP_DEV_PORT       — broker port (default 19876)
 *   MCP_DEV_TOKEN      — shared secret (default braian-mcp-dev)
 *   MCP_DEV_VERBOSE    — if set, inherit stdio from braian-mcpd
 *   MCP_DEV_SERVERS    — comma-separated server names to probe (default: all in config)
 *   MCP_DEV_SKIP_BUILD — if set, do not run `cargo build` (use when exe is locked or you already built)
 *   MCP_DEV_TARGET_DIR — Cargo `--target-dir` for the broker (default: target/mcp-dev-broker under src-tauri).
 *                        Uses a separate dir so `npm run mcp:dev` can rebuild while Tauri holds target/debug/braian-mcpd.exe.
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const tauriDir = path.join(repoRoot, 'src-tauri')
const mcpDevTargetDir =
  process.env.MCP_DEV_TARGET_DIR ||
  path.join(tauriDir, 'target', 'mcp-dev-broker')

const workspaceArg =
  process.env.MCP_TEST_WORKSPACE ||
  path.join(repoRoot, 'fixtures', 'mcp-test-workspace')
const workspaceRoot = path.resolve(workspaceArg)

const port = Number(process.env.MCP_DEV_PORT || '19876')
const token = process.env.MCP_DEV_TOKEN || 'braian-mcp-dev'
const mcpJson = path.join(workspaceRoot, '.braian', 'mcp.json')

if (!fs.existsSync(mcpJson)) {
  console.error(`Missing ${mcpJson}`)
  process.exit(1)
}

const cfg = JSON.parse(fs.readFileSync(mcpJson, 'utf8'))
const allNames = Object.keys(cfg.mcpServers || {})
const filter = process.env.MCP_DEV_SERVERS?.split(',').map((s) => s.trim()).filter(Boolean)
const serverNames = filter?.length ? allNames.filter((n) => filter.includes(n)) : allNames

if (serverNames.length === 0) {
  console.error('No servers to probe (check mcp.json or MCP_DEV_SERVERS).')
  process.exit(1)
}

console.log('Workspace:', workspaceRoot)
console.log('Servers:', serverNames.join(', '))

if (!process.env.MCP_DEV_SKIP_BUILD) {
  try {
    execFileSync(
      'cargo',
      [
        'build',
        '-p',
        'braian-mcpd',
        '-q',
        '--target-dir',
        mcpDevTargetDir,
      ],
      {
        cwd: tauriDir,
        stdio: 'inherit',
      },
    )
  } catch (e) {
    console.error('\ncargo build failed.\n')
    throw e
  }
} else {
  console.log('(skipping cargo build — MCP_DEV_SKIP_BUILD)')
}

const exeName = process.platform === 'win32' ? 'braian-mcpd.exe' : 'braian-mcpd'
const exe = path.join(mcpDevTargetDir, 'debug', exeName)
if (!fs.existsSync(exe)) {
  console.error('braian-mcpd binary not found after build:', exe)
  process.exit(1)
}

const child = spawn(exe, ['--port', String(port), '--token', token], {
  stdio: process.env.MCP_DEV_VERBOSE ? 'inherit' : 'ignore',
})

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForBroker() {
  const url = `http://127.0.0.1:${port}/v1/probe`
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(url, { method: 'GET' })
      if (r.status === 405) return
    } catch {
      /* ECONNREFUSED until listen */
    }
    await sleep(100)
  }
  throw new Error('braian-mcpd did not become ready on port ' + port)
}

function shutdown() {
  try {
    child.kill('SIGTERM')
  } catch {
    /* */
  }
}

process.on('SIGINT', () => {
  shutdown()
  process.exit(130)
})

try {
  await waitForBroker()

  for (const serverName of serverNames) {
    const body = JSON.stringify({
      workspaceRootPath: workspaceRoot,
      workspace_root_path: workspaceRoot,
      serverName,
      server_name: serverName,
    })
    const url = `http://127.0.0.1:${port}/v1/probe`
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Braian-Mcpd-Token': token,
      },
      body,
    })
    const text = await r.text()
    let summary = text
    try {
      const j = JSON.parse(text)
      if (j.ok === true) {
        summary = `ok tools=${j.toolCount ?? '?'} transport=${j.transport}`
      } else if (j.ok === false) {
        summary = `fail transport=${j.transport} err=${(j.errorMessage || '').slice(0, 400)}`
      } else if (j.error) {
        summary = `http body error: ${j.error}`
      }
    } catch {
      /* raw */
    }
    console.log(`[${serverName}] HTTP ${r.status} ${summary}`)
    if (r.status !== 200) {
      console.log('  raw:', text.slice(0, 800))
    }
  }
} finally {
  shutdown()
  await sleep(200)
}
