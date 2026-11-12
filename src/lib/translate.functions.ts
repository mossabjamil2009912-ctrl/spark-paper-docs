import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SYSTEM_EN = `You are a senior professional translator into English.
Translate each input segment into natural, professional English as a domain expert would write it — never word-for-word.
Rules:
- Use the correct established terminology for the document's field (engineering, finance, legal, medical, accounting, government, etc.). Infer the field from all segments together.
- Keep numbers, codes, units, symbols, part numbers, standards (e.g. IEC 61701), emails, URLs, currency symbols and formulas exactly as they are.
- Keep proper names transliterated correctly; keep well-known abbreviations (VAT, ID, Ltd).
- Table headers and labels stay short like headers. Keep segment meaning self-contained.
- If a segment is already English or is only numbers/symbols, return it unchanged.
- Use only plain ASCII punctuation (straight quotes, hyphen).
- Return exactly one translation per input, same order, same count.`;

const SYSTEM_AR = `You are a senior professional translator into Arabic.
Translate each input segment into natural, professional Modern Standard Arabic as a domain expert would write it — never word-for-word.
Rules:
- Use the correct established Arabic terminology for the document's field (engineering, finance, legal, medical, accounting, etc.). Infer the field from all segments together.
- Keep technical terms that specialists normally write in English, abbreviations, acronyms, brand/product names, model numbers, codes, units, symbols, standards (e.g. IEC 61701, UL, kW, MPPT), emails, URLs and formulas in English exactly as written, embedded inside the Arabic sentence.
- Keep numbers as Western digits (0-9) exactly as they are.
- Table headers and labels stay short like headers.
- If a segment is already Arabic or is only numbers/codes/symbols, return it unchanged.
- Return exactly one translation per input, same order, same count.`;

export const translateSegments = createServerFn({ method: "POST" })
  .validator((d) =>
    z.object({ segments: z.array(z.string().max(2000)).min(1).max(150), context: z.string().max(4000).optional(), target: z.enum(["en", "ar"]).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) return { error: "خدمة الترجمة غير مهيأة", translations: [] as string[] };
    const input = JSON.stringify({ document_context: data.context ?? "", segments: data.segments });
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        instructions: data.target === "ar" ? SYSTEM_AR : SYSTEM_EN,
        input,
        text: {
          format: {
            type: "json_schema",
            name: "translations",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["translations"],
              properties: { translations: { type: "array", items: { type: "string" } } },
            },
          },
        },
      }),
    });
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => "");
      console.error("translate failed", res.status, t);
      const msg =
        res.status === 402 ? "نفد رصيد الذكاء الاصطناعي" : res.status === 429 ? "طلبات كثيرة، حاول بعد قليل" : "تعذّرت الترجمة";
      return { error: msg, translations: [] as string[] };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let out = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const p = line.slice(5).trim();
        if (!p || p === "[DONE]") continue;
        try {
          const ev = JSON.parse(p);
          if (ev.type === "response.output_text.delta") out += ev.delta;
        } catch {
          /* partial */
        }
      }
    }
    try {
      const arr = (JSON.parse(out).translations ?? []) as string[];
      const translations = data.segments.map((s, k) => arr[k] ?? s);
      return { error: null as string | null, translations };
    } catch {
      console.error("bad translate output", out.slice(0, 300));
      return { error: "تعذّرت الترجمة", translations: [] as string[] };
    }
  });
