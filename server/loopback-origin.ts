import { isIP } from "node:net";

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const value = host.trim().toLowerCase();
  if (!value) return false;

  let hostname = value;
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close < 0 || (value.length > close + 1 && !/^:\d+$/.test(value.slice(close + 1)))) return false;
    hostname = value.slice(1, close);
  } else {
    const firstColon = value.indexOf(":");
    const lastColon = value.lastIndexOf(":");
    if (firstColon >= 0 && firstColon === lastColon) {
      if (!/^\d+$/.test(value.slice(firstColon + 1))) return false;
      hostname = value.slice(0, firstColon);
    }
  }

  if (hostname === "localhost" || hostname === "localhost.") return true;
  if (isIP(hostname) === 4) return hostname.startsWith("127.");
  return hostname === "::1" || hostname === "0:0:0:0:0:0:0:1";
}

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true;
  try {
    const value = new URL(origin);
    return isLoopbackHost(value.hostname) && (value.protocol === "http:" || value.protocol === "https:");
  } catch {
    return false;
  }
}

export function trustedBrowserMutation(input: {
  origin: string | string[] | undefined;
  contentType: string | string[] | undefined;
}): { ok: true } | { ok: false; status: 403 | 415; error: string } {
  const origin = Array.isArray(input.origin) ? "" : (input.origin ?? "");
  if (!origin || !isAllowedOrigin(origin)) {
    return { ok: false, status: 403, error: "same-origin browser request required" };
  }
  const contentType = Array.isArray(input.contentType) ? "" : (input.contentType ?? "");
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return { ok: false, status: 415, error: "content-type must be application/json" };
  }
  return { ok: true };
}
