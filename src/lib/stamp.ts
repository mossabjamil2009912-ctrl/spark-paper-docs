import { PDFDocument, degrees } from "pdf-lib";

export type StampOptions = {
  numbers: boolean;
  numberFormat: "n" | "n-of-total";
  watermark: string;
  opacity: number;
};

/** Draw text with the browser (shapes Arabic correctly) into a transparent PNG. */
function textPng(text: string, px: number, color: string): { bytes: Promise<Uint8Array>; w: number; h: number } {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = `bold ${px}px Arial, "IBM Plex Sans Arabic", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + px;
  const h = Math.ceil(px * 1.5);
  c.width = w;
  c.height = h;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.direction = /[\u0600-\u06FF]/.test(text) ? "rtl" : "ltr";
  ctx.fillText(text, w / 2, h / 2);
  const bytes = new Promise<Uint8Array>((res) =>
    c.toBlob(async (b) => res(new Uint8Array(await b!.arrayBuffer())), "image/png"),
  );
  return { bytes, w, h };
}

export function pageLabel(i: number, total: number, fmt: StampOptions["numberFormat"]) {
  return fmt === "n" ? String(i + 1) : `${i + 1} / ${total}`;
}

export async function stampPdf(bytes: ArrayBuffer, o: StampOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const wm = o.watermark.trim() ? textPng(o.watermark.trim(), 160, "#c8102e") : null;
  const wmImg = wm ? await doc.embedPng(await wm.bytes) : null;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const { width, height } = p.getSize();
    if (wmImg && wm) {
      const target = Math.hypot(width, height) * 0.6;
      const s = target / wm.w;
      const w = wm.w * s, h = wm.h * s;
      const a = Math.atan2(height, width);
      // Rotate around the page centre: offset the lower-left corner accordingly.
      const cx = width / 2 - (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a);
      const cy = height / 2 - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a);
      p.drawImage(wmImg, { x: cx, y: cy, width: w, height: h, rotate: degrees((a * 180) / Math.PI), opacity: o.opacity });
    }
    if (o.numbers) {
      const t = textPng(pageLabel(i, pages.length, o.numberFormat), 60, "#333333");
      const img = await doc.embedPng(await t.bytes);
      const h = 14, w = (t.w / t.h) * h;
      p.drawImage(img, { x: width / 2 - w / 2, y: 16, width: w, height: h });
    }
  }
  return doc.save();
}
