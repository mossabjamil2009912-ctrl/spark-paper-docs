import { Link } from "@tanstack/react-router";
import { FileUp } from "lucide-react";
import logo from "@/assets/actes-logo-v2.png.asset.json";
import { useRef, useState, type ReactNode } from "react";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo.url} alt="أكتس" className="h-10 w-auto" />
          </Link>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

export function PageTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-4">
      <h1 className="text-3xl text-primary md:text-4xl">{title}</h1>
      <p className="mt-1 text-muted-foreground">{sub}</p>
    </div>
  );
}

export function FileDrop({
  onFiles,
  multiple,
  label = "اختر ملف PDF",
  accept = "application/pdf,.pdf",
  exts = [".pdf"],
}: {
  accept?: string;
  exts?: string[];
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter(
      (f) => exts.some((x) => f.name.toLowerCase().endsWith(x)),
    );
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  return (
    <div className="mx-auto max-w-6xl px-4">
      <button
        type="button"
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className={`flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-16 transition-colors ${
          over ? "border-accent bg-accent/10" : "border-border bg-card hover:border-primary/50"
        }`}
      >
        <span className="grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-foreground">
          <FileUp className="h-7 w-7" />
        </span>
        <span className="text-lg font-semibold">{label}</span>
        <span className="text-sm text-muted-foreground">أو اسحب الملف وأفلته هنا — لا يغادر جهازك</span>
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function Busy({ text = "جارٍ التحميل…" }: { text?: string }) {
  return (
    <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-10 text-muted-foreground">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      {text}
    </div>
  );
}
