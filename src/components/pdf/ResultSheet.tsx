import { useEffect, useState } from "react";
import { Download, FileCheck2, Share2, X } from "lucide-react";
import { onResult, saveBlob } from "@/lib/pdf-ops";

function fmt(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

const MIME: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function ResultSheet() {
  const [res, setRes] = useState<{ blob: Blob; name: string; url: string } | null>(null);

  useEffect(() => {
    onResult(({ blob, name }) => {
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const typed = blob.type ? blob : new Blob([blob], { type: MIME[ext] ?? "" });
      setRes((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { blob: typed, name, url: URL.createObjectURL(typed) };
      });
    });
    return () => onResult(null);
  }, []);

  if (!res) return null;
  const ext = res.name.split(".").pop()?.toLowerCase() ?? "";
  const type = res.blob.type || MIME[ext] || "";
  const close = () => {
    URL.revokeObjectURL(res.url);
    setRes(null);
  };
  const file = new File([res.blob], res.name, { type });
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });
  const share = async () => {
    try {
      await navigator.share({ files: [file], title: res.name });
    } catch {
      /* cancelled */
    }
  };

  let preview: React.ReactNode = (
    <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
      <FileCheck2 className="h-14 w-14 text-primary" />
      <span className="text-sm">{ext.toUpperCase()}</span>
    </div>
  );
  if (type.startsWith("image/")) preview = <img src={res.url} alt={res.name} className="max-h-[55vh] w-full rounded-lg object-contain" />;
  else if (type.startsWith("video/")) preview = <video src={res.url} controls playsInline className="max-h-[55vh] w-full rounded-lg bg-foreground" />;
  else if (type.startsWith("audio/")) preview = <audio src={res.url} controls className="w-full" />;
  else if (type === "application/pdf") preview = <iframe src={res.url} title={res.name} className="h-[55vh] w-full rounded-lg border border-border bg-background" />;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/50 p-3 sm:items-center" dir="rtl">
      <div className="w-full max-w-lg rounded-2xl bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold text-foreground">اكتملت العملية</p>
            <p className="truncate text-xs text-muted-foreground" dir="auto">{res.name} · {fmt(res.blob.size)}</p>
          </div>
          <button onClick={close} aria-label="إغلاق" className="rounded-full p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="mb-4">{preview}</div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => saveBlob(res.blob, res.name)} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground">
            <Download className="h-5 w-5" /> تحميل
          </button>
          <button onClick={share} disabled={!canShare} className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 font-bold text-foreground disabled:opacity-40">
            <Share2 className="h-5 w-5" /> مشاركة
          </button>
        </div>
      </div>
    </div>
  );
}
