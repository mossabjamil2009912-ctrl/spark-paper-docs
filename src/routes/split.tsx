import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Busy, FileDrop, PageTitle, Shell } from "@/components/pdf/Shell";
import { baseName, downloadBytes, extractPages, parseRanges } from "@/lib/pdf-ops";
import { renderPages, type RenderedPage } from "@/lib/pdf-render";
import { KINDS, KindPicker, type Kind } from "@/components/pdf/KindPicker";

export const Route = createFileRoute("/split")({
  head: () => ({
    meta: [
      { title: "تقسيم ملف PDF — أكتس" },
      { name: "description", content: "استخرج صفحات من ملف PDF أو افصل كل صفحة في ملف مستقل." },
      { property: "og:title", content: "تقسيم ملف PDF — أكتس" },
      { property: "og:description", content: "قسّم ملفات PDF بسهولة داخل متصفحك." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SplitPage,
});

function SplitPage() {
  const [kind, setKind] = useState<Kind | null>(null);
  if (!kind) return (<Shell><PageTitle title="تقسيم الملف" sub="اختر نوع الملف" /><KindPicker onPick={setKind} /></Shell>);
  if (kind === "pdf") return <PdfSplit />;
  return <OfficeSplit kind={kind} />;
}

function OfficeSplit({ kind }: { kind: Exclude<Kind, "pdf"> }) {
  const k = KINDS[kind];
  const [file, setFile] = useState<{ name: string; bytes: ArrayBuffer } | null>(null);
  const [count, setCount] = useState(0);
  const [ranges, setRanges] = useState("");
  const [busy, setBusy] = useState(false);
  const unit = kind === "pptx" ? "شريحة" : kind === "xlsx" ? "تبويب" : "صفحة";

  const load = async (f: File) => {
    const bytes = await f.arrayBuffer();
    try {
      const o = await import("@/lib/office-merge");
      const n = kind === "docx" ? await o.docxPages(bytes) : kind === "pptx" ? await o.pptxCount(bytes) : (await o.splitXlsx(bytes)).length;
      setFile({ name: f.name, bytes });
      setCount(n);
    } catch (e) {
      console.error(e);
      toast.error("تعذّر فتح الملف");
    }
  };

  const zipAll = async (items: { name: string; blob: Blob }[]) => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    items.forEach((x) => zip.file(x.name, x.blob));
    downloadBytes(await zip.generateAsync({ type: "blob" }), `${baseName(file!.name)}-مقسم.zip`);
  };

  const run = async (picked?: number[]) => {
    if (!file) return;
    setBusy(true);
    try {
      const o = await import("@/lib/office-merge");
      const b = baseName(file.name);
      if (kind === "docx") {
        if (picked) downloadBytes((await o.splitDocx(file.bytes, [picked]))[0]!, `${b}-مقتطف.docx`);
        else await zipAll((await o.splitDocx(file.bytes, Array.from({ length: count }, (_, i) => [i]))).map((blob, i) => ({ name: `${b}-${i + 1}.docx`, blob })));
      } else if (kind === "pptx") {
        await zipAll((await o.splitPptx(file.bytes)).map((blob, i) => ({ name: `${b}-${i + 1}.pptx`, blob })));
      } else {
        await zipAll((await o.splitXlsx(file.bytes)).map((x, i) => ({ name: `${i + 1}-${x.name.replace(/[\\/:*?"<>|]/g, "")}.xlsx`, blob: x.blob })));
      }
    } catch (e) {
      console.error(e);
      toast.error("تعذّر التقسيم");
    } finally {
      setBusy(false);
    }
  };

  const picked = ranges.trim() ? parseRanges(ranges, count) : [];
  return (
    <Shell>
      <PageTitle title={`تقسيم ${k.label}`} sub={file ? `${count} ${unit}` : "اختر الملف"} />
      {!file ? (
        <>
          <FileDrop label={`اختر ملف ${k.label}`} accept={k.accept} exts={k.exts} onFiles={(f) => f[0] && load(f[0])} />
        </>
      ) : (
        <div className="mx-auto flex max-w-md flex-col items-stretch gap-2 px-4 pb-16">
          <div className="truncate rounded-xl border bg-card p-3 text-center text-sm">{file.name}</div>
          {kind === "docx" && (
            <div className="flex gap-2">
              <input value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="مثال: 1-3، 7" dir="ltr" className="h-9 flex-1 rounded-md border bg-background px-3 text-sm" />
              <Button onClick={() => run(picked)} disabled={busy || !picked.length}>استخراج</Button>
            </div>
          )}
          <Button onClick={() => run()} disabled={busy || count < 1}>{busy ? "جارٍ التقسيم…" : `كل ${unit} في ملف`}</Button>
        </div>
      )}
    </Shell>
  );
}

function PdfSplit() {
  const [file, setFile] = useState<{ name: string; bytes: ArrayBuffer } | null>(null);
  const [pages, setPages] = useState<RenderedPage[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [ranges, setRanges] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (f: File) => {
    const bytes = await f.arrayBuffer();
    setFile({ name: f.name, bytes });
    setPages(null);
    try {
      setPages(await renderPages(bytes, 0.5));
    } catch {
      toast.error("تعذّر فتح الملف");
      setFile(null);
    }
  };

  const toggle = (i: number) => {
    const n = new Set(picked);
    n.has(i) ? n.delete(i) : n.add(i);
    setPicked(n);
    setRanges("");
  };

  const selected = pages
    ? ranges.trim()
      ? parseRanges(ranges, pages.length)
      : [...picked].sort((a, b) => a - b)
    : [];

  const extract = async () => {
    if (!file || !selected.length) return;
    setBusy(true);
    try {
      downloadBytes(await extractPages(file.bytes, selected), `${baseName(file.name)}-مقتطف.pdf`);
    } finally {
      setBusy(false);
    }
  };

  const splitAll = async () => {
    if (!file || !pages) return;
    setBusy(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (let i = 0; i < pages.length; i++) {
        zip.file(`${baseName(file.name)}-${i + 1}.pdf`, await extractPages(file.bytes, [i]));
      }
      downloadBytes(await zip.generateAsync({ type: "blob" }), `${baseName(file.name)}-صفحات.zip`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <PageTitle title="تقسيم الملف" sub="اختر الصفحات" />
      {!file ? (
        <FileDrop onFiles={(f) => f[0] && load(f[0])} />
      ) : !pages ? (
        <Busy />
      ) : (
        <div className="mx-auto max-w-6xl px-4 pb-16">
          <div className="sticky top-16 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
            <input
              value={ranges}
              onChange={(e) => setRanges(e.target.value)}
              placeholder="مثال: 1-3، 7"
              className="h-9 w-40 rounded-md border bg-background px-3 text-sm"
              dir="ltr"
            />
            <Button onClick={extract} disabled={busy || !selected.length}>
              استخراج {selected.length ? `(${selected.length})` : ""}
            </Button>
            <Button variant="outline" onClick={splitAll} disabled={busy}>كل صفحة في ملف</Button>
            <Button variant="ghost" onClick={() => { setFile(null); setPicked(new Set()); setRanges(""); }}>ملف آخر</Button>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {pages.map((p, i) => {
              const on = selected.includes(i);
              return (
                <button
                  key={i}
                  onClick={() => toggle(i)}
                  className={`rounded-xl border-2 bg-paper p-2 transition-all ${on ? "border-accent shadow-paper" : "border-transparent"}`}
                >
                  <img src={p.src} alt={`صفحة ${i + 1}`} className="w-full" />
                  <span className={`mt-1 block text-sm ${on ? "font-semibold text-accent" : "text-muted-foreground"}`}>{i + 1}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Shell>
  );
}
