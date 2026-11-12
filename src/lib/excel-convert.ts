// Browser-only PDF <-> Excel conversion. exceljs is imported lazily.
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { toVisual } from "./arabic";
import type { Frag, RenderedPage } from "./pdf-render";

const AR = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/* ---------------- numbers ---------------- */

/** Turn "1,234.50" / "-12" / "45%" into a number + Excel format; leaves codes like "007" or "2-3" as text. */
export function parseNumber(s: string): { value: number; fmt?: string } | null {
  const t = s.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const m = t.match(/^(-|\()?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(\))?(%)?$/);
  if (!m) return null;
  const intPart = m[2]!;
  if (/^0\d/.test(intPart.replace(/,/g, ""))) return null;
  if (intPart.replace(/,/g, "").length > 15) return null;
  if (!!m[1] !== !!m[4] && m[1] === "(") return null;
  const dec = m[3] ?? "";
  let value = parseFloat(intPart.replace(/,/g, "") + (dec ? "." + dec : ""));
  if (m[1]) value = -value;
  const comma = intPart.includes(",");
  let fmt = (comma ? "#,##0" : "0") + (dec ? "." + "0".repeat(dec.length) : "");
  if (m[5]) { value /= 100; fmt += "%"; }
  if (m[1] === "(") fmt = `${fmt};(${fmt})`;
  const plain = !comma && !dec && !m[5] && !m[1];
  return plain ? { value } : { value, fmt };
}

/* ---------------- PDF -> Excel ---------------- */

type Seg = { str: string; x: number; r: number; y: number; h: number; base: number; bold: boolean; italic: boolean; fontName: string; generic: string; fg: string; bg: string; rtl: boolean };

const ORDER = new WeakMap<Frag, number>();
/** Mirrored brackets from visual-order extraction: ")Desktop App(" → "(Desktop App)". */
export function fixBrackets(s: string, rtl: boolean): string {
  if (!rtl) return s;
  return s.replace(/\)([^()]*)\(/g, "($1)").replace(/\]([^[\]]*)\[/g, "[$1]");
}

function segmentsOfLine(frags: Frag[]): Seg[] {
  const rtl = frags.some((f) => AR.test(f.str));
  const byX = [...frags].sort((a, b) => a.x - b.x);
  const groups: Frag[][] = [];
  for (const f of byX) {
    const g = groups[groups.length - 1];
    const last = g?.[g.length - 1];
    if (g && last && f.x - (last.x + last.w) < Math.max(f.h, last.h) * 0.9) g.push(f);
    else groups.push([f]);
  }
  return groups.map((g) => {
    // RTL: keep the PDF's own (logical) stream order — sorting overlapping
    // Arabic glyphs by x swaps letters (شركة → رشكة).
    const ord = rtl ? [...g].sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0)) : g;
    let str = "";
    ord.forEach((f, i) => {
      if (i) {
        const p = ord[i - 1]!;
        const gap = rtl ? p.x - (f.x + f.w) : f.x - (p.x + p.w);
        if (gap > f.h * 0.12 && !str.endsWith(" ") && !f.str.startsWith(" ")) str += " ";
      }
      str += f.str;
    });
    const main = [...g].sort((a, b) => b.w - a.w)[0]!;
    const x = Math.min(...g.map((f) => f.x)), r = Math.max(...g.map((f) => f.x + f.w));
    const y = Math.min(...g.map((f) => f.y)), base = Math.max(...g.map((f) => f.y + f.h));
    return {
      str: fixBrackets(str.normalize("NFKC").replace(/\s+/g, " ").trim(), AR.test(str)), x, r, y, h: main.h, base,
      bold: /bold|black|heavy|semibold|demi|w[6-9]/i.test(main.fontName),
      italic: /italic|oblique/i.test(main.fontName),
      fontName: main.fontName, generic: main.generic, fg: main.fg, bg: main.bg, rtl: AR.test(str),
    };
  });
}

function excelFont(seg: Seg) {
  const n = seg.fontName.toLowerCase();
  if (/mono|courier|consol/.test(n) || seg.generic === "monospace") return "Courier New";
  if (/times|serif|roman|georgia|garamond|cambria|amiri|naskh|traditional|lotus/.test(n) && !/sans/.test(n)) return seg.rtl ? "Traditional Arabic" : "Times New Roman";
  if (/calibri/.test(n)) return "Calibri";
  if (/tahoma/.test(n)) return "Tahoma";
  if (/verdana/.test(n)) return "Verdana";
  return "Arial";
}

const argb = (hex: string) => "FF" + hex.replace("#", "").toUpperCase().slice(0, 6);
const nearWhite = (hex: string) => {
  const v = hex.replace("#", "").match(/../g)?.map((h) => parseInt(h, 16)) ?? [255, 255, 255];
  return v.every((c) => c > 238);
};
const nearBlack = (hex: string) => {
  const v = hex.replace("#", "").match(/../g)?.map((h) => parseInt(h, 16)) ?? [0, 0, 0];
  return v.every((c) => c < 50);
};

/** Lay a page's text out on a grid: lines become rows, aligned x-gaps become columns. */
export function layoutPage(page: Pick<RenderedPage, "frags" | "width" | "height">) {
  const frags = page.frags.filter((f) => f.str.trim());
  frags.forEach((f, i) => ORDER.set(f, i));
  const sorted = [...frags].sort((a, b) => a.y + a.h - (b.y + b.h));
  const lines: Frag[][] = [];
  for (const f of sorted) {
    const l = lines[lines.length - 1];
    // compare with the nearest baseline in the line, using the smaller text height,
    // so one big title never swallows the small lines below it
    const near = l ? Math.min(...l.map((g) => Math.abs(g.y + g.h - (f.y + f.h)))) : Infinity;
    const lh = l ? Math.min(...l.map((g) => g.h)) : 0;
    if (l && near < Math.min(f.h, lh) * 0.45) l.push(f);
    else lines.push([f]);
  }
  const rows = lines.map(segmentsOfLine);
  // Column separators: x-gaps not covered by any segment of a multi-segment line.
  // A few long cells (e.g. a wide certification line) may cross a column gap; they get merged later.
  // Each block of the page (separated by larger vertical gaps) gets its own columns,
  // then all blocks share one grid (union of cuts) — e.g. a 2-column spec table above an 11-column matrix.
  const cutsOf = (blockRows: Seg[][]) => {
    const multiRows = blockRows.filter((r) => r.length > 1);
    const multi = multiRows.flat();
    const out: number[] = [];
    if (!multi.length) return out;
    const W = Math.ceil(page.width);
    const cover = new Array<number>(W + 2).fill(0);
    for (const s of multi) for (let x = Math.max(0, Math.floor(s.x)); x <= Math.min(W, Math.ceil(s.r)); x++) cover[x]!++;
    const allow = Math.floor(multiRows.length * 0.08);
    const minX = Math.min(...multi.map((s) => s.x)), maxX = Math.max(...multi.map((s) => s.r));
    let start = -1;
    for (let x = Math.ceil(minX); x <= Math.floor(maxX) + 1; x++) {
      const free = x <= maxX && cover[x]! <= allow;
      if (free && start < 0) start = x;
      if (!free && start >= 0) { if (x - start >= 2) out.push((start + x) / 2); start = -1; }
    }
    return out;
  };
  const bases = rows.map((r) => Math.max(...r.map((s) => s.base)));
  const gaps = bases.slice(1).map((b, i) => b - bases[i]!).sort((a, b) => a - b);
  const med = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0;
  const blocks: Seg[][][] = [];
  rows.forEach((r, i) => {
    if (!i || bases[i]! - bases[i - 1]! > Math.max(med * 1.6, 14)) blocks.push([]);
    blocks[blocks.length - 1]!.push(r);
  });
  const all = blocks.flatMap(cutsOf).sort((a, b) => a - b);
  let cuts: number[] = [];
  for (const c of all) if (!cuts.length || c - cuts[cuts.length - 1]! > 6) cuts.push(c);
  cuts = [0, ...cuts, page.width];
  const cols = cuts.slice(0, -1).map((c, i) => [c, cuts[i + 1]!] as [number, number]);
  const chars = frags.map((f) => f.str).join("");
  const rtl = (chars.match(/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/g)?.length ?? 0) > (chars.match(/[A-Za-z]/g)?.length ?? 0);
  return { rows, cols, rtl };
}

/** Sample the rendered page picture: returns a solid non-white colour at (x,y) in PDF points, or null. */
async function pagePicker(page: RenderedPage): Promise<((x: number, y: number, w: number) => string | null) | null> {
  if (typeof document === "undefined" || !page.src) return null;
  try {
    const img = new Image();
    img.src = page.src;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const k = cv.width / page.width;
    return (x, y, w) => {
      const half = Math.max(1, Math.min(w * 0.3, 15)) * k;
      const px = (xx: number) => { const d = ctx.getImageData(Math.round(xx), Math.round(y * k), 1, 1).data; return [d[0]!, d[1]!, d[2]!]; };
      const pts = [px(x * k - half), px(x * k), px(x * k + half)];
      const [a] = pts;
      const same = pts.every((p) => p.every((v, i) => Math.abs(v - a![i]!) < 18));
      const hex = "#" + a!.map((v) => v.toString(16).padStart(2, "0")).join("");
      return same && !nearWhite(hex) && a!.some((v) => v < 225) ? hex : null;
    };
  } catch { return null; }
}

export async function pdfToXlsx(pages: RenderedPage[], perPageSheets = true): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "أكتس";
  let ws: import("exceljs").Worksheet | null = null;
  let rowOffset = 0;
  for (const [pi, page] of pages.entries()) {
    const { rows, cols, rtl } = layoutPage(page);
    const pick = await pagePicker(page);
    if (perPageSheets || !ws) {
      ws = wb.addWorksheet(perPageSheets ? `صفحة ${pi + 1}` : "الملف", {
        views: [{ rightToLeft: rtl, showGridLines: false }],
        pageSetup: { orientation: page.width > page.height ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
      });
      rowOffset = 0;
      // column order: Excel column A is on the right for RTL sheets
      const ordered = rtl ? [...cols].reverse() : cols;
      ordered.forEach((c, i) => {
        const px = ((c[1] - c[0]) / 0.75) + 12; // breathing room so letters are not clipped
        ws!.getColumn(i + 1).width = Math.max(1, (px - 5) / 7);
      });
    }
    const sheet = ws!;
    const colIndex = (x: number) => {
      let i = cols.findIndex((c) => x >= c[0] && x < c[1]);
      if (i < 0) i = x < 0 ? 0 : cols.length - 1;
      return rtl ? cols.length - i : i + 1;
    };
    // map PDF y → (excel row index, excel y) so pictures land next to their text
    const marks: { pdfY: number; xlY: number }[] = [{ pdfY: 0, xlY: 0 }];
    const rowTops: number[] = []; // excel y of each used row top (relative to page start)
    let xlY = 0, prevBase = 0, extra = 0;
    const addRow = (h: number) => { rowTops.push(xlY); sheet.getRow(rowOffset + extra + rowTops.length).height = h; xlY += h; };
    rows.forEach((segs, ri) => {
      const base = Math.max(...segs.map((s) => s.base));
      const maxH = Math.max(...segs.map((s) => s.h));
      const need = Math.max(15, maxH * 1.6); // readable, never squashed
      const gap = base - prevBase - need;
      // spacer row for real vertical white space (keeps layout & room for pictures)
      if (gap > Math.max(10, maxH * 0.8)) { addRow(Math.min(409, gap)); marks.push({ pdfY: base - maxH * 1.3, xlY }); }
      void ri;
      const rh = Math.min(409, need);
      addRow(rh);
      marks.push({ pdfY: base, xlY });
      const rowNo = rowOffset + extra + rowTops.length;
      prevBase = base;
      const used = new Set<number>();
      for (const s of segs) {
        const anchor = s.rtl ? s.r - 0.01 : s.x + 0.01;
        let c1 = colIndex(anchor);
        const span = [colIndex(s.x + 0.01), colIndex(s.r - 0.01)].sort((a, b) => a - b) as [number, number];
        if (used.has(c1)) {
          c1 = span.find((c) => !used.has(c)) ?? c1;
        }
        const free = [];
        for (let c = span[0]; c <= span[1]; c++) if (!used.has(c)) free.push(c);
        const doMerge = span[1] > span[0] && free.length === span[1] - span[0] + 1;
        if (doMerge) c1 = span[0];
        const cell = sheet.getCell(rowNo, c1);
        const num = parseNumber(s.str);
        if (num) { cell.value = num.value; if (num.fmt) cell.numFmt = num.fmt; }
        else cell.value = s.str;
        const size = Math.max(4, Math.round(s.h * 2) / 2);
        cell.font = { name: excelFont(s), size, bold: s.bold, italic: s.italic, ...(nearBlack(s.fg) ? {} : { color: { argb: argb(s.fg) } }) };
        if (!nearWhite(s.bg)) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(s.bg) } };
        // alignment inside its column band(s)
        const ci = cols.findIndex((c) => (s.x + s.r) / 2 >= c[0] && (s.x + s.r) / 2 < c[1]);
        const band = cols[Math.max(0, ci)]!;
        const left = s.x - band[0], right = band[1] - s.r;
        const centered = doMerge || (Math.abs(left - right) < 3 && left > 4 && segs.length > 1);
        const horizontal = centered ? "center" : num ? "right" : s.rtl ? "right" : "left";
        cell.alignment = { horizontal, vertical: "middle", indent: horizontal === "center" ? 0 : 1, readingOrder: s.rtl ? "rtl" : "ltr" };
        used.add(c1);
        // merge cells the text physically covers so wide titles keep their place
        if (doMerge) {
          try { sheet.mergeCells(rowNo, span[0], rowNo, span[1]); } catch { /* overlap */ }
          for (let c = span[0]; c <= span[1]; c++) used.add(c);
        }
      }
      // coloured boxes without text (e.g. configuration matrix) keep their colour
      if (pick) {
        const top = Math.min(...segs.map((s) => s.y)), mid = (top + base) / 2;
        cols.forEach((c, i) => {
          const col = rtl ? cols.length - i : i + 1;
          if (used.has(col) || c[1] - c[0] < 4) return;
          const hex = pick((c[0] + c[1]) / 2, mid, c[1] - c[0]);
          if (hex) sheet.getCell(rowNo, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } };
        });
      }
    });
    // pictures: anchor each at its original spot over the grid
    const toXl = (y: number) => {
      for (let k = 1; k < marks.length; k++) {
        const a = marks[k - 1]!, b = marks[k]!;
        if (y <= b.pdfY) return a.xlY + ((y - a.pdfY) / Math.max(0.01, b.pdfY - a.pdfY)) * (b.xlY - a.xlY);
      }
      const l = marks[marks.length - 1]!;
      return l.xlY + (y - l.pdfY);
    };
    const pageEnd = toXl(page.height);
    while (xlY < pageEnd - 1) addRow(Math.min(409, Math.max(15, pageEnd - xlY)));
    const rowAt = (y: number) => {
      let r = rowTops.length - 1;
      while (r > 0 && rowTops[r]! > y) r--;
      const h = (rowTops[r + 1] ?? xlY) - rowTops[r]!;
      return r + Math.min(0.999, Math.max(0, (y - rowTops[r]!) / Math.max(1, h)));
    };
    for (const im of page.images ?? []) {
      const top = toXl(im.y), bottom = toXl(im.y + im.h);
      const rowF = extra + rowAt(Math.max(0, top));
      const hPt = Math.max(4, bottom - top);
      const wPt = Math.min(im.w * 1.25, im.w * (hPt / Math.max(1, im.h))); // keep aspect ratio
      const edge = rtl ? im.x + im.w : im.x;
      let i = cols.findIndex((c) => edge >= c[0] && edge <= c[1]);
      if (i < 0) i = edge <= 0 ? 0 : cols.length - 1;
      const c = cols[i]!;
      const colF = rtl ? cols.length - 1 - i + (c[1] - edge) / Math.max(1, c[1] - c[0]) : i + (edge - c[0]) / Math.max(1, c[1] - c[0]);
      const id = wb.addImage({ base64: im.src, extension: "png" });
      sheet.addImage(id, { tl: { col: colF, row: rowOffset + rowF } as never, ext: { width: wPt / 0.75, height: hPt / 0.75 }, editAs: "oneCell" });
    }
    rowOffset += rowTops.length + 1;
  }
  if (!wb.worksheets.length) wb.addWorksheet("صفحة 1");
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/* ---------------- Excel -> PDF ---------------- */

type XCell = import("exceljs").Cell;

const THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];
function colorOf(c: { argb?: string; theme?: number; tint?: number } | undefined, fallback: [number, number, number] | null): [number, number, number] | null {
  let h: string | undefined;
  if (c?.argb && c.argb.length >= 6) h = c.argb.slice(-6);
  else if (typeof c?.theme === "number") h = THEME[c.theme];
  if (!h) return fallback;
  const t = c?.tint ?? 0;
  return [0, 2, 4].map((i) => {
    const v = parseInt(h!.slice(i, i + 2), 16) / 255;
    return t < 0 ? v * (1 + t) : v + (1 - v) * t;
  }) as [number, number, number];
}

/** Render a cell value the way Excel displays it (number formats, percents, dates). */
export function displayText(cell: Pick<XCell, "value" | "numFmt">): string {
  let v: unknown = cell.value;
  if (v && typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; hyperlink?: string; error?: string };
    if ("result" in o) v = o.result;
    else if (o.richText) return o.richText.map((r) => r.text).join("");
    else if (o.text !== undefined) return String(o.text);
    else if (o.error) return o.error;
  }
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const fmt = (cell.numFmt ?? "").split(";")[0] ?? "";
    if (/[dmy]{2}/i.test(fmt) && !/0/.test(fmt)) {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return d.toISOString().slice(0, 10);
    }
    const pct = fmt.includes("%");
    const n = pct ? v * 100 : v;
    const decM = fmt.match(/\.(0+)/);
    const dec = decM ? decM[1]!.length : fmt ? 0 : -1;
    const opts: Intl.NumberFormatOptions = { useGrouping: fmt.includes(","), ...(dec >= 0 ? { minimumFractionDigits: dec, maximumFractionDigits: dec } : { maximumFractionDigits: 10 }) };
    let s = new Intl.NumberFormat("en-US", opts).format(Math.abs(n));
    if (n < 0) s = (cell.numFmt ?? "").includes("(") ? `(${s})` : "-" + s;
    const cur = fmt.match(/["]?([$€£¥]|ر\.س|ريال)["]?/);
    if (cur) s = cur[1] + s;
    return pct ? s + "%" : s;
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

type Fonts = { get(bold: boolean): Promise<PDFFont> };

function drawRun(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size: number, color: [number, number, number]) {
  const chars = [...(AR.test(text) ? toVisual(text) : text)];
  let cx = x;
  for (const ch of chars) {
    let w = 0;
    try { w = font.widthOfTextAtSize(ch, size); } catch { continue; }
    if (ch.trim()) { try { page.drawText(ch, { x: cx, y, size, font, color: rgb(...color) }); } catch { /* missing glyph */ } }
    cx += w;
  }
}
const textWidth = (font: PDFFont, s: string, size: number) =>
  [...(AR.test(s) ? toVisual(s) : s)].reduce((a, ch) => { try { return a + font.widthOfTextAtSize(ch, size); } catch { return a; } }, 0);

function wrap(font: PDFFont, text: string, size: number, maxW: number) {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const w of para.split(" ")) {
      const t = line ? line + " " + w : w;
      if (line && textWidth(font, t, size) > maxW) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

export async function xlsxToPdf(data: ArrayBuffer): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const cache = new Map<string, PDFFont>();
  const fonts: Fonts = {
    async get(bold) {
      const key = bold ? "Bold" : "Regular";
      let f = cache.get(key);
      if (!f) {
        const bytes = await (await fetch(`/fonts/IBMPlexSansArabic-${key}.ttf`)).arrayBuffer();
        f = await doc.embedFont(bytes, { subset: false });
        cache.set(key, f);
      }
      return f;
    },
  };

  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== "visible") continue;
    let maxR = 0, maxC = 0;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        if (displayText(cell) !== "" || cell.fill || cell.border) { maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); }
      });
    });
    if (!maxR) continue;
    const rtl = !!ws.views?.[0]?.rightToLeft;
    const colW: number[] = [];
    for (let c = 1; c <= maxC; c++) {
      const col = ws.getColumn(c);
      const w = col.hidden ? 0 : col.width ?? ws.properties.defaultColWidth ?? 8.43;
      colW.push(w ? (w * 7 + 5) * 0.75 : 0);
    }
    const rowH: number[] = [];
    for (let r = 1; r <= maxR; r++) {
      const row = ws.getRow(r);
      rowH.push(row.hidden ? 0 : row.height ?? ws.properties.defaultRowHeight ?? 15);
    }
    // merged ranges: master -> span, others skipped
    const merged = new Map<string, { r2: number; c2: number }>();
    const slave = new Set<string>();
    const mergesModel = (ws.model as { merges?: string[] }).merges ?? [];
    for (const ref of mergesModel) {
      const [a, b] = ref.split(":");
      if (!a || !b) continue;
      const A = ws.getCell(a), B = ws.getCell(b);
      const r1 = Number(A.row), c1 = Number(A.col), r2 = Number(B.row), c2 = Number(B.col);
      merged.set(`${r1}:${c1}`, { r2, c2 });
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) slave.add(`${r}:${c}`);
    }
    const totalW = colW.reduce((a, b) => a + b, 0);
    const landscape = ws.pageSetup?.orientation === "landscape" || totalW > 540;
    const PW = landscape ? 842 : 595, PH = landscape ? 595 : 842, M = 28;
    const fit = (PW - 2 * M) / totalW;
    const fitPage = !!ws.pageSetup?.fitToPage && (ws.pageSetup?.fitToWidth ?? 1) === 1;
    // never shrink text below 70% — split wide sheets into column pages instead
    const scale = Math.min(1, fitPage ? fit : Math.max(fit, 0.7));
    const groups: [number, number][] = [];
    { let g0 = 1, w = 0;
      for (let c = 1; c <= maxC; c++) {
        const cw = colW[c - 1]! * scale;
        if (w + cw > PW - 2 * M + 0.5 && c > g0) { groups.push([g0, c - 1]); g0 = c; w = 0; }
        w += cw;
      }
      groups.push([g0, maxC]); }
    const colX: number[] = [0];
    colW.forEach((w) => colX.push(colX[colX.length - 1]! + w * scale));
    // pictures
    const pics: { img: import("pdf-lib").PDFImage; c1: number; r1: number; c2: number; r2: number }[] = [];
    for (const im of ws.getImages()) {
      try {
        const media = wb.getImage(Number(im.imageId)) as { buffer?: ArrayBuffer | Uint8Array; base64?: string; extension?: string };
        let bytes: Uint8Array | undefined = media.buffer ? new Uint8Array(media.buffer as ArrayBuffer) : undefined;
        if (!bytes && media.base64) bytes = Uint8Array.from(atob(media.base64.replace(/^data:[^,]+,/, "")), (ch) => ch.charCodeAt(0));
        if (!bytes) continue;
        const isPng = bytes[0] === 0x89;
        const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const rg = im.range as unknown as { tl: { col: number; row: number }; br?: { col: number; row: number }; ext?: { width: number; height: number } };
        const c1 = rg.tl.col, r1 = rg.tl.row;
        let c2 = rg.br?.col, r2 = rg.br?.row;
        if (c2 === undefined || r2 === undefined) {
          const wpt = (rg.ext?.width ?? img.width) * 0.75, hpt = (rg.ext?.height ?? img.height) * 0.75;
          let c = c1, left = wpt; while (left > 0 && c < 200) { const cw = colW[Math.floor(c)] ?? 48; const take = Math.min(left, cw * (1 - (c % 1))); c += take / cw; left -= take; if (take <= 0) break; }
          let r = r1, lh = hpt; while (lh > 0 && r < 5000) { const rh = rowH[Math.floor(r)] ?? 15; const take = Math.min(lh, rh * (1 - (r % 1))); r += take / rh; lh -= take; if (take <= 0) break; }
          c2 = c; r2 = r;
        }
        pics.push({ img, c1, r1, c2, r2 });
        while (rowH.length < Math.ceil(r2)) rowH.push(ws.properties.defaultRowHeight ?? 15);
        maxR = Math.max(maxR, rowH.length);
      } catch { /* unsupported image */ }
    }
    // paginate rows
    const pagesRows: [number, number][] = [];
    let start = 1, acc = 0;
    for (let r = 1; r <= maxR; r++) {
      const h = rowH[r - 1]! * scale;
      if (acc + h > PH - 2 * M && r > start) { pagesRows.push([start, r - 1]); start = r; acc = 0; }
      acc += h;
    }
    pagesRows.push([start, maxR]);

    for (const [g0, g1] of groups) for (const [r0, r1] of pagesRows) {
      const page = doc.addPage([PW, PH]);
      const gx = colX[g0 - 1]!;
      const rowY: Record<number, number> = {};
      let y = PH - M;
      for (let r = r0; r <= maxR; r++) { rowY[r] = y; y -= rowH[r - 1]! * scale; }
      rowY[maxR + 1] = y;
      const box = (r: number, c: number, r2: number, c2: number) => {
        const top = rowY[r]!, bottom = rowY[Math.min(r2, r1) + 1] ?? rowY[r2 + 1]!;
        const cc2 = Math.min(c2, g1);
        const x1 = rtl ? PW - M - (colX[cc2]! - gx) : M + colX[c - 1]! - gx;
        const x2 = rtl ? PW - M - (colX[c - 1]! - gx) : M + colX[cc2]! - gx;
        return { x: x1, y: bottom, w: x2 - x1, h: top - bottom };
      };
      // pass 1: fills, pass 2: borders, pass 3: text
      for (const pass of [0, 1, 2]) {
        for (let r = r0; r <= r1; r++) {
          if (!rowH[r - 1]) continue;
          for (let c = g0; c <= g1; c++) {
            if (slave.has(`${r}:${c}`) || !colW[c - 1]) continue;
            const cell = ws.getCell(r, c);
            const m = merged.get(`${r}:${c}`);
            const b = box(r, c, m?.r2 ?? r, m?.c2 ?? c);
            if (pass === 0) {
              const fill = cell.fill as { type?: string; pattern?: string; fgColor?: { argb?: string } } | undefined;
              const col = fill?.type === "pattern" && fill.pattern !== "none" ? colorOf(fill.fgColor, null) : null;
              if (col) page.drawRectangle({ x: b.x, y: b.y, width: b.w, height: b.h, color: rgb(...col) });
            } else if (pass === 1) {
              const bd = cell.border ?? {};
              const side = (s: { style?: string; color?: { argb?: string } } | undefined, x1: number, y1: number, x2: number, y2: number) => {
                if (!s?.style) return;
                const t = /thick/.test(s.style) ? 1.6 : /medium/.test(s.style) ? 1.1 : /hair/.test(s.style) ? 0.3 : 0.6;
                page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t * Math.max(scale, 0.6), color: rgb(...(colorOf(s.color, [0, 0, 0])!)),
                  ...(/dash|dot/.test(s.style) ? { dashArray: [2, 2] } : {}) });
              };
              const L = rtl ? bd.right : bd.left, R = rtl ? bd.left : bd.right;
              side(bd.top, b.x, b.y + b.h, b.x + b.w, b.y + b.h);
              side(bd.bottom, b.x, b.y, b.x + b.w, b.y);
              side(L, b.x, b.y, b.x, b.y + b.h);
              side(R, b.x + b.w, b.y, b.x + b.w, b.y + b.h);
            } else {
              const text = displayText(cell);
              if (!text) continue;
              const f = cell.font ?? {};
              const font = await fonts.get(!!f.bold);
              const size = (f.size ?? 11) * scale;
              const color = colorOf(f.color, [0, 0, 0])!;
              const al = cell.alignment ?? {};
              const isNum = typeof cell.value === "number" || (typeof cell.value === "object" && cell.value !== null && typeof (cell.value as { result?: unknown }).result === "number");
              const pad = 2 * scale;
              const lines = al.wrapText ? wrap(font, text, size, b.w - 2 * pad) : text.split("\n");
              const lh = size * 1.25;
              const blockH = lines.length * lh;
              const v = al.vertical ?? "bottom";
              let ty = v === "top" ? b.y + b.h - size - pad : v === "middle" ? b.y + (b.h + blockH) / 2 - size : b.y + pad + (lines.length - 1) * lh + size * 0.2;
              const textRtl = AR.test(text);
              let h: string = al.horizontal ?? "general";
              if (h === "general") h = isNum ? "right" : textRtl && !rtl ? "right" : "left";
              else if (textRtl && !rtl && al.readingOrder === "rtl") h = h === "left" ? "right" : h === "right" ? "left" : h;
              // RTL sheets mirror left/right like Excel does
              if (rtl) h = h === "left" ? "right" : h === "right" ? "left" : h;
              for (const ln of lines) {
                const w = textWidth(font, ln, size);
                // overflow into neighbours like Excel does for unwrapped text
                const x = h === "center" || h === "centerContinuous" ? b.x + (b.w - w) / 2 : h === "right" ? b.x + b.w - pad - w : b.x + pad;
                drawRun(page, font, ln, x, ty, size, color);
                ty -= lh;
              }
            }
          }
        }
      }
      const fx = (c: number) => { const i = Math.min(Math.floor(c), colW.length); const v = (colX[i] ?? colX[colX.length - 1]!) + (colW[i] ?? 0) * scale * (c - i) - gx; return rtl ? PW - M - v : M + v; };
      const fy = (r: number) => { const i = Math.floor(r) + 1; return (rowY[i] ?? rowY[maxR + 1]!) - (rowH[i - 1] ?? 0) * scale * (r - i + 1); };
      for (const p of pics) {
        if (p.c2 < g0 - 1 || p.c1 > g1 || p.r2 < r0 - 1 || p.r1 > r1) continue;
        if (Math.floor(p.r1) + 1 < r0) continue;
        const xa = fx(p.c1), xb = fx(p.c2), ya = fy(p.r1), yb = fy(p.r2);
        page.drawImage(p.img, { x: Math.min(xa, xb), y: Math.min(ya, yb), width: Math.abs(xb - xa), height: Math.abs(ya - yb) });
      }
    }
  }
  if (!doc.getPageCount()) doc.addPage([595, 842]);
  return doc.save();
}
