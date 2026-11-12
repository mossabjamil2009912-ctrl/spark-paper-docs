import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { hasArabic, toVisual } from "./arabic";

/** Parse "1-3, 5, 8-" style ranges into 0-based page indices (in order, unique). */
export function parseRanges(input: string, pageCount: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of input.split(/[,،\s]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let a: number, b: number;
    if (m) {
      a = m[1] ? parseInt(m[1], 10) : 1;
      b = m[2] ? parseInt(m[2], 10) : pageCount;
    } else if (/^\d+$/.test(part)) {
      a = b = parseInt(part, 10);
    } else continue;
    if (a > b) [a, b] = [b, a];
    for (let i = Math.max(1, a); i <= Math.min(pageCount, b); i++) {
      if (!seen.has(i - 1)) {
        seen.add(i - 1);
        out.push(i - 1);
      }
    }
  }
  return out;
}

export async function loadDoc(bytes: ArrayBuffer) {
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

export async function mergePdfs(files: ArrayBuffer[], blankBetween = false): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const [i, f] of files.entries()) {
    if (blankBetween && i > 0) {
      const last = out.getPage(out.getPageCount() - 1);
      out.addPage([last.getWidth(), last.getHeight()]);
    }
    const src = await loadDoc(f);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}

export async function extractPages(bytes: ArrayBuffer, indices: number[]): Promise<Uint8Array> {
  const src = await loadDoc(bytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

export type PageEdit = { index: number; rotation: number };

/** Reorder / rotate / drop pages. `edits` lists the pages to keep, in output order. */
export async function organizePdf(bytes: ArrayBuffer, edits: PageEdit[]): Promise<Uint8Array> {
  const src = await loadDoc(bytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(
    src,
    edits.map((e) => e.index),
  );
  pages.forEach((p, i) => {
    const r = (((p.getRotation().angle + edits[i]!.rotation) % 360) + 360) % 360;
    p.setRotation(degrees(r));
    out.addPage(p);
  });
  return out.save();
}

/** Stamp a full-page transparent PNG overlay onto each page that has one. */
export async function stampOverlays(
  bytes: ArrayBuffer,
  overlays: Record<number, Uint8Array>,
): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  const pages = doc.getPages();
  for (const [k, png] of Object.entries(overlays)) {
    const page = pages[Number(k)];
    if (!page) continue;
    const img = await doc.embedPng(png);
    const { x, y, width, height } = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    // Overlay was drawn in the *displayed* orientation; map it back to page space.
    if (rot === 0) page.drawImage(img, { x, y, width, height });
    else if (rot === 90)
      page.drawImage(img, { x: x + width, y, width: height, height: width, rotate: degrees(90) });
    else if (rot === 180)
      page.drawImage(img, { x: x + width, y: y + height, width, height, rotate: degrees(180) });
    else page.drawImage(img, { x, y: y + height, width: height, height: width, rotate: degrees(270) });
  }
  return doc.save();
}

export type VecRect = { x: number; y: number; w: number; h: number; color: string };
export type VecText = { x: number; y: number; text: string; size: number; color: string; font?: string | undefined; bold?: boolean | undefined; italic?: boolean | undefined; ltr?: boolean | undefined };
export type VecImage = { x: number; y: number; w: number; h: number; src: string };
export type PageEdits = { overlay?: Uint8Array; rects: VecRect[]; texts: VecText[]; images?: VecImage[] };

function dataUrlBytes(src: string) {
  const b = atob(src.slice(src.indexOf(",") + 1));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

const AR = /[\u0590-\u08FF\uFB1D-\uFEFF]/;
/** True when text can be written as real PDF vector text with a standard font. */
export function isVectorable(text: string) {
  if (AR.test(text)) return /^[\x20-\x7E\u00A0-\u00FF\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF\n]*$/.test(text);
  return /^[\x20-\x7E\u00A0-\u00FF\n]*$/.test(text);
}

function arabicFontFile(t: VecText) {
  const f = (t.font ?? "").toLowerCase();
  const serif = /amiri|serif|naskh|times/.test(f.split(",")[0] ?? "") && !/sans/.test(f.split(",")[0] ?? "");
  return `/fonts/${serif ? "Amiri" : "IBMPlexSansArabic"}-${t.bold ? "Bold" : "Regular"}.ttf`;
}

function hex(c: string) {
  const m = c.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return rgb(0, 0, 0);
  const v = [m[1], m[2], m[3]].map((h) => parseInt(h!, 16) / 255);
  if (v.every((n) => n > 0.96)) return rgb(1, 1, 1); // JPEG-sampled near-white is paper white
  return rgb(v[0]!, v[1]!, v[2]!);
}

function stdFont(t: VecText): StandardFonts {
  const f = (t.font ?? "").toLowerCase();
  const fam = /mono|courier/.test(f) ? "C" : /serif/.test(f) && !/sans/.test(f.split(",")[0] ?? "") ? "T" : "H";
  const k = (t.bold ? "B" : "") + (t.italic ? "I" : "");
  const map: Record<string, StandardFonts> = {
    H: StandardFonts.Helvetica, HB: StandardFonts.HelveticaBold, HI: StandardFonts.HelveticaOblique, HBI: StandardFonts.HelveticaBoldOblique,
    T: StandardFonts.TimesRoman, TB: StandardFonts.TimesRomanBold, TI: StandardFonts.TimesRomanItalic, TBI: StandardFonts.TimesRomanBoldItalic,
    C: StandardFonts.Courier, CB: StandardFonts.CourierBold, CI: StandardFonts.CourierOblique, CBI: StandardFonts.CourierBoldOblique,
  };
  return map[fam + k]!;
}

/**
 * Apply edits on unrotated pages as real vector content: cover rects, then the PNG overlay
 * (drawings, signatures, Arabic text), then Latin text as selectable vector text.
 * Coordinates are page fractions; text size is a fraction of page width.
 */
export async function applyEdits(bytes: ArrayBuffer, edits: Record<number, PageEdits>): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  const pages = doc.getPages();
  doc.registerFontkit(fontkit);
  const fonts = new Map<string, PDFFont>();
  for (const [k, e] of Object.entries(edits)) {
    const page = pages[Number(k)];
    if (!page) continue;
    const { x: bx, y: by, width: W, height: H } = page.getCropBox();
    const top = by + H;
    for (const r of e.rects) page.drawRectangle({ x: bx + r.x * W, y: top - (r.y + r.h) * H, width: r.w * W, height: r.h * H, color: hex(r.color) });
    for (const im of e.images ?? []) {
      const bytes = dataUrlBytes(im.src);
      const img = /^data:image\/jpe?g/i.test(im.src) ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      page.drawImage(img, { x: bx + im.x * W, y: top - (im.y + im.h) * H, width: im.w * W, height: im.h * H });
    }
    if (e.overlay) page.drawImage(await doc.embedPng(e.overlay), { x: bx, y: by, width: W, height: H });
    for (const t of e.texts) {
      const ar = hasArabic(t.text);
      const key = ar ? arabicFontFile(t) : stdFont(t);
      let font = fonts.get(key);
      if (!font) {
        font = ar
          ? await doc.embedFont(await (await fetch(key)).arrayBuffer(), { subset: false })
          : await doc.embedFont(key as StandardFonts);
        fonts.set(key, font);
      }
      const size = t.size * W;
      const asc = font.heightAtSize(size, { descender: false });
      t.text.split("\n").forEach((raw, i) => {
        const y = top - t.y * H - asc - i * size * 1.3;
        const color = hex(t.color);
        if (!ar) {
          const w = font!.widthOfTextAtSize(raw, size);
          page.drawText(raw, { x: bx + t.x * W - (t.ltr === false ? w : 0), y, size, font: font!, color });
          return;
        }
        // Arabic: place each joined glyph ourselves in visual order, so the font
        // engine's own direction guessing can't flip the line.
        const chars = [...toVisual(raw)];
        const widths = chars.map((c) => font!.widthOfTextAtSize(c, size));
        const w = widths.reduce((a, b) => a + b, 0);
        let x = bx + t.x * W - (t.ltr === false ? w : 0);
        chars.forEach((c, j) => {
          if (c.trim()) page.drawText(c, { x, y, size, font: font!, color });
          x += widths[j]!;
        });
      });
    }
  }
  return doc.save();
}

type ResultListener = (r: { blob: Blob; name: string }) => void;
let resultListener: ResultListener | null = null;
/** Registered by ResultSheet; when present results are previewed instead of auto-downloaded. */
export function onResult(fn: ResultListener | null) {
  resultListener = fn;
}

export function downloadBytes(bytes: Uint8Array | Blob, name: string) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type: "application/pdf" });
  if (resultListener) return resultListener({ blob, name });
  saveBlob(blob, name);
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function baseName(name: string) {
  return name.replace(/\.pdf$/i, "");
}
