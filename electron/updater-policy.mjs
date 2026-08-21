export const UPDATE_POLICY = Object.freeze({
  enabled: false,
  message: "Updates are managed manually for this custom build.",
});

export function initialUpdateState() {
  return UPDATE_POLICY.enabled
    ? { status: "idle" }
    : { status: "disabled", message: UPDATE_POLICY.message };
}
