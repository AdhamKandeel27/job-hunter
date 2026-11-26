import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import path from "node:path";

// Starts the agent script (the same thing `npm run agent` runs) as a separate
// process, so the review page itself still never talks to sources, model or email.

interface RunState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logFile: string | null;
}

export interface RunStatus extends Omit<RunState, "logFile"> {
  /** The latest line of output: progress while running, the last message after. */
  lastLine: string;
  /** The "Run summary" and "Digest" lines once the run has printed them. */
  summary: string[];
}

// Kept on globalThis so a hot reload in dev does not forget a run in progress.
const g = globalThis as unknown as { __agentRun?: RunState };
const state: RunState = (g.__agentRun ??= {
  running: false, startedAt: null, finishedAt: null, exitCode: null, logFile: null,
});

/** `max`: how many new postings to check; left out, the agent uses MAX_POSTINGS_PER_RUN. */
export function startRun(max?: number): { started: boolean } {
  if (state.running) return { started: false };
  const args = [path.join("node_modules", "tsx", "dist", "cli.mjs"), "agent/run.ts"];
  if (max) args.push(`--max=${max}`);

  mkdirSync("logs", { recursive: true });
  const logFile = path.join("logs", `run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const fd = openSync(logFile, "a");
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    stdio: ["ignore", fd, fd],
    windowsHide: true,
  });
  closeSync(fd);

  Object.assign(state, {
    running: true, startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, logFile,
  });
  const finish = (code: number | null) => {
    if (!state.running) return;
    Object.assign(state, { running: false, finishedAt: new Date().toISOString(), exitCode: code ?? 1 });
  };
  child.on("exit", finish);
  child.on("error", () => finish(1));
  return { started: true };
}

export function runStatus(): RunStatus {
  const lines =
    state.logFile && existsSync(state.logFile)
      ? readFileSync(state.logFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      : [];
  const { logFile: _logFile, ...rest } = state;
  return {
    ...rest,
    lastLine: lines.at(-1) ?? "",
    summary: lines.filter((l) => l.startsWith("Run summary:") || l.startsWith("Digest:")),
  };
}
