"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RunStatus } from "../lib/runner";

const MAX_KEY = "job-agent-max-per-run";

/** Turn the script's latest log line into something worth reading. */
function describe(line: string): { text: string; percent: number } {
  const m = /^\[(\d+)\/(\d+)\]/.exec(line);
  if (m) return { text: `Checking posting ${m[1]} of ${m[2]}`, percent: (Number(m[1]) / Number(m[2])) * 100 };
  if (/^(Run summary|Digest|Model usage)/.test(line)) return { text: "Sending the digest…", percent: 100 };
  return { text: "Scanning the job boards…", percent: 3 };
}

const money = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : n < 10 ? 3 : 2)}`;

interface Props {
  /** MAX_POSTINGS_PER_RUN from .env: the starting value, and what scheduled runs use. */
  defaultMax: number;
  /** Average paid-tier cost of checking one posting, from recorded runs. */
  costPerPosting: number | null;
}

export function RunButton({ defaultMax, costPerPosting }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [max, setMax] = useState(String(defaultMax));
  const wasRunning = useRef(false);

  // Remember the last number chosen in this browser.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MAX_KEY);
      if (saved && Number(saved) >= 1) setMax(saved);
    } catch {
      // Storage unavailable: keep the default.
    }
  }, []);

  // Poll while a run is in progress; reload the page's data when it finishes.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const s: RunStatus = await (await fetch("/api/run", { cache: "no-store" })).json();
        if (stop) return;
        setStatus(s);
        if (wasRunning.current && !s.running) router.refresh();
        wasRunning.current = s.running;
        if (s.running) timer = setTimeout(poll, 3000);
      } catch {
        if (!stop) timer = setTimeout(poll, 5000);
      }
    };
    poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [router, status?.startedAt]);

  const count = Math.floor(Number(max));
  const valid = Number.isFinite(count) && count >= 1 && count <= 500;

  const start = async () => {
    if (!valid) return;
    try {
      localStorage.setItem(MAX_KEY, String(count));
    } catch {
      // Not remembered; the run still starts.
    }
    const s: RunStatus = await (
      await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max: count }),
      })
    ).json();
    wasRunning.current = s.running;
    setStatus(s);
  };

  const running = status?.running ?? false;
  const progress = describe(status?.lastLine ?? "");
  // A run that died before it could record itself (for example, no database).
  const crashed = !running && status?.finishedAt && status.exitCode !== 0 && /database/i.test(status.lastLine);

  return (
    <>
      <div className="runbox">
        <label className="small muted" htmlFor="max-per-run">Check up to</label>
        <input
          id="max-per-run"
          type="number"
          min={1}
          max={500}
          step={1}
          inputMode="numeric"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          disabled={running}
          aria-describedby="max-per-run-hint"
        />
        <span className="small muted">postings</span>
        <button className="primary" onClick={start} disabled={running || status === null || !valid}>
          {running && <span className="spinner" aria-hidden="true" />}
          {running ? "Running…" : "Find new jobs"}
        </button>
      </div>
      {!running && (
        <div id="max-per-run-hint" className="small muted runhint">
          {!valid
            ? "Enter a number from 1 to 500."
            : costPerPosting != null
              ? `Checking ${count} would cost about ${money(count * costPerPosting)}, going by earlier runs.`
              : "New postings checked in this run. The rest wait for the next run."}
        </div>
      )}
      {running && (
        <div className="progress small muted" style={{ flexBasis: "100%" }}>
          {progress.text}. You can leave this page; the run carries on.
          <div className="progress-bar"><div style={{ width: `${progress.percent}%` }} /></div>
        </div>
      )}
      {crashed && (
        <div className="notice error" style={{ flexBasis: "100%" }}>
          <b>The run could not start.</b>
          <span>{status?.lastLine}</span>
        </div>
      )}
    </>
  );
}
