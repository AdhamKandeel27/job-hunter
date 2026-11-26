import type { Posting } from "../../lib/types";
import { extractJsonLd, findJobPosting, htmlToText, PermanentError, politeGet, salaryFromLd } from "../http";
import { search } from "../search-config";
import type { Source } from "./index";

// Wuzzuf has no feed. Its browse pages (/a/...) and job pages are allowed by
// robots.txt and carry schema.org data, so no HTML layout parsing is needed.

export const wuzzuf: Source = {
  name: "wuzzuf",

  async scan(): Promise<Posting[]> {
    const byUrl = new Map<string, Posting>();
    for (const listing of search.wuzzuf) {
      const html = await politeGet(listing.url);
      const urls: string[] = [];
      for (const obj of extractJsonLd(html)) {
        const items = (obj as any)?.mainEntity?.itemListElement;
        if (Array.isArray(items)) for (const it of items) if (typeof it?.url === "string") urls.push(it.url);
      }
      if (urls.length === 0) {
        // Fallback if the structured data ever disappears.
        for (const m of html.matchAll(/href="((?:https:\/\/wuzzuf\.net)?\/jobs\/p\/[^"?#]+)/g)) {
          urls.push(new URL(m[1], "https://wuzzuf.net").href);
        }
      }
      for (const url of urls) {
        if (!byUrl.has(url)) byUrl.set(url, { source: "wuzzuf", url, meta: listing.note });
      }
    }
    return [...byUrl.values()];
  },

  async enrich(p) {
    const job = findJobPosting(await politeGet(p.url), p.url);
    const addr = [job.jobLocation].flat()[0]?.address ?? {};
    const location = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ");
    const pay = salaryFromLd(job.baseSalary);
    const meta = [
      p.meta,
      job.jobLocationType && `Location type: ${job.jobLocationType}`,
      job.employmentType && `Employment: ${[job.employmentType].flat().join(", ")}`,
      pay && `Pay: ${pay}`,
    ]
      .filter(Boolean)
      .join(". ");
    return {
      ...p,
      title: String(job.title ?? ""),
      company: String(job.hiringOrganization?.name ?? "Not stated"),
      location: location || "Egypt",
      meta,
      text: htmlToText(String(job.description ?? "")),
    };
  },

  // Closed when the page is gone or its own closing date has passed.
  async isOpen(p) {
    try {
      const job = extractJsonLd(await politeGet(p.url)).find((o) => o["@type"] === "JobPosting") as any;
      if (!job) return undefined;
      const until = Date.parse(String(job.validThrough ?? ""));
      return Number.isFinite(until) ? until > Date.now() : true;
    } catch (err) {
      return err instanceof PermanentError ? false : undefined;
    }
  },
};
