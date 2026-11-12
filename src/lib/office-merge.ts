// Merge / split Word, PowerPoint and Excel files entirely in the browser.
// Word & PowerPoint are edited at the OOXML package level with JSZip.
import JSZip from "jszip";

const parse = (s: string) => new DOMParser().parseFromString(s, "application/xml");
const ser = (d: Document) => new XMLSerializer().serializeToString(d);
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";

async function readXml(zip: JSZip, path: string) {
  const f = zip.file(path);
  if (!f) throw new Error(`missing ${path}`);
  return parse(await f.async("string"));
}
const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);
const relsOf = (p: string) => `${dirOf(p)}_rels/${p.slice(p.lastIndexOf("/") + 1)}.rels`;
function resolve(base: string, target: string) {
  const parts = (dirOf(base) + target).split("/");
  const out: string[] = [];
  for (const x of parts) x === ".." ? out.pop() : x !== "." && out.push(x);
  return out.join("/");
}
const ext = (p: string) => p.slice(p.lastIndexOf(".") + 1).toLowerCase();

async function ensureDefault(zip: JSZip, e: string, ctDoc: Document) {
  const root = ctDoc.documentElement;
  const has = Array.from(root.getElementsByTagNameNS(CT, "Default")).some((d) => d.getAttribute("Extension")?.toLowerCase() === e);
  if (has) return;
  const types: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif", emf: "image/x-emf", wmf: "image/x-wmf", svg: "image/svg+xml", bmp: "image/bmp", tiff: "image/tiff" };
  const d = ctDoc.createElementNS(CT, "Default");
  d.setAttribute("Extension", e);
  d.setAttribute("ContentType", types[e] ?? "application/octet-stream");
  root.insertBefore(d, root.firstChild);
  void zip;
}

/* ---------------- Word ---------------- */

function pageBreakPara(doc: Document) {
  const p = doc.createElementNS(W, "w:p");
  const r = doc.createElementNS(W, "w:r");
  const br = doc.createElementNS(W, "w:br");
  br.setAttributeNS(W, "w:type", "page");
  r.appendChild(br);
  p.appendChild(r);
  return p;
}

export async function mergeDocx(files: ArrayBuffer[], pageBreak: boolean): Promise<Blob> {
  const base = await JSZip.loadAsync(files[0]!);
  const docPath = "word/document.xml";
  const doc = await readXml(base, docPath);
  const rels = await readXml(base, relsOf(docPath));
  const ct = await readXml(base, "[Content_Types].xml");
  const body = doc.getElementsByTagNameNS(W, "body")[0]!;
  const sect = Array.from(body.childNodes).find((n) => (n as Element).localName === "sectPr") ?? null;
  let n = 0;
  for (let i = 1; i < files.length; i++) {
    const z = await JSZip.loadAsync(files[i]!);
    const d = await readXml(z, docPath);
    const relFile = z.file(relsOf(docPath));
    const rmap = new Map<string, string>();
    if (relFile) {
      const rd = parse(await relFile.async("string"));
      for (const rel of Array.from(rd.getElementsByTagNameNS(PR, "Relationship"))) {
        const type = rel.getAttribute("Type") ?? "";
        if (!/\/(image|hyperlink)$/.test(type)) continue;
        const id = `rIdM${i}_${++n}`;
        const nr = rels.createElementNS(PR, "Relationship");
        nr.setAttribute("Id", id);
        nr.setAttribute("Type", type);
        if (rel.getAttribute("TargetMode") === "External") {
          nr.setAttribute("Target", rel.getAttribute("Target")!);
          nr.setAttribute("TargetMode", "External");
        } else {
          const src = resolve(docPath, rel.getAttribute("Target")!);
          const data = await z.file(src)?.async("uint8array");
          if (!data) continue;
          const name = `media/m${i}_${n}.${ext(src)}`;
          base.file(`word/${name}`, data);
          await ensureDefault(base, ext(src), ct);
          nr.setAttribute("Target", name);
        }
        rels.documentElement.appendChild(nr);
        rmap.set(rel.getAttribute("Id")!, id);
      }
    }
    if (pageBreak) body.insertBefore(pageBreakPara(doc), sect);
    const b = d.getElementsByTagNameNS(W, "body")[0]!;
    for (const node of Array.from(b.childNodes)) {
      if ((node as Element).localName === "sectPr") continue;
      const imp = doc.importNode(node, true) as Element;
      if (imp.nodeType === 1) {
        for (const el of [imp, ...Array.from(imp.getElementsByTagName("*"))]) {
          for (const a of ["r:embed", "r:id", "r:link"]) {
            const v = el.getAttribute(a);
            if (v && rmap.has(v)) el.setAttribute(a, rmap.get(v)!);
          }
        }
      }
      body.insertBefore(imp, sect);
    }
  }
  base.file(docPath, ser(doc));
  base.file(relsOf(docPath), ser(rels));
  base.file("[Content_Types].xml", ser(ct));
  return base.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

/** Split a Word document at its page breaks. Returns one block list per page. */
export async function docxPages(file: ArrayBuffer): Promise<number> {
  return (await docxChunks(file)).chunks.length;
}

async function docxChunks(file: ArrayBuffer) {
  const zip = await JSZip.loadAsync(file);
  const doc = await readXml(zip, "word/document.xml");
  const body = doc.getElementsByTagNameNS(W, "body")[0]!;
  const chunks: Node[][] = [[]];
  for (const node of Array.from(body.childNodes)) {
    const el = node as Element;
    if (el.localName === "sectPr") continue;
    const breaks = el.nodeType === 1 && (
      Array.from(el.getElementsByTagNameNS(W, "br")).some((b) => b.getAttributeNS(W, "type") === "page" || b.getAttribute("w:type") === "page") ||
      Array.from(el.getElementsByTagNameNS(W, "pageBreakBefore")).length > 0
    );
    const before = el.nodeType === 1 && el.getElementsByTagNameNS(W, "pageBreakBefore").length > 0;
    if (before && chunks[chunks.length - 1]!.length) chunks.push([]);
    chunks[chunks.length - 1]!.push(node);
    if (breaks && !before) chunks.push([]);
    if (el.nodeType === 1 && el.getElementsByTagNameNS(W, "sectPr").length) chunks.push([]);
  }
  while (chunks.length > 1 && !chunks[chunks.length - 1]!.length) chunks.pop();
  return { zip, doc, body, chunks };
}

export async function splitDocx(file: ArrayBuffer, pages: number[][]): Promise<Blob[]> {
  const out: Blob[] = [];
  for (const group of pages) {
    const { zip, doc, body, chunks } = await docxChunks(file);
    const keep = new Set(group.flatMap((i) => chunks[i] ?? []));
    for (const node of Array.from(body.childNodes)) {
      if ((node as Element).localName === "sectPr") continue;
      if (!keep.has(node)) body.removeChild(node);
    }
    zip.file("word/document.xml", ser(doc));
    out.push(await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  }
  return out;
}

/* ---------------- PowerPoint ---------------- */

const PRES = "ppt/presentation.xml";
const SLIDE_CT = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";

async function slideList(zip: JSZip) {
  const pres = await readXml(zip, PRES);
  const prels = await readXml(zip, relsOf(PRES));
  const byId = new Map<string, string>();
  for (const r of Array.from(prels.getElementsByTagNameNS(PR, "Relationship"))) byId.set(r.getAttribute("Id")!, resolve(PRES, r.getAttribute("Target")!));
  const ids = Array.from(pres.getElementsByTagNameNS(P, "sldId"));
  return { pres, prels, ids, paths: ids.map((s) => byId.get(s.getAttributeNS(R, "id") ?? s.getAttribute("r:id")!)!) };
}

const BLANK_SLIDE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

export async function mergePptx(files: ArrayBuffer[], blankSlide: boolean): Promise<Blob> {
  const base = await JSZip.loadAsync(files[0]!);
  const { pres, prels, paths } = await slideList(base);
  const ct = await readXml(base, "[Content_Types].xml");
  const lst = pres.getElementsByTagNameNS(P, "sldIdLst")[0]!;
  // layout to use for imported slides: the one used by the base deck's first slide
  let layout = "../slideLayouts/slideLayout1.xml";
  if (paths[0]) {
    const lr = await readXml(base, relsOf(paths[0]));
    const l = Array.from(lr.getElementsByTagNameNS(PR, "Relationship")).find((r) => r.getAttribute("Type")!.endsWith("/slideLayout"));
    if (l) layout = l.getAttribute("Target")!;
  }
  let slideNo = Math.max(0, ...Object.keys(base.files).map((f) => Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(f)?.[1] ?? 0)));
  let sid = Math.max(255, ...Array.from(lst.childNodes).map((s) => Number((s as Element).getAttribute?.("id") ?? 0)));
  let rid = 0;
  let media = 0;

  const addSlide = (xml: string, relXml: string) => {
    slideNo++;
    const path = `ppt/slides/slide${slideNo}.xml`;
    base.file(path, xml);
    base.file(relsOf(path), relXml);
    const o = ct.createElementNS(CT, "Override");
    o.setAttribute("PartName", `/${path}`);
    o.setAttribute("ContentType", SLIDE_CT);
    ct.documentElement.appendChild(o);
    const id = `rIdMS${++rid}`;
    const r = prels.createElementNS(PR, "Relationship");
    r.setAttribute("Id", id);
    r.setAttribute("Type", `${R}/slide`);
    r.setAttribute("Target", `slides/slide${slideNo}.xml`);
    prels.documentElement.appendChild(r);
    const s = pres.createElementNS(P, "p:sldId");
    s.setAttribute("id", String(++sid));
    s.setAttributeNS(R, "r:id", id);
    lst.appendChild(s);
  };
  const layoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/slideLayout" Target="${layout}"/></Relationships>`;

  for (let i = 1; i < files.length; i++) {
    if (blankSlide) addSlide(BLANK_SLIDE, layoutRels);
    const z = await JSZip.loadAsync(files[i]!);
    const src = await slideList(z);
    for (const sp of src.paths) {
      const xml = await z.file(sp)!.async("string");
      const rf = z.file(relsOf(sp));
      const rd = rf ? parse(await rf.async("string")) : parse(`<Relationships xmlns="${PR}"/>`);
      for (const r of Array.from(rd.getElementsByTagNameNS(PR, "Relationship"))) {
        const type = r.getAttribute("Type")!;
        if (type.endsWith("/slideLayout")) r.setAttribute("Target", layout);
        else if (r.getAttribute("TargetMode") === "External") continue;
        else if (/\/(image|media|video|audio)$/.test(type)) {
          const full = resolve(sp, r.getAttribute("Target")!);
          const data = await z.file(full)?.async("uint8array");
          if (!data) { r.parentNode!.removeChild(r); continue; }
          const name = `ppt/media/merged${i}_${++media}.${ext(full)}`;
          base.file(name, data);
          await ensureDefault(base, ext(full), ct);
          r.setAttribute("Target", `../media/${name.slice(10)}`);
        } else r.parentNode!.removeChild(r); // notes, tags, charts: dropped
      }
      addSlide(xml, ser(rd));
    }
  }
  base.file(PRES, ser(pres));
  base.file(relsOf(PRES), ser(prels));
  base.file("[Content_Types].xml", ser(ct));
  return base.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

export async function pptxCount(file: ArrayBuffer) {
  return (await slideList(await JSZip.loadAsync(file))).paths.length;
}

export async function splitPptx(file: ArrayBuffer): Promise<Blob[]> {
  const n = await pptxCount(file);
  const out: Blob[] = [];
  for (let k = 0; k < n; k++) {
    const zip = await JSZip.loadAsync(file);
    const { pres, prels, ids, paths } = await slideList(zip);
    const ct = await readXml(zip, "[Content_Types].xml");
    ids.forEach((s, i) => {
      if (i === k) return;
      const rId = s.getAttributeNS(R, "id") ?? s.getAttribute("r:id");
      s.parentNode!.removeChild(s);
      for (const r of Array.from(prels.getElementsByTagNameNS(PR, "Relationship"))) if (r.getAttribute("Id") === rId) r.parentNode!.removeChild(r);
      for (const o of Array.from(ct.getElementsByTagNameNS(CT, "Override"))) if (o.getAttribute("PartName") === `/${paths[i]}`) o.parentNode!.removeChild(o);
      zip.remove(paths[i]!);
      zip.remove(relsOf(paths[i]!));
    });
    zip.file(PRES, ser(pres));
    zip.file(relsOf(PRES), ser(prels));
    zip.file("[Content_Types].xml", ser(ct));
    out.push(await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
  }
  return out;
}

/* ---------------- Excel ---------------- */

type WS = import("exceljs").Worksheet;
function copySheet(src: WS, dst: WS, rowOffset = 0) {
  src.columns?.forEach((c, i) => {
    const d = dst.getColumn(i + 1);
    if (c.width && (!d.width || c.width > d.width)) d.width = c.width;
  });
  src.eachRow({ includeEmpty: true }, (row, r) => {
    const nr = dst.getRow(r + rowOffset);
    if (row.height) nr.height = row.height;
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      const nc = nr.getCell(c);
      nc.value = cell.value;
      nc.style = JSON.parse(JSON.stringify(cell.style ?? {}));
    });
  });
  const merges = (src.model as { merges?: string[] }).merges ?? [];
  for (const m of merges) {
    const [a, b] = m.split(":");
    const shift = (ref: string) => ref.replace(/\d+$/, (d) => String(Number(d) + rowOffset));
    try { dst.mergeCells(`${shift(a!)}:${shift(b ?? a!)}`); } catch { /* overlap */ }
  }
  if (src.views?.[0]?.rightToLeft) dst.views = [{ rightToLeft: true }];
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
async function newBook() {
  const ExcelJS = (await import("exceljs")).default;
  return { ExcelJS, wb: new ExcelJS.Workbook() };
}

export async function mergeXlsx(files: { name: string; bytes: ArrayBuffer }[], oneSheet: boolean): Promise<Blob> {
  const { ExcelJS, wb } = await newBook();
  const used = new Set<string>();
  const uniq = (s: string) => {
    let n = s.replace(/[\\/?*[\]:]/g, "").slice(0, 28) || "Sheet";
    let k = 1, t = n;
    while (used.has(t.toLowerCase())) t = `${n.slice(0, 26)}_${++k}`;
    used.add(t.toLowerCase());
    return t;
  };
  const one = oneSheet ? wb.addWorksheet("الكل") : null;
  let offset = 0;
  for (const f of files) {
    const src = new ExcelJS.Workbook();
    await src.xlsx.load(f.bytes);
    const base = f.name.replace(/\.[^.]+$/, "");
    src.eachSheet((ws) => {
      if (one) {
        copySheet(ws, one, offset);
        offset += ws.rowCount + 1;
      } else {
        copySheet(ws, wb.addWorksheet(uniq(src.worksheets.length > 1 ? `${base}-${ws.name}` : base)));
      }
    });
  }
  return new Blob([new Uint8Array(await wb.xlsx.writeBuffer())], { type: XLSX_MIME });
}

export async function splitXlsx(bytes: ArrayBuffer): Promise<{ name: string; blob: Blob }[]> {
  const ExcelJS = (await import("exceljs")).default;
  const src = new ExcelJS.Workbook();
  await src.xlsx.load(bytes);
  const out: { name: string; blob: Blob }[] = [];
  for (const ws of src.worksheets) {
    const wb = new ExcelJS.Workbook();
    copySheet(ws, wb.addWorksheet(ws.name));
    out.push({ name: ws.name, blob: new Blob([new Uint8Array(await wb.xlsx.writeBuffer())], { type: XLSX_MIME }) });
  }
  return out;
}
