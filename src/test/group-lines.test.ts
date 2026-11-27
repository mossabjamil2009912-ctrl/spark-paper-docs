import { describe, expect, it } from "vitest";
import { groupLines } from "@/lib/pdf-render";

describe("groupLines Arabic", () => {
  it("keeps a kerned Arabic word joined (no space inside أنظمة)", () => {
    const l = groupLines([
      { str: "أنظ", x: 60, y: 0, w: 20, h: 10 },
      { str: "مة", x: 37, y: 0, w: 20, h: 10 }, // gap 3 = 0.3·h
    ]);
    expect(l[0]!.str).toBe("أنظمة");
  });
  it("turns presentation forms into plain letters", () => {
    expect(groupLines([{ str: "\uFE83\uFEE7\uFEC8\uFEE4\uFE94", x: 0, y: 0, w: 30, h: 10 }])[0]!.str).toBe("أنظمة");
  });
});
