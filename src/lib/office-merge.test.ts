// @vitest-environment jsdom
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { mergeXlsx, splitXlsx } from "./office-merge";

async function book(sheets: string[]) {
  const wb = new ExcelJS.Workbook();
  sheets.forEach((n) => wb.addWorksheet(n).getCell("A1").value = n);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
async function load(b: Blob) {
  const wb = new ExcelJS.Workbook();
  const buf = await new Promise<ArrayBuffer>((ok) => { const r = new FileReader(); r.onload = () => ok(r.result as ArrayBuffer); r.readAsArrayBuffer(b); });
  await wb.xlsx.load(buf);
  return wb;
}

describe("merge options", () => {
  it("Excel: each file in its own tab", async () => {
    const wb = await load(await mergeXlsx([{ name: "a.xlsx", bytes: await book(["x"]) }, { name: "b.xlsx", bytes: await book(["y"]) }], false));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["a", "b"]);
  });
  it("Excel: all files in one tab", async () => {
    const wb = await load(await mergeXlsx([{ name: "a.xlsx", bytes: await book(["x"]) }, { name: "b.xlsx", bytes: await book(["y"]) }], true));
    expect(wb.worksheets.length).toBe(1);
    expect(wb.worksheets[0]!.getCell("A1").value).toBe("x");
    expect(wb.worksheets[0]!.getCell("A3").value).toBe("y");
  });
  it("Excel split: one file per tab", async () => {
    expect((await splitXlsx(await book(["s1", "s2", "s3"]))).length).toBe(3);
  });
});
