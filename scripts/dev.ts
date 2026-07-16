import { spawn, type ChildProcess } from "node:child_process";

const children: ChildProcess[] = [];
let stopping = false;

function start(script: string): ChildProcess {
  const child = spawn("npm", ["run", script], { stdio: "inherit", env: process.env });
  children.push(child);
  child.once("exit", (code, signal) => {
    if (stopping) return;
    process.stderr.write(`STAMP ${script} exited (${signal ?? code ?? "unknown"})\n`);
    stop(code ?? 1);
  });
  return child;
}

function stop(exitCode = 0): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
start("api:start");
start("web:dev");
