import { PDFDict, PDFName, PDFNumber, PDFRawStream, PDFDocument, decodePDFRawStream } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { hasArabic, toVisual } from "./arabic";

export type SourceFont = { name: string; family: string; weight: number; italic: boolean; data: string; characters: number[] };
export type PdfFontInfo = { weight: number; italic: boolean; sourceFont?: SourceFont };

/** PDF descriptor/name evidence survives unusable subset programs and PDF.js remapping. */
export function resolveFontWeight(info: { name?: string; weight?: number; flags?: number; programWeight?: number; bold?: boolean }): number {
  const namedBold = /bold|black|heavy|semibold|demi|w[6-9]/i.test(info.name ?? "");
  const forcedBold = ((info.flags ?? 0) & 0x40000) !== 0;
  const weight = info.weight ?? info.programWeight ?? 400;
  return namedBold || forcedBold || info.bold ? Math.max(700, weight) : weight;
}

export function isBoldText(text: { weight?: number | undefined; bold?: boolean | undefined }): boolean {
  return (text.weight ?? (text.bold ? 700 : 400)) >= 600;
}

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
  const metadata = await readPdfFontInfo(bytes);
  return new Map([...metadata].flatMap(([name, info]) => info.sourceFont ? [[name, info.sourceFont] as const] : []));
}

export async function readPdfFontInfo(bytes: ArrayBuffer): Promise<Map<string, PdfFontInfo>> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const fonts = new Map<string, PdfFontInfo>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const descriptor = obj.lookup(PDFName.of("FontDescriptor"));
    if (!(descriptor instanceof PDFDict)) continue;
    const base = obj.lookup(PDFName.of("BaseFont"));
    const nameObj = descriptor.lookup(PDFName.of("FontName"));
    const name = (base instanceof PDFName ? base : nameObj instanceof PDFName ? nameObj : undefined)?.decodeText();
    if (!name || fonts.has(name)) continue;
    const weightObj = descriptor.lookup(PDFName.of("FontWeight"));
    const flagsObj = descriptor.lookup(PDFName.of("Flags"));
    const descriptorWeight = weightObj instanceof PDFNumber ? weightObj.asNumber() : undefined;
    const flags = flagsObj instanceof PDFNumber ? flagsObj.asNumber() : 0;
    const info: PdfFontInfo = {
      weight: resolveFontWeight({ name, flags, ...(descriptorWeight !== undefined ? { weight: descriptorWeight } : {}) }),
      italic: /italic|oblique/i.test(name) || (flags & 64) !== 0,
    };
    fonts.set(name, info);
    for (const key of ["FontFile2", "FontFile3"]) {
      const stream = descriptor.lookup(PDFName.of(key));
      if (!(stream instanceof PDFRawStream)) continue;
      try {
        const data = decodePDFRawStream(stream).decode();
        const programWeight = sfntWeight(data);
        info.weight = resolveFontWeight({ name, flags, ...(descriptorWeight !== undefined ? { weight: descriptorWeight } : {}), ...(programWeight !== undefined ? { programWeight } : {}) });
        const f = fontkit.create(data);
        // Empty/PUA-only cmaps cannot accept ordinary typed text.
        if (!f.characterSet.some((c) => c >= 32 && c < 0xe000)) continue;
        const style = f.subfamilyName ?? "";
        const weight = resolveFontWeight({ name: `${name} ${style}`, weight: info.weight, flags });
        info.weight = weight;
        info.italic ||= /italic|oblique/i.test(style);
        let binary = "";
        for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
        const font: SourceFont = { name, family: f.familyName ?? name, weight, italic: info.italic, data: btoa(binary), characters: f.characterSet };
        info.sourceFont = font;
        if (typeof FontFace !== "undefined") {
          const face = new FontFace(`PDF-${name}`, data.slice().buffer, { weight: String(weight), style: font.italic ? "italic" : "normal" });
          document.fonts.add(await face.load());
        }
      } catch { /* Unsupported embedded font program: retain the matching local family. */ }
    }
  }
  return fonts;
}