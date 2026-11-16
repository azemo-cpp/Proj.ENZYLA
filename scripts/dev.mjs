// Starts Vite (the app) and Daryl's server together.
// Press Ctrl+C to stop both.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const isWin = process.platform === "win32";
const node = process.execPath;
const vite = path.join(root, "node_modules", ".bin", isWin ? "vite.cmd" : "vite");

const darylPort = process.env.DARYL_PORT ?? "8787";
const autostart = process.env.DARYL_AUTOSTART !== "0";

function runVite() {
  const child = spawn(vite, [], {
    cwd: root,
    stdio: "inherit",
    shell: true
  });
  child.on("error", err => console.error(`[dev] vite failed: ${err.message}`));
  return child;
}

function runDaryl(port) {
  const child = spawn(node, [path.join(root, "daryl", "server.js")], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, PORT: port }
  });
  child.on("error", err => console.error(`[dev] daryl failed: ${err.message}`));
  return child;
}

const viteProc = runVite();
const darylProc = autostart ? runDaryl(darylPort) : null;

function stop() {
  viteProc.kill();
  darylProc?.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
