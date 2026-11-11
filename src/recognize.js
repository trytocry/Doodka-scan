import jsQR from 'jsqr';
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
import wasmURL from 'zxing-wasm/reader/zxing_reader.wasm?url&inline';

// WASM встроен в сборку: доступ к сети не нужен даже при запуске EXE с диска.
prepareZXingModule({ overrides: { wasmBinary: Uint8Array.from(atob(wasmURL.split(',')[1]), c => c.charCodeAt(0)) } });

export async function readDetailed(pixels) {
  const results = await readBarcodes(pixels, { formats: ['QRCode', 'DataMatrix'], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 2 });
  const qr = results.find(r => r.isValid && r.format === 'QRCode');
  if (qr) {
    if (qr.hasECI || qr.contentType === 'GS1' || qr.sequenceSize >= 0) throw new Error('Код распознан, но содержит специальные служебные данные. Эта версия не может безопасно восстановить такой QR-код.');
    return { data: qr.text, chunks: [{ type: 'byte', bytes: Array.from(qr.bytes) }] };
  }
  const dm = results.find(r => r.isValid && r.format === 'DataMatrix');
  if (dm) {
    const { width, height, data } = dm.symbol;
    if (!width || !height || data.length !== width * height) throw new Error('Data Matrix прочитан, но не удалось восстановить его изображение.');
    // Проверяем исходную матрицу: сохраняем FNC1, ECI и разделители маркировки.
    const scale = 6, pw = (width + 8) * scale, ph = (height + 8) * scale;
    const pixels = new Uint8ClampedArray(pw * ph * 4).fill(255);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[y * width + x] < 128) {
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const p = (((y + 4) * scale + dy) * pw + (x + 4) * scale + dx) * 4;
        pixels[p] = pixels[p + 1] = pixels[p + 2] = 0;
      }
    }
    const checked = (await readBarcodes({ data: pixels, width: pw, height: ph }, { formats: ['DataMatrix'] }))[0];
    const sameBytes = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
    if (!checked?.isValid || !sameBytes(dm.bytes, checked.bytes) || !sameBytes(dm.bytesECI, checked.bytesECI) || dm.symbologyIdentifier !== checked.symbologyIdentifier || dm.sequenceSize !== checked.sequenceSize || dm.sequenceIndex !== checked.sequenceIndex || dm.sequenceId !== checked.sequenceId) throw new Error('Не удалось проверить восстановленный Data Matrix. Сделайте более чёткое фото.');
    return { format: 'DataMatrix', data: dm.text, symbol: { width, height, data: Array.from(data) } };
  }
  return null;
}

export async function recognize(img, isCurrent = () => true, progress = () => {}) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const attempts = [[0, 0, w, h, 1600], [0, 0, w, h, 3600]];
  // Крупные кадры проверяем по участкам, чтобы маленький код не терял детали.
  if (Math.max(w, h) > 1800) {
    for (const [x, y] of [[0.25, 0.25], [0, 0], [0.45, 0], [0, 0.45], [0.45, 0.45]]) attempts.push([x * w, y * h, 0.55 * w, 0.55 * h, 2400]);
  }
  for (let i = 0; i < attempts.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    if (!isCurrent()) return null;
    progress(i);
    const [x, y, cw, ch, limit] = attempts[i];
    const scale = Math.min(1, limit / Math.max(cw, ch));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cw * scale)); canvas.height = Math.max(1, Math.round(ch * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (i === 0) {
      const quick = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
      if (quick) return quick;
    }
    const detailed = await readDetailed(pixels);
    if (!isCurrent()) return null;
    if (detailed) return detailed;
  }
  return null;
}
