import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

let home: string | undefined;
afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
});

it.skipIf(process.platform === "win32")("keeps the user's Factory settings.json when a rewrite fails partway", () => {
  home = mkdtempSync(join(tmpdir(), "omb-factory-"));
  mkdirSync(join(home, ".factory"));
  const path = join(home, ".factory", "settings.json");
  const original = `${JSON.stringify({ customModels: [{ id: "custom:mine", model: "m".repeat(4000), baseUrl: "https://example.test/v1" }] }, null, 2)}\n`;
  writeFileSync(path, original);
  const script = `const { ensureDroidInjectModel } = await import(${JSON.stringify(new URL("./droid.ts", import.meta.url).href)});
const { encodeInjectId } = await import(${JSON.stringify(new URL("../local-inject.ts", import.meta.url).href)});
try { ensureDroidInjectModel(encodeInjectId("ollama", "qwen3:8b"), { FACTORY_HOME_OVERRIDE: ${JSON.stringify(home)} }); } catch { process.exit(3); }`;
  const child = spawnSync(
    "/bin/sh",
    ["-c", 'ulimit -f 1; exec "$0" --experimental-strip-types --input-type=module -e "$1"', process.execPath, script],
    { encoding: "utf8" },
  );
  expect(child.status, child.stderr).toBe(3);
  expect(readFileSync(path, "utf8")).toBe(original);
});
