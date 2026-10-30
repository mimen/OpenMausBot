import type { IncomingMessage } from "node:http";

export function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let done = false;
    const fail = (status: number, msg: string) => {
      if (done) return;
      done = true;
      chunks.length = 0;
      reject(Object.assign(new Error(msg), { status }));
    };
    req.on("data", (c: Buffer | string) => {
      if (done) return;
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      bytes += buf.length;
      if (bytes > 1_000_000) {
        // Keep draining the socket, but stop retaining attacker-controlled
        // bytes. Destroying the request here prevents the caller from
        // receiving the useful 413 response.
        return fail(413, "body too large");
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (done) return;
      // One decode of the whole body. Per-chunk toString() turns a UTF-8
      // sequence split across TCP chunks into U+FFFD, and JSON.parse accepts it.
      const data = Buffer.concat(chunks).toString("utf8");
      let body: any;
      try {
        body = data ? JSON.parse(data) : {};
      } catch {
        return fail(400, "invalid JSON body");
      }
      done = true;
      resolve(body);
    });
    req.on("error", (e) => fail(400, e instanceof Error ? e.message : String(e)));
  });
}
