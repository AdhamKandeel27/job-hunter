import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "../lib/config";
import { pool } from "../lib/db";
import type { Notice, PostingRow } from "../lib/types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function item(p: PostingRow): string {
  const elig =
    p.eligibility_verdict === "eligible"
      ? `Eligible (${p.eligibility_confidence} confidence)`
      : `Eligibility unclear (${p.eligibility_confidence} confidence)`;
  const evidence = p.eligibility_evidence.length
    ? `<div style="margin:6px 0 0;color:#555;font-size:13px">${p.eligibility_evidence
        .map((q) => `&ldquo;${esc(q)}&rdquo;`)
        .join("<br>")}</div>`
    : "";
  const tags = [
    `Pay: ${p.currency}${p.pay ? ` (${p.pay})` : ""}`,
    `Score ${p.score}`,
    p.seniority === "entry" ? "Entry level" : null,
    p.location,
  ]
    .filter(Boolean)
    .map((t) => esc(String(t)))
    .join(" &middot; ");
  return `<tr><td style="padding:16px 0;border-bottom:1px solid #e5e5e5">
  <div style="font-size:16px;font-weight:600">${esc(p.title)}</div>
  <div style="color:#333">${esc(p.company)}</div>
  <div style="margin:6px 0;font-size:13px;color:#333">${tags}</div>
  <div style="font-size:13px">${esc(elig)}: ${esc(p.eligibility_reason)}</div>${evidence}
  <div style="margin:6px 0 0;font-size:13px;color:#555">Fit: ${esc(p.score_reason)}</div>
  <div style="margin:10px 0 0;font-size:14px">
    <a href="${esc(`${config.appUrl}/posting/${p.id}`)}">Open package</a> &nbsp;|&nbsp;
    <a href="${esc(p.url)}">View posting</a>
  </div>
</td></tr>`;
}

function buildDigest(rows: PostingRow[], date: string): string {
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:640px;margin:0 auto;padding:16px">
<h1 style="font-size:20px;margin:0 0 4px">${rows.length} strong ${rows.length === 1 ? "fit" : "fits"} today</h1>
<div style="color:#555;font-size:13px">${date} &middot; <a href="${esc(config.appUrl)}">Review page</a></div>
<table style="width:100%;border-collapse:collapse">${rows.map(item).join("")}</table>
<p style="color:#777;font-size:12px">Nothing has been submitted. Open each form yourself and send recruiter notes yourself.</p>
</body></html>`;
}

/** Send one digest of strong fits not yet emailed. Returns what to tell you about it. */
export async function sendDigest(): Promise<Notice | null> {
  const { rows } = await pool.query<PostingRow>(
    "select * from postings where state = 'strong_fit' and closed_at is null order by score desc, date_seen desc",
  );
  if (rows.length === 0) {
    console.log("Digest: no new strong fits, no email sent.");
    return null;
  }
  const fits = `${rows.length} strong ${rows.length === 1 ? "fit" : "fits"}`;
  const date = new Date().toISOString().slice(0, 10);
  const html = buildDigest(rows, date);

  if (!config.resendApiKey || !config.digestTo) {
    mkdirSync("out", { recursive: true });
    const file = `out/digest-${date}.html`;
    writeFileSync(file, html);
    console.log(`Digest: RESEND_API_KEY or DIGEST_TO is not set, so nothing was emailed. Wrote ${file} instead.`);
    return {
      level: "warning",
      title: "The digest was not emailed.",
      detail: `${!config.resendApiKey ? "RESEND_API_KEY" : "DIGEST_TO"} is empty in .env. The ${fits} are listed below, and the digest was saved to ${file}.`,
    };
  }

  let problem = "";
  let status = 0;
  let resendId = "";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: config.digestFrom,
        to: [config.digestTo],
        subject: `Job digest ${date}: ${fits}`,
        html,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
    if (res.ok) {
      resendId = String(((await res.json().catch(() => ({}))) as { id?: string }).id ?? "");
    } else {
      const body = await res.text();
      try {
        problem = String(JSON.parse(body).message ?? body);
      } catch {
        problem = body;
      }
      problem = problem.slice(0, 300) || `Resend answered ${res.status}.`;
    }
  } catch (err) {
    problem = `Resend could not be reached: ${String(err).slice(0, 150)}`;
  }

  if (problem) {
    console.error(`Digest: email failed (${status}): ${problem}`);
    const hint =
      status === 401
        ? "Check RESEND_API_KEY in .env."
        : status === 403
          ? "Without your own domain, Resend only delivers to the address you signed up with. Check DIGEST_TO in .env."
          : "It will be tried again on the next run.";
    return {
      level: "error",
      title: "The digest email could not be sent.",
      detail: `${hint} The ${fits} are still listed below. Resend said: ${problem}`,
    };
  }

  await pool.query(
    "update postings set state = 'emailed', emailed_at = now() where id = any($1::int[]) and state = 'strong_fit'",
    [rows.map((r) => r.id)],
  );
  // Resend accepting the email is not proof it reached the inbox, so say where to look.
  console.log(`Digest: Resend accepted ${fits} for ${config.digestTo}${resendId ? ` (id ${resendId})` : ""}.`);
  return {
    level: "info",
    title: `Digest with ${fits} sent to ${config.digestTo}.`,
    detail: `Sent from ${config.digestFrom.replace(/^.*<|>$/g, "")}, subject "Job digest ${date}". If it is not in that inbox, check Spam and Promotions, and that DIGEST_TO in .env is the address you read.${resendId ? ` Resend id ${resendId}: look it up under Emails at resend.com to see whether it was delivered.` : ""}`,
  };
}