import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { workspaceDir, writeMemoryFile } from "./workspace.ts";

const BOT = "bot-memory-save-test";

it("keeps the previous MEMORY.md when a save fails partway", () => {
  writeMemoryFile(BOT, "# Memory\n- keep me\n");
  // A one-block file-size limit fails the write with EFBIG after the first
  // block, the same shape as the disk filling up mid-save.
  const script = `const { writeMemoryFile } = await import(${JSON.stringify(new URL("./workspace.ts", import.meta.url).href)});
try { writeMemoryFile(${JSON.stringify(BOT)}, "# Memory\\n" + "x".repeat(8000)); } catch { process.exit(3); }`;
  const child = spawnSync(
    "/bin/sh",
    ["-c", 'ulimit -f 1; exec "$0" --experimental-strip-types --input-type=module -e "$1"', process.execPath, script],
    { encoding: "utf8" },
  );
  expect(child.status, child.stderr).toBe(3);
  expect(readFileSync(join(workspaceDir(BOT), "MEMORY.md"), "utf8")).toBe("# Memory\n- keep me\n");
});
