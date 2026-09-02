import { spawn } from "node:child_process";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
let status = { phase: "idle" };
let buildProcess = null;
const STAGED_DIR = join(homedir(), ".infinite-ai", "staged-update");
const STAGED_MARKER = join(homedir(), ".infinite-ai", "staged-update.json");
function getBuildStatus() {
  return status;
}
function setStatus(s) {
  status = s;
}
function buildInBackground(cwd) {
  if (status.phase === "building") {
    return Promise.resolve(status);
  }
  setStatus({ phase: "building", startedAt: Date.now() });
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const npmCmd = isWin ? "npm.cmd" : "npm";
    buildProcess = spawn(npmCmd, ["run", "build"], {
      cwd,
      shell: isWin,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    buildProcess.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    buildProcess.stdout?.on("data", () => {
    });
    buildProcess.on("close", (code) => {
      buildProcess = null;
      if (code === 0) {
        try {
          stageBuild(cwd);
          const ready = { phase: "ready", stagedAt: Date.now(), stagedPath: STAGED_DIR };
          setStatus(ready);
          resolve(ready);
        } catch (e) {
          const failed = { phase: "failed", error: e.message };
          setStatus(failed);
          resolve(failed);
        }
      } else {
        const failed = { phase: "failed", error: stderr.slice(-2e3) || `Build exited ${code}` };
        setStatus(failed);
        resolve(failed);
      }
    });
    buildProcess.on("error", (e) => {
      buildProcess = null;
      const failed = { phase: "failed", error: e.message };
      setStatus(failed);
      resolve(failed);
    });
  });
}
function stageBuild(cwd) {
  const outDir = join(cwd, "out");
  const distDir = join(cwd, "dist", "win-unpacked");
  if (!existsSync(outDir)) throw new Error("Build output not found (out/ missing)");
  const sourceDir = existsSync(distDir) ? distDir : outDir;
  if (existsSync(STAGED_DIR)) rmSync(STAGED_DIR, { recursive: true, force: true });
  mkdirSync(STAGED_DIR, { recursive: true });
  const marker = JSON.stringify({ stagedAt: Date.now(), sourceDir, cwd }, null, 2);
  const markerDir = join(homedir(), ".infinite-ai");
  mkdirSync(markerDir, { recursive: true });
  writeFileSync(STAGED_MARKER, marker);
}
function hasStagedUpdate() {
  return existsSync(STAGED_MARKER);
}
function clearStagedUpdate() {
  try {
    if (existsSync(STAGED_MARKER)) rmSync(STAGED_MARKER, { force: true });
    if (existsSync(STAGED_DIR)) rmSync(STAGED_DIR, { recursive: true, force: true });
  } catch {
  }
  setStatus({ phase: "idle" });
}
function cancelBuild() {
  if (buildProcess && status.phase === "building") {
    buildProcess.kill();
    buildProcess = null;
    setStatus({ phase: "idle" });
    return true;
  }
  return false;
}
export {
  buildInBackground,
  cancelBuild,
  clearStagedUpdate,
  getBuildStatus,
  hasStagedUpdate
};
