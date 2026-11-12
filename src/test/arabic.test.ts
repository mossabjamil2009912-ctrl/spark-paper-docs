import { describe, expect, it } from "vitest";
import { toVisual } from "@/lib/arabic";
import { isVectorable } from "@/lib/pdf-ops";

describe("Arabic vector text", () => {
  it("joins letters and mirrors them into visual order", () => {
    // مرحبا → joined forms, reversed for left-to-right drawing
    expect(toVisual("مرحبا")).toBe("\uFE8E\uFE92\uFEA3\uFEAE\uFEE3");
  });
  it("keeps numbers in reading order inside Arabic", () => {
    expect(toVisual("سنة 2026").startsWith("2026")).toBe(true);
  });
  it("saves Arabic text as real text, not a picture", () => {
    expect(isVectorable("تعديل النص 12")).toBe(true);
  });
});
