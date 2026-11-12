import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Busy, FileDrop, PageTitle, Shell } from "@/components/pdf/Shell";
import { baseName, downloadBytes } from "@/lib/pdf-ops";
import { renderPages, type RenderedPage } from "@/lib/pdf-render";

export const Route = createFileRoute("/pdf-to-images")({
  head: () => ({
    meta: [
      { title: "تحويل PDF إلى صور — أكتس" },
      { name: "description", content: "حوّل صفحات PDF إلى صور عالية الدقة لمشاركتها بسهولة." },
      { property: "og:title", content: "تحويل PDF إلى صور — أكتس" },
      { property: "og:description", content: "استخرج كل صفحة من PDF كصورة عالية الدقة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ImagesPage,
});

async function toBlob(src: string) {
  return (await fetch(src)).blob();
}

function ImagesPage() {
  const [name, setName] = useState("");
  const [pages, setPages] = useState<RenderedPage[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (f: File) => {
    setName(f.name);
    setBusy(true);
    try {
      setPages(await renderPages(await f.arrayBuffer(), 3));
    } catch {
      toast.error("تعذّر فتح الملف");
    } finally {
      setBusy(false);
    }
  };

  const one = async (i: number) => downloadBytes(await toBlob(pages![i]!.src), `${baseName(name)}-${i + 1}.jpg`);

  const all = async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    for (let i = 0; i < pages!.length; i++) zip.file(`${baseName(name)}-${i + 1}.jpg`, await toBlob(pages![i]!.src));
    downloadBytes(await zip.generateAsync({ type: "blob" }), `${baseName(name)}-صور.zip`);
  };

  return (
    <Shell>
      <PageTitle title="تحويل PDF إلى صور" sub="صورة لكل صفحة" />
      {busy ? (
        <Busy />
      ) : !pages ? (
        <FileDrop onFiles={(f) => f[0] && load(f[0])} />
      ) : (
        <div className="mx-auto max-w-6xl px-4 pb-16">
          <div className="mb-4 flex gap-2">
            <Button onClick={all}>تنزيل كل الصور ({pages.length})</Button>
            <Button variant="ghost" onClick={() => setPages(null)}>ملف آخر</Button>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {pages.map((p, i) => (
              <button key={i} onClick={() => one(i)} className="rounded-xl border bg-paper p-2">
                <img src={p.src} alt={`صفحة ${i + 1}`} className="w-full" />
                <span className="mt-1 block text-sm text-muted-foreground">{i + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}
