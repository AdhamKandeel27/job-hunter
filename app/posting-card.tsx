import Link from "next/link";
import type { CSSProperties } from "react";
import { SOURCE_LABEL, type Outcome, type PostingRow } from "../lib/types";
import { markApplied, markSkipped, reopen, setOutcome } from "./actions";

const OUTCOME_LABEL: Record<Outcome, string> = {
  interview: "Got an interview",
  rejected: "Rejected",
  no_reply: "No reply",
};

// Green for the outcome you want, red for a rejection, brown for no news.
const OUTCOME_STYLE: Record<Outcome, string> = {
  interview: "success",
  rejected: "danger",
  no_reply: "neutral",
};

const day =(d: Date) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function Chips({ p }: { p: PostingRow }) {
  return (
    <div className="chips">
      <span className="chip">Pays in {p.currency}{p.pay ? `: ${p.pay}` : ""}</span>
      <span className={`chip ${p.eligibility_verdict === "eligible" ? "good" : "warn"}`}>
        {p.eligibility_verdict === "eligible" ? "Open to Egypt" : "Egypt eligibility unclear"}
      </span>
      {p.seniority === "entry" && <span className="chip">Entry level</span>}
      {p.closed_at && <span className="chip warn">Posting taken down</span>}
    </div>
  );
}

export function Evidence({ p }: { p: PostingRow }) {
  return (
    <details>
      <summary>
        {p.eligibility_verdict === "eligible" ? "Why you are eligible" : "Why eligibility is unclear"} ({p.eligibility_confidence} confidence)
      </summary>
      <div>{p.eligibility_reason}</div>
      {p.eligibility_evidence.map((q, i) => (
        <blockquote key={i}>{q}</blockquote>
      ))}
    </details>
  );
}

/** The decision buttons for whatever stage the posting is at. */
export function Decide({ p }: { p: PostingRow }) {
  if (p.state === "strong_fit" || p.state === "emailed") {
    return (
      <>
        <form action={markApplied.bind(null, p.id)}><button className="success">I applied</button></form>
        <form action={markSkipped.bind(null, p.id)}><button className="quiet">Skip</button></form>
      </>
    );
  }
  if (p.state === "applied") {
    return (
      <>
        {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => (
          <form key={o} action={setOutcome.bind(null, p.id, p.outcome === o ? null : o)}>
            <button className={`${OUTCOME_STYLE[o]} ${p.outcome === o ? "on" : ""}`} aria-pressed={p.outcome === o}>
              {OUTCOME_LABEL[o]}
            </button>
          </form>
        ))}
        <form action={reopen.bind(null, p.id)}><button className="quiet">Undo applied</button></form>
      </>
    );
  }
  return <form action={reopen.bind(null, p.id)}><button className="quiet">Move back to review</button></form>;
}

/** The fit score as a ring that fills to the score; green from 85 up. */
export function ScoreRing({ score }: { score: number }) {
  return (
    <span
      className={`score ${score >= 85 ? "high" : ""}`}
      style={{ "--p": score } as CSSProperties}
      title="Fit score out of 100"
      aria-label={`Fit score ${score} out of 100`}
    >
      <span>{score}</span>
    </span>
  );
}

export function PostingCard({ p, index = 0 }: { p: PostingRow; index?: number }) {
  return (
    <div className="card" style={{ "--i": Math.min(index, 8) } as CSSProperties}>
      <div className="card-head">
        <h3><Link href={`/posting/${p.id}`}>{p.title}</Link></h3>
        <ScoreRing score={p.score} />
      </div>
      <div className="muted small">
        {[p.company, p.location, p.applied_at ? `applied ${day(p.applied_at)}` : `found ${day(p.date_seen)}`, `via ${SOURCE_LABEL[p.source] ?? p.source}`]
          .filter(Boolean)
          .join(" · ")}
      </div>
      <Chips p={p} />
      <div className="small">{p.score_reason}</div>
      <Evidence p={p} />
      <div className="actions">
        <Link className="button primary" href={`/posting/${p.id}`}>Open package</Link>
        <a className="button secondary" href={p.url} target="_blank" rel="noreferrer">View posting</a>
        <span className="spacer" />
        <Decide p={p} />
      </div>
    </div>
  );
}
