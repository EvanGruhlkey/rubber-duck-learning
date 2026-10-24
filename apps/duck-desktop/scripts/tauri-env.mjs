/**
 * MSVC link.exe often hits LNK1318 (PDB errors) when `target/` lives under OneDrive
 * or other sync/AV-heavy paths. Redirect Cargo output to a local cache unless the
 * caller already set CARGO_TARGET_DIR.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");

if (!process.env.CARGO_TARGET_DIR) {
  let dir;
  if (platform() === "win32" && process.env.LOCALAPPDATA) {
    dir = join(process.env.LOCALAPPDATA, "RubberDuckDesktop", "cargo-target");
  } else {
    dir = join(homedir(), ".cache", "rubber-duck-desktop", "cargo-target");
  }
  mkdirSync(dir, { recursive: true });
  process.env.CARGO_TARGET_DIR = dir;
}

const tauriBin = join(pkgRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
if (!existsSync(tauriBin)) {
  console.error("Missing @tauri-apps/cli. From apps/duck-desktop run: npm install");
  process.exit(1);
}

const tauriArgs = process.argv.slice(2);
const child = spawnSync(process.execPath, [tauriBin, ...tauriArgs], {
  cwd: pkgRoot,
  stdio: "inherit",
  env: process.env,
  windowsHide: true,
});

process.exit(child.status === null ? 1 : child.status);
