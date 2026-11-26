import type { Posting } from "../../lib/types";
import { htmlToText, politeGet } from "../http";
import type { Source } from "./index";

// Public API listed on the site; robots.txt allows everything.
const FEED = "https://www.workingnomads.com/api/exposed_jobs/";

interface WnJob {
  url: string;
  title: string;
  description: string;
  company_name: string;
  category_name: string;
  tags: string;
  location: string;
}

export const workingNomads: Source = {
  name: "workingnomads",

  async scan(): Promise<Posting[]> {
    const jobs = JSON.parse(await politeGet(FEED)) as WnJob[];
    return jobs.map((j) => ({
      source: "workingnomads",
      url: j.url,
      title: j.title,
      company: j.company_name,
      location: j.location || "Not stated",
      meta: `Remote job board listing. Category: ${j.category_name}. Tags: ${j.tags}. Open to: ${j.location || "not stated"}.`,
      text: htmlToText(j.description),
    }));
  },

  // The feed already carries the full description.
  async enrich(p) {
    return p;
  },
};
