import { describe, it, expect } from "vitest";
import { coverFor } from "@/lib/pdf-render";

describe("coverFor", () => {
  it("never reaches the next line below", () => {
    const a = { x: 0.1, y: 0.5, w: 0.5, h: 0.024 };
    const b = { x: 0.1, y: 0.522, w: 0.5, h: 0.024 };
    const c = coverFor([a, b], a);
    expect(c.y + c.h).toBeLessThanOrEqual(b.y);
    expect(c.y + c.h).toBeGreaterThanOrEqual(a.y + a.h / 1.2);
  });
});
