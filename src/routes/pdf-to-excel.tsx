import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Busy, FileDrop, PageTitle, Shell } from "@/components/pdf/Shell";
import { baseName, downloadBytes } from "@/lib/pdf-ops";

export const Route = createFileRoute("/pdf-to-excel")({
  head: () => ({
    meta: [
      { title: "تحويل PDF إلى Excel — أكتس" },
      { name: "description", content: "حوّل جداول ونصوص PDF إلى ملف Excel قابل للتعديل مع الحفاظ على الترتيب والخطوط والألوان." },
      { property: "og:title", content: "تحويل PDF إلى Excel — أكتس" },
      { property: "og:description", content: "PDF إلى Excel قابل للتعديل داخل متصفحك." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PdfToExcel,
});

function PdfToExcel() {
  const [busy, setBusy] = useState(false);
  const [perPage, setPerPage] = useState(true);
  const [done, setDone] = useState<string | null>(null);

  const convert = async (f: File) => {
    setBusy(true);
    setDone(null);
    try {
      const { renderPages } = await import("@/lib/pdf-render");
      const { pdfToXlsx } = await import("@/lib/excel-convert");
      const pages = await renderPages(await f.arrayBuffer(), 1.5);
      if (!pages.some((p) => p.frags.length)) {
        toast.error("هذا الملف صور ممسوحة بلا نص قابل للقراءة، فلا يمكن تحويله إلى خلايا.");
        return;
      }
      const blob = await pdfToXlsx(pages, perPage);
      const name = `${baseName(f.name)}.xlsx`;
      downloadBytes(blob, name);
      setDone(name);
    } catch (e) {
      console.error(e);
      toast.error("تعذّر تحويل الملف");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <PageTitle title="تحويل PDF إلى Excel" sub="بنفس الترتيب والتنسيق" />
      <div className="mx-auto mb-4 flex max-w-6xl flex-wrap gap-2 px-4">
        <Button variant={perPage ? "default" : "outline"} size="sm" onClick={() => setPerPage(true)}>كل صفحة في ورقة</Button>
        <Button variant={!perPage ? "default" : "outline"} size="sm" onClick={() => setPerPage(false)}>كل الصفحات في ورقة واحدة</Button>
      </div>
      {busy ? <Busy text="جارٍ التحويل…" /> : <FileDrop onFiles={(fs) => fs[0] && convert(fs[0])} />}
      {done && (
        <p className="mx-auto mt-6 flex max-w-6xl items-center gap-2 px-4 text-accent">
          <FileSpreadsheet className="h-5 w-5" /> تم تنزيل {done}
        </p>
      )}
    </Shell>
  );
}
