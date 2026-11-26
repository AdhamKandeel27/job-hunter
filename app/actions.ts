"use server";

import { existsSync, readFileSync } from "node:fs";
import { revalidatePath } from "next/cache";
import { answerQuestions } from "../agent/ask";
import { ModelError } from "../agent/model";
import { config } from "../lib/config";
import { pool } from "../lib/db";
import type { Outcome, QAItem, StoredAnswers } from "../lib/types";

const OUTCOMES: Outcome[] = ["interview", "rejected", "no_reply"];

function refresh(id: number) {
  revalidatePath("/");
  revalidatePath(`/posting/${id}`);
}

export async function markApplied(id: number) {
  await pool.query(
    "update postings set state = 'applied', applied_at = now() where id = $1 and state in ('strong_fit', 'emailed', 'skipped')",
    [id],
  );
  refresh(id);
}

export async function markSkipped(id: number) {
  await pool.query(
    "update postings set state = 'skipped' where id = $1 and state in ('strong_fit', 'emailed')",
    [id],
  );
  refresh(id);
}

/** Undo Applied or Skipped, back to waiting for a decision. */
export async function reopen(id: number) {
  await pool.query(
    `update postings
     set state = case when emailed_at is null then 'strong_fit' else 'emailed' end,
         applied_at = null, outcome = null, outcome_at = null
     where id = $1 and state in ('applied', 'skipped')`,
    [id],
  );
  refresh(id);
}

const DOC_COLUMN = { resume: "resume_md", cover: "cover_note" } as const;
export type DocField = keyof typeof DOC_COLUMN;

/** Save your edits to the tailored résumé or the cover note. The PDF downloads read the saved text. */
export async function saveDoc(id: number, field: DocField, text: string) {
  const column = DOC_COLUMN[field];
  if (!Number.isInteger(id) || !column) throw new Error("Unknown document");
  if (typeof text !== "string" || !text.trim()) throw new Error("The text is empty");
  if (text.length > 50_000) throw new Error("The text is too long");
  await pool.query(`update packages set ${column} = $2 where posting_id = $1`, [id, text]);
  revalidatePath(`/posting/${id}`);
}

export type AskResult = { ok: true; qa: QAItem[] } | { ok: false; error: string };

const MAX_QUESTIONS = 15;

function cleanQA(qa: QAItem[]): QAItem[] {
  return (Array.isArray(qa) ? qa : [])
    .slice(0, 50)
    .map((q) => ({
      question: String(q?.question ?? "").slice(0, 2000),
      answer: String(q?.answer ?? "").slice(0, 10000),
      note: String(q?.note ?? "").slice(0, 1000),
    }))
    .filter((q) => q.question.trim() || q.answer.trim());
}

/** Your full résumé and stored answers: from the last run, or from profile/ if no run has synced them. */
async function loadProfile(): Promise<{ resume: string; answers: StoredAnswers | null }> {
  const row = await pool
    .query<{ resume: string; answers: StoredAnswers }>("select resume, answers from profile where id = 1")
    .then((r) => r.rows[0])
    .catch(() => undefined);
  if (row?.resume) return { resume: row.resume, answers: row.answers ?? null };
  const resume = existsSync("profile/resume.md") ? readFileSync("profile/resume.md", "utf8").trim() : "";
  return { resume, answers: null };
}

function explain(err: unknown): string {
  if (err instanceof ModelError) {
    switch (err.kind) {
      case "quota": return "The OpenAI account is out of credit or at its spending limit.";
      case "auth": return "OpenAI rejected the API key. Check OPENAI_API_KEY in .env.";
      case "model": return `The model ${err.model} was not found. Check OPENAI_MODEL_JUDGE in .env.`;
      case "rate": return "OpenAI is rate limiting the account. Wait a minute and try again.";
      case "overloaded": return "OpenAI's servers are busy. Try again in a minute.";
      case "network": return "Could not reach OpenAI. Check the internet connection.";
      case "output": return "The model's reply could not be used. Try again.";
    }
  }
  return `Something went wrong: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`;
}

/**
 * Draft answers to application questions with the judge model. With a posting id,
 * the job's title, company and cover note are given to the model too.
 */
export async function askAI(postingId: number | null, overview: string, questions: string[]): Promise<AskResult> {
  const qs = (Array.isArray(questions) ? questions : []).map((q) => String(q).trim()).filter(Boolean);
  if (qs.length === 0) return { ok: false, error: "Add at least one question." };
  if (qs.length > MAX_QUESTIONS) return { ok: false, error: `Ask at most ${MAX_QUESTIONS} questions at a time.` };
  if (!config.openaiApiKey) return { ok: false, error: "OPENAI_API_KEY is not set in .env." };
  const text = String(overview ?? "").slice(0, 30_000);

  try {
    const profile = await loadProfile();
    let job: { title?: string; company?: string; coverNote?: string; resume?: string } = {};
    if (postingId !== null) {
      if (!Number.isInteger(postingId)) return { ok: false, error: "Unknown posting." };
      const r = await pool.query<{ title: string; company: string; cover_note: string; resume_md: string }>(
        `select p.title, p.company, k.cover_note, k.resume_md
         from postings p join packages k on k.posting_id = p.id where p.id = $1`,
        [postingId],
      );
      const row = r.rows[0];
      if (!row) return { ok: false, error: "Unknown posting." };
      job = { title: row.title, company: row.company, coverNote: row.cover_note, resume: row.resume_md };
    }
    const resume = profile.resume || job.resume || "";
    if (!resume) return { ok: false, error: "Your résumé is missing. Save it as profile/resume.md." };

    const qa = await answerQuestions({
      overview: text,
      questions: qs,
      resume,
      answers: profile.answers,
      title: job.title,
      company: job.company,
      coverNote: job.coverNote,
    });
    // The page merges these into its list and saves the list with saveQA.
    return { ok: true, qa };
  } catch (err) {
    return { ok: false, error: explain(err) };
  }
}

/** Save the overview and your edits to the questions and answers on a posting. */
export async function saveQA(postingId: number, overview: string, qa: QAItem[]): Promise<{ ok: boolean }> {
  if (!Number.isInteger(postingId)) return { ok: false };
  try {
    await pool.query("update packages set job_overview = $2, qa = $3 where posting_id = $1", [
      postingId,
      String(overview ?? "").slice(0, 30_000),
      JSON.stringify(cleanQA(qa)),
    ]);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function setOutcome(id: number, outcome: Outcome | null) {
  if (outcome !== null && !OUTCOMES.includes(outcome)) throw new Error("Unknown outcome");
  await pool.query(
    "update postings set outcome = $2, outcome_at = case when $2::text is null then null else now() end where id = $1 and state = 'applied'",
    [id, outcome],
  );
  refresh(id);
}
