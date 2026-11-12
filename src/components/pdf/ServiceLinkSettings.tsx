import { useEffect, useState } from "react";
import { Settings, Copy, ExternalLink, X, Check } from "lucide-react";

const KEY = "actes:service-url";

export function ServiceLinkSettings() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setUrl(localStorage.getItem(KEY) || window.location.origin);
  }, []);

  const valid = (() => { try { return /^https?:$/.test(new URL(url).protocol); } catch { return false; } })();
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  const save = () => {
    if (!valid) return flash("الرابط غير صحيح — يجب أن يبدأ بـ https://");
    localStorage.setItem(KEY, url.trim());
    flash("تم حفظ الرابط");
  };
  const copy = async () => { await navigator.clipboard.writeText(url); flash("تم نسخ الرابط"); };
  const test = async () => {
    if (!valid) return flash("الرابط غير صحيح");
    flash("جارٍ الفحص…");
    try { await fetch(url, { mode: "no-cors" }); flash("الرابط يعمل ✓"); } catch { flash("تعذّر الوصول إلى الرابط"); }
  };

  return (
    <>
      <button type="button" aria-label="الإعدادات" onClick={() => setOpen(true)}
        className="grid h-9 w-9 place-items-center rounded-full border bg-card text-muted-foreground hover:text-primary">
        <Settings className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" onClick={() => setOpen(false)}>
          <div dir="rtl" className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-paper" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-primary">رابط النشر / الخدمة</h2>
              <button type="button" aria-label="إغلاق" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
            </div>
            <input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://my-site.lovable.app"
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm" />
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold">
              <button type="button" onClick={save} className="flex items-center justify-center gap-1 rounded-xl bg-primary px-3 py-2 text-primary-foreground"><Check className="h-4 w-4" />حفظ</button>
              <button type="button" onClick={test} className="rounded-xl border px-3 py-2">اختبار</button>
              <button type="button" onClick={copy} className="flex items-center justify-center gap-1 rounded-xl border px-3 py-2"><Copy className="h-4 w-4" />نسخ</button>
              <a href={valid ? url : undefined} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1 rounded-xl border px-3 py-2"><ExternalLink className="h-4 w-4" />فتح</a>
            </div>
            <button type="button" onClick={() => { localStorage.removeItem(KEY); setUrl(window.location.origin); flash("أُعيد للرابط الحالي"); }}
              className="mt-2 w-full text-xs text-muted-foreground underline">استخدام رابط الموقع الحالي</button>
            {msg && <p className="mt-2 text-center text-sm text-accent">{msg}</p>}
          </div>
        </div>
      )}
    </>
  );
}
