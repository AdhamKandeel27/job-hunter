import type { Posting } from "../../lib/types";
import { politeGet } from "../http";
import { search } from "../search-config";
import type { Source } from "./index";

// Jobgether's feed for AI agents; robots.txt allows it with query strings.
// Docs: https://jobgether.com/astroapi/ai/jobs/docs
const FEED = "https://jobgether.com/astroapi/ai/jobs.json";

interface JgJob {
  title: string;
  company: string;
  url: string;
  location?: string;
  remote?: string;
  contractType?: string;
  experience?: string;
  salaryRange?: string;
  jobFunctions?: string[];
}

export const jobgether: Source = {
  name: "jobgether",

  async scan(): Promise<Posting[]> {
    const byUrl = new Map<string, Posting>();
    for (const q of search.jobgether) {
      const params = new URLSearchParams({ sort: "date", limit: "25" });
      if (q.keyword) params.set("keyword", q.keyword);
      if (q.locations) params.set("locations", q.locations);
      const body = JSON.parse(await politeGet(`${FEED}?${params}`)) as { jobs: JgJob[] };
      for (const j of body.jobs ?? []) {
        if (byUrl.has(j.url)) continue;
        const meta = [
          j.location && `Offer available from: ${j.location}`,
          j.remote && `Remote type: ${j.remote}`,
          j.contractType && `Contract: ${j.contractType}`,
          j.experience && `Experience: ${j.experience}`,
          j.salaryRange && `Salary range: ${j.salaryRange}`,
          j.jobFunctions?.length && `Function: ${j.jobFunctions.join(", ")}`,
        ]
          .filter(Boolean)
          .join(". ");
        byUrl.set(j.url, {
          source: "jobgether",
          url: j.url,
          title: j.title,
          company: j.company,
          location: j.location || "Not stated",
          meta,
        });
      }
    }
    return [...byUrl.values()];
  },

  // The feed has no description, and Jobgether answers 403 to scripts that
  // request its offer pages. That block is respected, not worked around: these
  // postings are judged on the feed's tags alone, and the model is told so.
  async enrich(p) {
    return {
      ...p,
      text: `The full job description is not available to the agent for this board. Only the title, company and board tags above are known. Judge from those alone, and treat anything they do not state as unknown.`,
    };
  },
};
