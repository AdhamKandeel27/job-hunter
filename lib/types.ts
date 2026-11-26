export type SourceName = "workingnomads" | "jobgether" | "wuzzuf" | "himalayas" | "careers";

/** One question on a job's real application form. */
export interface FormQuestion {
  label: string;
  required: boolean;
  type: "text" | "long text" | "choice" | "multiple choice";
  options?: string[];
  description?: string;
}

export const SOURCE_LABEL: Record<SourceName, string> = {
  careers: "Company careers page",
  wuzzuf: "Wuzzuf",
  workingnomads: "Working Nomads",
  jobgether: "Jobgether",
  himalayas: "Himalayas",
};

/** Tokens one model used during a run. Output includes thinking tokens, which are billed as output. */
export interface ModelUsage {
  calls: number;
  input: number;
  output: number;
  /** The part of input/output spent on the first-pass screen. Missing on runs recorded before this was tracked. */
  screenInput?: number;
  screenOutput?: number;
}
export type Usage = Record<string, ModelUsage>;

/** A posting as it moves through one run. Only strong fits are ever saved. */
export interface Posting {
  source: SourceName;
  url: string;
  title?: string;
  company?: string;
  location?: string;
  /** Tags the board itself attaches (remote type, seniority, salary range...). */
  meta?: string;
  /** Full description as plain text. Missing until the source enriches it. */
  text?: string;
  /** The company's own site, when the board exposes it. */
  companyUrl?: string;
}

export type Enriched = Posting & { title: string; company: string; text: string };

export interface FormAnswer {
  question: string;
  answer: string;
}

export interface StoredAnswers {
  address: string;
  /** One figure per currency code, e.g. { USD: "2,200 per month", EUR: "2,000 per month" }. */
  expectedSalary: Record<string, string>;
  noticePeriod: string;
}

export interface Profile {
  resume: string;
  answers: StoredAnswers;
}

/** Something the review page should tell you about a run. */
export interface Notice {
  level: "error" | "warning" | "info";
  title: string;
  detail?: string;
}

export interface RunRow {
  id: number;
  started_at: Date;
  finished_at: Date | null;
  status: "running" | "finished" | "failed";
  tally: Record<string, number>;
  notices: Notice[];
  /** Tokens used per model. Missing on runs recorded before usage tracking. */
  usage?: Usage;
}

export type PostingState = "strong_fit" | "emailed" | "applied" | "skipped";
export type Outcome = "interview" | "rejected" | "no_reply";

/** A row of the postings table, as the review page and the mailer read it. */
export interface PostingRow {
  id: number;
  source: SourceName;
  url: string;
  title: string;
  company: string;
  location: string | null;
  pay: string | null;
  currency: string;
  seniority: string;
  date_seen: Date;
  state: PostingState;
  eligibility_verdict: "eligible" | "unclear";
  eligibility_confidence: "high" | "medium" | "low";
  eligibility_reason: string;
  eligibility_evidence: string[];
  vetting_reasons: string[];
  score: number;
  score_reason: string;
  emailed_at: Date | null;
  applied_at: Date | null;
  outcome: Outcome | null;
  /** Set when a run finds the posting has been taken down. */
  closed_at: Date | null;
}

export interface PackageRow {
  posting_id: number;
  resume_md: string;
  cover_note: string;
  recruiter_note: string;
  form_answers: FormAnswer[];
  unanswered: string[];
  /** "application_form": answers follow this job's real form. "general": the form could not be read. */
  form_source: "application_form" | "general";
  /** Where the form was read from, e.g. "Greenhouse". */
  form_note: string | null;
  /** The job overview pasted into "Ask about this job". */
  job_overview: string;
  /** Questions asked there, with the drafted (and possibly edited) answers. */
  qa: QAItem[];
}

export interface QAItem {
  question: string;
  answer: string;
  /** What to check before sending; empty when nothing. */
  note: string;
}
