import { execFile, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const outputDir = path.join(root, "docs", "screenshots", "component-gallery");
const port = 19000 + Math.floor(Math.random() * 1_000);
const url = `http://127.0.0.1:${port}/?component-gallery=1&skin=atelier`;
const viteEntry = path.join(root, "node_modules", "vite", "bin", "vite.js");
const preflight = path.join(process.env.HOME ?? "", ".claude", "chrome-agent", "preflight.sh");
const cdpBase = "http://127.0.0.1:9222";
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

async function fetchJson(value) {
  const response = await fetch(value, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`CDP returned HTTP ${response.status}`);
  return response.json();
}

async function connect(endpoint) {
  const socket = new WebSocket(endpoint);
  const pending = new Map();
  let nextId = 1;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP connection timed out")), 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP connection failed"));
    }, { once: true });
  });
  socket.addEventListener("message", async (event) => {
    const stringData = z.string().safeParse(event.data);
    const blobData = z.instanceof(Blob).safeParse(event.data);
    const text = stringData.success
      ? stringData.data
      : blobData.success
        ? await blobData.data.text()
        : Buffer.from(event.data).toString("utf8");
    const message = JSON.parse(text);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message ?? "CDP command failed"));
    else request.resolve(message.result ?? {});
  });
  return {
    command(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, 10_000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function galleryTarget(pageId) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const targets = await fetchJson(`${cdpBase}/json/list`);
    const target = targets.find((candidate) => candidate.id === pageId || candidate.url === url);
    if (target?.webSocketDebuggerUrl) return target;
    if (Date.now() > deadline) throw new Error("Gallery Chrome target did not become debuggable.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitForDocument(client) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const state = await client.command("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
    if (state.result?.value === "complete") return;
    if (Date.now() > deadline) throw new Error("Gallery document did not finish loading.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function capture(target, name, viewport) {
  const client = await connect(target.webSocketDebuggerUrl);
  try {
    await client.command("Page.enable");
    await client.command("Runtime.enable");
    await client.command("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
      screenOrientation: { type: "portraitPrimary", angle: 0 },
    });
    await client.command("Emulation.setTouchEmulationEnabled", { enabled: viewport.mobile, maxTouchPoints: viewport.mobile ? 5 : 1 });
    await client.command("Page.reload", { ignoreCache: true });
    await waitForDocument(client);
    await client.command("Runtime.evaluate", {
      expression: "document.fonts.ready.then(() => new Promise((resolve, reject) => { const deadline = Date.now() + 10000; const check = () => { const figures = document.querySelectorAll('figure'); const alerts = [...document.querySelectorAll('[role=alert]')].map(element => element.textContent?.trim()).filter(Boolean); if (figures.length === 7 && alerts.length === 0) requestAnimationFrame(() => requestAnimationFrame(resolve)); else if (alerts.length > 0) reject(new Error('gallery rendered an error fallback: ' + alerts.join(' | '))); else if (Date.now() > deadline) reject(new Error('seven healthy gallery components did not render')); else setTimeout(check, 50); }; check(); }))",
      awaitPromise: true,
    });
    const extent = await client.command("Runtime.evaluate", {
      expression: "Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, ...Array.from(document.querySelectorAll('*'), element => element.getBoundingClientRect().bottom + window.scrollY)))",
      returnByValue: true,
    });
    const contentHeight = z.number().safeParse(extent.result?.value);
    if (!contentHeight.success || contentHeight.data < viewport.height) {
      throw new Error(`Gallery layout height is invalid: ${JSON.stringify(extent.result?.value)}`);
    }
    const screenshot = await client.command("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: viewport.width, height: contentHeight.data, scale: 1 },
    });
    const image = z.string().safeParse(screenshot.data);
    if (!image.success) throw new Error("CDP returned no gallery screenshot data.");
    writeFileSync(path.join(outputDir, name), Buffer.from(image.data, "base64"), { mode: 0o600 });
  } finally {
    client.close();
  }
}

let pageId = null;
try {
  const prepared = await run(preflight);
  if (!prepared.stdout.includes("STATE:READY")) throw new Error(prepared.stdout.trim());
  await waitForPreview();
  const opened = await run("chrome-devtools", ["new_page", url]);
  const selected = opened.stdout.split("\n").find((line) => line.includes("component-gallery=1") && line.includes("[selected]"));
  pageId = selected?.match(/^([\w-]+):/)?.[1] ?? null;
  if (!pageId) throw new Error("Gallery page did not expose a selectable Chrome target.");
  const target = await galleryTarget(pageId);
  await capture(target, "component-gallery-desktop.png", { width: 1200, height: 900, mobile: false });
  await capture(target, "component-gallery-narrow.png", { width: 390, height: 844, mobile: true });
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
