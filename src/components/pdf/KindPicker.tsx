import { FileSpreadsheet, FileText, FileType2, Presentation } from "lucide-react";

export type Kind = "pdf" | "xlsx" | "docx" | "pptx";

export const KINDS: Record<Kind, { label: string; accept: string; exts: string[]; tile: string; Icon: typeof FileText }> = {
  pdf: { label: "PDF", accept: "application/pdf,.pdf", exts: [".pdf"], tile: "tile-red", Icon: FileText },
  xlsx: { label: "Excel", accept: ".xlsx", exts: [".xlsx"], tile: "tile-green", Icon: FileSpreadsheet },
  docx: { label: "Word", accept: ".docx", exts: [".docx"], tile: "tile-blue", Icon: FileType2 },
  pptx: { label: "PowerPoint", accept: ".pptx", exts: [".pptx"], tile: "tile-yellow", Icon: Presentation },
};

export function KindPicker({ onPick }: { onPick: (k: Kind) => void }) {
  return (
    <div className="mx-auto grid max-w-md grid-cols-2 gap-3 px-4 pb-16">
      {(Object.keys(KINDS) as Kind[]).map((k) => {
        const { label, tile, Icon } = KINDS[k];
        return (
          <button
            key={k}
            onClick={() => onPick(k)}
            className="flex flex-col items-center gap-2 rounded-xl border bg-card p-4 transition-shadow hover:shadow-paper"
          >
            <span className={`grid h-10 w-10 place-items-center rounded-lg ${tile}`}><Icon className="h-5 w-5" /></span>
            <span className="font-semibold">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function KindIcon({ kind }: { kind: Kind }) {
  const { Icon } = KINDS[kind];
  return <Icon className="h-5 w-5 text-accent" />;
}
