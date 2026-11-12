import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Languages } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Busy, FileDrop, PageTitle, Shell } from "@/components/pdf/Shell";
import { baseName, downloadBytes } from "@/lib/pdf-ops";
import { translateSegments } from "@/lib/translate.functions";

export const Route = createFileRoute("/translate")({
  head: () => ({
    meta: [
      { title: "ترجمة PDF وExcel بين العربية والإنجليزية — أكتس" },
      { name: "description", content: "ترجم ملفات PDF وExcel إلى الإنجليزية أو العربية ترجمة احترافية تراعي المصطلحات والرموز مع الحفاظ على التنسيق." },
      { property: "og:title", content: "ترجمة PDF وExcel بين العربية والإنجليزية — أكتس" },
      { property: "og:description", content: "ترجمة متخصصة غير حرفية مع بقاء التنسيق كما هو." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TranslatePage,
});

function TranslatePage() {
  const call = useServerFn(translateSegments);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [target, setTarget] = useState<"en" | "ar">("en");
  const [fixed, setFixed] = useState(false);
  useEffect(() => {
    const to = new URLSearchParams(window.location.search).get("to");
    if (to === "ar" || to === "en") { setTarget(to); setFixed(true); }
  }, []);

  const tr = async (segments: string[], context: string) => {
    const r = await call({ data: { segments, context, target } });
    if (r.error) throw new Error(r.error);
    return r.translations;
  };

  const run = async (f: File) => {
    setDone(null);
    if (!navigator.onLine) { toast.error("الترجمة تحتاج اتصالاً بالإنترنت. باقي الأدوات تعمل بدون إنترنت."); return; }
    setBusy("جارٍ قراءة الملف…");
    try {
      const lib = await import("@/lib/translate-doc");
      const progress = (p: number) => setBusy(`جارٍ الترجمة… ${Math.round(p * 100)}%`);
      const isXlsx = /\.xlsx$/i.test(f.name);
      let name: string;
      if (isXlsx) {
        const blob = await lib.translateXlsx(await f.arrayBuffer(), tr, progress, target);
        name = `${f.name.replace(/\.xlsx$/i, "")}-${target.toUpperCase()}.xlsx`;
        downloadBytes(blob, name);
      } else {
        const bytes = await f.arrayBuffer();
        const { renderPages } = await import("@/lib/pdf-render");
        const { applyEdits } = await import("@/lib/pdf-ops");
        const pages = await renderPages(bytes.slice(0), 1.5);
        const all = pages.flatMap((p) => p.texts.map((x) => x.str.trim()));
        if (!all.length) { toast.error("هذا الملف صور ممسوحة بلا نص قابل للقراءة."); return; }
        const t = await lib.translateAll(all, tr, progress, target);
        setBusy("جارٍ كتابة الملف…");
        const out = await applyEdits(bytes, lib.pdfEdits(pages, t, target));
        name = `${baseName(f.name)}-${target.toUpperCase()}.pdf`;
        downloadBytes(out, name);
      }
      setDone(name);
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error && /[\u0600-\u06FF]/.test(e.message) ? e.message : "تعذّرت ترجمة الملف");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Shell>
      <PageTitle title={fixed ? (target === "ar" ? "ترجمة إلى العربية" : "ترجمة إلى الإنجليزية") : "ترجمة الملفات"} sub="خدمة الترجمة الذكية" />
      {target === "ar" && (
        <p className="mx-auto mb-2 max-w-6xl px-4 text-sm text-muted-foreground">المصطلحات والرموز تبقى بالإنجليزية</p>
      )}
      {busy ? (
        <Busy text={busy} />
      ) : (
        <FileDrop onFiles={(fs) => fs[0] && run(fs[0])} label="اختر ملف PDF أو Excel" accept="application/pdf,.pdf,.xlsx" exts={[".pdf", ".xlsx"]} />
      )}
      {done && (
        <p className="mx-auto mt-6 flex max-w-6xl items-center gap-2 px-4 text-accent">
          <Languages className="h-5 w-5" /> تم تنزيل {done}
        </p>
      )}
    </Shell>
  );
}
