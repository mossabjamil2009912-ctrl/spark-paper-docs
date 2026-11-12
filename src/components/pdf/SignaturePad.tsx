import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

export function SignaturePad({ color, onDone, onCancel }: { color: string; onDone: (src: string, aspect: number) => void; onCancel: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const used = useRef(false);

  useEffect(() => {
    const c = ref.current!;
    c.width = c.clientWidth * 2;
    c.height = c.clientHeight * 2;
    const ctx = c.getContext("2d")!;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
  }, [color]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) * 2, (e.clientY - r.top) * 2] as const;
  };

  const finish = () => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++)
        if (data[(y * c.width + x) * 4 + 3]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 <= x0) return;
    const pad = 6;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    const w = Math.min(c.width, x1 + pad) - x0, h = Math.min(c.height, y1 + pad) - y0;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    out.getContext("2d")!.drawImage(c, x0, y0, w, h, 0, 0, w, h);
    onDone(out.toDataURL("image/png"), h / w);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-lg rounded-2xl bg-card p-5 shadow-paper" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl text-primary">ارسم توقيعك</h2>
        <canvas
          ref={ref}
          className="mt-3 h-48 w-full touch-none rounded-xl border-2 border-dashed bg-paper"
          onPointerDown={(e) => {
            drawing.current = true;
            used.current = true;
            const ctx = ref.current!.getContext("2d")!;
            const [x, y] = pos(e);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 0.1, y);
            ctx.stroke();
            (e.target as Element).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = ref.current!.getContext("2d")!;
            const [x, y] = pos(e);
            ctx.lineTo(x, y);
            ctx.stroke();
          }}
          onPointerUp={() => (drawing.current = false)}
        />
        <div className="mt-4 flex justify-between gap-2">
          <Button variant="ghost" onClick={() => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); }}>مسح</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>إلغاء</Button>
            <Button onClick={finish}>استخدام التوقيع</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
