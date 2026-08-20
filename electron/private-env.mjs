/** Capture a secret before any child is spawned, then remove it from the
 * ambient environment. Only a deliberately constructed child env can receive
 * it after this point. */
export function capturePrivateEnv(name, env = process.env) {
  const value = String(env[name] ?? "").trim();
  delete env[name];
  return value || null;
}

export function withoutPrivateEnv(source = process.env) {
  const env = { ...source };
  delete env.TODOIST_API_TOKEN;
  delete env.OMB_DESKTOP_ACTION_TOKEN;
  delete env.OMB_ELECTRON_USER_DATA;
  return env;
}
