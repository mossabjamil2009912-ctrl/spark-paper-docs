import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Busy, FileDrop, PageTitle, Shell } from "@/components/pdf/Shell";
import { baseName, downloadBytes } from "@/lib/pdf-ops";
import { stampPdf } from "@/lib/stamp";

export const Route = createFileRoute("/stamp")({
  head: () => ({
    meta: [
      { title: "ترقيم الصفحات وعلامة مائية — أكتس" },
      { name: "description", content: "أضف أرقام الصفحات وختم مثل مسودة أو معتمد على ملف PDF." },
      { property: "og:title", content: "ترقيم الصفحات وعلامة مائية — أكتس" },
      { property: "og:description", content: "ترقيم تلقائي وعلامة مائية لملفات PDF داخل المتصفح." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StampPage,
});

const PRESETS = ["مسودة", "معتمد", "سري", "نسخة", "DRAFT", "APPROVED"];

function StampPage() {
  const [file, setFile] = useState<File | null>(null);
  const [numbers, setNumbers] = useState(true);
  const [fmt, setFmt] = useState<"n" | "n-of-total">("n-of-total");
  const [mark, setMark] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!file) return;
    if (!numbers && !mark.trim()) { toast.error("اختر الترقيم أو اكتب علامة مائية"); return; }
    setBusy(true);
    try {
      const out = await stampPdf(await file.arrayBuffer(), { numbers, numberFormat: fmt, watermark: mark, opacity: 0.18 });
      downloadBytes(out, `${baseName(file.name)}-مختوم.pdf`);
      toast.success("تم");
    } catch {
      toast.error("تعذّر معالجة الملف");
    } finally {
      setBusy(false);
    }
  };

  const chip = (on: boolean) => `rounded-lg border px-3 py-2 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`;

  return (
    <Shell>
      <PageTitle title="ترقيم وعلامة مائية" sub="أرقام وختم لكل صفحة" />
      {!file ? (
        <FileDrop onFiles={(f) => f[0] && setFile(f[0])} />
      ) : busy ? (
        <Busy />
      ) : (
        <div className="mx-auto max-w-xl space-y-6 px-4 pb-16">
          <p className="text-sm text-muted-foreground">{file.name}</p>
          <div className="space-y-2">
            <p className="font-semibold">ترقيم الصفحات</p>
            <div className="flex flex-wrap gap-2">
              <button className={chip(!numbers)} onClick={() => setNumbers(false)}>بدون</button>
              <button className={chip(numbers && fmt === "n")} onClick={() => { setNumbers(true); setFmt("n"); }}>1</button>
              <button className={chip(numbers && fmt === "n-of-total")} onClick={() => { setNumbers(true); setFmt("n-of-total"); }}>1 / 5</button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="font-semibold">علامة مائية</p>
            <div className="flex flex-wrap gap-2">
              <button className={chip(!mark)} onClick={() => setMark("")}>بدون</button>
              {PRESETS.map((p) => (
                <button key={p} className={chip(mark === p)} onClick={() => setMark(p)}>{p}</button>
              ))}
            </div>
            <input value={mark} onChange={(e) => setMark(e.target.value)} placeholder="أو اكتب نصاً خاصاً" className="h-10 w-full rounded-md border bg-background px-3" />
          </div>
          <div className="flex gap-2">
            <Button onClick={run}>تطبيق وتنزيل</Button>
            <Button variant="ghost" onClick={() => setFile(null)}>ملف آخر</Button>
          </div>
        </div>
      )}
    </Shell>
  );
}
