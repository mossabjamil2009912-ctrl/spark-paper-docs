import { PDFDict, PDFName, PDFRawStream, PDFDocument, decodePDFRawStream } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { hasArabic, toVisual } from "./arabic";

export type SourceFont = { name: string; family: string; weight: number; italic: boolean; data: string; characters: number[] };

/** Read the real weight, including fonts whose external name omits Bold. */
export function sfntWeight(bytes: Uint8Array): number | undefined {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.byteLength < 12) return undefined;
  const count = v.getUint16(4);
  for (let i = 0; i < count; i++) {
    const p = 12 + i * 16;
    if (p + 16 > v.byteLength) break;
    if (v.getUint32(p) !== 0x4f532f32) continue;
    const offset = v.getUint32(p + 8);
    if (offset + 6 > v.byteLength) return undefined;
    const weight = v.getUint16(offset + 4);
    return weight >= 1 && weight <= 1000 ? weight : undefined;
  }
  return undefined;
}

export function sourceSupports(font: SourceFont, text: string) {
  const supported = new Set(font.characters);
  const visual = hasArabic(text) ? toVisual(text) : text;
  return [...visual].every((c) => /\s/.test(c) || [...(supported.has(c.codePointAt(0) ?? -1) ? c : c.normalize("NFKC"))].every((g) => supported.has(g.codePointAt(0) ?? -1)));
}

export function sourceFontBytes(data: string) {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}

/** Extract original Unicode font programs, not PDF.js's remapped rendering fonts. */
export async function readSourceFonts(bytes: ArrayBuffer): Promise<Map<string, SourceFont>> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const fonts = new Map<string, SourceFont>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const descriptor = obj.lookup(PDFName.of("FontDescriptor"));
    if (!(descriptor instanceof PDFDict)) continue;
    const base = obj.lookup(PDFName.of("BaseFont"));
    const nameObj = descriptor.lookup(PDFName.of("FontName"));
    const name = (base instanceof PDFName ? base : nameObj instanceof PDFName ? nameObj : undefined)?.decodeText();
    if (!name || fonts.has(name)) continue;
    for (const key of ["FontFile2", "FontFile3"]) {
      const stream = descriptor.lookup(PDFName.of(key));
      if (!(stream instanceof PDFRawStream)) continue;
      try {
        const data = decodePDFRawStream(stream).decode();
        const f = fontkit.create(data);
        // Empty/PUA-only cmaps cannot accept ordinary typed text.
        if (!f.characterSet.some((c) => c >= 32 && c < 0xe000)) continue;
        const style = f.subfamilyName ?? "";
        const weight = sfntWeight(data) ?? (/bold|black|heavy/i.test(style) ? 700 : 400);
        let binary = "";
        for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
        const font: SourceFont = { name, family: f.familyName ?? name, weight, italic: /italic|oblique/i.test(style), data: btoa(binary), characters: f.characterSet };
        fonts.set(name, font);
        if (typeof FontFace !== "undefined") {
          const face = new FontFace(`PDF-${name}`, data.slice().buffer, { weight: String(weight), style: font.italic ? "italic" : "normal" });
          document.fonts.add(await face.load());
        }
      } catch { /* Unsupported embedded font program: retain the matching local family. */ }
    }
  }
  return fonts;
}