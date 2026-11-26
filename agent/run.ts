import { existsSync, readFileSync } from "node:fs";
import { config } from "../lib/config";
import { pool } from "../lib/db";
import {
  SOURCE_LABEL, type Enriched, type FormQuestion, type Notice, type Posting, type Profile, type SourceName,
  type StoredAnswers,
} from "../lib/types";
import { ATS_LABEL, fetchForm, parseAts } from "./ats";
import { jobKey, titleProblem } from "./filter";
import { ModelError, usageSoFar } from "./model";
import { PermanentError, politeResolve } from "./http";
import { sendDigest } from "./mailer";
import { sourceByName, sources } from "./sources";
import { checkEligibility, firstPass, scoreFit, vet, writePackage } from "./steps";

const dryRun = process.argv.includes("--dry-run");

/** How many new postings this run checks: --max=N (set on the dashboard) or MAX_POSTINGS_PER_RUN. */
const maxPostings = (() => {
  const arg = process.argv.find((a) => a.startsWith("--max="));
  const n = arg ? Number(arg.slice("--max=".length)) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : config.maxPostingsPerRun;
})();

/** A problem you can fix yourself; shown on the review page as written. */
class SetupError extends Error {
  constructor(
    public title: string,
    public detail: string,
  ) {
    super(`${title} ${detail}`);
  }
}

/** Expected salary per currency. A bare figure with no currency is refused, not guessed. */
function readSalaries(raw: unknown): Record<string, string> {
  if (raw == null || raw === "") return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new SetupError(
      "Expected salary needs a currency.",
      'In profile/answers.json, write one figure per currency, for example { "USD": "2,200 per month", "EUR": "2,000 per month" }.',
    );
  }
  const out: Record<string, string> = {};
  for (const [code, value] of Object.entries(raw)) {
    const v = String(value ?? "").trim();
    if (v) out[code.trim().toUpperCase()] = v;
  }
  return out;
}

function loadProfile(): Profile {
  const resume = existsSync("profile/resume.md") ? readFileSync("profile/resume.md", "utf8").trim() : "";
  if (!resume) {
    throw new SetupError("Your résumé is missing.", "Save it as profile/resume.md (Markdown or plain text), then run again.");
  }
  let raw: any = {};
  if (existsSync("profile/answers.json")) {
    try {
      raw = JSON.parse(readFileSync("profile/answers.json", "utf8"));
    } catch {
      throw new SetupError("profile/answers.json could not be read.", "It is not valid JSON. Check for a missing comma or quote.");
    }
  }
  const answers: StoredAnswers = {
    address: String(raw.address ?? "").trim(),
    expectedSalary: readSalaries(raw.expectedSalary),
    noticePeriod: String(raw.noticePeriod ?? "").trim(),
  };
  return { resume, answers };
}

/** Step 1: scan every source. One source failing does not stop the others. */
async function scanAll(notices: Notice[]): Promise<Posting[][]> {
  const perSource: Posting[][] = [];
  for (const s of sources) {
    try {
      const found = await s.scan();
      console.log(`Scan: ${s.name} returned ${found.length} postings.`);
      perSource.push(found);
    } catch (err) {
      console.error(`Scan: ${s.name} failed: ${String(err)}`);
      notices.push({
        level: "warning",
        title: `${SOURCE_LABEL[s.name]} could not be read this run.`,
        detail: `The other sources were still checked. (${String(err instanceof Error ? err.message : err).slice(0, 160)})`,
      });
    }
  }
  if (perSource.length === 0) {
    throw new SetupError("No job source could be read.", "Check your internet connection and run again.");
  }
  return perSource;
}

/** Step 2: drop postings already judged on an earlier run. */
async function dropSeen(postings: Posting[]): Promise<Posting[]> {
  if (postings.length === 0) return [];
  const { rows } = await pool.query<{ source: string; url: string }>(
    "select source, url from fingerprints where url = any($1::text[])",
    [postings.map((p) => p.url)],
  );
  const seen = new Set(rows.map((r) => `${r.source} ${r.url}`));
  return postings.filter((p) => !seen.has(`${p.source} ${p.url}`));
}

/** Take postings from each source in turn, so one source cannot use up the daily cap. */
function interleave(lists: Posting[][]): Posting[] {
  const out: Posting[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length) out.push(l[i]);
  }
  return out;
}

const remember = (p: Posting) =>
  pool.query("insert into fingerprints (source, url, job_key) values ($1, $2, $3) on conflict do nothing", [
    p.source, p.url, jobKey(p),
  ]);

/** Company-and-title fingerprints of jobs judged in the last 60 days, on any board. */
async function recentJobKeys(): Promise<Set<string>> {
  const { rows } = await pool.query<{ job_key: string }>(
    "select job_key from fingerprints where job_key is not null and seen_at > now() - interval '60 days'",
  );
  return new Set(rows.map((r) => r.job_key));
}

/**
 * The questions on this job's real application form, when the job is hosted on
 * a system whose forms can be read (Greenhouse, Lever). null otherwise.
 */
async function applicationForm(p: Enriched): Promise<{ questions: FormQuestion[]; note: string } | null> {
  let ref = parseAts(p.url);
  if (!ref && p.source === "workingnomads") {
    // Working Nomads links hop to the employer's own page.
    try {
      ref = parseAts(await politeResolve(p.url));
    } catch {
      ref = null;
    }
  }
  if (!ref) return null;
  const questions = await fetchForm(ref);
  return questions ? { questions, note: ATS_LABEL[ref.kind] } : null;
}

/** Mark saved postings that have been taken down, so they leave the review list and the digest. */
async function closeStale(): Promise<number> {
  const { rows } = await pool.query<{ id: number; source: SourceName; url: string; closed_at: Date | null }>(
    "select id, source, url, closed_at from postings where state in ('strong_fit', 'emailed')",
  );
  let closed = 0;
  for (const r of rows) {
    const check = sourceByName[r.source]?.isOpen;
    if (!check) continue;
    const open = await check({ url: r.url }).catch(() => undefined);
    if (open === false && !r.closed_at) {
      await pool.query("update postings set closed_at = now() where id = $1", [r.id]);
      closed++;
    } else if (open === true && r.closed_at) {
      await pool.query("update postings set closed_at = null where id = $1", [r.id]);
    }
  }
  console.log(`Still open: checked ${rows.length} saved postings, ${closed} newly closed.`);
  return closed;
}

async function ensureEnriched(p: Posting): Promise<Enriched> {
  const full = p.text ? p : await sourceByName[p.source].enrich(p);
  if (!full.title || !full.text) throw new PermanentError(`No title or description for ${p.url}`);
  return { ...full, title: full.title, company: full.company || "Not stated", text: full.text };
}

type Result =
  | "first pass" | "not eligible" | "managerial" | "failed vetting" | "below cut-off" | "strong fit" | "duplicate";

/** Steps 3-6 for one posting. Nothing is saved unless it ends as a strong fit. */
async function judge(stub: Posting, profile: Profile, keys: Set<string>): Promise<Result> {
  // A stub with no title (Wuzzuf) must be loaded before it can be screened.
  // Only now is its company and title known, so the duplicate check happens here.
  if (!stub.title) {
    Object.assign(stub, await ensureEnriched(stub));
    const key = jobKey(stub);
    if (key && keys.has(key)) return "duplicate";
    if (key) keys.add(key);
  }
  const p: Posting = stub;

  const screen = await firstPass(p, profile);
  if (!screen.keep) return "first pass";

  const full = await ensureEnriched(p);

  const elig = await checkEligibility(full);
  if (elig.verdict === "blocked") return "not eligible";
  if (elig.seniority === "managerial") return "managerial";

  const vetting = await vet(full);
  if (!vetting.pass) return "failed vetting";

  const fit = await scoreFit(full, profile);
  if (fit.score < config.scoreCutoff) return "below cut-off";

  const form = await applicationForm(full);
  console.log(
    form
      ? `  Form: read ${form.questions.length} questions from the ${form.note} application form.`
      : "  Form: the application form could not be read; writing general answers.",
  );
  const pkg = await writePackage(full, profile, elig.payCurrency, form?.questions);

  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ id: number }>(
      `insert into postings (source, url, title, company, location, pay, currency, seniority,
         eligibility_verdict, eligibility_confidence, eligibility_reason, eligibility_evidence,
         vetting_reasons, score, score_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
      [
        full.source, full.url, full.title, full.company, full.location ?? null,
        elig.pay || null, elig.payCurrency || "not stated", elig.seniority,
        elig.verdict, elig.confidence, elig.reason, JSON.stringify(elig.evidence),
        JSON.stringify(vetting.reasons), fit.score, fit.reason,
      ],
    );
    await client.query(
      `insert into packages (posting_id, resume_md, cover_note, recruiter_note, form_answers, unanswered, form_source, form_note)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        rows[0].id, pkg.resume, pkg.coverNote, pkg.recruiterNote, JSON.stringify(pkg.formAnswers),
        JSON.stringify(pkg.unanswered), form ? "application_form" : "general", form?.note ?? null,
      ],
    );
    await client.query(
      "insert into fingerprints (source, url, job_key) values ($1, $2, $3) on conflict do nothing",
      [full.source, full.url, jobKey(full)],
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  return "strong fit";
}

/** Plain-language notice for a model problem that ends the run early. */
function stopNotice(err: ModelError, left: number): Notice {
  const later = `${left} ${left === 1 ? "posting was" : "postings were"} not checked and will be picked up on the next run.`;
  switch (err.kind) {
    case "quota":
      return {
        level: "warning",
        title: "Your OpenAI account is out of credit.",
        detail: `OpenAI refused the call because the account has no credit left or reached its spending limit. ${later} Add credit or raise the limit at platform.openai.com (Billing), then run again.`,
      };
    case "auth":
      return {
        level: "error",
        title: "OpenAI rejected your API key.",
        detail: "Check OPENAI_API_KEY in .env. You can create a new key at platform.openai.com/api-keys.",
      };
    case "model":
      return {
        level: "error",
        title: `The model "${err.model}" does not exist, or your key cannot use it.`,
        detail: "Change OPENAI_MODEL_SCREEN or OPENAI_MODEL_JUDGE in .env to a model your OpenAI account can use.",
      };
    case "rate":
      return {
        level: "warning",
        title: "OpenAI kept rate-limiting the agent.",
        detail: `${later} If this keeps happening, lower OPENAI_RPM in .env.`,
      };
    case "network":
      return { level: "warning", title: "The connection to OpenAI kept failing.", detail: `${later} Check your internet connection.` };
    default:
      return {
        level: "warning",
        title: "OpenAI is having server problems right now.",
        detail: `${err.model} kept answering with server errors. ${later} Try again in a while.`,
      };
  }
}

async function pipeline(notices: Notice[], tally: Record<string, number>) {
  // Check the setup before spending time on scanning.
  if (!config.openaiApiKey) {
    throw new SetupError("The OpenAI API key is missing.", "Add OPENAI_API_KEY to .env, then run again.");
  }
  const profile = loadProfile();
  const a = profile.answers;
  const missing = [
    !a.address && "address",
    Object.keys(a.expectedSalary).length === 0 && "expected salary",
    !a.noticePeriod && "notice period",
  ].filter(Boolean);
  if (missing.length) {
    notices.push({
      level: "info",
      title: `Not set in your stored answers: ${missing.join(", ")}.`,
      detail: "Until you add them to profile/answers.json, those questions are flagged on each package for you to answer.",
    });
  }
  await pool.query(
    `insert into profile (id, resume, answers) values (1, $1, $2)
     on conflict (id) do update set resume = excluded.resume, answers = excluded.answers, updated_at = now()`,
    [profile.resume, JSON.stringify(a)],
  );

  const bump = (k: string, by = 1) => (tally[k] = (tally[k] ?? 0) + by);

  // Free checks before any model call: the title filter, then jobs already
  // judged under another link (the same job on a second board).
  const fresh = await Promise.all((await scanAll(notices)).map(dropSeen));
  const keys = await recentJobKeys();
  const lists: Posting[][] = [];
  for (const list of fresh) {
    const kept: Posting[] = [];
    for (const p of list) {
      if (titleProblem(p)) {
        bump("off-title");
        continue;
      }
      const key = jobKey(p);
      if (key && keys.has(key)) {
        await remember(p);
        bump("duplicate");
        continue;
      }
      if (key) keys.add(key);
      kept.push(p);
    }
    lists.push(kept);
  }
  console.log(
    `Filter: skipped ${tally["off-title"] ?? 0} by title and ${tally["duplicate"] ?? 0} already seen on another board, at no cost.`,
  );

  const queue = interleave(lists);
  const batch = queue.slice(0, maxPostings);
  console.log(`Dedupe: ${queue.length} new postings; judging ${batch.length} this run (cap ${maxPostings}).`);
  if (queue.length > batch.length) {
    notices.push({
      level: "info",
      title: `${queue.length - batch.length} more new postings are waiting.`,
      detail: `This run checked up to ${maxPostings}. Run again to continue, or raise the number next to "Find new jobs".`,
    });
  }

  let firstError = "";
  let transientInARow = 0;

  for (const [i, p] of batch.entries()) {
    const label = `[${i + 1}/${batch.length}] ${p.source}: ${p.title ?? p.url}`;
    try {
      const result = await judge(p, profile, keys);
      // Strong fits were fingerprinted with their save; discards are fingerprinted here.
      if (result !== "strong fit") await remember(p);
      bump(result);
      transientInARow = 0;
      console.log(`${label} -> ${result === "strong fit" ? "STRONG FIT" : `dropped (${result})`}`);
    } catch (err) {
      if (err instanceof PermanentError) {
        await remember(p);
        bump("unreadable");
        console.error(`${label} -> skipped for good: ${err.message}`);
        continue;
      }
      // Not fingerprinted, so the next run tries it again.
      const fatal = err instanceof ModelError && ["quota", "auth", "model"].includes(err.kind);
      const transient = err instanceof ModelError && ["overloaded", "rate", "network"].includes(err.kind);
      transientInARow = transient ? transientInARow + 1 : 0;
      console.error(`${label} -> error, will retry next run: ${String(err).slice(0, 300)}`);

      // Stop when carrying on would only repeat the same failure.
      if (fatal || transientInARow >= 3) {
        const left = batch.length - i + (transientInARow >= 3 ? 2 : 0);
        tally["error"] = Math.max(0, (tally["error"] ?? 0) - (transientInARow >= 3 ? 2 : 0));
        if (!tally["error"]) delete tally["error"];
        tally["not checked"] = left;
        notices.push(stopNotice(err as ModelError, left));
        console.error("Stopping early; the remaining postings are picked up on the next run.");
        firstError = "";
        break;
      }
      bump("error");
      firstError ||= String(err instanceof Error ? err.message : err).slice(0, 200);
    }
  }

  if (tally["error"]) {
    notices.push({
      level: "warning",
      title: `${tally["error"]} ${tally["error"] === 1 ? "posting" : "postings"} hit an error and will be tried again next run.`,
      detail: firstError ? `First error: ${firstError}` : undefined,
    });
  }

  console.log("Run summary:", JSON.stringify(tally));

  // Before anything is emailed, drop saved postings that have been taken down.
  try {
    const closed = await closeStale();
    if (closed) {
      notices.push({
        level: "info",
        title: `${closed} saved ${closed === 1 ? "posting has" : "postings have"} been taken down.`,
        detail: "They moved from To review to the Closed tab.",
      });
    }
  } catch (err) {
    console.error(`Still open: check failed: ${String(err).slice(0, 200)}`);
  }

  const digest = await sendDigest();
  if (digest) notices.push(digest);
}

async function dryRunScan() {
  const all = await scanAll([]);
  const keys = new Set<string>();
  let offTitle = 0;
  let dupes = 0;
  const lists = all.map((list) =>
    list.filter((p) => {
      if (titleProblem(p)) return offTitle++, false;
      const key = jobKey(p);
      if (key && keys.has(key)) return dupes++, false;
      if (key) keys.add(key);
      return true;
    }),
  );
  const queue = interleave(lists);
  console.log(`Filter: ${offTitle} skipped by title, ${dupes} are the same job on another board.`);
  console.log(`Found ${queue.length} postings worth judging.`);
  for (const p of queue.slice(0, 15)) console.log(`  [${p.source}] ${p.title ?? "(title on job page)"} | ${p.url}`);
  console.log("Dry run: no model calls, nothing saved.");
}

async function main() {
  if (dryRun) return dryRunScan();

  // Keep the tables up to date, then open a record of this run for the review page.
  let runId: number;
  try {
    await pool.query(readFileSync("db/schema.sql", "utf8"));
    await pool.query(
      `update runs set status = 'failed', finished_at = now(),
         notices = notices || '[{"level":"warning","title":"This run was interrupted before it finished."}]'::jsonb
       where status = 'running'`,
    );
    runId = (await pool.query<{ id: number }>("insert into runs default values returning id")).rows[0].id;
  } catch (err) {
    console.error(String(err));
    console.error("Cannot reach the database. Start Docker Desktop, then run: npm run db:up");
    process.exitCode = 1;
    return;
  }

  const notices: Notice[] = [];
  const tally: Record<string, number> = {};
  try {
    await pipeline(notices, tally);
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    notices.push(
      err instanceof SetupError
        ? { level: "error", title: err.title, detail: err.detail }
        : {
            level: "error",
            title: "The run stopped on an unexpected error.",
            detail: String(err instanceof Error ? err.message : err).slice(0, 300),
          },
    );
  }

  const failed = notices.some((n) => n.level === "error");
  if (failed) process.exitCode = 1;
  console.log("Model usage:", JSON.stringify(usageSoFar()));
  await pool.query("update runs set status = $2, finished_at = now(), tally = $3, notices = $4, usage = $5 where id = $1", [
    runId, failed ? "failed" : "finished", JSON.stringify(tally), JSON.stringify(notices), JSON.stringify(usageSoFar()),
  ]);
}

main()
  .catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
