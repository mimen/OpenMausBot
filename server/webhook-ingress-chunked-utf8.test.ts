import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { describe, expect, it } from "vitest";

import { listenWebhookIngress, webhookCredential, type WebhookIngress } from "./webhook-ingress.ts";
import { WebhookManager } from "./webhooks.ts";

// Reproduction: the ingress reads the body with `raw += chunk`, where chunk is
// a Buffer. Node stringifies each Buffer chunk independently, so a UTF-8
// sequence split across two TCP chunks becomes U+FFFD replacement characters.
// A raw socket lets us control the chunk boundary.

describe("webhook ingress chunked UTF-8", () => {
  it("preserves a multibyte character split across TCP chunks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-repro-"));
    const seen: Array<Record<string, unknown>> = [];
    const manager = new WebhookManager({
      file: join(dir, "webhooks.json"),
      botState: () => "ready",
      enqueue: (input) => {
        seen.push(input as Record<string, unknown>);
        return { id: "run-1" };
      },
    });
    const created = manager.create({ name: "t", prompt: "got: {{payload.message}}", botId: "maus-1" });
    const cred = webhookCredential("", created.webhook.endpointId, created.secret);
    const ingress: WebhookIngress = await listenWebhookIngress(manager, { port: 0 });

    const body = Buffer.from(JSON.stringify({ message: "héllo" }), "utf8");
    const split = body.indexOf(Buffer.from("é", "utf8")) + 1; // between é's two bytes
    const path = `/hooks/${created.webhook.endpointId}/${encodeURIComponent(created.secret)}`;
    const head = Buffer.from(
      `POST ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
    );

    const resp = await new Promise<string>((resolve, reject) => {
      const sock = net.connect(ingress.port, "127.0.0.1", () => {
        sock.write(head);
        sock.write(body.subarray(0, split));
        setTimeout(() => {
          sock.write(body.subarray(split));
          sock.end();
        }, 30);
      });
      let data = "";
      sock.on("data", (d) => (data += d));
      sock.on("error", reject);
      sock.on("close", () => resolve(data));
    });

    expect(resp).toContain("202");
    const prompt = String(seen.at(-1)?.prompt ?? "");
    expect(prompt).toContain('"message": "héllo"');
    expect(prompt).not.toContain("�");
    await new Promise<void>((r) => ingress.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });
});
