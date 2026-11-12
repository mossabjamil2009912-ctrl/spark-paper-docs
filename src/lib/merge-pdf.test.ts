// @vitest-environment jsdom
import { PDFDocument } from "pdf-lib";
import { expect, it } from "vitest";
import { mergePdfs } from "./pdf-ops";

async function pdf(pages: number) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([200, 300]);
  return (await d.save()).buffer as ArrayBuffer;
}
it("PDF: separator page between files", async () => {
  const out = await PDFDocument.load(await mergePdfs([await pdf(2), await pdf(1)], true));
  expect(out.getPageCount()).toBe(4);
});
