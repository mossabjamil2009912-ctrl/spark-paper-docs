import { describe, expect, it, vi } from "vitest";
import { sfntWeight, sourceSupports, readSourceFonts, readPdfFontInfo, resolveFontWeight } from "@/lib/pdf-source-fonts";
import { fontCss } from "@/lib/annotations";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFArray, PDFDict, PDFRawStream, PDFName, decodePDFRawStream } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { applyEdits } from "@/lib/pdf-ops";

describe("automatic original PDF text formatting", () => {
  it("does not let remapped weight 500 erase an explicit Bold flag", () => {
    expect(resolveFontWeight({ name: "F1", programWeight: 500, bold: true })).toBe(700);
    expect(resolveFontWeight({ name: "F1", programWeight: 400, weight: 600 })).toBe(600);
    expect(resolveFontWeight({ name: "F1", programWeight: 400 })).toBe(400);
  });
  it.each([{ weight: 700, flags: 0 }, { weight: 400, flags: 0x40000 }])("retains descriptor boldness when the subset is unusable: %j", async ({ weight, flags }) => {
    const doc = await PDFDocument.create();
    const descriptor = doc.context.obj({ Type: "FontDescriptor", FontName: "ABCDEF+F1", FontWeight: weight, Flags: flags,
      FontFile2: doc.context.register(doc.context.stream(new Uint8Array([1, 2, 3]))) });
    doc.context.register(doc.context.obj({ Type: "Font", BaseFont: "ABCDEF+F1", FontDescriptor: doc.context.register(descriptor) }));
    doc.addPage();
    const info = (await readPdfFontInfo((await doc.save()).slice().buffer)).get("ABCDEF+F1");
    expect(info?.weight).toBe(700);
    expect(info?.sourceFont).toBeUndefined();
  });
  it.each(["Edited", "تغيير"])("uses numeric bold weight for fallback export of %s even without a bold flag", async (text) => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = (await doc.save()).slice().buffer;
    const fetchFont = vi.fn(async (_url: string) => new Response(readFileSync("public/fonts/Cairo-Bold.ttf")));
    vi.stubGlobal("fetch", fetchFont);
    try {
      const saved = await applyEdits(bytes, { 0: { rects: [], texts: [{ x: 0.1, y: 0.1, text, size: 0.04, color: "#000000", weight: 700, bold: false, ...(text === "تغيير" ? { font: '"Cairo"' } : {}) }] } });
      const output = await PDFDocument.load(saved);
      const fonts = output.getPage(0).node.Resources()?.lookup(PDFName.of("Font"));
      if (!(fonts instanceof PDFDict)) throw new Error("Missing saved font dictionary");
      if (text === "تغيير") {
        expect(fetchFont.mock.calls[0]?.[0]).toMatch(/Cairo-Bold\.ttf$/);
        expect([...(await readSourceFonts(saved.slice().buffer)).values()].map((f) => f.weight)).toContain(700);
      } else {
        const first = fonts.values()[0];
        if (!first) throw new Error("Missing saved fallback font reference");
        const face = output.context.lookup(first);
        if (!(face instanceof PDFDict)) throw new Error("Missing saved fallback font");
        expect(face.lookup(PDFName.of("BaseFont"))?.toString()).toBe("/Helvetica-Bold");
      }
    } finally { vi.unstubAllGlobals(); }
  });
  it("reads weight 700 without relying on a Bold font name", () => {
    const bytes = new Uint8Array(40);
    const view = new DataView(bytes.buffer);
    view.setUint16(4, 1);
    view.setUint32(12, 0x4f532f32);
    view.setUint32(20, 28);
    view.setUint16(32, 700);
    expect(sfntWeight(bytes)).toBe(700);
  });
  it("retains an exact semibold weight and point size", () => {
    expect(fontCss({ size: 0.04, font: '"Original"', weight: 600 }, 24)).toBe('600 24px "Original"');
  });
  it("only reuses a subset when the edited characters exist", () => {
    const font = { name: "Original", family: "Original", weight: 700, italic: false, data: "", characters: [65, 66] };
    expect(sourceSupports(font, "AB")).toBe(true);
    expect(sourceSupports(font, "AC")).toBe(false);
  });
  it("rejects a truncated font table", () => {
    expect(sfntWeight(new Uint8Array(6))).toBeUndefined();
  });
  it("exports the original embedded bold font at 24 points and the original baseline", async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(Uint8Array.from(readFileSync("public/fonts/Cairo-Bold.ttf")), { subset: false });
    doc.addPage([595, 842]).drawText("Original", { x: 60, y: 700, size: 24, font });
    const bytes = (await doc.save()).slice().buffer;
    const source = [...(await readSourceFonts(bytes)).values()][0];
    expect(source?.weight).toBe(700);
    if (!source) throw new Error("Missing embedded source font");
    const saved = await applyEdits(bytes, { 0: { rects: [], texts: [{ x: 60 / 595, y: 0.1, baseline: 142 / 842, text: "Edited", size: 24 / 595, color: "#334c66", weight: 700, bold: true, sourceFont: source }] } });
    const output = await PDFDocument.load(saved);
    const contents = output.getPage(0).node.lookup(PDFName.of("Contents"));
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => output.context.lookup(r)) : [contents];
    const commands = streams.filter((s): s is PDFRawStream => s instanceof PDFRawStream).map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join("\n");
    expect(commands).toMatch(/24 Tf/);
    expect(commands).toContain("1 0 0 1 60 700 Tm");
    expect(commands).toContain("0.2 0.2980392156862745 0.4 rg");
    const fonts = await readSourceFonts(saved.slice().buffer);
    expect([...fonts.values()].every((f) => f.data === source.data)).toBe(true);
  });
});