const USER_AGENT = "job-hunter-personal/0.1 (personal job search, one run a day)";
const MIN_GAP_MS = 2100; // Jobgether asks for a 2s crawl delay; apply it to every host.
const lastHit = new Map<string, number>();

/** The posting is gone or unreadable for good; do not retry it tomorrow. */
export class PermanentError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET a URL as text, waiting between requests to the same host. */
export async function politeGet(url: string): Promise<string> {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json" },
    signal: AbortSignal.timeout(90_000), // large career boards take a while to download
  });
  if (res.status === 404 || res.status === 410) {
    throw new PermanentError(`${res.status} for ${url}`);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/** Follow redirects and return the address a link ends up at (for "apply" links that hop to the employer). */
export async function politeResolve(url: string): Promise<string> {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  await res.body?.cancel().catch(() => {});
  return res.url || url;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Turn a posting's HTML into readable plain text. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|section|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** All JSON-LD objects on a page, with @graph containers flattened. */
export function extractJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue;
    }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!item || typeof item !== "object") continue;
      const graph = (item as Record<string, unknown>)["@graph"];
      if (Array.isArray(graph)) out.push(...(graph as Record<string, unknown>[]));
      else out.push(item as Record<string, unknown>);
    }
  }
  return out;
}

/** The schema.org JobPosting on a job page, or a PermanentError if there is none. */
export function findJobPosting(html: string, url: string): Record<string, any> {
  const job = extractJsonLd(html).find((o) => o["@type"] === "JobPosting");
  if (!job) throw new PermanentError(`No JobPosting data on ${url}`);
  return job;
}

/** Pay as the posting states it, from a schema.org baseSalary. */
export function salaryFromLd(baseSalary: any): string | undefined {
  const v = baseSalary?.value;
  if (!v) return undefined;
  const range =
    v.minValue != null && v.maxValue != null && v.minValue !== v.maxValue
      ? `${v.minValue}-${v.maxValue}`
      : String(v.value ?? v.minValue ?? v.maxValue ?? "");
  if (!range) return undefined;
  const unit = v.unitText ? ` per ${String(v.unitText).toLowerCase()}` : "";
  return `${range} ${baseSalary.currency ?? ""}${unit}`.trim();
}
