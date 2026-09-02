import { watch } from "node:fs";
import { join, relative } from "node:path";
let watcher = null;
let allowedPaths = /* @__PURE__ */ new Set();
let allowedUntil = 0;
const ALLOW_WINDOW_MS = 3e3;
let onViolation = null;
function allowWrite(filePath) {
  allowedPaths.add(filePath.toLowerCase());
  allowedUntil = Date.now() + ALLOW_WINDOW_MS;
  setTimeout(() => {
    if (Date.now() >= allowedUntil) allowedPaths.clear();
  }, ALLOW_WINDOW_MS + 500).unref?.();
}
function isAllowed(filePath) {
  if (Date.now() > allowedUntil) return false;
  return allowedPaths.has(filePath.toLowerCase());
}
function setViolationHandler(handler) {
  onViolation = handler;
}
function startGuard(cwd) {
  if (watcher) return;
  const srcDir = join(cwd, "src");
  try {
    watcher = watch(srcDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const fullPath = join(srcDir, filename);
      const rel = relative(cwd, fullPath).replace(/\\/g, "/");
      if (rel.includes("node_modules") || rel.startsWith("out/") || rel.startsWith("dist/")) return;
      if (isAllowed(fullPath) || isAllowed(rel)) return;
      onViolation?.(rel);
    });
    watcher.on("error", () => {
    });
  } catch {
  }
}
function stopGuard() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  allowedPaths.clear();
  onViolation = null;
}
export {
  allowWrite,
  isAllowed,
  setViolationHandler,
  startGuard,
  stopGuard
};
