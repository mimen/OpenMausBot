import { randomBytes, timingSafeEqual } from "node:crypto";

export type UiAccessScope = {
  botId: string;
  threadId: string;
  provider: string;
  providerInstanceId: string;
};

type UiAccessGrant = UiAccessScope & { expiresAt: number };

export class UiAccessRegistry {
  private grants = new Map<string, UiAccessGrant>();

  issue(scope: UiAccessScope, now = Date.now(), ttlMs = 4 * 60 * 60_000): string {
    this.prune(now);
    const token = randomBytes(24).toString("hex");
    this.grants.set(token, { ...scope, expiresAt: now + ttlMs });
    return token;
  }

  authorize(header: string | string[] | undefined, scope: UiAccessScope, now = Date.now()): boolean {
    this.prune(now);
    if (Array.isArray(header) || !header?.startsWith("Bearer ")) return false;
    const presented = header.slice("Bearer ".length);
    let matchedToken: string | null = null;
    for (const token of this.grants.keys()) {
      const expectedBytes = Buffer.from(token);
      const presentedBytes = Buffer.from(presented);
      if (expectedBytes.length === presentedBytes.length && timingSafeEqual(expectedBytes, presentedBytes)) {
        matchedToken = token;
        break;
      }
    }
    if (!matchedToken) return false;
    const grant = this.grants.get(matchedToken);
    return Boolean(
      grant &&
      grant.botId === scope.botId &&
      grant.threadId === scope.threadId &&
      grant.provider === scope.provider &&
      grant.providerInstanceId === scope.providerInstanceId,
    );
  }

  settleThread(threadId: string): void {
    for (const [token, grant] of this.grants) {
      if (grant.threadId === threadId) this.grants.delete(token);
    }
  }

  private prune(now: number): void {
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(token);
    }
  }
}
