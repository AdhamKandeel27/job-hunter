import type { Posting } from "../../lib/types";
import { ATS_LABEL, isOpenAts, listJobs, parseAts } from "../ats";
import { search } from "../search-config";
import type { Source } from "./index";

// Company career pages, read through the public job-board APIs of Greenhouse,
// Lever and Ashby. The companies are listed in profile/search.json.

// A career page lists every office job too. Keep only jobs that are remote or
// in a region the candidate could work in; the model still judges eligibility.
const REACHABLE =
  /remote|anywhere|worldwide|global|distributed|emea|africa|mena|middle east|egypt|cairo|saudi|riyadh|jeddah|emirates|uae|dubai|abu dhabi|qatar|doha|kuwait|bahrain|oman|muscat|jordan|amman/i;

// The listed location positively includes Egypt or the Gulf.
const OPEN_TO_REGION =
  /anywhere|worldwide|global|emea|africa|mena|middle east|egypt|cairo|saudi|riyadh|jeddah|emirates|uae|dubai|abu dhabi|qatar|doha|kuwait|bahrain|oman|muscat|jordan|amman/i;

// The listed location names a country or region the candidate cannot work from.
// "Europe" alone is left for the model, since postings use it loosely.
const ELSEWHERE =
  /united states|\bu\.?s\.?a?\b|canada|americas|north america|south america|latam|latin america|brazil|mexico|argentina|colombia|india|apac|asia|australia|new zealand|japan|singapore|philippines|china|korea|united kingdom|\buk\b|ireland|germany|france|spain|portugal|italy|netherlands|belgium|poland|sweden|denmark|norway|finland|switzerland|austria|czech|romania|bulgaria|greece|turkey|israel|ukraine|serbia|estonia|lithuania|latvia|hungary|nigeria|kenya|south africa/i;

/** Remote, but only for people in other countries: not worth a model call. */
const elsewhereOnly = (location: string) => ELSEWHERE.test(location) && !OPEN_TO_REGION.test(location);

export const careers: Source = {
  name: "careers",

  async scan(): Promise<Posting[]> {
    const companies = search.careers ?? [];
    const found: (Posting & { posted: number })[] = [];
    let failed = 0;
    let elsewhere = 0;
    for (const c of companies) {
      try {
        const jobs = await listJobs(c.ats, c.board);
        for (const j of jobs) {
          if (!j.title || !j.url) continue;
          if (!j.remote && !REACHABLE.test(j.location)) continue;
          if (elsewhereOnly(j.location)) {
            elsewhere++;
            continue;
          }
          const company = c.name || j.company || c.board;
          found.push({
            source: "careers",
            url: j.url,
            title: j.title,
            company,
            location: j.location || (j.remote ? "Remote" : "Not stated"),
            meta: [
              `Listed on ${company}'s own careers page (${ATS_LABEL[c.ats]})`,
              `Location as listed: ${j.location || "not stated"}`,
              j.remote && "Marked as remote",
              ...j.extra,
            ]
              .filter(Boolean)
              .join(". "),
            text: j.text,
            posted: j.posted,
          });
        }
      } catch (err) {
        failed++;
        console.error(`Scan: careers page ${c.ats}/${c.board} failed: ${String(err).slice(0, 160)}`);
      }
    }
    if (companies.length > 0 && failed === companies.length) throw new Error("No company careers page could be read");
    if (failed) console.log(`Scan: ${failed} of ${companies.length} company careers pages could not be read.`);
    console.log(`Scan: careers pages listed ${elsewhere} remote jobs limited to other countries; those were left out.`);
    // Newest first, so a small run still sees fresh jobs.
    return found.sort((a, b) => b.posted - a.posted).map(({ posted: _posted, ...p }) => p);
  },

  // The APIs already carry the full description.
  async enrich(p) {
    return p;
  },

  async isOpen(p) {
    const ref = parseAts(p.url);
    return ref ? isOpenAts(ref) : undefined;
  },
};
