import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FileDrop, PageTitle, Shell } from "@/components/pdf/Shell";
import { KINDS, KindIcon, KindPicker, type Kind } from "@/components/pdf/KindPicker";
import { downloadBytes, mergePdfs } from "@/lib/pdf-ops";

export const Route = createFileRoute("/merge")({
  head: () => ({
    meta: [
      { title: "دمج الملفات — أكتس" },
      { name: "description", content: "ادمج ملفات PDF أو Excel أو Word أو PowerPoint في ملف واحد داخل متصفحك." },
      { property: "og:title", content: "دمج الملفات — أكتس" },
      { property: "og:description", content: "دمج PDF وExcel وWord وPowerPoint بسهولة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MergePage,
});

function MergePage() {
  const [kind, setKind] = useState<Kind | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [sep, setSep] = useState(false);
  const [oneSheet, setOneSheet] = useState(false);
  const more = useRef<HTMLInputElement>(null);

  const move = (i: number, d: number) =>
    setFiles((f) => {
      const n = [...f];
      const j = i + d;
      if (j < 0 || j >= n.length) return f;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });

  const run = async () => {
    if (!kind) return;
    setBusy(true);
    try {
      const bufs = await Promise.all(files.map((f) => f.arrayBuffer()));
      const office = await import("@/lib/office-merge");
      if (kind === "pdf") downloadBytes(await mergePdfs(bufs, sep), "مدمج.pdf");
      else if (kind === "docx") downloadBytes(await office.mergeDocx(bufs, sep), "مدمج.docx");
      else if (kind === "pptx") downloadBytes(await office.mergePptx(bufs, sep), "مدمج.pptx");
      else downloadBytes(await office.mergeXlsx(files.map((f, i) => ({ name: f.name, bytes: bufs[i]! })), oneSheet), "مدمج.xlsx");
      toast.success("تم الدمج");
    } catch (e) {
      console.error(e);
      toast.error("تعذّر دمج الملفات. تأكد أنها ملفات سليمة.");
    } finally {
      setBusy(false);
    }
  };

  const k = kind ? KINDS[kind] : null;

  return (
    <Shell>
      <PageTitle title={k ? `دمج ${k.label}` : "دمج الملفات"} sub={k ? "أضف ملفين أو أكثر" : "اختر نوع الملفات"} />
      {kind && k && (
        <div className="px-4">
          <div className="mx-auto mb-4 max-w-3xl rounded-xl border bg-card p-3 text-sm">
            {kind === "xlsx" ? (
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2"><input type="radio" checked={!oneSheet} onChange={() => setOneSheet(false)} /> تبويبات منفصلة</label>
                <label className="flex items-center gap-2"><input type="radio" checked={oneSheet} onChange={() => setOneSheet(true)} /> دمج في تبويب واحد</label>
              </div>
            ) : (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sep} onChange={(e) => setSep(e.target.checked)} />
                {kind === "pptx" ? "شريحة فاصلة" : "صفحة فاصلة"}
              </label>
            )}
          </div>
        </div>
      )}
      {!kind || !k ? (
        <KindPicker onPick={setKind} />
      ) : files.length === 0 ? (
        <>
          <FileDrop multiple label={`اختر ملفات ${k.label}`} accept={k.accept} exts={k.exts} onFiles={setFiles} />
        </>
      ) : (
        <div className="mx-auto max-w-3xl px-4 pb-16">
          <ul className="space-y-2">
            {files.map((f, i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <span className="grid h-8 w-8 place-items-center rounded-md bg-secondary text-sm font-semibold">{i + 1}</span>
                <KindIcon kind={kind} />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <Button size="icon" variant="ghost" onClick={() => move(i, -1)} aria-label="للأعلى"><ArrowUp /></Button>
                <Button size="icon" variant="ghost" onClick={() => move(i, 1)} aria-label="للأسفل"><ArrowDown /></Button>
                <Button size="icon" variant="ghost" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label="إزالة"><X /></Button>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => more.current?.click()}><Plus /> إضافة ملفات</Button>
            <Button onClick={run} disabled={busy || files.length < 2}>{busy ? "جارٍ الدمج…" : "دمج وتحميل"}</Button>
          </div>
          <input
            ref={more}
            type="file"
            accept={k.accept}
            multiple
            hidden
            onChange={(e) => {
              const add = Array.from(e.target.files ?? []).filter((f) => k.exts.some((x) => f.name.toLowerCase().endsWith(x)));
              setFiles((f) => [...f, ...add]);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </Shell>
  );
}
