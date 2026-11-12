import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { Busy, FileDrop, PageTitle, Shell } from "@/components/pdf/Shell";
import { downloadBytes } from "@/lib/pdf-ops";

export const Route = createFileRoute("/excel-to-pdf")({
  head: () => ({
    meta: [
      { title: "تحويل Excel إلى PDF — أكتس" },
      { name: "description", content: "حوّل ملف Excel إلى PDF بنفس الأعمدة والحدود والألوان والخطوط، بنص حاد قابل للنسخ." },
      { property: "og:title", content: "تحويل Excel إلى PDF — أكتس" },
      { property: "og:description", content: "Excel إلى PDF بدقة عالية داخل متصفحك." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExcelToPdf,
});

function ExcelToPdf() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const convert = async (f: File) => {
    setBusy(true);
    setDone(null);
    try {
      const { xlsxToPdf } = await import("@/lib/excel-convert");
      const bytes = await xlsxToPdf(await f.arrayBuffer());
      const name = f.name.replace(/\.xlsx$/i, "") + ".pdf";
      downloadBytes(bytes, name);
      setDone(name);
    } catch (e) {
      console.error(e);
      toast.error("تعذّر فتح الملف. تأكد أنه بصيغة ‎.xlsx");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <PageTitle title="تحويل Excel إلى PDF" sub="بنفس التنسيق" />
      {busy ? (
        <Busy text="جارٍ التحويل…" />
      ) : (
        <FileDrop
          onFiles={(fs) => fs[0] && convert(fs[0])}
          label="اختر ملف Excel"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          exts={[".xlsx"]}
        />
      )}
      {done && (
        <p className="mx-auto mt-6 flex max-w-6xl items-center gap-2 px-4 text-accent">
          <FileText className="h-5 w-5" /> تم تنزيل {done}
        </p>
      )}
    </Shell>
  );
}
