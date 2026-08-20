import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const dataDir = process.env.OMB_DATA_DIR || "/private/tmp/openmaus-component-suite-dev";
const electronUserData = process.env.OMB_ELECTRON_USER_DATA || path.join(dataDir, "electron-user-data");
const serverPort = process.env.OMB_PORT || "18879";
const vitePort = process.env.OMB_VITE_PORT || "5199";
const desktopToken = process.env.OMB_DESKTOP_ACTION_TOKEN || randomBytes(24).toString("hex");
const require = createRequire(import.meta.url);
const electronPath = require("electron");
const viteEntry = path.join(root, "node_modules", "vite", "bin", "vite.js");
const serverEntry = path.join(root, "server", "index.ts");

mkdirSync(dataDir, { recursive: true });
mkdirSync(electronUserData, { recursive: true });

const sharedEnv = {
  ...process.env,
  OMB_DATA_DIR: dataDir,
  OMB_PORT: serverPort,
  OMB_WEBHOOK_PORT: String(Number(serverPort) + 1),
  OMB_DESKTOP_ACTION_TOKEN: desktopToken,
  OMB_ELECTRON_USER_DATA: electronUserData,
  ELECTRON_START_URL: `http://127.0.0.1:${vitePort}`,
};

const children = [
  spawn(process.execPath, ["--experimental-strip-types", serverEntry], {
    cwd: root,
    argv0: "openmaus:server@component-suite",
    env: { ...sharedEnv, PROCID: "openmaus:server@component-suite" },
    stdio: "inherit",
  }),
  spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", vitePort, "--strictPort"], {
    cwd: root,
    argv0: "openmaus:vite@component-suite",
    env: { ...sharedEnv, PROCID: "openmaus:vite@component-suite" },
    stdio: "inherit",
  }),
  spawn(electronPath, [root], {
    cwd: root,
    argv0: "openmaus:desktop@component-suite",
    env: { ...sharedEnv, PROCID: "openmaus:desktop@component-suite" },
    stdio: "inherit",
  }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    process.exit(code);
  }, 3_000).unref?.();
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));
for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    stop(1);
  });
  child.once("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`component-suite child exited code=${code} signal=${signal}`);
      stop(code ?? 1);
    }
  });
}

console.log(`OpenMaus component suite dev data: ${dataDir}`);
console.log(`Renderer: http://127.0.0.1:${vitePort}/?component-gallery=1`);
