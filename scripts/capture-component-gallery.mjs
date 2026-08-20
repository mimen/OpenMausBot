import { execFile, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const outputDir = path.join(root, "docs", "screenshots", "component-gallery");
const port = 19000 + Math.floor(Math.random() * 1_000);
const url = `http://127.0.0.1:${port}/?component-gallery=1`;
const viteEntry = path.join(root, "node_modules", "vite", "bin", "vite.js");
const preflight = path.join(process.env.HOME ?? "", ".claude", "chrome-agent", "preflight.sh");
const captureScript = path.join(process.env.HOME ?? "", ".claude", "chrome-agent", "capture.mjs");
mkdirSync(outputDir, { recursive: true });

const preview = spawn(process.execPath, [viteEntry, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  argv0: "openmaus:gallery-preview@component-suite",
  env: { ...process.env, PROCID: "openmaus:gallery-preview@component-suite" },
  stdio: ["ignore", "pipe", "pipe"],
});
let previewError = "";
preview.stderr.setEncoding("utf8");
preview.stderr.on("data", (chunk) => {
  previewError += chunk;
  if (previewError.length > 8_000) previewError = previewError.slice(-8_000);
});

async function waitForPreview() {
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    if (preview.exitCode !== null) throw new Error(`Gallery preview exited ${preview.exitCode}: ${previewError}`);
    if (Date.now() > deadline) throw new Error(`Gallery preview did not become ready: ${previewError}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function capture(name, width, height) {
  await run("chrome-devtools", ["resize_page", String(width), String(height)]);
  await run(process.execPath, [captureScript, path.join(outputDir, name), "component-gallery=1"]);
}

let pageId = null;
try {
  const prepared = await run(preflight);
  if (!prepared.stdout.includes("STATE:READY")) throw new Error(prepared.stdout.trim());
  await waitForPreview();
  const opened = await run("chrome-devtools", ["new_page", url]);
  const selected = opened.stdout.split("\n").find((line) => line.includes("component-gallery=1") && line.includes("[selected]"));
  pageId = selected?.match(/^([\w-]+):/)?.[1] ?? null;
  await capture("component-gallery-desktop.png", 1200, 1400);
  await capture("component-gallery-narrow.png", 390, 1400);
  console.log(`wrote component gallery screenshots to ${outputDir}`);
} finally {
  if (pageId) await run("chrome-devtools", ["close_page", pageId]).catch(() => {});
  preview.kill("SIGTERM");
  await new Promise((resolve) => {
    if (preview.exitCode !== null) return resolve();
    preview.once("exit", resolve);
    setTimeout(() => {
      preview.kill("SIGKILL");
      resolve();
    }, 3_000).unref?.();
  });
}
