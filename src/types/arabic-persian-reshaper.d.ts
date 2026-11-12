declare module "arabic-persian-reshaper" {
  type Shaper = { convertArabic(s: string): string; convertArabicBack(s: string): string };
  export const ArabicShaper: Shaper;
  export const PersianShaper: Shaper;
  const _default: { ArabicShaper: Shaper; PersianShaper: Shaper };
  export default _default;
}
