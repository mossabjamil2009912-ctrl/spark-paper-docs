import { Bold, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { matchedPdfFont, PDF_FONTS } from "@/lib/pdf-fonts";

export function TextFormatToolbar({ font, bold, onFont, onBold, onDone, onMenu, onFocusText }: {
  font: string;
  bold: boolean;
  onFont: (font: string) => void;
  onBold: () => void;
  onDone: () => void;
  onMenu: (open: boolean) => void;
  onFocusText: () => void;
}) {
  const family = matchedPdfFont(font)?.family;
  return (
    <div role="toolbar" aria-label="تنسيق النص" className="flex max-w-full items-center gap-1 rounded-md border bg-card p-1 shadow-sm" dir="rtl">
      <Select value={family ?? "original"} onValueChange={(value) => { if (value !== "original") onFont(`"${value}", ${value === "Amiri" ? "serif" : "sans-serif"}`); }} onOpenChange={onMenu}>
        <SelectTrigger aria-label="نوع الخط" className="w-40 max-w-full"><SelectValue /></SelectTrigger>
        <SelectContent onCloseAutoFocus={(event) => { event.preventDefault(); onFocusText(); }}>
          {!family && <SelectItem value="original">الخط الحالي</SelectItem>}
          {PDF_FONTS.map((f) => <SelectItem key={f.family} value={f.family}>{f.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="button" size="icon" variant={bold ? "secondary" : "ghost"} aria-label="خط عريض" aria-pressed={bold} title="خط عريض" onPointerDown={(e) => e.preventDefault()} onClick={() => { onBold(); onFocusText(); }}><Bold className="h-4 w-4" /></Button>
      <Button type="button" size="icon" variant="ghost" aria-label="تطبيق النص" title="تطبيق النص" onPointerDown={(e) => e.preventDefault()} onClick={onDone}><Check className="h-4 w-4" /></Button>
    </div>
  );
}