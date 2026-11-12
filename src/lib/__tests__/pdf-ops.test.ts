import { describe, expect, it } from "vitest";
import { parseRanges } from "../pdf-ops";

describe("parseRanges", () => {
  it("parses ranges and singles with Arabic comma", () => {
    expect(parseRanges("1-3، 5", 10)).toEqual([0, 1, 2, 4]);
  });
  it("clamps to page count and supports open ranges", () => {
    expect(parseRanges("8-", 9)).toEqual([7, 8]);
    expect(parseRanges("20", 5)).toEqual([]);
  });
});
