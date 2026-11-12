# Paper Spark Pdf Studio

اريد موقع يسمح لتعديل الpdf هل ممكن

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://paper-spark-pdf-studio.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/79d26cdc-f07f-4b7f-a0c0-b5ebd6ee04b3).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## النشر على GitHub Pages

1. في المستودع: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. أي دفع إلى الفرع `main` يشغّل `.github/workflows/deploy.yml` فيبني الموقع (`bun run build:pages`) وينشره.
3. الرابط: https://mossabjamil2009912-ctrl.github.io/spark-paper-docs/

ملاحظة: ميزة «ترجمة المستندات» تحتاج خادماً (مفتاح الذكاء الاصطناعي لا يوضع في المتصفح)، لذلك لا تعمل على GitHub Pages؛ بقية الأدوات تعمل بالكامل داخل المتصفح.

### حزمة Android عبر PWABuilder
1. افتح https://www.pwabuilder.com وأدخل رابط الموقع أعلاه.
2. Package for stores → Android → حدّد Package ID ثم Generate، وحمّل الحزمة.
3. ارفع ملف `assetlinks.json` الناتج إلى `public/.well-known/` (يحتاج أن يكون على جذر النطاق، انظر الملاحظة في التعليمات).
