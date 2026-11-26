import type { FormQuestion } from "../lib/types";
import { decodeEntities, htmlToText, PermanentError, politeGet } from "./http";

// Applicant tracking systems that publish their job boards through public APIs.
// Used three ways: as a job source (company career pages), to read a job's real
// application form, and to check a saved job is still open.

export type AtsKind = "greenhouse" | "lever" | "ashby";
export interface AtsRef {
  kind: AtsKind;
  board: string;
  id: string;
}

export const ATS_LABEL: Record<AtsKind, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby" };

/** Recognise a job link on one of the supported systems. */
export function parseAts(url: string): AtsRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const parts = u.pathname.split("/").filter(Boolean);
  if (/^(boards|job-boards)\.greenhouse\.io$/.test(u.host) && parts[1] === "jobs" && /^\d+$/.test(parts[2] ?? "")) {
    return { kind: "greenhouse", board: parts[0], id: parts[2] };
  }
  if (u.host === "jobs.lever.co" && parts.length >= 2) return { kind: "lever", board: parts[0], id: parts[1] };
  if (u.host === "jobs.ashbyhq.com" && parts.length >= 2) return { kind: "ashby", board: parts[0], id: parts[1] };
  return null;
}

// ------------------------------------------------------------------ job lists

export interface AtsJob {
  url: string;
  title: string;
  company?: string;
  location: string;
  remote: boolean;
  /** When the job was posted or last updated, for newest-first ordering. */
  posted: number;
  extra: string[];
  text: string;
}

const REMOTE_WORD = /remote|anywhere|worldwide|global|distributed|work from home/i;

async function greenhouseJobs(board: string): Promise<AtsJob[]> {
  const data = JSON.parse(await politeGet(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`));
  return (data.jobs ?? []).map((j: any): AtsJob => {
    const location = String(j.location?.name ?? "");
    return {
      url: `https://job-boards.greenhouse.io/${board}/jobs/${j.id}`,
      title: String(j.title ?? "").trim(),
      company: j.company_name ? String(j.company_name) : undefined,
      location,
      remote: REMOTE_WORD.test(location),
      posted: Date.parse(j.first_published ?? j.updated_at ?? "") || 0,
      extra: [],
      // Greenhouse sends the description as escaped HTML.
      text: htmlToText(decodeEntities(String(j.content ?? ""))),
    };
  });
}

async function leverJobs(board: string): Promise<AtsJob[]> {
  const data = JSON.parse(await politeGet(`https://api.lever.co/v0/postings/${board}?mode=json`));
  return (Array.isArray(data) ? data : []).map((j: any): AtsJob => {
    const locations: string[] = j.categories?.allLocations ?? [j.categories?.location].filter(Boolean);
    const location = locations.join("; ");
    const lists = (j.lists ?? []).map((l: any) => `${l.text}\n${htmlToText(String(l.content ?? ""))}`);
    return {
      url: String(j.hostedUrl),
      title: String(j.text ?? "").trim(),
      location,
      remote: j.workplaceType === "remote" || REMOTE_WORD.test(location),
      posted: Number(j.createdAt) || 0,
      extra: [j.categories?.commitment && `Commitment: ${j.categories.commitment}`].filter(Boolean),
      text: [j.descriptionPlain, ...lists, j.additionalPlain].filter(Boolean).join("\n\n").trim(),
    };
  });
}

const ashbyBoards = new Map<string, Promise<any[]>>();
function ashbyRaw(board: string): Promise<any[]> {
  if (!ashbyBoards.has(board)) {
    ashbyBoards.set(
      board,
      politeGet(`https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`).then(
        (body) => JSON.parse(body).jobs ?? [],
      ),
    );
  }
  return ashbyBoards.get(board)!;
}

async function ashbyJobs(board: string): Promise<AtsJob[]> {
  return (await ashbyRaw(board))
    .filter((j: any) => j.isListed !== false)
    .map((j: any): AtsJob => {
      const others = (j.secondaryLocations ?? []).map((s: any) => s?.location).filter(Boolean);
      const location = [j.location, ...others].filter(Boolean).join("; ");
      const pay = j.compensation?.compensationTierSummary;
      return {
        url: String(j.jobUrl),
        title: String(j.title ?? "").trim(),
        location,
        remote: Boolean(j.isRemote) || REMOTE_WORD.test(location),
        posted: Date.parse(j.publishedAt ?? "") || 0,
        extra: [j.employmentType && `Employment: ${j.employmentType}`, pay && `Pay: ${pay}`].filter(Boolean),
        text: String(j.descriptionPlain ?? "").trim() || htmlToText(String(j.descriptionHtml ?? "")),
      };
    });
}

export function listJobs(kind: AtsKind, board: string): Promise<AtsJob[]> {
  return kind === "greenhouse" ? greenhouseJobs(board) : kind === "lever" ? leverJobs(board) : ashbyJobs(board);
}

// ------------------------------------------------------------ still open?

/** true: still listed. false: taken down. undefined: could not tell. */
export async function isOpenAts(ref: AtsRef): Promise<boolean | undefined> {
  try {
    if (ref.kind === "greenhouse") {
      await politeGet(`https://boards-api.greenhouse.io/v1/boards/${ref.board}/jobs/${ref.id}`);
      return true;
    }
    if (ref.kind === "lever") {
      await politeGet(`https://api.lever.co/v0/postings/${ref.board}/${ref.id}`);
      return true;
    }
    return (await ashbyRaw(ref.board)).some((j: any) => j.id === ref.id);
  } catch (err) {
    return err instanceof PermanentError ? false : undefined;
  }
}

// ------------------------------------------------------- application forms

const MAX_OPTIONS = 40;

/** A very long list (every country) is not sent to the model; it answers in words and you pick the entry. */
function trimOptions(options: string[]): string[] {
  const clean = options.map((o) => o.trim()).filter(Boolean);
  return clean.length > MAX_OPTIONS ? [] : clean;
}

const LONG_LIST = "The form offers a long list to pick from; give the entry that applies.";

async function greenhouseForm(ref: AtsRef): Promise<FormQuestion[]> {
  const job = JSON.parse(
    await politeGet(`https://boards-api.greenhouse.io/v1/boards/${ref.board}/jobs/${ref.id}?questions=true`),
  );
  const out: FormQuestion[] = [];
  for (const q of job.questions ?? []) {
    const fields: any[] = q.fields ?? [];
    // A question can offer both an upload and a text box (cover letter); answer the text box.
    const field = fields.find((f) => f.type === "textarea") ?? fields.find((f) => f.type !== "input_hidden" && f.type !== "input_file");
    if (!field || !q.label) continue; // upload-only or hidden
    // The résumé is uploaded as a file; the tailored one is on the package page.
    if (fields.some((f) => f.type === "input_file") && /resume|résumé|\bcv\b/i.test(String(q.label))) continue;
    const select = field.type === "multi_value_single_select" || field.type === "multi_value_multi_select";
    const options = select ? trimOptions((field.values ?? []).map((v: any) => String(v.label ?? ""))) : [];
    const note = q.description ? htmlToText(decodeEntities(String(q.description))).slice(0, 400) : "";
    out.push({
      label: String(q.label).trim(),
      required: Boolean(q.required),
      type:
        field.type === "textarea" ? "long text"
        : !options.length ? "text"
        : field.type === "multi_value_multi_select" ? "multiple choice"
        : "choice",
      options: options.length ? options : undefined,
      description: [note, select && !options.length && LONG_LIST].filter(Boolean).join(" ") || undefined,
    });
  }
  return out;
}

async function leverForm(ref: AtsRef): Promise<FormQuestion[]> {
  const html = await politeGet(`https://jobs.lever.co/${ref.board}/${ref.id}/apply`);
  const out: FormQuestion[] = [];

  // The standard fields (name, email, links...).
  for (const m of html.matchAll(/<div class="application-label">([\s\S]*?)<\/div>/g)) {
    const required = m[1].includes('class="required"');
    const label = htmlToText(m[1]).replace(/✱/g, "").trim();
    if (!label || /resume|cv/i.test(label)) continue;
    out.push({ label, required, type: "text" });
  }

  // The employer's own questions, embedded as JSON "cards".
  for (const m of html.matchAll(/<input type="hidden" value="([^"]*)" name="cards\[[^\]]+\]\[baseTemplate\]"/g)) {
    let card: any;
    try {
      card = JSON.parse(decodeEntities(m[1]));
    } catch {
      continue;
    }
    for (const f of card.fields ?? []) {
      if (f.type === "file-upload") continue;
      const text = String(f.text ?? "").trim();
      const heading = String(card.text ?? "").trim();
      const label = heading && text && heading !== text ? `${heading}: ${text}` : text || heading;
      if (!label) continue;
      const options = Array.isArray(f.options) ? trimOptions(f.options.map((o: any) => String(o?.text ?? o ?? ""))) : [];
      out.push({
        label,
        required: Boolean(f.required),
        type: f.type === "textarea" ? "long text"
          : f.type === "multiple-select" ? "multiple choice"
          : options.length ? "choice"
          : "text",
        options: options.length ? options : undefined,
        description:
          [f.description && String(f.description).slice(0, 400), Array.isArray(f.options) && f.options.length > 0 && !options.length && LONG_LIST]
            .filter(Boolean)
            .join(" ") || undefined,
      });
    }
  }
  return out;
}

/**
 * The questions on a job's real application form, or null when they cannot be
 * read. Ashby builds its form in the browser and refuses scripted requests,
 * so its forms are not available.
 */
export async function fetchForm(ref: AtsRef): Promise<FormQuestion[] | null> {
  if (ref.kind === "ashby") return null;
  try {
    const questions = ref.kind === "greenhouse" ? await greenhouseForm(ref) : await leverForm(ref);
    return questions.length >= 2 ? questions : null;
  } catch (err) {
    console.error(`Form: could not read the ${ATS_LABEL[ref.kind]} form for ${ref.board}/${ref.id}: ${String(err).slice(0, 160)}`);
    return null;
  }
}
