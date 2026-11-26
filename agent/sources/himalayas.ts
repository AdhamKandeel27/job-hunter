import type { Posting } from "../../lib/types";
import { htmlToText, PermanentError, politeGet } from "../http";
import { search } from "../search-config";
import type { Source } from "./index";

// Himalayas' free public JSON API; no key needed, robots.txt allows it.
// Docs: https://himalayas.app/docs/remote-jobs-api
// Their terms: link to the job through `applicationLink` and credit Himalayas,
// so that link is what gets stored and the dashboard names the board.
const SEARCH = "https://himalayas.app/jobs/api/search";
const PAGES_PER_SEARCH = 2; // 20 postings a page, newest first

interface HmJob {
  title: string;
  companyName: string;
  employmentType?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string;
  currency?: string;
  seniority?: string[];
  locationRestrictions?: (string | { name?: string })[];
  categories?: string[];
  description?: string;
  applicationLink?: string;
  guid: string;
}

function salary(j: HmJob): string | undefined {
  const lo = j.minSalary ?? j.maxSalary;
  const hi = j.maxSalary ?? j.minSalary;
  if (lo == null || hi == null) return undefined;
  const range = lo === hi ? String(lo) : `${lo}-${hi}`;
  return `${range} ${j.currency ?? ""} ${j.salaryPeriod ?? "annual"}`.replace(/\s+/g, " ").trim();
}

export const himalayas: Source = {
  name: "himalayas",

  async scan(): Promise<Posting[]> {
    const byUrl = new Map<string, Posting>();
    for (const s of search.himalayas ?? []) {
      for (let page = 1; page <= PAGES_PER_SEARCH; page++) {
        // country=EG returns jobs open worldwide plus jobs that list Egypt.
        const params = new URLSearchParams({ q: s.q, country: "EG", sort: "recent", page: String(page) });
        const body = JSON.parse(await politeGet(`${SEARCH}?${params}`)) as { jobs?: HmJob[] };
        const jobs = body.jobs ?? [];
        for (const j of jobs) {
          const url = j.applicationLink || j.guid;
          if (!url || byUrl.has(url)) continue;
          const countries = (j.locationRestrictions ?? [])
            .map((c) => (typeof c === "string" ? c : c?.name ?? ""))
            .filter(Boolean);
          const openTo = countries.length ? countries.join(", ") : "Worldwide";
          const pay = salary(j);
          const meta = [
            "Remote job board listing",
            countries.length
              ? `Applicants must be based in one of: ${openTo}`
              : "Open worldwide: the board lists no country restriction",
            j.seniority?.length && `Seniority: ${j.seniority.join(", ")}`,
            j.employmentType && `Employment: ${j.employmentType}`,
            pay && `Pay: ${pay}`,
            j.categories?.length && `Categories: ${j.categories.slice(0, 6).join(", ")}`,
          ]
            .filter(Boolean)
            .join(". ");
          byUrl.set(url, {
            source: "himalayas",
            url,
            title: j.title,
            company: j.companyName,
            location: `Remote, ${openTo}`,
            meta,
            text: htmlToText(j.description ?? ""),
          });
        }
        if (jobs.length < 20) break; // last page
      }
    }
    return [...byUrl.values()];
  },

  // The search results already carry the full description.
  async enrich(p) {
    return p;
  },

  // Their single-job endpoint answers 410 once a job has closed.
  async isOpen(p) {
    const api = p.url.split("?")[0].replace("himalayas.app/companies/", "himalayas.app/jobs/api/companies/");
    if (!api.includes("/jobs/api/companies/")) return undefined;
    try {
      await politeGet(api);
      return true;
    } catch (err) {
      return err instanceof PermanentError ? false : undefined;
    }
  },
};
