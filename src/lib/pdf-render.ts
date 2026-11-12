// Browser-only: pdfjs is imported lazily so SSR never evaluates it.
type Pdfjs = typeof import("pdfjs-dist");
let lib: Promise<Pdfjs> | null = null;

function getPdfjs() {
  if (!lib) {
    lib = (async () => {
      const m = await import("pdfjs-dist");
      const w = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      m.GlobalWorkerOptions.workerSrc = w.default;
      return m;
    })();
  }
  return lib;
}

/** Box in page fractions (0..1). */
export type PageText = { str: string; x: number; y: number; w: number; h: number; bg: string; fg: string; font: string; bold: boolean; italic: boolean; rtl: boolean };

/** Map a PDF font name + generic family to a CSS font stack close to the original. */
export function cssFontFor(name: string, generic: string, rtl: boolean): string {
  const n = name.toLowerCase();
  const serif = /times|serif|roman|georgia|garamond|minion|cambria|book|amiri|naskh|traditional|lotus|mudir|badr/.test(n) && !/sans/.test(n);
  const mono = /mono|courier|consol/.test(n) || generic === "monospace";
  const isSerif = serif || (generic === "serif" && !/sans|arial|helvet|tahoma|segoe|calibri|verdana|inter|roboto/.test(n));
  if (mono) return '"Noto Sans Mono", "Courier New", monospace';
  if (isSerif) return rtl ? '"Amiri", "Noto Serif", serif' : '"Noto Serif", "Times New Roman", "Amiri", serif';
  return rtl ? '"IBM Plex Sans Arabic", "Noto Sans", sans-serif' : '"Noto Sans", Arial, "IBM Plex Sans Arabic", sans-serif';
}
/** Raw text fragment in PDF points (top-left origin) with sampled colours. */
export type Frag = { str: string; x: number; y: number; w: number; h: number; fontName: string; generic: string; fg: string; bg: string };
export type PdfImage = { x: number; y: number; w: number; h: number; src: string };
export type RenderedPage = { src: string; width: number; height: number; texts: PageText[]; frags: Frag[]; images?: PdfImage[] };

/** Render each page to a JPEG data URL. width/height are the displayed size in PDF points. */
export async function renderPages(bytes: ArrayBuffer, scale = 2, onPage?: (page: RenderedPage, index: number, total: number) => void): Promise<RenderedPage[]> {
  const pdfjs = await getPdfjs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), fontExtraProperties: true });
  const doc = await loadingTask.promise;
  const out: RenderedPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
    const raw: Box[] = [];
    try {
      const tc = await page.getTextContent();
      const styles = tc.styles as Record<string, { fontFamily?: string }>;
      const fontInfo = (fn: string) => {
        let real = "";
        try { const o = page.commonObjs.get(fn) as { name?: string; bold?: boolean; italic?: boolean; black?: boolean } | undefined; real = o?.name ?? ""; if (o?.bold || o?.black) real += "-Bold"; if (o?.italic) real += "-Italic"; } catch { /* not loaded */ }
        return { real, generic: styles[fn]?.fontFamily ?? "sans-serif" };
      };
      for (const r of tc.items) {
        const it = r as { str?: string; transform?: number[]; width?: number; fontName?: string };
        if (!it.str?.trim() || !it.transform) continue;
        const t = pdfjs.Util.transform(base.transform, it.transform);
        const h = Math.hypot(t[2]!, t[3]!);
        const w = it.width ?? 0;
        if (h <= 0 || w <= 0) continue;
        const fi = fontInfo(it.fontName ?? "");
        raw.push({ str: it.str, x: t[4]!, y: t[5]! - h, w, h, fontName: fi.real, generic: fi.generic });
      }
    } catch (e) { console.warn(e); }
    const texts = groupLines(raw).map((l) => {
      const c = sampleColors(ctx, l.x * scale, l.y * scale, l.w * scale, l.h * 1.2 * scale);
      const fn = l.fontName ?? "";
      const rtl = AR.test(l.str);
      const bold = /bold|black|heavy|semibold|demi|w[6-9]/i.test(fn);
      const italic = /italic|oblique/i.test(fn);
      return { str: l.str, x: l.x / base.width, y: l.y / base.height, w: l.w / base.width, h: (l.h * 1.2) / base.height, ...c,
        font: cssFontFor(fn, l.generic ?? "sans-serif", rtl), bold, italic, rtl };
    });
    const frags: Frag[] = raw.map((b) => ({ str: b.str, x: b.x, y: b.y, w: b.w, h: b.h, fontName: b.fontName ?? "", generic: b.generic ?? "sans-serif",
      ...sampleColors(ctx, b.x * scale, b.y * scale, b.w * scale, b.h * 1.15 * scale) }));
    const images: PdfImage[] = [];
    try {
      const ops = await page.getOperatorList();
      const O = pdfjs.OPS;
      const stack: number[][] = [];
      let ctm = base.transform.slice() as number[];
      for (let k = 0; k < ops.fnArray.length; k++) {
        const fn = ops.fnArray[k];
        if (fn === O.save) stack.push(ctm.slice());
        else if (fn === O.restore) ctm = stack.pop() ?? ctm;
        else if (fn === O.transform) ctm = pdfjs.Util.transform(ctm, ops.argsArray[k] as number[]);
        else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageXObjectRepeat) {
          const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => [ctm[0]! * a! + ctm[2]! * b! + ctm[4]!, ctm[1]! * a! + ctm[3]! * b! + ctm[5]!]);
          const xs = pts.map((q) => q[0]!), ys = pts.map((q) => q[1]!);
          const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys));
          const w = Math.min(base.width, Math.max(...xs)) - x, h = Math.min(base.height, Math.max(...ys)) - y;
          if (w < 4 || h < 4) continue;
          const c = document.createElement("canvas");
          c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
          c.getContext("2d")!.drawImage(canvas, x * scale, y * scale, w * scale, h * scale, 0, 0, c.width, c.height);
          images.push({ x, y, w, h, src: c.toDataURL("image/png") });
        }
      }
    } catch (e) { console.warn(e); }
    try { images.push(...drawnRegions(canvas, scale, base.width, base.height, raw, images)); } catch (e) { console.warn(e); }
    out.push({ images, texts, frags, src: canvas.toDataURL("image/jpeg", 0.85), width: base.width, height: base.height });
    page.cleanup();
    onPage?.(out[out.length - 1]!, i - 1, doc.numPages);
    await new Promise((r) => setTimeout(r, 0));
  }
  await loadingTask.destroy();
  return out;
}

type Box = { str: string; x: number; y: number; w: number; h: number; fontName?: string | undefined; generic?: string | undefined };
const AR = /[\u0600-\u06FF]/;

/** Merge pdf.js fragments sitting on the same baseline and close together into whole lines. */
export function groupLines(items: Box[]): Box[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Box[][] = [];
  for (const it of sorted) {
    const line = lines.find((l) => {
      const f = l[0]!;
      if (Math.abs(f.y + f.h - (it.y + it.h)) > Math.max(f.h, it.h) * 0.4) return false;
      const minX = Math.min(...l.map((b) => b.x)), maxX = Math.max(...l.map((b) => b.x + b.w));
      const gap = Math.max(minX - (it.x + it.w), it.x - maxX, 0);
      return gap < Math.max(f.h, it.h) * 1.5;
    });
    if (line) line.push(it); else lines.push([it]);
  }
  return lines.map((l) => {
    const rtl = l.some((b) => AR.test(b.str));
    l.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    let str = "";
    l.forEach((b, i) => {
      if (i) {
        const p = l[i - 1]!;
        const gap = rtl ? p.x - (b.x + b.w) : b.x - (p.x + p.w);
        if (gap > b.h * 0.15 && !str.endsWith(" ") && !b.str.startsWith(" ")) str += " ";
      }
      str += b.str;
    });
    const x = Math.min(...l.map((b) => b.x)), y = Math.min(...l.map((b) => b.y));
    const r = Math.max(...l.map((b) => b.x + b.w)), bt = Math.max(...l.map((b) => b.y + b.h));
    const main = [...l].sort((a, b) => b.w - a.w)[0]!;
    return { str: str.trim(), x, y, w: r - x, h: bt - y, fontName: main.fontName, generic: main.generic };
  });
}

type LineBox = { x: number; y: number; w: number; h: number };

/**
 * Cover rect for one detected line that never spills onto neighbouring lines.
 * Line h includes a 20% descender allowance (h = glyph * 1.2); the cover is clamped
 * between the baseline of the line above and the cap top of the line below.
 */
export function coverFor(lines: LineBox[], t: LineBox) {
  const padX = 0.003, padY = 0.001;
  const glyph = t.h / 1.2;
  let top = t.y - padY, bottom = t.y + t.h + padY;
  let left = t.x - padX, right = t.x + t.w + padX;
  for (const o of lines) {
    if (o === t) continue;
    const overlapX = o.x < t.x + t.w && o.x + o.w > t.x;
    const oBase = o.y + o.h / 1.2;
    if (overlapX) {
      if (o.y > t.y + glyph * 0.5 && o.y < bottom) bottom = Math.max(t.y + glyph, o.y - 0.0005);
      if (oBase < t.y + glyph * 0.5 && oBase > top) top = Math.min(t.y, oBase + 0.0005);
    } else {
      const overlapY = o.y < t.y + t.h && o.y + o.h > t.y;
      if (overlapY) {
        if (o.x >= t.x + t.w && o.x < right) right = Math.max(t.x + t.w, o.x - 0.0005);
        if (o.x + o.w <= t.x && o.x + o.w > left) left = Math.min(t.x, o.x + o.w + 0.0005);
      }
    }
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

/** Background = most common colour on the box edge; foreground = pixel inside most unlike it. */
export function sampleColors(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  try {
    const pad = 2;
    const X = Math.max(0, Math.floor(x - pad)), Y = Math.max(0, Math.floor(y - pad));
    const W = Math.max(1, Math.ceil(w + pad * 2)), H = Math.max(1, Math.ceil(h + pad * 2));
    const d = ctx.getImageData(X, Y, W, H).data;
    const counts = new Map<number, number>();
    const at = (i: number, j: number) => (j * W + i) * 4;
    const edge = (i: number, j: number) => {
      const k = at(i, j);
      const q = ((d[k]! >> 3) << 10) | ((d[k + 1]! >> 3) << 5) | (d[k + 2]! >> 3);
      counts.set(q, (counts.get(q) ?? 0) + 1);
    };
    for (let i = 0; i < W; i++) { edge(i, 0); edge(i, H - 1); }
    for (let j = 0; j < H; j++) { edge(0, j); edge(W - 1, j); }
    let best = 0, bq = 0x7fff;
    counts.forEach((c, q) => { if (c > best) { best = c; bq = q; } });
    const br = ((bq >> 10) & 31) * 8 + 4, bg = ((bq >> 5) & 31) * 8 + 4, bb = (bq & 31) * 8 + 4;
    let far = -1, fg = [0, 0, 0];
    for (let k = 0; k < d.length; k += 4) {
      const dist = Math.abs(d[k]! - br) + Math.abs(d[k + 1]! - bg) + Math.abs(d[k + 2]! - bb);
      if (dist > far) { far = dist; fg = [d[k]!, d[k + 1]!, d[k + 2]!]; }
    }
    return { bg: hex(Math.min(255, br), Math.min(255, bg), Math.min(255, bb)), fg: hex(fg[0]!, fg[1]!, fg[2]!) };
  } catch {
    return { bg: "#ffffff", fg: "#111111" };
  }
}

/** Vector-drawn logos/titles/shapes (not text, not raster images) captured as picture regions. */
function drawnRegions(canvas: HTMLCanvasElement, scale: number, pw: number, ph: number,
  texts: { x: number; y: number; w: number; h: number }[], imgs: { x: number; y: number; w: number; h: number }[]) {
  const ctx = canvas.getContext("2d")!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const G = 4; // grid cell in PDF points
  const gw = Math.ceil(pw / G), gh = Math.ceil(ph / G);
  const masked = new Uint8Array(gw * gh);
  const mark = (r: { x: number; y: number; w: number; h: number }, pad: number) => {
    for (let gy = Math.max(0, Math.floor((r.y - pad) / G)); gy < Math.min(gh, Math.ceil((r.y + r.h + pad) / G)); gy++)
      for (let gx = Math.max(0, Math.floor((r.x - pad) / G)); gx < Math.min(gw, Math.ceil((r.x + r.w + pad) / G)); gx++) masked[gy * gw + gx] = 1;
  };
  texts.forEach((t) => mark(t, 1));
  imgs.forEach((t) => mark(t, 0));
  const ink = new Uint8Array(gw * gh);
  const cell = G * scale;
  const step = Math.max(1, Math.floor(cell / 4));
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    if (masked[gy * gw + gx]) continue;
    const x0 = Math.floor(gx * cell), y0 = Math.floor(gy * cell);
    let n = 0;
    for (let y = y0; y < Math.min(canvas.height, y0 + cell); y += step)
      for (let x = x0; x < Math.min(canvas.width, x0 + cell); x += step) {
        const i = (y * canvas.width + x) * 4;
        if (255 * 3 - data[i]! - data[i + 1]! - data[i + 2]! > 90) n++;
      }
    if (n >= 2) ink[gy * gw + gx] = 1;
  }
  const seen = new Uint8Array(gw * gh);
  const out: { x: number; y: number; w: number; h: number; src: string }[] = [];
  for (let s = 0; s < ink.length; s++) {
    if (!ink[s] || seen[s]) continue;
    let x1 = gw, y1 = gh, x2 = 0, y2 = 0, cnt = 0;
    const q = [s]; seen[s] = 1;
    while (q.length) {
      const k = q.pop()!; const kx = k % gw, ky = (k - kx) / gw; cnt++;
      x1 = Math.min(x1, kx); x2 = Math.max(x2, kx); y1 = Math.min(y1, ky); y2 = Math.max(y2, ky);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = kx + dx, ny = ky + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const j = ny * gw + nx;
        if (ink[j] && !seen[j]) { seen[j] = 1; q.push(j); }
      }
    }
    const x = x1 * G, y = y1 * G, w = (x2 - x1 + 1) * G, h = (y2 - y1 + 1) * G;
    if (cnt < 6 || w < 16 || h < 8) continue; // skip rules, dots, noise
    if (w > pw * 0.9 && h > ph * 0.9) continue; // full-page background
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
    c.getContext("2d")!.drawImage(canvas, x * scale, y * scale, w * scale, h * scale, 0, 0, c.width, c.height);
    out.push({ x, y, w, h, src: c.toDataURL("image/png") });
  }
  return out;
}

