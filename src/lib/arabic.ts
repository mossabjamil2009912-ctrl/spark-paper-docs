import reshaper from "arabic-persian-reshaper";
const { ArabicShaper } = reshaper;

const AR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LTR = /[A-Za-z0-9\u0660-\u0669\u06F0-\u06F9]/;

export function hasArabic(s: string) {
  return AR.test(s);
}

/**
 * Convert a logical-order Arabic line into the visual left-to-right glyph order a PDF
 * draws: letters take their joined presentation forms, the line is mirrored, and
 * embedded Latin words/numbers keep their own reading order.
 */
export function toVisual(line: string): string {
  const shaped: string = ArabicShaper.convertArabic(line);
  // Split into runs: LTR (latin/digits incl. inner . , : / -) vs everything else.
  const runs: { ltr: boolean; s: string }[] = [];
  const re = /[A-Za-z0-9\u0660-\u0669\u06F0-\u06F9](?:[A-Za-z0-9\u0660-\u0669\u06F0-\u06F9.,:/\-]*[A-Za-z0-9\u0660-\u0669\u06F0-\u06F9])?/g;
  let last = 0;
  for (const m of shaped.matchAll(re)) {
    if (m.index! > last) runs.push({ ltr: false, s: shaped.slice(last, m.index) });
    runs.push({ ltr: true, s: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < shaped.length) runs.push({ ltr: false, s: shaped.slice(last) });
  const mirror: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<", "«": "»", "»": "«" };
  return runs
    .reverse()
    .map((r) => (r.ltr ? r.s : [...r.s].reverse().map((c) => mirror[c] ?? c).join("")))
    .join("");
}

export { LTR };

