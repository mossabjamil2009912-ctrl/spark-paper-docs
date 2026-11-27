/** One local font registry for editor rendering and PDF embedding. */
export const PDF_FONTS = [
  { family: "Cairo", file: "Cairo", label: "Cairo — القاهرة" },
  { family: "Tajawal", file: "Tajawal", label: "Tajawal — تجوّل" },
  { family: "IBM Plex Sans Arabic", file: "IBMPlexSansArabic", label: "IBM Plex Arabic" },
  { family: "Amiri", file: "Amiri", label: "Amiri — أميري" },
] as const;

export function matchedPdfFont(name: string) {
  const normalized = name.toLowerCase().replace(/[\s_-]/g, "");
  return PDF_FONTS.find((f) => normalized.includes(f.family.toLowerCase().replace(/\s/g, "")));
}

export function pdfFontUrl(font: string, bold = false) {
  const matched = matchedPdfFont(font);
  const first = font.split(",")[0] ?? "";
  const serif = /amiri|serif|naskh|times/i.test(first) && !/sans/i.test(first);
  const file = matched?.file ?? (serif ? "Amiri" : "IBMPlexSansArabic");
  return `${import.meta.env.BASE_URL}fonts/${file}-${bold ? "Bold" : "Regular"}.ttf`;
}

let loaded: Promise<void> | undefined;
/** Some fonts omit isolated presentation forms but contain their nominal letters. */
export function supportedArabicGlyph(char: string, supported: ReadonlySet<number>) {
  const point = char.codePointAt(0);
  return point !== undefined && supported.has(point) ? char : char.normalize("NFKC");
}

export function loadPdfFonts() {
  if (!loaded) {
    loaded = Promise.all(PDF_FONTS.flatMap((f) => [false, true].map(async (bold) => {
      const face = new FontFace(f.family, `url("${pdfFontUrl(f.family, bold)}")`, { weight: bold ? "700" : "400" });
      document.fonts.add(await face.load());
    }))).then(() => undefined).catch((error: unknown) => { loaded = undefined; throw error; });
  }
  return loaded;
}