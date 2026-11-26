import Link from "next/link";
import { config } from "../lib/config";
import { pool } from "../lib/db";
import { loadPrices, loadSetups } from "../lib/prices";
import type { Notice, PostingRow, RunRow } from "../lib/types";
import { checkedIn, CostPanel, costPerPosting } from "./cost";
import { PostingCard } from "./posting-card";
import { RunButton } from "./run-button";

export const dynamic = "force-dynamic";

type Tab = "review" | "applied" | "skipped" | "closed";
const TABS: Tab[] = ["review", "applied", "skipped", "closed"];

function NoticeBox({ n }: { n: Notice }) {
  return (
    <div className={`notice ${n.level}`}>
      <b>{n.title}</b>
      {n.detail && <span>{n.detail}</span>}
    </div>
  );
}

/** One line on the last run, then anything it needs you to know. */
function LastRun({ run }: { run: RunRow | undefined }) {
  if (!run || run.status === "running") return null;
  const when = new Date(run.finished_at ?? run.started_at).toLocaleString(undefined, {
    weekday: "short", hour: "2-digit", minute: "2-digit",
  });
  const checked = checkedIn(run);
  const fits = run.tally["strong fit"] ?? 0;
  const free = (run.tally["off-title"] ?? 0) + (run.tally["duplicate"] ?? 0);
  const order = { error: 0, warning: 1, info: 2 };
  const notices = [...run.notices].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <div className="lastrun">
      <div className="small muted">
        <span className={`dot ${run.status === "failed" ? "failed" : ""}`} aria-hidden="true" />
        Last run {when}: checked {checked} {checked === 1 ? "posting" : "postings"}, found {fits} strong {fits === 1 ? "fit" : "fits"}.
        {free > 0 && ` ${free} more were skipped for free by the title filter or as duplicates.`}
      </div>
      {notices.map((n, i) => <NoticeBox key={i} n={n} />)}
    </div>
  );
}

async function load() {
  const postings = await pool.query<PostingRow>("select * from postings order by score desc, date_seen desc, id desc");
  // The runs table appears with the first run; until then there is no last run.
  const runs = await pool
    .query<RunRow>("select * from runs order by id desc limit 90")
    .then((r) => r.rows)
    .catch(() => [] as RunRow[]);
  return { rows: postings.rows, runs };
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const requested = (await searchParams).tab;
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : "review";

  let data: Awaited<ReturnType<typeof load>>;
  try {
    data = await load();
  } catch {
    return (
      <>
        <h1>Job agent</h1>
        <NoticeBox
          n={{
            level: "error",
            title: "The database is not running.",
            detail: "Start Docker Desktop, run “npm run db:up” in the project folder, then reload this page.",
          }}
        />
      </>
    );
  }
  const { rows, runs } = data;
  const run = runs[0];
  const prices = loadPrices();

  const lists: Record<Tab, PostingRow[]> = {
    review: rows.filter((p) => (p.state === "strong_fit" || p.state === "emailed") && !p.closed_at),
    applied: rows.filter((p) => p.state === "applied"),
    skipped: rows.filter((p) => p.state === "skipped"),
    // Taken down before you applied or skipped.
    closed: rows.filter((p) => (p.state === "strong_fit" || p.state === "emailed") && p.closed_at),
  };
  const interviews = lists.applied.filter((p) => p.outcome === "interview").length;
  const rate = lists.applied.length ? ((interviews / lists.applied.length) * 10).toFixed(1) : "–";
  const empty: Record<Tab, string> = {
    review: "Nothing to review. Press “Find new jobs” to scan the job boards.",
    applied: "No applications yet. Mark a posting “I applied” after you submit it.",
    skipped: "Nothing skipped.",
    closed: "No saved posting has been taken down.",
  };

  return (
    <>
      <div className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <div>
            <h1>Job agent</h1>
            <div className="small muted">
              Remote and Gulf jobs open to Egypt · <Link href="/ask">Answer questions for another job</Link>
            </div>
          </div>
        </div>
        <RunButton defaultMax={config.maxPostingsPerRun} costPerPosting={costPerPosting(runs, prices)} />
      </div>
      <LastRun run={run} />

      <div className="stats">
        <div><b>{lists.review.length}</b><span className="small muted">to review</span></div>
        <div><b>{lists.applied.length}</b><span className="small muted">applied</span></div>
        <div className={interviews > 0 ? "good" : ""}><b>{interviews}</b><span className="small muted">interviews</span></div>
        <div><b>{rate}</b><span className="small muted">interviews per 10 applications</span></div>
      </div>

      <nav className="tabs">
        <Link href="/" className={tab === "review" ? "on" : ""}>To review <span className="count">{lists.review.length}</span></Link>
        <Link href="/?tab=applied" className={tab === "applied" ? "on" : ""}>Applied <span className="count">{lists.applied.length}</span></Link>
        <Link href="/?tab=skipped" className={tab === "skipped" ? "on" : ""}>Skipped <span className="count">{lists.skipped.length}</span></Link>
        {lists.closed.length > 0 && (
          <Link href="/?tab=closed" className={tab === "closed" ? "on" : ""}>Closed <span className="count">{lists.closed.length}</span></Link>
        )}
      </nav>

      {lists[tab].length === 0 && (
        <div className="empty">
          <span className="icon" aria-hidden="true" />
          {empty[tab]}
        </div>
      )}
      {/* key includes the tab so cards animate in again when you switch */}
      {lists[tab].map((p, i) => <PostingCard key={`${tab}-${p.id}`} p={p} index={i} />)}

      <CostPanel
        runs={runs}
        prices={prices}
        setups={loadSetups()}
        perRun={config.maxPostingsPerRun}
        screenModel={config.modelScreen}
      />
    </>
  );
}
