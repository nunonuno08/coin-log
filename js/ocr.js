// Reads the coin count from the framed part of a screenshot, on the phone itself (nothing is
// uploaded). Tesseract.js is downloaded the first time it is needed.

let loading;
function loadTesseract() {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => {
      loading = null;
      reject(new Error('読み取り機能を読み込めませんでした（初回はネット接続が必要です）'));
    };
    document.head.append(s);
  });
  return loading;
}

/**
 * Versions of the image for reading. Digits read best dark on white and fairly large, but
 * the game's numbers may be light with an outline, so a few versions are tried.
 */
function variants(src) {
  const scale = Math.max(1, Math.min(4, 120 / src.height));
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const base = document.createElement('canvas');
  base.width = w;
  base.height = h;
  const bctx = base.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(src, 0, 0, w, h);
  const px = bctx.getImageData(0, 0, w, h);
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * px.data[i * 4] + 0.587 * px.data[i * 4 + 1] + 0.114 * px.data[i * 4 + 2];

  // Otsu threshold: the split that best separates the two tones.
  const hist = new Array(256).fill(0);
  gray.forEach(v => hist[v]++);
  let sum = 0;
  hist.forEach((c, v) => (sum += c * v));
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = gray.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }

  const make = fn => {
    const c = document.createElement('canvas');
    c.width = w + 40;
    c.height = h + 40;
    const ctx = c.getContext('2d');
    const out = ctx.createImageData(w, h);
    for (let i = 0; i < gray.length; i++) {
      const v = fn(gray[i]);
      out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
      out.data[i * 4 + 3] = 255;
    }
    // A white margin around the text helps Tesseract.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.putImageData(out, 20, 20);
    return c;
  };
  const darkCount = gray.reduce((n, v) => n + (v <= threshold), 0);
  const textIsDark = darkCount < gray.length / 2; // text covers less area than the background
  return [
    make(v => ((v <= threshold) === textIsDark ? 0 : 255)), // black text on white
    make(v => (textIsDark ? v : 255 - v)), // smooth gray, text dark
  ];
}

/** The game shows the count without commas ("711087"); takes the longest run of digits. */
export function parseCoins(text) {
  const runs = String(text).normalize('NFKC').match(/\d[\d\s]*\d|\d/g) || [];
  const nums = runs.map(r => r.replace(/\D/g, '')).sort((a, b) => b.length - a.length);
  return nums.length ? Number(nums[0]) : null;
}

/**
 * Resolves with { value, alternatives } (value null when nothing was read).
 * `near` (the coins at the previous reading, if any) helps choose between readings: the
 * count rarely jumps far between two readings. onProgress(message) reports progress.
 */
export async function readCoins(canvas, onProgress, near) {
  onProgress?.('読み取りの準備中…（初回は少し時間がかかります）');
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker('eng', 1);
  const found = [];
  try {
    await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' });
    const imgs = variants(canvas);
    for (const [i, img] of imgs.entries()) {
      onProgress?.(`読み取り中… ${i + 1}/${imgs.length}`);
      const { data } = await worker.recognize(img);
      const value = parseCoins(data.text);
      if (value > 0) found.push({ value, conf: data.confidence });
    }
  } finally {
    await worker.terminate();
  }
  // Readings that both versions agree on first, then the one closest to the last count,
  // then the more confident one.
  const agree = v => found.filter(f => f.value === v).length;
  const distance = v => (near > 0 ? Math.abs(Math.log(v / near)) : 0);
  found.sort((a, b) => agree(b.value) - agree(a.value) || distance(a.value) - distance(b.value) || b.conf - a.conf);
  const values = [...new Set(found.map(f => f.value))];
  return { value: values[0] ?? null, alternatives: values.slice(1) };
}
