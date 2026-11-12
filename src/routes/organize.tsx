import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, RotateCcw, RotateCw, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Busy, FileDrop, PageTitle, Shell } from "@/components/pdf/Shell";
import { baseName, downloadBytes, organizePdf } from "@/lib/pdf-ops";
import { renderPages, type RenderedPage } from "@/lib/pdf-render";

export const Route = createFileRoute("/organize")({
  head: () => ({
    meta: [
      { title: "ترتيب وتدوير وحذف صفحات PDF — أكتس" },
      { name: "description", content: "دوّر صفحات PDF، احذفها وأعد ترتيبها مجاناً." },
      { property: "og:title", content: "ترتيب صفحات PDF — أكتس" },
      { property: "og:description", content: "دوّر واحذف ورتّب صفحات ملفك." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OrganizePage,
});

type Item = { index: number; rotation: number; deleted: boolean };

function OrganizePage() {
  const [file, setFile] = useState<{ name: string; bytes: ArrayBuffer } | null>(null);
  const [pages, setPages] = useState<RenderedPage[] | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async (f: File) => {
    const bytes = await f.arrayBuffer();
    setFile({ name: f.name, bytes });
    setPages(null);
    try {
      const r = await renderPages(bytes, 0.5);
      setPages(r);
      setItems(r.map((_, i) => ({ index: i, rotation: 0, deleted: false })));
    } catch {
      toast.error("تعذّر فتح الملف");
      setFile(null);
    }
  };

  const update = (k: number, fn: (it: Item) => Item) => setItems((x) => x.map((it, i) => (i === k ? fn(it) : it)));
  const move = (k: number, d: number) =>
    setItems((x) => {
      const j = k + d;
      if (j < 0 || j >= x.length) return x;
      const n = [...x];
      [n[k], n[j]] = [n[j]!, n[k]!];
      return n;
    });

  const save = async () => {
    if (!file) return;
    const keep = items.filter((i) => !i.deleted);
    if (!keep.length) { toast.error("لا توجد صفحات متبقية"); return; }
    setBusy(true);
    try {
      downloadBytes(await organizePdf(file.bytes, keep), `${baseName(file.name)}-معدّل.pdf`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <PageTitle title="ترتيب الصفحات" sub="دوّر الصفحات، احذفها، أو حرّكها لتغيير ترتيبها." />
      {!file ? (
        <FileDrop onFiles={(f) => f[0] && load(f[0])} />
      ) : !pages ? (
        <Busy />
      ) : (
        <div className="mx-auto max-w-6xl px-4 pb-16">
          <div className="sticky top-16 z-20 mb-4 flex flex-wrap gap-2 rounded-xl border bg-card p-3">
            <Button onClick={save} disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ وتحميل"}</Button>
            <Button variant="outline" onClick={() => setItems((x) => x.map((i) => ({ ...i, rotation: i.rotation + 90 })))}>
              <RotateCw /> تدوير الكل
            </Button>
            <Button variant="ghost" onClick={() => setFile(null)}>ملف آخر</Button>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {items.map((it, k) => (
              <div key={it.index} className={`rounded-xl border bg-card p-2 ${it.deleted ? "opacity-40" : ""}`}>
                <div className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-stage p-2">
                  <img
                    src={pages[it.index]?.src}
                    alt={`صفحة ${it.index + 1}`}
                    className="max-h-full max-w-full bg-paper shadow-paper transition-transform"
                    style={{ transform: `rotate(${it.rotation}deg)` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{it.index + 1}</span>
                  <div className="flex">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(k, -1)} aria-label="تقديم"><ArrowRight /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(k, 1)} aria-label="تأخير"><ArrowLeft /></Button>
                  </div>
                </div>
                <div className="flex justify-between">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => update(k, (i) => ({ ...i, rotation: i.rotation - 90 }))} aria-label="تدوير يسار"><RotateCcw /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => update(k, (i) => ({ ...i, rotation: i.rotation + 90 }))} aria-label="تدوير يمين"><RotateCw /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => update(k, (i) => ({ ...i, deleted: !i.deleted }))} aria-label="حذف">
                    {it.deleted ? <Undo2 /> : <Trash2 />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}
