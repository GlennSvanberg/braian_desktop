/**
 * Build braian-mcpd and copy it to src-tauri/bin/ for Tauri `bundle.externalBin`.
 * Run from `beforeBuildCommand` so the binary exists before `tauri build` bundles it
 * (avoids invoking `cargo` from build.rs, which can deadlock).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tauriDir = path.join(root, "src-tauri");

execSync("cargo build -p braian-mcpd --release", {
  cwd: tauriDir,
  stdio: "inherit",
});

const target = execSync("rustc --print host-tuple", {
  encoding: "utf8",
}).trim();
if (!target) {
  console.error("stage-mcpd-sidecar: could not read rustc host tuple");
  process.exit(1);
}

const ext = process.platform === "win32" ? ".exe" : "";
const src = path.join(tauriDir, "target", "release", `braian-mcpd${ext}`);
if (!fs.existsSync(src)) {
  console.error(`stage-mcpd-sidecar: expected broker at ${src}`);
  process.exit(1);
}

const binDir = path.join(tauriDir, "bin");
fs.mkdirSync(binDir, { recursive: true });
const dest = path.join(binDir, `braian-mcpd-${target}${ext}`);
fs.copyFileSync(src, dest);
console.log(`stage-mcpd-sidecar: copied ${dest}`);
