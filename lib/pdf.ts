import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

/**
 * Turns the tailored résumé (Markdown) and the cover note into PDFs.
 * Handles the Markdown the model writes: #/##/### headings, paragraphs, - and 1. lists,
 * **bold**, *italic*, [links](url) and --- rules.
 */

type Doc = PDFKit.PDFDocument;

const ACCENT = "#7b1e2b";
const TEXT = "#222222";
const MUTED = "#555555";
const MARGIN = 50;

// Arial covers more characters than the built-in Helvetica (arrows, non-Latin letters).
const FONT_DIR = process.env.WINDIR ? path.join(process.env.WINDIR, "Fonts") : "C:\\Windows\\Fonts";
const TTF = { regular: "arial.ttf", bold: "arialbd.ttf", italic: "ariali.ttf", boldItalic: "arialbi.ttf" };
const HAS_TTF = Object.values(TTF).every((f) => fs.existsSync(path.join(FONT_DIR, f)));

function newDoc(title: string, author: string): Doc {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: { Title: title, Author: author },
  });
  if (HAS_TTF) {
    doc.registerFont("regular", path.join(FONT_DIR, TTF.regular));
    doc.registerFont("bold", path.join(FONT_DIR, TTF.bold));
    doc.registerFont("italic", path.join(FONT_DIR, TTF.italic));
    doc.registerFont("boldItalic", path.join(FONT_DIR, TTF.boldItalic));
  } else {
    doc.registerFont("regular", "Helvetica");
    doc.registerFont("bold", "Helvetica-Bold");
    doc.registerFont("italic", "Helvetica-Oblique");
    doc.registerFont("boldItalic", "Helvetica-BoldOblique");
  }
  return doc;
}

/** Helvetica only knows Latin-1 plus a few typographic marks; swap or drop the rest. */
function clean(s: string): string {
  if (HAS_TTF) return s;
  return s
    .replace(/[→⇒]/g, "->")
    .replace(/[←]/g, "<-")
    .replace(/[\u2010\u2011\u2212]/g, "-")
    .replace(/[^\x00-\xff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac]/g, "");
}

function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

interface Segment {
  text: string;
  bold: boolean;
  italic: boolean;
  link?: string;
}

/** Splits one line of Markdown into styled runs. */
function inline(md: string): Segment[] {
  const out: Segment[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|(?<![A-Za-z0-9])_(.+?)_(?![A-Za-z0-9])|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;
  let last = 0;
  for (const m of md.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: md.slice(last, at), bold: false, italic: false });
    if (m[1] ?? m[2]) {
      // Bold may itself contain italic or a link; keep it simple and flatten to bold.
      for (const s of inline((m[1] ?? m[2])!)) out.push({ ...s, bold: true });
    } else if (m[3] ?? m[4]) {
      for (const s of inline((m[3] ?? m[4])!)) out.push({ ...s, italic: true });
    } else if (m[5]) {
      out.push({ text: m[5], bold: false, italic: false, link: m[6] });
    } else if (m[7]) {
      out.push({ text: m[7], bold: false, italic: false });
    }
    last = at + m[0].length;
  }
  if (last < md.length) out.push({ text: md.slice(last), bold: false, italic: false });
  return out.filter((s) => s.text.length > 0);
}

function fontFor(s: Segment): string {
  return s.bold && s.italic ? "boldItalic" : s.bold ? "bold" : s.italic ? "italic" : "regular";
}

/** Writes styled runs as one wrapped paragraph starting at x. */
function runs(
  doc: Doc,
  segs: Segment[],
  x: number,
  opts: { size: number; color: string; width: number; gap?: number; align?: "left" | "justify" },
) {
  if (segs.length === 0) return;
  doc.fontSize(opts.size);
  segs.forEach((s, i) => {
    const first = i === 0;
    const continued = i < segs.length - 1;
    doc.font(fontFor(s)).fillColor(s.link ? ACCENT : opts.color);
    // Options carry over between continued calls, so set link and underline every time.
    const o: PDFKit.Mixins.TextOptions = {
      continued,
      link: s.link ?? null,
      underline: false,
      lineGap: opts.gap ?? 1.5,
      align: opts.align ?? "left",
    } as PDFKit.Mixins.TextOptions;
    if (first) doc.text(clean(s.text), x, doc.y, { ...o, width: opts.width });
    else doc.text(clean(s.text), o);
  });
}

function bottom(doc: Doc) {
  return doc.page.height - doc.page.margins.bottom;
}

/** Start a new page when fewer than `need` points are left, so a heading is not stranded. */
function keep(doc: Doc, need: number) {
  if (doc.y + need > bottom(doc)) doc.addPage();
}

function rule(doc: Doc, color = "#cccccc") {
  const y = doc.y;
  doc.moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).lineWidth(0.6).strokeColor(color).stroke();
  doc.y = y + 4;
}

/** The first `# Heading` in the résumé: the candidate's name. */
export function nameFrom(md: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].replace(/[*_`]/g, "").trim() : "";
}

/** The line under the name: address, email, phone, links. */
function contactFrom(md: string): string {
  const lines = md.split(/\r?\n/);
  const h = lines.findIndex((l) => /^#\s+/.test(l));
  if (h < 0) return "";
  for (const l of lines.slice(h + 1)) {
    if (!l.trim()) continue;
    return /^#{1,6}\s/.test(l) ? "" : l.trim();
  }
  return "";
}

function renderMarkdown(doc: Doc, md: string) {
  const width = doc.page.width - MARGIN * 2;
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let afterName = false;

  const flush = () => {
    if (para.length === 0) return;
    const text = para.join(" ");
    para = [];
    if (afterName) {
      // Contact line: small and muted under the name.
      runs(doc, inline(text), MARGIN, { size: 9.5, color: MUTED, width });
      afterName = false;
      doc.moveDown(0.6);
      return;
    }
    runs(doc, inline(text), MARGIN, { size: 10, color: TEXT, width });
    doc.moveDown(0.45);
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);

    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      rule(doc);
      doc.moveDown(0.3);
      continue;
    }
    if (h) {
      flush();
      const level = h[1].length;
      const text = h[2];
      if (level === 1) {
        doc.font("bold").fontSize(20).fillColor(ACCENT).text(clean(text.replace(/[*_`]/g, "")), MARGIN, doc.y, { width });
        doc.moveDown(0.15);
        afterName = true;
      } else if (level === 2) {
        keep(doc, 60);
        doc.moveDown(0.5);
        doc.font("bold").fontSize(11.5).fillColor(ACCENT)
          .text(clean(text.replace(/[*_`]/g, "")).toUpperCase(), MARGIN, doc.y, { width, characterSpacing: 0.6 });
        doc.moveDown(0.1);
        rule(doc, ACCENT);
        doc.moveDown(0.25);
      } else {
        keep(doc, 45);
        doc.moveDown(0.2);
        runs(doc, inline(text).map((s) => ({ ...s, bold: true })), MARGIN, { size: 10.5, color: TEXT, width });
        doc.moveDown(0.15);
      }
      continue;
    }
    if (bullet || numbered) {
      flush();
      const depth = Math.floor(((bullet ? bullet[1] : numbered![1]).replace(/\t/g, "  ").length) / 2);
      const marker = bullet ? (depth > 0 ? "◦" : "•") : `${numbered![2]}.`;
      const text = bullet ? bullet[2] : numbered![3];
      const x = MARGIN + 6 + depth * 14;
      const textX = x + (bullet ? 10 : 16);
      keep(doc, 14);
      const y = doc.y;
      doc.font("regular").fontSize(10).fillColor(TEXT).text(clean(marker) || "-", x, y, { lineBreak: false });
      doc.y = y;
      runs(doc, inline(text), textX, { size: 10, color: TEXT, width: MARGIN + width - textX });
      doc.moveDown(0.2);
      continue;
    }
    para.push(line.trim());
  }
  flush();
}

export async function resumePdf(md: string, title: string): Promise<Buffer> {
  const doc = newDoc(title, nameFrom(md));
  renderMarkdown(doc, md);
  return toBuffer(doc);
}

export async function coverLetterPdf(
  note: string,
  resumeMd: string,
  job: { title: string; company: string },
): Promise<Buffer> {
  const name = nameFrom(resumeMd);
  const contact = contactFrom(resumeMd);
  const doc = newDoc(`Cover letter: ${job.title}, ${job.company}`, name);
  const width = doc.page.width - MARGIN * 2;

  if (name) {
    doc.font("bold").fontSize(20).fillColor(ACCENT).text(clean(name), MARGIN, doc.y, { width });
    doc.moveDown(0.15);
  }
  if (contact) {
    runs(doc, inline(contact), MARGIN, { size: 9.5, color: MUTED, width });
    doc.moveDown(0.4);
  }
  if (name || contact) {
    rule(doc, ACCENT);
    doc.moveDown(1);
  }

  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  doc.font("regular").fontSize(10.5).fillColor(TEXT).text(date, MARGIN, doc.y, { width });
  doc.moveDown(0.8);
  runs(doc, [{ text: `Re: ${job.title}${job.company ? ` at ${job.company}` : ""}`, bold: true, italic: false }], MARGIN, {
    size: 10.5,
    color: TEXT,
    width,
  });
  doc.moveDown(1);

  // Blank lines separate paragraphs; single line breaks inside a paragraph are kept.
  const paras = note.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  for (const p of paras) {
    const lines = p.split("\n");
    for (const l of lines) {
      runs(doc, inline(l.trim()), MARGIN, { size: 10.5, color: TEXT, width, gap: 3 });
    }
    doc.moveDown(0.8);
  }
  return toBuffer(doc);
}
