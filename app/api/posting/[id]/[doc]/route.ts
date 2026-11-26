import { pool } from "../../../../../lib/db";
import { coverLetterPdf, nameFrom, resumePdf } from "../../../../../lib/pdf";
import type { PackageRow, PostingRow } from "../../../../../lib/types";

export const dynamic = "force-dynamic";

/** Safe for a file name: letters, digits and dashes. */
function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** GET /api/posting/:id/resume or /api/posting/:id/cover-letter → PDF download. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; doc: string }> }) {
  const { id: rawId, doc } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || (doc !== "resume" && doc !== "cover-letter")) {
    return new Response("Not found", { status: 404 });
  }

  const [posting, pkg] = await Promise.all([
    pool.query<Pick<PostingRow, "title" | "company">>("select title, company from postings where id = $1", [id]),
    pool.query<Pick<PackageRow, "resume_md" | "cover_note">>(
      "select resume_md, cover_note from packages where posting_id = $1",
      [id],
    ),
  ]);
  const p = posting.rows[0];
  const k = pkg.rows[0];
  if (!p || !k) return new Response("Not found", { status: 404 });

  const person = slug(nameFrom(k.resume_md));
  const company = slug(p.company ?? "");
  let pdf: Buffer;
  let label: string;
  if (doc === "resume") {
    pdf = await resumePdf(k.resume_md, `Résumé: ${p.title}, ${p.company}`);
    label = "Resume";
  } else {
    pdf = await coverLetterPdf(k.cover_note, k.resume_md, { title: p.title, company: p.company });
    label = "Cover-Letter";
  }
  const file = [person, label, company].filter(Boolean).join("-") + ".pdf";

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
    },
  });
}
