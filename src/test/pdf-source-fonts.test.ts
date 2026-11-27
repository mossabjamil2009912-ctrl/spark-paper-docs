import { describe, expect, it } from "vitest";
import { sfntWeight, sourceSupports, readSourceFonts } from "@/lib/pdf-source-fonts";
import { fontCss } from "@/lib/annotations";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFArray, PDFRawStream, PDFName, decodePDFRawStream } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { applyEdits } from "@/lib/pdf-ops";

describe("automatic original PDF text formatting", () => {
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
    const font = await doc.embedFont(readFileSync("public/fonts/Cairo-Bold.ttf"), { subset: false });
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