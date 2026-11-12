// All coordinates are fractions of the page (0..1); sizes are fractions of page width.
/** x is the right edge for rtl text, the left edge for ltr text. */
export type TextItem = { kind: "text"; x: number; y: number; text: string; size: number; color: string; w: number; font?: string | undefined; bold?: boolean | undefined; italic?: boolean | undefined; ltr?: boolean | undefined };

export const fontCss = (it: { size: number; font?: string | undefined; bold?: boolean | undefined; italic?: boolean | undefined }, px: number) =>
  `${it.italic ? "italic " : ""}${it.bold ? 700 : it.font ? 400 : 500} ${px}px ${it.font ?? FONT}`;
export type PathItem = { kind: "path"; points: [number, number][]; color: string; width: number; alpha: number };
export type ImageItem = { kind: "image"; x: number; y: number; w: number; h: number; src: string; img?: HTMLImageElement };
export type RectItem = { kind: "rect"; x: number; y: number; w: number; h: number; color: string };
export type Item = TextItem | PathItem | ImageItem | RectItem;

export const FONT = '"Amiri", "IBM Plex Sans Arabic", serif';

export function drawItems(ctx: CanvasRenderingContext2D, items: Item[], W: number, H: number) {
  ctx.clearRect(0, 0, W, H);
  for (const it of items) {
    if (it.kind === "path") {
      if (!it.points.length) continue;
      ctx.save();
      ctx.globalAlpha = it.alpha;
      ctx.strokeStyle = it.color;
      ctx.lineWidth = it.width * W;
      ctx.lineCap = it.alpha < 1 ? "butt" : "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      it.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
      if (it.points.length === 1) ctx.lineTo(it.points[0]![0] * W + 0.5, it.points[0]![1] * H);
      ctx.stroke();
      ctx.restore();
    } else if (it.kind === "text") {
      ctx.save();
      ctx.fillStyle = it.color;
      ctx.font = fontCss(it, it.size * W);
      ctx.textBaseline = "top";
      ctx.textAlign = it.ltr ? "left" : "right";
      ctx.direction = it.ltr ? "ltr" : "rtl";
      it.text.split("\n").forEach((line, i) => ctx.fillText(line, it.x * W, it.y * H + i * it.size * W * 1.3));
      ctx.restore();
    } else if (it.kind === "rect") {
      ctx.fillStyle = it.color;
      ctx.fillRect(it.x * W, it.y * H, it.w * W, it.h * H);
    } else if (it.img?.complete) {
      ctx.drawImage(it.img, it.x * W, it.y * H, it.w * W, it.h * H);
    }
  }
}

/** Returns the index of the topmost item under (x,y), or -1. aspect = H/W. */
export function hitTest(items: Item[], x: number, y: number, aspect: number): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === "path") {
      const tol = Math.max(it.width, 0.015);
      if (it.points.some(([px, py]) => Math.hypot(px - x, (py - y) * aspect) < tol)) return i;
    } else if (it.kind === "text") {
      const lines = it.text.split("\n").length;
      const h = (it.size * 1.3 * lines) / aspect;
      const left = it.ltr ? it.x : it.x - it.w;
      if (x >= left && x <= left + it.w && y >= it.y && y <= it.y + h) return i;
    } else if ((it.kind === "image" || it.kind === "rect") && x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) return i;
  }
  return -1;
}

export function measureText(text: string, size: number, style: { font?: string | undefined; bold?: boolean | undefined; italic?: boolean | undefined } = {}) {
  const c = document.createElement("canvas").getContext("2d")!;
  c.font = fontCss({ size, ...style }, size * 1000);
  return Math.max(...text.split("\n").map((l) => c.measureText(l).width)) / 1000;
}
