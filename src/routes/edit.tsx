import { createFileRoute } from "@tanstack/react-router";
import { Eraser, Highlighter, Pen, Signature, Type, Undo2, Download, MousePointer2, FilePenLine, SquareDashedMousePointer, ImageIcon, Trash2, ImagePlus, Redo2, ZoomIn, ZoomOut, Square, MoveUpRight } from "lucide-react";
import { clearDraft, draftKey, loadDraft, saveDraft } from "@/lib/draft-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Busy, FileDrop, Shell } from "@/components/pdf/Shell";
import { SignaturePad } from "@/components/pdf/SignaturePad";
import { drawItems, fontCss, hitTest, measureText, type ImageItem, type Item } from "@/lib/annotations";
import { applyEdits, baseName, downloadBytes, isVectorable, type PageEdits } from "@/lib/pdf-ops";
import { renderPages, sampleColors, coverFor, type RenderedPage } from "@/lib/pdf-render";

export const Route = createFileRoute("/edit")({
  head: () => ({
    meta: [
      { title: "تعديل وتوقيع PDF — أكتس" },
      { name: "description", content: "أضف نصاً وتوقيعاً، ارسم وظلّل على ملف PDF مباشرة في المتصفح." },
      { property: "og:title", content: "تعديل وتوقيع PDF — أكتس" },
      { property: "og:description", content: "اكتب ووقّع وارسم على صفحات PDF." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EditPage,
});

type Tool = "none" | "edittext" | "image" | "area" | "text" | "rect" | "arrow" | "pen" | "highlight" | "sign" | "erase";
const COLORS = ["#111827", "#1d4ed8", "#c2410c", "#15803d", "#facc15"] as const;
const tools: { id: Tool; label: string; icon: typeof Pen }[] = [
  { id: "none", label: "تصفح", icon: MousePointer2 },
  { id: "edittext", label: "تعديل النص", icon: FilePenLine },
  { id: "area", label: "تحديد حر", icon: SquareDashedMousePointer },
  { id: "image", label: "الصور", icon: ImageIcon },
  { id: "text", label: "نص", icon: Type },
  { id: "sign", label: "توقيع", icon: Signature },
  { id: "rect", label: "مربع", icon: Square },
  { id: "arrow", label: "سهم", icon: MoveUpRight },
  { id: "pen", label: "قلم", icon: Pen },
  { id: "highlight", label: "تظليل", icon: Highlighter },
  { id: "erase", label: "ممحاة", icon: Eraser },
];

function EditPage() {
  const [file, setFile] = useState<{ name: string; bytes: ArrayBuffer } | null>(null);
  const [pages, setPages] = useState<RenderedPage[] | null>(null);
  const [items, setItems] = useState<Item[][]>([]);
  const [history, setHistory] = useState<Item[][][]>([]);
  const [tool, setTool] = useState<Tool>("none");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [textSize, setTextSize] = useState(0.025);
  const [sig, setSig] = useState<{ src: string; aspect: number } | null>(null);
  const [padOpen, setPadOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [future, setFuture] = useState<Item[][][]>([]);
  const [zoom, setZoom] = useState(1);
  const keyRef = useRef<string | null>(null);

  // Saved signature/stamp is reused across files.
  useEffect(() => {
    try { const s = localStorage.getItem("saved-signature"); if (s) setSig(JSON.parse(s)); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { if (sig) localStorage.setItem("saved-signature", JSON.stringify(sig)); } catch { /* ignore */ }
  }, [sig]);

  useEffect(() => {
    if (!keyRef.current || !pages) return;
    const t = setTimeout(() => saveDraft(keyRef.current!, items), 600);
    return () => clearTimeout(t);
  }, [items, pages]);

  const load = async (f: File) => {
    const bytes = await f.arrayBuffer();
    setFile({ name: f.name, bytes });
    setPages(null);
    try {
      const r = await renderPages(bytes, 2);
      setPages(r);
      const key = draftKey(f.name, f.size);
      keyRef.current = key;
      const saved = await loadDraft<Item[][]>(key);
      setHistory([]); setFuture([]); setZoom(1);
      if (saved && saved.length === r.length && saved.some((l) => l.length)) {
        setItems(saved);
        toast.success("استرجعنا تعديلاتك السابقة على هذا الملف", { action: { label: "ابدأ من جديد", onClick: () => { setItems(r.map(() => [])); clearDraft(key); } } });
      } else setItems(r.map(() => []));
      setTool("edittext");
    } catch (e) {
      console.error(e);
      toast.error("تعذّر فتح الملف");
      setFile(null);
    }
  };

  const commit = useCallback((page: number, fn: (list: Item[]) => Item[]) => {
    setItems((cur) => {
      setHistory((h) => [...h.slice(-50), cur]);
      setFuture([]);
      return cur.map((l, i) => (i === page ? fn(l) : l));
    });
  }, []);

  const undo = () =>
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1]!;
      setItems((cur) => { setFuture((f) => [...f, cur]); return prev; });
      return h.slice(0, -1);
    });

  const redo = () =>
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[f.length - 1]!;
      setItems((cur) => { setHistory((h) => [...h, cur]); return next; });
      return f.slice(0, -1);
    });

  const pickTool = (t: Tool) => {
    if (t === "sign" && !sig) setPadOpen(true);
    setTool(t);
  };

  const save = async () => {
    if (!file || !pages) return;
    setSaving(true);
    try {
      await Promise.all(items.flat().map((it) => (it.kind === "text" ? document.fonts.load(fontCss(it, 20), it.text).catch(() => []) : null)));
      await document.fonts.ready;
      const edits: Record<number, PageEdits> = {};
      for (let i = 0; i < pages.length; i++) {
        const list = items[i] ?? [];
        const pg = pages[i]!;
        if (!list.length) continue;
        const e: PageEdits = { rects: [], texts: [] };
        const raster: Item[] = [];
        for (const it of list) {
          if (it.kind === "rect") e.rects.push(it);
          else if (it.kind === "image" && /^data:image\/(png|jpe?g)/i.test(it.src)) (e.images ??= []).push({ x: it.x, y: it.y, w: it.w, h: it.h, src: it.src });
          else if (it.kind === "text" && isVectorable(it.text)) e.texts.push(it);
          else raster.push(it);
        }
        if (raster.length) {
          const W = Math.round(pg.width * 6), H = Math.round(pg.height * 6);
          const c = document.createElement("canvas");
          c.width = W; c.height = H;
          drawItems(c.getContext("2d")!, raster, W, H);
          const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
          e.overlay = new Uint8Array(await blob.arrayBuffer());
        }
        edits[i] = e;
      }
      downloadBytes(await applyEdits(file.bytes, edits), `${baseName(file.name)}-معدّل.pdf`);
      toast.success("تم حفظ الملف");
    } catch (e) {
      console.error(e);
      toast.error("تعذّر حفظ الملف");
    } finally {
      setSaving(false);
    }
  };

  if (!file)
    return (
      <Shell>
        <div className="mx-auto max-w-6xl px-4 pt-8 pb-4">
          <h1 className="text-3xl text-primary md:text-4xl">تعديل وتوقيع</h1>
          <p className="mt-1 text-muted-foreground">اكتب، وقّع، ارسم وظلّل على صفحات ملفك.</p>
        </div>
        <FileDrop onFiles={(f) => f[0] && load(f[0])} />
      </Shell>
    );

  return (
    <Shell>
      <div className="sticky top-[61px] z-20 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2">
          <div className="-mx-1 flex w-full gap-1 overflow-x-auto px-1 md:w-auto">
            {tools.map((t) => (
              <button
                key={t.id}
                onClick={() => pickTool(t.id)}
                className={`flex min-w-12 shrink-0 flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 text-[11px] md:min-w-14 md:px-2 md:py-1.5 md:text-xs transition-colors ${
                  tool === t.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                }`}
              >
                <t.icon className="h-4 w-4 md:h-5 md:w-5" />
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                aria-label="لون"
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-accent ring-2 ring-accent/30" : "border-card"}`}
                style={{ background: c }}
              />
            ))}
          </div>
          {(tool === "text" || tool === "edittext") && (
            <select value={textSize} onChange={(e) => setTextSize(+e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm">
              <option value={0.018}>صغير</option>
              <option value={0.025}>متوسط</option>
              <option value={0.035}>كبير</option>
              <option value={0.05}>عنوان</option>
            </select>
          )}
          <div className="ms-auto flex gap-2">
            <Button variant="ghost" size="sm" onClick={undo} disabled={!history.length}><Undo2 /> تراجع</Button>
            <Button variant="ghost" size="sm" onClick={redo} disabled={!future.length}><Redo2 /> إعادة</Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="تصغير الصفحة" onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))} disabled={zoom <= 1}><ZoomOut /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="تكبير الصفحة" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} disabled={zoom >= 3}><ZoomIn /></Button>
            <Button size="sm" onClick={save} disabled={saving || !pages}><Download /> {saving ? "جارٍ الحفظ…" : "حفظ"}</Button>
          </div>
        </div>
        {tool === "edittext" && (
          <p className="pb-2 text-center text-xs text-muted-foreground">انقر على أي نص أو شعار أو عنوان في الصفحة لتعديله</p>
        )}
        {tool === "image" && (
          <p className="pb-2 text-center text-xs text-muted-foreground">انقر على أي صورة لتحريكها أو تكبيرها أو حذفها، أو أضف صورة جديدة من الزر أعلى كل صفحة</p>
        )}
        {tool === "area" && (
          <p className="pb-2 text-center text-xs text-muted-foreground">اسحب مربعاً فوق أي كلمة أو جزء من الصفحة لمسحه وكتابة بديل</p>
        )}
        {tool === "sign" && sig && (
          <p className="pb-2 text-center text-xs text-muted-foreground">انقر على الصفحة لوضع توقيعك المحفوظ · <button className="underline" onClick={() => setPadOpen(true)}>توقيع جديد</button></p>
        )}
      </div>

      {!pages ? (
        <Busy />
      ) : (
        <div className="overflow-x-auto bg-stage py-6">
          <div className="mx-auto flex max-w-4xl flex-col gap-6 px-3" style={zoom > 1 ? { width: `${zoom * 100}%`, maxWidth: `${zoom * 56}rem` } : undefined}>
            {pages.map((p, i) => (
              <PageCanvas
                key={i}
                page={p}
                num={i + 1}
                items={items[i] ?? []}
                tool={tool}
                color={color}
                textSize={textSize}
                sig={sig}
                onAdd={(...its) => commit(i, (l) => [...l, ...its])}
                onRemove={(k) => commit(i, (l) => l.filter((_, j) => j !== k))}
                onReplace={(old, its) => commit(i, (l) => [...l.filter((x) => !old.includes(x)), ...its])}
              />
            ))}
          </div>
        </div>
      )}

      {padOpen && (
        <SignaturePad
          color={color === COLORS[4] ? COLORS[0] : color}
          onCancel={() => { setPadOpen(false); if (!sig) setTool("none"); }}
          onDone={(src, aspect) => { setSig({ src, aspect }); setPadOpen(false); setTool("sign"); }}
        />
      )}
    </Shell>
  );
}

function PageCanvas({
  page, num, items, tool, color, textSize, sig, onAdd, onRemove, onReplace,
}: {
  page: RenderedPage;
  num: number;
  items: Item[];
  tool: Tool;
  color: string;
  textSize: number;
  sig: { src: string; aspect: number } | null;
  onAdd: (...its: Item[]) => void;
  onRemove: (k: number) => void;
  onReplace: (old: Item[], its: Item[]) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<Item | null>(null);
  const shapeStart = useRef<[number, number] | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; text: string; size?: number; color?: string; bg?: string; font?: string; bold?: boolean; italic?: boolean; ltr?: boolean; cover?: { x: number; y: number; w: number; h: number } } | null>(null);
  type Draft = NonNullable<typeof draft>;
  const [edited, setEdited] = useState<Map<number, { draft: Draft; items: Item[] }>>(new Map());
  const editingIdx = useRef<number | null>(null);
  const [tick, setTick] = useState(0);
  const [sel, setSel] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const aspect = page.height / page.width;
  type Box = { x: number; y: number; w: number; h: number };
  const wrap = useRef<HTMLDivElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const [selImg, setSelImg] = useState<ImageItem | null>(null);
  const [taken, setTaken] = useState<Set<number>>(new Set());
  const [drag, setDrag] = useState<{ item: ImageItem; box: Box; start: Box; mode: "move" | "resize"; sx: number; sy: number } | null>(null);
  const origImgs = (page.images ?? []).map((im) => ({ x: im.x / page.width, y: im.y / page.height, w: im.w / page.width, h: im.h / page.height, src: im.src }));
  const mkImg = (src: string) => { const im = new Image(); im.onload = () => setTick((t) => t + 1); im.src = src; return im; };

  /** Paper colour just outside a box, so the old picture's place blends in. */
  const ringColor = async (b: Box) => {
    const img = new Image(); img.src = page.src; await img.decode().catch(() => {});
    const W = img.naturalWidth || 1, H = img.naturalHeight || 1;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const counts = new Map<string, number>();
    const x0 = Math.floor(b.x * W) - 3, x1 = Math.ceil((b.x + b.w) * W) + 3, y0 = Math.floor(b.y * H) - 3, y1 = Math.ceil((b.y + b.h) * H) + 3;
    const add = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = (y * W + x) * 4;
      const k = [d[i]!, d[i + 1]!, d[i + 2]!].map((v) => (v >> 3) << 3).map((v) => v.toString(16).padStart(2, "0")).join("");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    };
    for (let x = x0; x <= x1; x += 2) { add(x, y0); add(x, y1); }
    for (let y = y0; y <= y1; y += 2) { add(x0, y); add(x1, y); }
    let best = "ffffff", n = 0;
    counts.forEach((v, k) => { if (v > n) { n = v; best = k; } });
    const v = best.match(/../g)!.map((h) => parseInt(h, 16));
    return v.every((c) => c >= 240) ? "#ffffff" : "#" + best;
  };

  const takeOriginal = async (k: number) => {
    const o = origImgs[k]!;
    const bg = await ringColor(o);
    const item: ImageItem = { kind: "image", x: o.x, y: o.y, w: o.w, h: o.h, src: o.src, img: mkImg(o.src) };
    const e = 1 / Math.max(page.width, 1);
    onAdd({ kind: "rect", x: o.x - e, y: o.y - e, w: o.w + 2 * e, h: o.h + 2 * e, color: bg }, item);
    setTaken((s) => new Set(s).add(k));
    setSelImg(item);
    return item;
  };

  const addPicture = async (f: File) => {
    const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f); });
    const im = new Image(); im.src = url; await im.decode();
    const s = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight));
    const cv = document.createElement("canvas");
    cv.width = Math.round(im.naturalWidth * s); cv.height = Math.round(im.naturalHeight * s);
    cv.getContext("2d")!.drawImage(im, 0, 0, cv.width, cv.height);
    const src = /png|gif|webp|svg/i.test(f.type) ? cv.toDataURL("image/png") : cv.toDataURL("image/jpeg", 0.92);
    const w = 0.4, h = (w * cv.height / cv.width) / aspect;
    const item: ImageItem = { kind: "image", x: 0.3, y: Math.max(0, 0.5 - h / 2), w, h, src, img: mkImg(src) };
    onAdd(item);
    setSelImg(item);
  };

  const startDrag = (e: React.PointerEvent, item: ImageItem, mode: "move" | "resize") => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const b = { x: item.x, y: item.y, w: item.w, h: item.h };
    setDrag({ item, box: b, start: b, mode, sx: e.clientX, sy: e.clientY });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    const dx = (e.clientX - drag.sx) / r.width, dy = (e.clientY - drag.sy) / r.height;
    const s = drag.start;
    if (drag.mode === "move") setDrag({ ...drag, box: { ...s, x: s.x + dx, y: s.y + dy } });
    else { const w = Math.max(0.02, s.w + dx); setDrag({ ...drag, box: { ...s, w, h: (w * s.h) / s.w } }); }
  };
  const endDrag = () => {
    if (!drag) return;
    const n: ImageItem = { ...drag.item, ...drag.box };
    if (n.x !== drag.item.x || n.y !== drag.item.y || n.w !== drag.item.w) { onReplace([drag.item], [n]); setSelImg(n); }
    setDrag(null);
  };
  const scaleSel = (f: number) => {
    if (!selImg) return;
    const w = selImg.w * f, h = selImg.h * f;
    const n: ImageItem = { ...selImg, x: selImg.x - (w - selImg.w) / 2, y: selImg.y - (h - selImg.h) / 2, w, h };
    onReplace([selImg], [n]); setSelImg(n);
  };
  const deleteSel = () => { if (selImg) { onReplace([selImg], []); setSelImg(null); } };
  useEffect(() => { if (tool !== "image") setSelImg(null); }, [tool]);

  const redraw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(4, Math.max(2, window.devicePixelRatio || 1));
    const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const shown = drag ? items.filter((it) => it !== drag.item) : items;
    drawItems(c.getContext("2d")!, live.current ? [...shown, live.current] : shown, W, H);
  }, [items, drag]);

  useEffect(() => {
    redraw();
    document.fonts?.ready.then(redraw);
    window.addEventListener("resize", redraw);
    document.fonts?.addEventListener("loadingdone", redraw);
    return () => { window.removeEventListener("resize", redraw); document.fonts?.removeEventListener("loadingdone", redraw); };
  }, [redraw, tick]);

  const pt = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  const commitDraft = () => {
    const size = draft?.size ?? textSize;
    const cover = draft?.cover;
    const c = draft?.color ?? color;
    const st = { font: draft?.font, bold: draft?.bold, italic: draft?.italic };
    const txt = draft?.text.trim() ? [{ kind: "text" as const, x: draft!.x, y: draft!.y, text: draft!.text, size, color: c, w: measureText(draft!.text, size, st), ...st, ltr: draft!.ltr }] : [];
    if (cover) {
      const its: Item[] = [{ kind: "rect", ...cover, color: draft?.bg ?? "#ffffff" }, ...txt];
      const k = editingIdx.current;
      const prev = k !== null ? edited.get(k) : undefined;
      if (prev) onReplace(prev.items, its); else onAdd(...its);
      if (k !== null) setEdited((s) => new Map(s).set(k, { draft: draft!, items: its }));
    }
    else if (txt.length) onAdd(...txt);
    setDraft(null);
    editingIdx.current = null;
  };

  const finishArea = async (s: { x0: number; y0: number; x1: number; y1: number }) => {
    const x = Math.min(s.x0, s.x1), y = Math.min(s.y0, s.y1);
    const w = Math.abs(s.x1 - s.x0), h = Math.abs(s.y1 - s.y0);
    if (w < 0.01 || h < 0.005) return;
    const img = new Image();
    img.src = page.src;
    await img.decode().catch(() => {});
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth || 1; cv.height = img.naturalHeight || 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const c = sampleColors(ctx, x * cv.width, y * cv.height, w * cv.width, h * cv.height);
    // Prefill with any detected text inside the box (useful for tables).
    const inside = page.texts.filter((t) => t.x + t.w / 2 > x && t.x + t.w / 2 < x + w && t.y + t.h / 2 > y && t.y + t.h / 2 < y + h);
    const first = inside[0];
    let text = inside.map((t) => t.str).join(" ");
    let ocrRtl: boolean | null = null;
    if (!first) {
      // Drawn text (logo/title as shapes): read the letters so the user edits them instead of retyping.
      const crop = document.createElement("canvas");
      const pad = 0.15;
      const cx = (x - w * pad) * cv.width, cy = (y - h * pad) * cv.height;
      const cw = w * (1 + 2 * pad) * cv.width, ch = h * (1 + 2 * pad) * cv.height;
      const up = Math.max(1, 80 / Math.max(1, ch));
      crop.width = Math.ceil(cw * up); crop.height = Math.ceil(ch * up);
      const g = crop.getContext("2d")!;
      g.fillStyle = "#fff"; g.fillRect(0, 0, crop.width, crop.height);
      g.drawImage(cv, cx, cy, cw, ch, 0, 0, crop.width, crop.height);
      const tid = toast.loading("جارٍ قراءة النص…");
      try {
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker(["eng", "ara"]);
        await worker.setParameters({ tessedit_pageseg_mode: "7" as never });
        const r = await worker.recognize(crop);
        await worker.terminate();
        text = r.data.text.replace(/\s+/g, " ").trim();
        ocrRtl = /[\u0600-\u06FF]/.test(text);
      } catch (err) { console.warn(err); }
      toast.dismiss(tid);
    }
    const rtl = first ? first.rtl : ocrRtl ?? false;
    const size = Math.max(0.008, Math.min(h * aspect * 0.8, first ? (first.h / 1.2) * aspect * 0.95 : 1));
    editingIdx.current = null;
    setDraft({
      x: rtl ? x + w : x, y, text, size, color: c.fg, bg: c.bg, ltr: !rtl,
      ...(first ? { font: first.font, bold: first.bold, italic: first.italic } : { font: rtl ? '"IBM Plex Sans Arabic", Arial, sans-serif' : "Arial, Helvetica, sans-serif", bold: true }),
      cover: { x, y, w, h },
    });
  };

  /** Text drawn as shapes (logos, outlined titles) has no text layer: find the ink blob around the tap instead. */
  const blobAt = async (px: number, py: number) => {
    const img = new Image();
    img.src = page.src;
    await img.decode().catch(() => {});
    const W = img.naturalWidth || 1, H = img.naturalHeight || 1;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const cs = Math.max(2, Math.round(W / 400)); // grid cell in px
    const gw = Math.ceil(W / cs), gh = Math.ceil(H / cs);
    const cx = Math.floor((px * W) / cs), cy = Math.floor((py * H) / cs);
    const R = 60; // local window in cells
    const x0 = Math.max(0, cx - R), y0 = Math.max(0, cy - R), x1 = Math.min(gw, cx + R), y1 = Math.min(gh, cy + R);
    const d = ctx.getImageData(x0 * cs, y0 * cs, (x1 - x0) * cs, (y1 - y0) * cs);
    const iw = d.width;
    const counts = new Map<number, number>();
    for (let i = 0; i < d.data.length; i += 4 * 7) {
      const k = ((d.data[i]! >> 4) << 8) | ((d.data[i + 1]! >> 4) << 4) | (d.data[i + 2]! >> 4);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const bk = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0xfff;
    const br = ((bk >> 8) << 4) + 8, bgG = (((bk >> 4) & 15) << 4) + 8, bb = ((bk & 15) << 4) + 8;
    const gW = x1 - x0, gH = y1 - y0;
    const ink = new Uint8Array(gW * gH);
    for (let gy = 0; gy < gH; gy++) for (let gx = 0; gx < gW; gx++) {
      let hit = 0;
      for (let yy = 0; yy < cs && !hit; yy++) for (let xx = 0; xx < cs; xx++) {
        const i = ((gy * cs + yy) * iw + gx * cs + xx) * 4;
        if (Math.abs(d.data[i]! - br) + Math.abs(d.data[i + 1]! - bgG) + Math.abs(d.data[i + 2]! - bb) > 90) { hit = 1; break; }
      }
      ink[gy * gW + gx] = hit;
    }
    // Seed: nearest ink cell to the tap.
    let seed = -1;
    for (let r = 0; r <= 8 && seed < 0; r++) for (let dy = -r; dy <= r && seed < 0; dy++) for (let dx = -r; dx <= r; dx++) {
      const gx = cx - x0 + dx, gy = cy - y0 + dy;
      if (gx >= 0 && gy >= 0 && gx < gW && gy < gH && ink[gy * gW + gx]) { seed = gy * gW + gx; break; }
    }
    if (seed < 0) return null;
    // Flood fill joining letters on a line (horizontal gaps up to ~1 letter, vertical 1 cell).
    const seen = new Uint8Array(gW * gH);
    const stack = [seed];
    seen[seed] = 1;
    let mnx = gW, mny = gH, mxx = 0, mxy = 0;
    const gapX = Math.max(3, Math.round(gW / 40));
    while (stack.length) {
      const p = stack.pop()!;
      const gx = p % gW, gy = (p - gx) / gW;
      mnx = Math.min(mnx, gx); mxx = Math.max(mxx, gx); mny = Math.min(mny, gy); mxy = Math.max(mxy, gy);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -gapX; dx <= gapX; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= gW || ny >= gH) continue;
        const q = ny * gW + nx;
        if (!seen[q] && ink[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    const pad = 1;
    return {
      x: ((x0 + mnx - pad) * cs) / W, y: ((y0 + mny - pad) * cs) / H,
      w: ((mxx - mnx + 1 + 2 * pad) * cs) / W, h: ((mxy - mny + 1 + 2 * pad) * cs) / H,
    };
  };

  const onDown = (e: React.PointerEvent) => {
    const [x, y] = pt(e);
    if (tool === "image") { setSelImg(null); return; }
    if (tool === "edittext") {
      e.preventDefault();
      if (draft) { commitDraft(); return; }
      // Nearest real text first (table cells, numbers) so a tap never grabs a whole table.
      const tol = 0.02;
      let best = -1, bd = Infinity;
      page.texts.forEach((t, k) => {
        const dx = Math.max(t.x - x, 0, x - (t.x + t.w)), dy = Math.max(t.y - y, 0, y - (t.y + t.h)) * (1 / aspect);
        const d = Math.hypot(dx, dy);
        if (d < tol && d < bd) { bd = d; best = k; }
      });
      if (best >= 0) { editOriginal(page.texts[best]!, best); return; }
      void blobAt(x, y).then((b) => {
        if (!b) { toast("لا يوجد نص هنا. استخدم «تحديد حر» لاختيار منطقة"); return; }
        const hits = page.texts.filter((t) => t.x + t.w / 2 > b.x && t.x + t.w / 2 < b.x + b.w && t.y + t.h / 2 > b.y && t.y + t.h / 2 < b.y + b.h);
        if (hits.length > 1 || b.w > 0.6 || b.h > 0.15) { toast("اضغط على النص نفسه مباشرة، أو استخدم «تحديد حر»"); return; }
        void finishArea({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
      });
      return;
    }
    if (tool === "area") {
      e.preventDefault();
      if (draft) { commitDraft(); return; }
      setSel({ x0: x, y0: y, x1: x, y1: y });
      (e.target as Element).setPointerCapture(e.pointerId);
      return;
    }
    if (tool === "pen" || tool === "highlight") {
      live.current = tool === "pen"
        ? { kind: "path", points: [[x, y]], color, width: 0.003, alpha: 1 }
        : { kind: "path", points: [[x, y]], color: color === COLORS[0] ? COLORS[4] : color, width: 0.02, alpha: 0.35 };
      (e.target as Element).setPointerCapture(e.pointerId);
      redraw();
    } else if (tool === "rect" || tool === "arrow") {
      shapeStart.current = [x, y];
      live.current = { kind: "path", points: [[x, y]], color, width: 0.004, alpha: 1 };
      (e.target as Element).setPointerCapture(e.pointerId);
    } else if (tool === "erase") {
      const k = hitTest(items, x, y, aspect);
      if (k >= 0) onRemove(k);
    } else if (tool === "text") {
      e.preventDefault();
      if (draft) commitDraft();
      else setDraft({ x, y, text: "" });
    } else if (tool === "sign" && sig) {
      const img = new Image();
      img.src = sig.src;
      const w = 0.28, h = (w * sig.aspect) / aspect;
      img.onload = () => setTick((t) => t + 1);
      onAdd({ kind: "image", x: Math.max(0, x - w / 2), y: Math.max(0, y - h / 2), w, h, src: sig.src, img });
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (sel) { const [x, y] = pt(e); setSel({ ...sel, x1: x, y1: y }); return; }
    if (live.current?.kind !== "path") return;
    if (shapeStart.current) {
      const [ax, ay] = shapeStart.current, [bx, by] = pt(e);
      if (tool === "rect") {
        live.current.points = [[ax, ay], [bx, ay], [bx, by], [ax, by], [ax, ay]];
      } else {
        const ang = Math.atan2((by - ay) / aspect, bx - ax), L = 0.025;
        const head = (d: number): [number, number] => [bx - L * Math.cos(ang + d), by - L * aspect * Math.sin(ang + d)];
        live.current.points = [[ax, ay], [bx, by], head(0.45), [bx, by], head(-0.45)];
      }
      redraw();
      return;
    }
    live.current.points.push(pt(e));
    redraw();
  };

  const onUp = () => {
    if (sel) { const s = sel; setSel(null); void finishArea(s); return; }
    const wasShape = shapeStart.current;
    shapeStart.current = null;
    if (live.current) {
      if (wasShape && live.current.kind === "path" && live.current.points.length < 2) { live.current = null; redraw(); return; }
      onAdd(live.current);
      live.current = null;
    }
  };

  const editOriginal = (t: RenderedPage["texts"][number], k: number) => {
    if (draft) commitDraft();
    editingIdx.current = k;
    const prev = edited.get(k);
    if (prev) { setDraft({ ...prev.draft }); return; }
    const st = { font: t.font, bold: t.bold, italic: t.italic };
    let size = (t.h / 1.2) * aspect * 0.95;
    const m = measureText(t.str, size, st);
    if (m > 0) size = Math.min(size * 1.15, size * (t.w / m)); // match original line width
    setDraft({
      x: t.rtl ? t.x + t.w : t.x, y: t.y, text: t.str, size, color: t.fg, bg: t.bg, ...st, ltr: !t.rtl,
      cover: coverFor(page.texts, t),
    });
  };

  const drawing = tool === "pen" || tool === "highlight" || tool === "area" || tool === "rect" || tool === "arrow";

  return (
    <div ref={wrap} className="relative bg-paper shadow-paper">
      <img src={page.src} alt={`صفحة ${num}`} className="block w-full select-none" draggable={false} />
      <canvas
        ref={canvas}
        className={`absolute inset-0 h-full w-full ${drawing ? "touch-none" : ""} ${tool === "none" ? "pointer-events-none" : tool === "edittext" ? "cursor-text" : tool === "text" ? "cursor-text" : "cursor-crosshair"}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      {sel && (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-accent bg-accent/10"
          style={{ left: `${Math.min(sel.x0, sel.x1) * 100}%`, top: `${Math.min(sel.y0, sel.y1) * 100}%`, width: `${Math.abs(sel.x1 - sel.x0) * 100}%`, height: `${Math.abs(sel.y1 - sel.y0) * 100}%` }}
        />
      )}
      {tool === "edittext" && !draft && page.texts.map((t, k) => (
        <button
          key={k}
          type="button"
          title={t.str}
          onClick={() => editOriginal(t, k)}
          className={`absolute rounded-sm transition-colors ${edited.has(k) ? "outline-dashed outline-1 outline-accent/60" : ""} hover:bg-accent/20 hover:outline hover:outline-1 hover:outline-accent active:bg-accent/30`}
          style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, width: `${t.w * 100}%`, height: `${t.h * 100}%` }}
        />
      ))}
      {draft && (
        <textarea
          dir={draft.ltr ? "ltr" : draft.font ? "rtl" : "auto"}
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitDraft(); }
            if (e.key === "Escape") setDraft(null);
          }}
          onBlur={commitDraft}
          placeholder="اكتب هنا…"
          className="absolute min-w-24 resize rounded border border-accent p-0 leading-[1.3] outline-none"
          style={{
            ...(draft.ltr ? { left: `${draft.x * 100}%` } : { right: `${(1 - draft.x) * 100}%` }),
            top: `${draft.y * 100}%`,
            color: draft.color ?? color,
            background: draft.bg ?? "var(--paper, #fff)",
            fontSize: `calc(${draft.size ?? textSize} * var(--pw))`,
            fontFamily: draft.font ?? '"Amiri", serif',
            fontWeight: draft.bold ? 700 : 400,
            fontStyle: draft.italic ? "italic" : "normal",
          }}
          ref={(el) => {
            if (!el || el.dataset["ready"]) return;
            el.dataset["ready"] = "1";
            el.parentElement!.style.setProperty("--pw", `${el.parentElement!.clientWidth}px`);
            requestAnimationFrame(() => el.focus({ preventScroll: true }));
          }}
        />
      )}
      {tool === "image" && (
        <>
          {origImgs.map((o, k) => taken.has(k) ? null : (
            <button key={"o" + k} type="button" aria-label="صورة" onClick={() => void takeOriginal(k)}
              className="absolute outline-dashed outline-1 outline-accent/60 hover:bg-accent/10"
              style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%` }} />
          ))}
          {items.map((it, k) => it.kind !== "image" || it === selImg ? null : (
            <button key={"i" + k} type="button" aria-label="صورة" onClick={() => setSelImg(it)}
              className="absolute outline-dashed outline-1 outline-accent/60 hover:bg-accent/10"
              style={{ left: `${it.x * 100}%`, top: `${it.y * 100}%`, width: `${it.w * 100}%`, height: `${it.h * 100}%` }} />
          ))}
          {selImg && (() => {
            const b = drag?.item === selImg ? drag.box : selImg;
            return (
              <div className="absolute touch-none cursor-move outline outline-2 outline-primary"
                style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
                onPointerDown={(e) => startDrag(e, selImg, "move")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                {drag && <img src={selImg.src} alt="" className="h-full w-full" draggable={false} />}
                <span className="absolute -bottom-3 -right-3 h-6 w-6 cursor-nwse-resize rounded-full border-2 border-card bg-primary"
                  onPointerDown={(e) => startDrag(e, selImg, "resize")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
                {!drag && (
                  <div className="absolute -top-11 left-1/2 flex -translate-x-1/2 gap-1 rounded-lg border bg-card p-1 shadow" onPointerDown={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => scaleSel(1.15)}>تكبير</Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => scaleSel(1 / 1.15)}>تصغير</Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive" onClick={deleteSel}><Trash2 /> حذف</Button>
                  </div>
                )}
              </div>
            );
          })()}
          <Button size="sm" className="absolute top-2 left-2 z-10" onClick={() => fileIn.current?.click()}><ImagePlus /> إضافة صورة</Button>
          <input ref={fileIn} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void addPicture(f); }} />
        </>
      )}
      <span className="absolute bottom-2 left-2 rounded bg-foreground/60 px-2 py-0.5 text-xs text-background">{num}</span>
    </div>
  );
}
