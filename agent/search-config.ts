import { readFileSync } from "node:fs";

export interface SearchConfig {
  /** The kinds of role you want. Anything else is dropped at the first pass. */
  targetRoles: string[];
  /**
   * A free check on the job title before any model call. A posting is skipped
   * when its title contains none of `mustInclude`, or any of `exclude`.
   * Whole words or phrases, any case. Leave a list empty to switch it off.
   */
  titleFilter?: { mustInclude?: string[]; exclude?: string[] };
  /** Company career pages to read. `board` is the company's name in its careers page address. */
  careers?: { ats: "greenhouse" | "lever" | "ashby"; board: string; name?: string }[];
  /** Himalayas keyword searches. Results are already limited to jobs open to Egypt. */
  himalayas?: { q: string }[];
  /** Jobgether searches. `locations` is a slug such as "egypt" or "anywhere". */
  jobgether: { keyword?: string; locations?: string }[];
  /** Wuzzuf browse pages to read. `note` tells the model what the page lists. */
  wuzzuf: { url: string; note: string }[];
}

// Edit profile/search.json to change what gets scanned.
export const search: SearchConfig = JSON.parse(readFileSync("profile/search.json", "utf8"));
