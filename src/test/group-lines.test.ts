import { describe, expect, it } from "vitest";
import { groupLines } from "@/lib/pdf-render";

describe("groupLines Arabic", () => {
  it("keeps a kerned Arabic word joined (no space inside أنظمة)", () => {
    const l = groupLines([
      { str: "أنظ", x: 60, y: 0, w: 20, h: 10, spaceWidth: 6 },
      { str: "مة", x: 37, y: 0, w: 20, h: 10, spaceWidth: 6 }, // kerning gap 3 < actual space advance 6
    ]);
    expect(l[0]?.str).toBe("أنظمة");
  });
  it("turns presentation forms into plain letters", () => {
    expect(groupLines([{ str: "\uFE83\uFEE7\uFEC8\uFEE4\uFE94", x: 0, y: 0, w: 30, h: 10 }])[0]?.str).toBe("أنظمة");
  });
  it("separates Arabic words at a real word gap below the old 0.35 height limit", () => {
    expect(groupLines([
      { str: "دليل", x: 80, y: 0, w: 20, h: 10, spaceWidth: 3 },
      { str: "عمل", x: 57, y: 0, w: 20, h: 10, spaceWidth: 3 },
      { str: "بوت", x: 34, y: 0, w: 20, h: 10, spaceWidth: 3 },
    ])[0]?.str).toBe("دليل عمل بوت");
  });
  it("keeps an explicit PDF space even when its box overlaps the next word", () => {
    expect(groupLines([
      { str: "دليل", x: 80, y: 0, w: 20, h: 10 },
      { str: " ", x: 79, y: 0, w: 1, h: 10 },
      { str: "عمل", x: 59, y: 0, w: 20, h: 10 },
    ])[0]?.str).toBe("دليل عمل");
  });
  it("does not merge Arabic words when font metrics are missing", () => {
    expect(groupLines([
      { str: "دليل", x: 60, y: 0, w: 20, h: 10 },
      { str: "عمل", x: 38, y: 0, w: 20, h: 10 },
    ])[0]?.str).toBe("دليل عمل");
  });
});
