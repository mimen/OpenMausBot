import { describe, expect, it } from "vitest";

import { capturePrivateEnv, withoutPrivateEnv } from "./private-env.mjs";

describe("Todoist child environment isolation", () => {
  it("captures and deletes the token before any child environment is derived", () => {
    const parent = { PATH: "/usr/bin", TODOIST_API_TOKEN: " todoist-private " };
    expect(capturePrivateEnv("TODOIST_API_TOKEN", parent)).toBe("todoist-private");
    expect(parent).toEqual({ PATH: "/usr/bin" });

    const childEnvironments = {
      loginShell: { ...parent, SHELL: "/bin/zsh" },
      container: { ...parent, DOCKER_HOST: "unix:///tmp/docker.sock" },
      vps: { ...parent, SSH_ALIAS: "test-vps" },
      provider: { ...parent, OMB_PROVIDER: "claudeAgent" },
      diagnostic: { ...parent, OMB_DIAGNOSTIC: "1" },
    };
    for (const child of Object.values(childEnvironments)) {
      expect(child.TODOIST_API_TOKEN).toBeUndefined();
    }
  });

  it("defensively strips a reintroduced token from arbitrary child envs", () => {
    expect(withoutPrivateEnv({ PATH: "/bin", TODOIST_API_TOKEN: "leak" })).toEqual({ PATH: "/bin" });
  });
});
