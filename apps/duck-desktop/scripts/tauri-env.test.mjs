import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("launches the real Tauri CLI when the workspace path contains spaces", () => {
  const script = fileURLToPath(new URL("./tauri-env.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--version"], {
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/^tauri-cli \d+\.\d+/);
});
