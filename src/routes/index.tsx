import { createFileRoute } from "@tanstack/react-router";
import {
  Languages,
  ArrowLeftRight,
  Layers,
  Shrink,
  Stamp,
  ImagePlay,
  type LucideIcon,
} from "lucide-react";
import { Shell } from "@/components/pdf/Shell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "أكتس — أدوات PDF وExcel" },
      { name: "description", content: "عدّل، قسّم، ادمج، حوّل، ترجم واضغط ملفات PDF وExcel داخل متصفحك." },
      { property: "og:title", content: "أكتس — أدوات PDF وExcel" },
      { property: "og:description", content: "عدّل، قسّم، ادمج، حوّل وترجم ملفات PDF وExcel بسهولة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function EditPdfIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21H11" />
      <path d="M14 3v4h4l-4-4" />
      <path d="M8 10h6M8 13.5h4" />
      <path d="M19.4 12.6a1.6 1.6 0 0 1 2.3 2.3L16 20.6l-3 .8.8-3z" fill="currentColor" fillOpacity={0.35} />
    </svg>
  );
}

type Tool = {
  icon: LucideIcon;
  title: string;
  tile: string;
  href?: string;
  options?: { label: string; href: string }[];
};

const tools: Tool[] = [
  { icon: EditPdfIcon as unknown as LucideIcon, title: "تحرير PDF", tile: "text-accent !shadow-none", href: "/edit" },
  {
    icon: Layers,
    title: "دمج وتقسيم",
    tile: "tile-yellow",
    options: [
      { label: "دمج الملفات", href: "/merge" },
      { label: "تقسيم الملف", href: "/split" },
    ],
  },
  {
    icon: Shrink,
    title: "ضغط الملفات",
    tile: "tile-teal",
    options: [
      { label: "ملفات - صور - فيديو", href: "/compress" },
      { label: "استخراج الصوت", href: "/compress?kind=audio" },
    ],
  },
  {
    icon: Languages,
    title: "ترجمة الملفات",
    tile: "tile-blue",
    options: [
      { label: "إلى العربية", href: "/translate?to=ar" },
      { label: "إلى الإنجليزية", href: "/translate?to=en" },
    ],
  },
  {
    icon: ArrowLeftRight,
    title: "تحويل PDF ⇄ Excel",
    tile: "tile-green",
    options: [
      { label: "من PDF إلى Excel", href: "/pdf-to-excel" },
      { label: "من Excel إلى PDF", href: "/excel-to-pdf" },
    ],
  },
  {
    icon: Stamp,
    title: "أدوات إضافية",
    tile: "tile-lime",
    options: [
      { label: "ترقيم وعلامة مائية", href: "/stamp" },
      { label: "PDF إلى صور", href: "/pdf-to-images" },
    ],
  },
];

function Index() {
  return (
    <Shell>
      <section className="mx-auto max-w-3xl px-4 pt-5 pb-3 text-center">
        <h1 className="text-2xl font-bold text-primary md:text-3xl">اختر الخدمة</h1>
      </section>
      <section className="mx-auto grid max-w-3xl gap-2 px-4 pb-10 sm:grid-cols-2">
        {tools.map((t) => {
          const Icon = t.icon;
          const head = (
            <div className="flex items-center gap-3">
              <span className={`${t.tile} relative grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-paper transition-transform group-hover:-rotate-6 group-hover:scale-105`}>
                <Icon className="h-5 w-5" strokeWidth={2.2} />
                <span className="absolute -top-0.5 -left-0.5 h-2 w-2 rounded-full bg-card/70" />
              </span>
              <span className="text-base font-bold text-foreground">{t.title}</span>
            </div>
          );
          if (t.href)
            return (
              <a key={t.title} href={t.href} className="group rounded-xl border bg-card p-3 transition-all hover:-translate-y-0.5 hover:shadow-paper">
                <div className="flex justify-center">{head}</div>
              </a>
            );
          return (
            <div key={t.title} className="group rounded-xl border bg-card p-3">
              {head}
              <div className="mt-2 grid grid-cols-2 gap-2">
                {t.options!.map((o) => (
                  <a key={o.href} href={o.href} dir="auto" className="rounded-xl border bg-secondary px-2 py-1.5 text-center text-xs font-bold text-foreground transition-colors hover:border-accent hover:text-accent">
                    {o.label}
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </section>
      <footer className="border-t py-6 text-center text-sm text-muted-foreground">أكتس لأنظمة الطاقة وحلولها</footer>
    </Shell>
  );
}
