import { coverFor, type RenderedPage } from "@/lib/pdf-render";
import type { PageEdits } from "@/lib/pdf-ops";

export type Translator = (segments: string[], context: string) => Promise<string[]>;
export type Target = "en" | "ar";

/** Characters the standard PDF fonts can encode; map common typographic ones to ASCII. */
export function toLatin1(s: string) {
  return s
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2009\u202F]/g, " ")
    .replace(/[^\x20-\x7E\u00A1-\u00FF\n]/g, "");
}

const needsEn = (s: string) => /[^\s\d.,:;%()\-+/\\*#=$€£@&|_[\]{}<>!?'"]/.test(s) && !/^[\x20-\x7E]*$/.test(s);
const needsAr = (s: string) => /[A-Za-z]{2,}/.test(s) && !/[\u0600-\u06FF]/.test(s);
export const needsFor = (target: Target) => (target === "ar" ? needsAr : needsEn);

/** Translate unique strings in batches, sharing a short document context for terminology. */
export async function translateAll(strings: string[], tr: Translator, onProgress?: (p: number) => void, target: Target = "en") {
  const uniq = [...new Set(strings.filter(needsFor(target)))];
  const context = uniq.join(" | ").slice(0, 3000);
  const map = new Map<string, string>();
  const size = 80;
  for (let i = 0; i < uniq.length; i += size) {
    const chunk = uniq.slice(i, i + size);
    const out = await tr(chunk, context);
    chunk.forEach((s, k) => map.set(s, out[k] ?? s));
    onProgress?.(Math.min(1, (i + size) / uniq.length));
  }
  return (s: string) => map.get(s) ?? s;
}

/** Build per-page cover + English text edits from detected text lines. */
export function pdfEdits(pages: RenderedPage[], t: (s: string) => string, target: Target = "en"): Record<number, PageEdits> {
  const needs = needsFor(target);
  const ar = target === "ar";
  const edits: Record<number, PageEdits> = {};
  pages.forEach((p, i) => {
    const e: PageEdits = { rects: [], texts: [] };
    for (const line of p.texts) {
      const src = line.str.trim();
      if (!needs(src)) continue;
      const en = (ar ? t(src) : toLatin1(t(src))).trim();
      if (en === src) continue;
      if (!en) continue;
      e.rects.push({ ...coverFor(p.texts, line), color: line.bg });
      // size as fraction of page width; shrink so the English fits the original line width
      let size = (line.h * p.height * 0.82) / p.width;
      const avg = line.bold ? 0.56 : 0.52;
      // English may run a little wider than the Arabic it replaces before we shrink it
      const maxW = Math.max(line.w * 1.35, 0.05);
      if (en.length * avg * size > maxW) size = Math.max(maxW / (en.length * avg), size * 0.6);
      // RTL lines keep their right edge so table columns stay aligned and nothing runs off the page
      if (ar) {
        // Arabic reads right-to-left: anchor to the line's right edge
        const serif = /serif|times|georgia/i.test(line.font.split(",")[0] ?? "") && !/sans/i.test(line.font.split(",")[0] ?? "");
        e.texts.push({
          x: line.x + line.w, ltr: false, y: line.y + line.h * 0.08, text: en, size, color: line.fg,
          font: serif ? "Amiri, serif" : "IBM Plex Sans Arabic, sans-serif", bold: line.bold, italic: false,
        });
        continue;
      }
      e.texts.push({
        x: line.rtl ? line.x + line.w : line.x, ltr: !line.rtl, y: line.y + line.h * 0.08, text: en, size, color: line.fg,
        font: line.font.replace(/Amiri|IBM Plex Sans Arabic/g, ""), bold: line.bold, italic: line.italic,
      });
    }
    if (e.rects.length) edits[i] = e;
  });
  return edits;
}

/** Translate every text cell of an xlsx in place, keeping styles, merges, widths and formulas. */
export async function translateXlsx(data: ArrayBuffer, tr: Translator, onProgress?: (p: number) => void, target: Target = "en"): Promise<Blob> {
  const ar = target === "ar";
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  type Hit = { cell: import("exceljs").Cell; rich?: { text: string }[] };
  const hits: Hit[] = [];
  const strings: string[] = [];
  wb.eachSheet((ws) => {
    strings.push(ws.name);
    ws.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.isMerged && cell.master !== cell) return;
        const v = cell.value as unknown;
        if (typeof v === "string") { hits.push({ cell }); strings.push(v); }
        else if (v && typeof v === "object" && "richText" in v) {
          const rich = (v as { richText: { text: string }[] }).richText;
          hits.push({ cell, rich }); rich.forEach((r) => strings.push(r.text));
        }
      }),
    );
  });
  const t = await translateAll(strings, tr, onProgress, target);
  for (const h of hits) {
    if (h.rich) h.cell.value = { richText: h.rich.map((r) => ({ ...r, text: t(r.text) })) };
    else h.cell.value = t(h.cell.value as string);
    const al = h.cell.alignment;
    if (ar) h.cell.alignment = { ...(al ?? {}), readingOrder: "rtl" };
    else if (al?.readingOrder === "rtl") h.cell.alignment = { ...al, readingOrder: "ltr" };
  }
  const used = new Set<string>();
  wb.eachSheet((ws) => {
    let n = t(ws.name).replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || ws.name;
    while (used.has(n)) n = `${n.slice(0, 28)} ${used.size}`;
    used.add(n);
    ws.name = n;
    ws.views = (ws.views?.length ? ws.views : [{}]).map((v) => ({ ...v, rightToLeft: ar }));
  });
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
