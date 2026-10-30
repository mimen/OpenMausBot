import { createServer } from "node:http";
import net, { type AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { readBody } from "./read-body.ts";

// A Buffer chunk stringifies on its own. A UTF-8 sequence split across two
// TCP writes becomes U+FFFD, and JSON.parse then accepts the corrupted text.
describe("readBody", () => {
  it("preserves a multibyte character split across TCP chunks", async () => {
    const server = createServer(async (req, res) => {
      const body = await readBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (addr === null) throw new Error("no port");
    // SAFETY: listen(0) on an IP host returns AddressInfo, never a pipe path.
    const port = (addr as AddressInfo).port;

    const body = Buffer.from(JSON.stringify({ text: "héllo" }), "utf8");
    const split = body.indexOf(Buffer.from("é", "utf8")) + 1;
    const head = Buffer.from(
      `POST / HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
    );

    const resp = await new Promise<string>((resolve, reject) => {
      const sock = net.connect(port, "127.0.0.1", () => {
        sock.write(head);
        sock.write(body.subarray(0, split));
        setTimeout(() => {
          sock.write(body.subarray(split));
          sock.end();
        }, 30);
      });
      let data = "";
      sock.setEncoding("utf8");
      sock.on("data", (d) => (data += d));
      sock.on("error", reject);
      sock.on("close", () => resolve(data));
    });

    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(resp).toContain("200");
    expect(resp).toContain("héllo");
    expect(resp).not.toContain("\uFFFD");
  });
});
