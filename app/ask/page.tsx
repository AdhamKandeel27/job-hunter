import Link from "next/link";
import { AskPanel } from "../ask-panel";

export const dynamic = "force-dynamic";

/** The question helper for a job the agent did not find. Nothing here is saved. */
export default function AskPage() {
  return (
    <>
      <div className="small"><Link href="/">← Back to all jobs</Link></div>
      <h1 style={{ marginTop: 8 }}>Answer application questions</h1>
      <div className="muted">
        For a job you found yourself. Answers here aren&rsquo;t saved, so copy them before you leave. For a job on the
        dashboard, use the section on its page instead: it uses that job&rsquo;s cover note and keeps your answers.
      </div>
      <AskPanel postingId={null} />
    </>
  );
}
