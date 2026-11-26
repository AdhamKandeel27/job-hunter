import type { Posting, SourceName } from "../../lib/types";
import { careers } from "./careers";
import { himalayas } from "./himalayas";
import { jobgether } from "./jobgether";
import { workingNomads } from "./workingnomads";
import { wuzzuf } from "./wuzzuf";

export interface Source {
  name: SourceName;
  /** Fetch current postings. May return stubs without a description. */
  scan(): Promise<Posting[]>;
  /** Fill in title, company and the full description for one posting. */
  enrich(p: Posting): Promise<Posting>;
  /** Is a saved posting still listed? undefined when the board cannot say. */
  isOpen?(p: { url: string }): Promise<boolean | undefined>;
}

// In order of how much each source tells the agent: when the same job shows up
// on two of them, the copy from the earlier source is the one that is judged.
export const sources: Source[] = [careers, himalayas, workingNomads, wuzzuf, jobgether];

export const sourceByName = Object.fromEntries(sources.map((s) => [s.name, s])) as Record<SourceName, Source>;
