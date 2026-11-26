import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "../../../lib/db";
import type { PackageRow, PostingRow, StoredAnswers } from "../../../lib/types";
import { CopyButton } from "../../copy-button";
import { AskPanel } from "../../ask-panel";
import { Collapsible } from "../../collapsible";
import { DocEditor } from "../../doc-editor";
import { Chips, Decide, Evidence, ScoreRing } from "../../posting-card";

export const dynamic = "force-dynamic";

function Doc({ title, text }: { title: string; text: string }) {
  return (
    <>
      <div className="section-head">
        <h2>{title}</h2>
        <CopyButton text={text} />
      </div>
      <pre className="doc">{text}</pre>
    </>
  );
}

export default async function PostingPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const [posting, pkg, profile] = await Promise.all([
    pool.query<PostingRow>("select * from postings where id = $1", [id]),
    pool.query<PackageRow>("select * from packages where posting_id = $1", [id]),
    pool.query<{ answers: StoredAnswers }>("select answers from profile where id = 1"),
  ]);
  const p = posting.rows[0];
  const k = pkg.rows[0];
  if (!p || !k) notFound();

  const a = profile.rows[0]?.answers;
  const stored = [
    { question: "Address", answer: a?.address ?? "" },
    ...Object.entries(a?.expectedSalary ?? {}).map(([code, v]) => ({
      question: `Expected salary (${code})`,
      answer: `${v} ${code}`,
    })),
    { question: "Notice period", answer: a?.noticePeriod ?? "" },
  ].filter((s) => s.answer);
  const formAnswers = k.form_source === "application_form" ? [...k.form_answers, ...stored] : [...stored, ...k.form_answers];

  return (
    <>
      <div className="small"><Link href="/">← Back to all jobs</Link></div>
      <div className="card-head" style={{ marginTop: 8 }}>
        <h1>{p.title}</h1>
        <ScoreRing score={p.score} />
      </div>
      <div className="muted">{[p.company, p.location].filter(Boolean).join(" · ")}</div>
      <Chips p={p} />
      <div className="small">{p.score_reason}</div>
      <Evidence p={p} />
      {p.vetting_reasons.length > 0 && (
        <details>
          <summary>Legitimacy checks</summary>
          <div>{p.vetting_reasons.join("; ")}</div>
        </details>
      )}
      <div className="actions">
        <a className="button primary" href={p.url} target="_blank" rel="noreferrer">Open the posting to apply</a>
        <span className="spacer" />
        <Decide p={p} />
      </div>

      {k.unanswered.length > 0 && (
        <>
          <h2>Needs your answer</h2>
          <div className="qa flag">
            <div className="small muted">The agent could not answer these from your résumé or stored answers, so it did not guess.</div>
            <ul>
              {k.unanswered.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          </div>
        </>
      )}

      <Collapsible
        title="Form answers"
        hint={`${formAnswers.length} answers · ${k.form_source === "application_form" ? `from the ${k.form_note ?? "job's"} form` : "general"}`}
        storageKey="job-agent-form-answers"
      >
      {k.form_source === "application_form" ? (
        <div className="notice info">
          <b>These follow this job&rsquo;s real application form.</b>
          <span>
            The agent read the {k.form_note ?? "employer's"} form and answered its questions in the form&rsquo;s order.
            Your stored answers are listed after them in case the form has changed.
          </span>
        </div>
      ) : (
        <div className="notice warning">
          <b>General answers, not from this job&rsquo;s application form.</b>
          <span>
            The agent could not read the application form for this job, so these are the questions most forms ask.
            The real form may ask different ones: check each answer against it before you paste.
          </span>
        </div>
      )}
      {formAnswers.map((f, i) => (
        <div className="qa" key={i}>
          <div className="q">
            <span>{f.question}</span>
            <CopyButton text={f.answer} />
          </div>
          <div className="a">{f.answer}</div>
        </div>
      ))}
      </Collapsible>

      <AskPanel postingId={id} initialOverview={k.job_overview ?? ""} initialQA={k.qa ?? []} />

      <div className="small muted" style={{ marginTop: 28 }}>
        The résumé and cover note are editable. The PDFs are built from the saved text, in Markdown:
        <code> ## Heading</code>, <code>- bullet</code>, <code>**bold**</code>, <code>*italic*</code>, <code>[text](link)</code>.
      </div>
      <DocEditor id={id} field="resume" title="Tailored résumé" initial={k.resume_md} pdf={`/api/posting/${id}/resume`} />
      <DocEditor id={id} field="cover" title="Cover note" initial={k.cover_note} pdf={`/api/posting/${id}/cover-letter`} />
      <Doc title="Recruiter note (you send it)" text={k.recruiter_note} />
    </>
  );
}
