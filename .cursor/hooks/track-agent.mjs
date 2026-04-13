/**
 * AI Pilot Tracker — Cursor Hook (cross-platform)
 * Runs after each agent response. Uses Node so Windows does not prompt "Open with" for .sh files.
 *
 * First-time setup (terminal): node .cursor/hooks/track-agent.mjs --register
 */

import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import { stdin as input } from "node:process";

const CONFIG_FILE = path.join(os.homedir(), ".ai-pilot-config");
const API_URL =
  "https://slbzmnxyriiuxyevkllu.supabase.co/functions/v1/ingest-event";
const REGISTER_URL =
  "https://slbzmnxyriiuxyevkllu.supabase.co/functions/v1/register-pilot";

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  const content = fs.readFileSync(CONFIG_FILE, "utf8");
  let pilotId;
  let apiToken;
  for (const line of content.split("\n")) {
    const p = line.match(/^PILOT_ID=(.+)/);
    if (p) pilotId = p[1].trim();
    const t = line.match(/^API_TOKEN=(.+)/);
    if (t) apiToken = t[1].trim();
  }
  if (!pilotId || !apiToken) return null;
  return { pilotId, apiToken };
}

function writeConfig(pilotId, apiToken) {
  fs.writeFileSync(
    CONFIG_FILE,
    `PILOT_ID=${pilotId}\nAPI_TOKEN=${apiToken}\n`,
    "utf8"
  );
}

async function registerPilot(handle) {
  const res = await fetch(REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle }),
  });
  const data = await res.json();
  const pilotId = data.pilot_id;
  const apiToken = data.api_token;
  if (!pilotId || !apiToken) {
    throw new Error(
      `Registration failed: ${JSON.stringify(data)}`
    );
  }
  writeConfig(pilotId, apiToken);
  return { pilotId, apiToken };
}

async function drainHookStdin() {
  const chunks = [];
  for await (const chunk of input) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseFilesChanged() {
  const raw = process.env.CURSOR_FILES_CHANGED ?? "[]";
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function runRegisterCli() {
  console.log("🚀 Welcome to the AI Pilot Fleet!");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const handle = await new Promise((resolve) => {
    rl.question("Choose your pilot handle: ", resolve);
  });
  rl.close();
  if (!handle?.trim()) {
    console.error("No handle entered.");
    process.exit(1);
  }
  const { pilotId } = await registerPilot(handle.trim());
  console.log(`✅ Registered as ${handle.trim()}! You're in the fleet. (${pilotId})`);
}

async function runHook() {
  await drainHookStdin();

  let cfg = loadConfig();
  if (!cfg && process.env.AI_PILOT_HANDLE?.trim()) {
    await registerPilot(process.env.AI_PILOT_HANDLE.trim());
    cfg = loadConfig();
  }
  if (!cfg) {
    return;
  }

  const { pilotId, apiToken } = cfg;
  const model = process.env.CURSOR_AGENT_MODEL ?? "unknown";
  const tokensIn = Number(process.env.CURSOR_TOKENS_IN ?? 0);
  const tokensOut = Number(process.env.CURSOR_TOKENS_OUT ?? 0);
  const duration = Number(process.env.CURSOR_DURATION_MS ?? 0);
  const filesChanged = parseFilesChanged();
  const promptLen = Number(process.env.CURSOR_PROMPT_LENGTH ?? 0);
  const accepted = process.env.CURSOR_ACCEPTED === "false" ? false : true;

  await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pilot_id: pilotId,
      api_token: apiToken,
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      duration_ms: duration,
      files_changed: filesChanged,
      prompt_length: promptLen,
      accepted,
    }),
  }).catch(() => {});
}

const isRegister = process.argv.includes("--register");
if (isRegister) {
  runRegisterCli().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  runHook().catch(() => process.exit(0));
}
