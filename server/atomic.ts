// Durable, atomic file replace: write to a sibling temp file, fsync it, then
// rename over the target. rename(2) is atomic on the same filesystem, so a
// crash or power loss mid-write can never leave a truncated file behind — a
// reader always sees either the complete old contents or the complete new
// ones. Without this, an interrupted writeFileSync produces half-written JSON
// that fails to parse on next boot and is silently treated as empty state.
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";

export function writeFileAtomic(path: string, data: string, options: { mode?: number } = {}): void {
  // Replace a symlink's target, not the link, and keep the existing file's
  // mode unless the caller asks for one: callers rewrite the user's dotfiles.
  let target = path;
  let mode = options.mode;
  try {
    target = realpathSync(path);
    mode ??= statSync(target).mode & 0o7777;
  } catch {
    /* a new file */
  }
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | null = null;
  try {
    // Apply sensitive-file permissions to the temporary inode itself. The
    // final rename preserves them and never leaves a broader-permission
    // config file visible between the write and a later chmod.
    fd = openSync(tmp, "w", mode);
    writeFileSync(fd, data);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tmp, target);
  } catch (e) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* best-effort cleanup */
      }
    }
    try {
      unlinkSync(tmp);
    } catch {
      /* best-effort cleanup */
    }
    throw e;
  }
}
