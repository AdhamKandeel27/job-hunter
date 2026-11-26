import { createHash } from "node:crypto";
import type { Posting } from "../lib/types";
import { search } from "./search-config";

// Free checks that run before any model call.

const flat = (s: string) =>
  ` ${s.toLowerCase().replace(/\.net\b/g, " dotnet ").replace(/[^a-z0-9+#]+/g, " ").trim()} `;

const has = (text: string, phrase: string) => text.includes(flat(phrase));

/** The title, or for a stub without one (Wuzzuf) the words in its link. */
function titleText(p: Posting): string {
  if (p.title) return p.title;
  try {
    return decodeURIComponent(new URL(p.url).pathname.split("/").filter(Boolean).at(-1) ?? "");
  } catch {
    return "";
  }
}

/** Why the title rules this posting out, or null to keep it. */
export function titleProblem(p: Posting): string | null {
  const f = search.titleFilter;
  const text = flat(titleText(p));
  if (!f || text.trim() === "") return null;
  const bad = (f.exclude ?? []).find((w) => has(text, w));
  if (bad) return `title contains "${bad}"`;
  const must = f.mustInclude ?? [];
  if (must.length && !must.some((w) => has(text, w))) return "title has none of the wanted words";
  return null;
}

const NO_COMPANY = /^(not stated|confidential( company)?|unknown|n\/?a)?$/;

/**
 * A fingerprint of "this company, this job title", the same on every board.
 * null when the company is unknown, since two such postings may be different jobs.
 */
export function jobKey(p: Posting): string | null {
  if (!p.title || !p.company) return null;
  const company = p.company
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|company|plc|sa|bv|ag)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "");
  if (NO_COMPANY.test(p.company.trim().toLowerCase()) || !company) return null;
  const title = p.title
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // "(Remote)", "(EMEA)"
    .replace(/\b(remote|hybrid|onsite|on site|worldwide|anywhere)\b/g, " ")
    .replace(/[^a-z0-9+#]+/g, "");
  if (!title) return null;
  return createHash("sha256").update(`${company}|${title}`).digest("hex").slice(0, 32);
}
