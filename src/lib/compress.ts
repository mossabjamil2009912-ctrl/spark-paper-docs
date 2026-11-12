// Browser-only compression. Pixel dimensions are always kept unchanged.

const JPEG_Q = 0.75;

async function reencodeJpeg(bytes: Uint8Array, q = JPEG_Q, maxSide = 0): Promise<{ out: Uint8Array; w: number; h: number } | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
    const k = maxSide ? Math.min(1, maxSide / Math.max(bmp.width, bmp.height)) : 1;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
    return blob ? { out: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height } : null;
  } catch {
    return null;
  }
}

/** PDF: re-encode embedded JPEG photos at the same pixel size + compact object streams. Text stays vector. */
export async function compressPdf(buf: ArrayBuffer, max = false): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFRawStream, PDFNumber } = await import("pdf-lib");
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const ctx = doc.context;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (d.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const f = d.get(PDFName.of("Filter"));
    if (f !== PDFName.of("DCTDecode")) continue;
    const cs = d.get(PDFName.of("ColorSpace"));
    if (cs && cs !== PDFName.of("DeviceRGB") && cs !== PDFName.of("DeviceGray")) continue;
    if (d.get(PDFName.of("SMask")) === undefined && d.get(PDFName.of("Decode"))) continue;
    const src = obj.contents;
    if (src.length < (max ? 2000 : 20000)) continue;
    const r = await reencodeJpeg(src, max ? 0.2 : JPEG_Q, max ? 800 : 0);
    if (!r || r.out.length >= src.length * 0.9) continue;
    const out = r.out;
    d.set(PDFName.of("Width"), PDFNumber.of(r.w));
    d.set(PDFName.of("Height"), PDFNumber.of(r.h));
    d.delete(PDFName.of("DecodeParms"));
    d.set(PDFName.of("Length"), PDFNumber.of(out.length));
    d.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
    d.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
    ctx.assign(ref, PDFRawStream.of(d, out));
  }
  return doc.save({ useObjectStreams: true });
}

/** Image: same width/height; WebP if supported (smaller), else JPEG. PNG with alpha stays WebP to keep transparency. */
export async function compressImage(file: File, max = false): Promise<{ blob: Blob; ext: string }> {
  const bmp = await createImageBitmap(file);
  const k = max ? Math.min(1, 800 / Math.max(bmp.width, bmp.height)) : 1;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const tryType = async (t: string, q: number) =>
    new Promise<Blob | null>((r) => c.toBlob(r, t, q));
  let best: { blob: Blob; ext: string } = { blob: file, ext: file.name.split(".").pop() || "img" };
  const webp = await tryType("image/webp", max ? 0.2 : 0.8);
  if (webp && webp.type === "image/webp" && webp.size < best.blob.size) best = { blob: webp, ext: "webp" };
  if (!/png|gif|webp/i.test(file.type)) {
    const jpg = await tryType("image/jpeg", max ? 0.2 : 0.8);
    if (jpg && jpg.size < best.blob.size) best = { blob: jpg, ext: "jpg" };
  }
  return best;
}

export type VideoTarget = 270 | 360 | 720 | 1080;

/**
 * Re-encode a video by playing it (in real time) into a canvas + WebAudio graph and recording that.
 * WebM output gets its duration patched in — MediaRecorder leaves it empty, which players show as 0:00.
 */
async function recordVideo(
  file: File,
  height: number | null,
  bitrate: (w: number, h: number, srcBps: number) => number,
  onProgress: (p: number) => void,
  audioBps = 128_000,
): Promise<{ blob: Blob; ext: string }> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.src = url;
  v.playsInline = true;
  v.preload = "auto";
  v.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0";
  document.body.appendChild(v);
  let ac: AudioContext | null = null;
  try {
    await new Promise<void>((ok, err) => {
      v.onloadeddata = () => ok();
      v.onerror = () => err(new Error("video"));
    });
    let dur = v.duration;
    if (!isFinite(dur) || dur <= 0) {
      v.currentTime = 1e9;
      await new Promise((r) => (v.onseeked = r));
      dur = v.duration;
      v.currentTime = 0;
      await new Promise((r) => (v.onseeked = r));
    }
    const scale = height ? Math.min(1, height / v.videoHeight) : 1;
    const w = Math.max(2, Math.round((v.videoWidth * scale) / 2) * 2);
    const h = Math.max(2, Math.round((v.videoHeight * scale) / 2) * 2);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    g.drawImage(v, 0, 0, w, h);
    const out = c.captureStream(30);
    // Audio via WebAudio: captured but not played through the speakers.
    try {
      ac = new AudioContext();
      await ac.resume();
      const dest = ac.createMediaStreamDestination();
      ac.createMediaElementSource(v).connect(dest);
      dest.stream.getAudioTracks().forEach((t) => out.addTrack(t));
    } catch {
      v.muted = true;
    }
    const mime = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
    ].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error("unsupported");
    const srcBps = (file.size * 8) / Math.max(1, dur);
    const rec = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: Math.round(bitrate(w, h, srcBps)), audioBitsPerSecond: audioBps });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    let stopped = false;
    const stop = () => { if (!stopped) { stopped = true; if (rec.state !== "inactive") rec.stop(); } };
    let raf = 0;
    const draw = () => {
      if (v.readyState >= 2) g.drawImage(v, 0, 0, w, h);
      onProgress(Math.min(1, v.currentTime / dur));
      if (v.ended) return stop();
      raf = requestAnimationFrame(draw);
    };
    // Fallback ticker if rAF is throttled (tab in background).
    const tick = setInterval(() => { if (v.readyState >= 2) g.drawImage(v, 0, 0, w, h); if (v.ended) stop(); }, 100);
    v.onended = stop;
    rec.start(1000);
    const t0 = performance.now();
    await v.play();
    draw();
    await done;
    cancelAnimationFrame(raf);
    clearInterval(tick);
    const elapsed = performance.now() - t0;
    const type = mime.split(";")[0] ?? "video/webm";
    let blob = new Blob(chunks, { type });
    if (!blob.size) throw new Error("empty");
    if (type === "video/webm") {
      const { default: fix } = await import("fix-webm-duration");
      blob = await fix(blob, Math.round(isFinite(dur) && dur > 0 ? dur * 1000 : elapsed), { logger: false });
    }
    return { blob, ext: type === "video/mp4" ? "mp4" : "webm" };
  } finally {
    v.pause();
    v.remove();
    URL.revokeObjectURL(url);
    ac?.close().catch(() => {});
  }
}

/**
 * Fast path: hardware WebCodecs decode→encode (much faster than real time, no playback needed,
 * keeps running when the screen is not visible). Returns null if the browser/file can't do it.
 */
async function fastVideo(
  file: File,
  height: number | null,
  bitrate: number | null | ((srcBps: number, dur: number) => number),
  onProgress: (p: number) => void,
  audioBps = 128_000,
): Promise<{ blob: Blob; ext: string } | null> {
  if (typeof VideoEncoder === "undefined") return null;
  try {
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const srcH = track.displayHeight;
    const h = height && height < srcH ? Math.round(height / 2) * 2 : undefined;
    const dur = Math.max(1, await input.computeDuration());
    const srcBps = (file.size * 8) / dur;
    const bps = typeof bitrate === "function" ? bitrate(srcBps, dur) : bitrate ?? Math.max(400_000, Math.min(srcBps * 0.5, track.displayWidth * srcH * 3));
    const conv = await mb.Conversion.init({
      input,
      output,
      video: { ...(h ? { height: h } : {}), bitrate: Math.round(bps), codec: "avc", forceTranscode: true },
      audio: { bitrate: audioBps },
    });
    if (!conv.isValid) return null;
    // Never silently lose the sound: if audio can't be encoded here, use the slower path.
    if (conv.discardedTracks.some((d) => d.track.type === "audio")) return null;
    conv.onProgress = (p) => onProgress(p);
    await conv.execute();
    const buf = output.target.buffer;
    if (!buf || !buf.byteLength) return null;
    return { blob: new Blob([buf], { type: "video/mp4" }), ext: "mp4" };
  } catch (e) {
    console.warn("fast video path failed, falling back", e);
    return null;
  }
}

/** Video: same resolution, lower bitrate. */
export async function compressVideo(file: File, onProgress: (p: number) => void): Promise<{ blob: Blob; ext: string }> {
  const f = await fastVideo(file, null, null, onProgress);
  if (f) return f.blob.size < file.size ? f : { blob: file, ext: file.name.split(".").pop() || "mp4" };
  const r = await recordVideo(file, null, (w, h, src) => Math.max(400_000, Math.min(src * 0.5, w * h * 3)), onProgress);
  if (r.blob.size >= file.size) return { blob: file, ext: file.name.split(".").pop() || "mp4" };
  return r;
}

/** Video: re-encode at a chosen height (keeps aspect ratio; never upscales). */
export async function convertVideo(file: File, height: VideoTarget, onProgress: (p: number) => void): Promise<{ blob: Blob; ext: string }> {
  const bps = { 270: 400_000, 360: 700_000, 720: 2_000_000, 1080: 4_000_000 }[height];
  return (await fastVideo(file, height, bps, onProgress)) ?? recordVideo(file, height, () => bps, onProgress);
}

/** Keep the phone awake and the page alive while a long job runs; notify when done. */
export async function keepAlive(): Promise<(msg?: string) => void> {
  let lock: { release: () => Promise<void> } | null = null;
  const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
  const getLock = async () => { try { lock = (await nav.wakeLock?.request("screen")) ?? null; } catch { /* ignore */ } };
  await getLock();
  const onVis = () => { if (document.visibilityState === "visible") getLock(); };
  document.addEventListener("visibilitychange", onVis);
  // Silent audio keeps Android from freezing the tab when you switch apps.
  let ac: AudioContext | null = null;
  try {
    ac = new AudioContext();
    const o = ac.createOscillator();
    const g = ac.createGain();
    g.gain.value = 0.0001;
    o.connect(g).connect(ac.destination);
    o.start();
  } catch { /* ignore */ }
  try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch { /* ignore */ }
  return (msg) => {
    document.removeEventListener("visibilitychange", onVis);
    lock?.release().catch(() => {});
    ac?.close().catch(() => {});
    if (msg && document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted") {
      try { new Notification("A'CTES", { body: msg, icon: `${import.meta.env.BASE_URL}icons/icon-192.png` }); } catch { /* ignore */ }
    }
  };
}

/** Extract the audio track as MP3 (fast, not real time). */
export async function videoToMp3(file: File, onProgress: (p: number) => void): Promise<{ blob: Blob; ext: string }> {
  const ac = new AudioContext();
  const audio = await ac.decodeAudioData(await file.arrayBuffer());
  ac.close();
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const ch = Math.min(2, audio.numberOfChannels);
  const enc = new Mp3Encoder(ch, audio.sampleRate, 128);
  const toI16 = (f: Float32Array) => {
    const o = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) o[i] = Math.max(-1, Math.min(1, f[i] ?? 0)) * 0x7fff;
    return o;
  };
  const L = toI16(audio.getChannelData(0));
  const R = ch > 1 ? toI16(audio.getChannelData(1)) : undefined;
  const parts: BlobPart[] = [];
  const step = 1152 * 400;
  for (let i = 0; i < L.length; i += step) {
    const buf = R ? enc.encodeBuffer(L.subarray(i, i + step), R.subarray(i, i + step)) : enc.encodeBuffer(L.subarray(i, i + step));
    if (buf.length) parts.push(new Uint8Array(buf));
    onProgress(i / L.length);
    if ((i / step) % 5 === 0) await new Promise((r) => setTimeout(r));
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  return { blob: new Blob(parts, { type: "audio/mpeg" }), ext: "mp3" };
}

/** Video: smallest possible file — 360p max, aims for ~1–2% of the original size (with a floor so it stays watchable). */
export async function maxCompressVideo(file: File, onProgress: (p: number) => void): Promise<{ blob: Blob; ext: string }> {
  // Target ~1% of the original (99% smaller), even at a big quality cost.
  // Small/already-compressed files: drop to 144p with a tiny bitrate so they still shrink.
  const small = file.size < 30 * 1024 * 1024;
  const AUDIO = small ? 16_000 : 32_000;
  const H = small ? 144 : 240;
  const pick = (srcBps: number) =>
    small ? Math.max(25_000, Math.min(80_000, srcBps * 0.15 - AUDIO)) : Math.max(60_000, Math.min(300_000, srcBps * 0.01 - AUDIO));
  let r =
    (await fastVideo(file, H, (s) => pick(s), onProgress, AUDIO)) ??
    (await recordVideo(file, H, (_w, _h, s) => pick(s), onProgress, AUDIO));
  if (r.blob.size >= file.size * 0.8) {
    // Still not small enough: absolute floor (144p, ~25 kbps video, 12 kbps audio).
    const again =
      (await fastVideo(file, 144, () => 25_000, onProgress, 12_000)) ??
      (await recordVideo(file, 144, () => 25_000, onProgress, 12_000));
    if (again.blob.size < r.blob.size) r = again;
  }
  return r.blob.size < file.size ? r : { blob: file, ext: file.name.split(".").pop() || "mp4" };
}
