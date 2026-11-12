import { describe, expect, it } from "vitest";
import { displayText, parseNumber } from "@/lib/excel-convert";

describe("PDF/Excel number handling", () => {
  it("keeps thousands separators and decimals as a number format", () => {
    expect(parseNumber("1,250.50")).toEqual({ value: 1250.5, fmt: "#,##0.00" });
  });
  it("keeps codes with leading zeros as text", () => {
    expect(parseNumber("007")).toBeNull();
  });
  it("reads percentages as fractions", () => {
    expect(parseNumber("45%")).toEqual({ value: 0.45, fmt: "0%" });
  });
  it("shows Excel numbers with their format in the PDF", () => {
    expect(displayText({ value: 15006, numFmt: "#,##0.00" })).toBe("15,006.00");
  });
});
