"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import type { QAItem } from "../lib/types";
import { askAI, saveQA } from "./actions";
import { CopyButton } from "./copy-button";

const SUGGESTIONS = [
  "Why do you want this job?",
  "What's your most relevant experience?",
  "Why are you a good fit for this role?",
  "Tell us about a challenging project you worked on.",
  "What are your salary expectations?",
];

/** A textarea that grows with its text. */
function AutoText(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; minRows?: number }) {
  const { minRows = 2, ...rest } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={minRows} {...rest} />;
}

const blank = (): QAItem => ({ question: "", answer: "", note: "" });

/**
 * Paste the job overview, type the application's questions, and draft answers from
 * your résumé and stored answers. On a posting page everything is saved on the posting.
 */
export function AskPanel({
  postingId,
  initialOverview = "",
  initialQA = [],
}: {
  postingId: number | null;
  initialOverview?: string;
  initialQA?: QAItem[];
}) {
  const [overview, setOverview] = useState(initialOverview);
  const [rows, setRows] = useState<QAItem[]>(initialQA.length ? initialQA : [blank()]);
  const [busy, setBusy] = useState<"all" | number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [, start] = useTransition();
  const first = useRef(true);
  const questionRefs = useRef<(HTMLInputElement | null)[]>([]);
  const focusNext = useRef<number | null>(null);

  // Save edits on a posting a moment after typing stops.
  useEffect(() => {
    if (postingId === null) return;
    if (first.current) {
      first.current = false;
      return;
    }
    setSaveState("saving");
    const t = setTimeout(async () => {
      const r = await saveQA(postingId, overview, rows);
      setSaveState(r.ok ? "saved" : "failed");
    }, 800);
    return () => clearTimeout(t);
  }, [postingId, overview, rows]);

  useEffect(() => {
    if (focusNext.current !== null) {
      questionRefs.current[focusNext.current]?.focus();
      focusNext.current = null;
    }
  });

  const update = (i: number, patch: Partial<QAItem>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const addQuestion = (question = "") => {
    setRows((rs) => {
      // Fill an empty last row before adding a new one.
      const last = rs[rs.length - 1];
      if (question && last && !last.question.trim() && !last.answer.trim()) {
        return [...rs.slice(0, -1), { ...blank(), question }];
      }
      focusNext.current = question ? null : rs.length;
      return [...rs, { ...blank(), question }];
    });
  };

  const remove = (i: number) => setRows((rs) => (rs.length === 1 ? [blank()] : rs.filter((_, j) => j !== i)));

  /** Draft answers for every question (which = "all") or just one row. */
  function generate(which: "all" | number) {
    const asked = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.question.trim());
    const open = asked.filter(({ r }) => !r.answer.trim());
    // "All" answers only the open questions, so edited answers are kept; with none open it redoes them all.
    const targets = which === "all" ? (open.length ? open : asked) : [{ r: rows[which], i: which }];
    if (targets.length === 0) {
      setError("Type at least one question first.");
      return;
    }
    setError(null);
    setBusy(which);
    start(async () => {
      const res = await askAI(postingId, overview, targets.map(({ r }) => r.question));
      setBusy(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRows((rs) => {
        const next = [...rs];
        targets.forEach(({ i }, k) => {
          const got = res.qa[k];
          if (got && next[i]) next[i] = { ...next[i], answer: got.answer, note: got.note };
        });
        return next;
      });
    });
  }

  const asked = new Set(rows.map((r) => r.question.trim().toLowerCase()));
  const working = busy !== null;
  const count = rows.filter((r) => r.question.trim()).length;
  const openCount = rows.filter((r) => r.question.trim() && !r.answer.trim()).length;
  const generateLabel =
    openCount === 0 ? "Redo all answers" : openCount === 1 ? "Generate answer" : `Generate ${openCount} answers`;

  return (
    <section className="ask">
      <div className="section-head">
        <h2>Ask about this job</h2>
        {postingId !== null && saveState !== "idle" && (
          <span className={`small ${saveState === "failed" ? "bad" : "muted"}`}>
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Could not save"}
          </span>
        )}
      </div>
      <div className="small muted">
        Paste the job overview, add the questions the application asks, and the AI drafts answers from your résumé
        {postingId !== null ? ", stored answers and this job's cover note" : " and stored answers"}. It won&rsquo;t invent
        facts: anything it can&rsquo;t answer is left in [brackets] with a note.
      </div>

      <label className="ask-label" htmlFor={`overview-${postingId ?? "new"}`}>Job overview</label>
      <AutoText
        id={`overview-${postingId ?? "new"}`}
        className="field"
        minRows={5}
        placeholder="Paste the job description or overview here…"
        value={overview}
        onChange={(e) => setOverview(e.target.value)}
      />

      <div className="ask-label">Questions</div>
      {rows.map((r, i) => (
        <div className="qa ask-item" key={i}>
          <div className="ask-q">
            <input
              ref={(el) => { questionRefs.current[i] = el; }}
              className="field"
              placeholder={i === 0 ? "e.g. Why do you want this job?" : "Another question…"}
              value={r.question}
              onChange={(e) => update(i, { question: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (i === rows.length - 1 && r.question.trim()) addQuestion();
                  else questionRefs.current[i + 1]?.focus();
                }
              }}
            />
            <button
              type="button"
              className="quiet"
              disabled={working || !r.question.trim()}
              onClick={() => generate(i)}
              title="Draft an answer to this question only"
            >
              {busy === i ? <><span className="spinner" />Writing…</> : r.answer ? "Redo" : "Answer"}
            </button>
            <button type="button" className="quiet" disabled={working} onClick={() => remove(i)} aria-label="Remove question">
              ✕
            </button>
          </div>
          {(r.answer || (busy === "all" && r.question.trim())) && (
            <>
              {r.note && <div className="ask-note small">{r.note}</div>}
              <AutoText
                className="field answer"
                minRows={3}
                value={r.answer}
                placeholder={busy === "all" ? "Writing…" : ""}
                onChange={(e) => update(i, { answer: e.target.value })}
              />
              {r.answer && (
                <div className="ask-tools">
                  <span className="small muted">{r.answer.trim().split(/\s+/).filter(Boolean).length} words</span>
                  <CopyButton text={r.answer} />
                </div>
              )}
            </>
          )}
        </div>
      ))}

      <div className="chips">
        {SUGGESTIONS.filter((s) => !asked.has(s.toLowerCase())).map((s) => (
          <button type="button" key={s} className="chip-button" disabled={working} onClick={() => addQuestion(s)}>
            + {s}
          </button>
        ))}
      </div>

      {error && <div className="notice error"><b>{error}</b></div>}

      <div className="actions">
        <button type="button" className="quiet" disabled={working} onClick={() => addQuestion()}>+ Add question</button>
        <span className="spacer" />
        <button type="button" className="primary" disabled={working || count === 0} onClick={() => generate("all")}>
          {busy === "all" ? <><span className="spinner" />Writing answers…</> : generateLabel}
        </button>
      </div>
    </section>
  );
}
