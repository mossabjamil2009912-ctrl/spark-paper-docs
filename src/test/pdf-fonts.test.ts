import { describe, expect, it } from "vitest";
import { pdfFontUrl, supportedArabicGlyph } from "@/lib/pdf-fonts";
import { cssFontFor } from "@/lib/pdf-render";

describe("PDF font matching", () => {
  it("writes isolated dal and beh even when their presentation codepoints are absent", () => {
    expect(supportedArabicGlyph("\uFEA9", new Set([0x062f]))).toBe("د");
    expect(supportedArabicGlyph("\uFE8F", new Set([0x0628]))).toBe("ب");
  });
  it("retains supported connected forms", () => {
    expect(supportedArabicGlyph("\uFEE4", new Set([0xfee4]))).toBe("\uFEE4");
  });
  it("keeps Cairo instead of substituting IBM Plex", () => {
    expect(cssFontFor("ABCDEF+Cairo-Bold", "sans-serif", true)).toBe('"Cairo", sans-serif');
    expect(pdfFontUrl('"Cairo", sans-serif', true)).toBe(`${import.meta.env.BASE_URL}fonts/Cairo-Bold.ttf`);
  });
  it("uses Tajawal for both the editor and saved text", () => {
    expect(cssFontFor("Tajawal-Regular", "sans-serif", true)).toBe('"Tajawal", sans-serif');
    expect(pdfFontUrl('"Tajawal", sans-serif')).toBe(`${import.meta.env.BASE_URL}fonts/Tajawal-Regular.ttf`);
  });
});