import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';

export function makeMatrix(decoded) {
  if (decoded.format === 'DataMatrix') {
    const { width, height, data: original } = decoded.symbol;
    const size = Math.max(width, height), data = new Uint8Array(size * size);
    const left = Math.floor((size - width) / 2), top = Math.floor((size - height) / 2);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[(top + y) * size + left + x] = original[y * width + x] < 128 ? 1 : 0;
    return { size, data, format: 'DataMatrix', get: (y, x) => data[y * size + x] };
  }
  // Сохраняем исходные сегменты, включая байты, без перекодирования текста.
  const segments = decoded.chunks.map(chunk => {
    if (chunk.type === 'byte') return { data: new Uint8Array(chunk.bytes), mode: 'byte' };
    if (chunk.type === 'numeric' || chunk.type === 'alphanumeric') return { data: chunk.text, mode: chunk.type };
    throw new Error('Этот тип QR-кода пока не поддерживается. Нужен обычный текстовый или байтовый QR-код.');
  });
  return QRCode.create(segments, { errorCorrectionLevel: 'M' }).modules;
}

export function layout(matrix, size, copies) {
  if (!Number.isFinite(size) || size < 8 || size > 20) throw new Error('Размер должен быть от 8 до 20 мм.');
  if (!Number.isInteger(copies) || copies < 1 || copies > 500) throw new Error('Укажите целое количество от 1 до 500.');
  const moduleDots = Math.floor((size * 8 + 1e-8) / (matrix.size + 8));
  if (moduleDots < 2) throw new Error('Этот код слишком плотный для выбранного размера. Увеличьте размер; если это не помогает, нужна более крупная этикетка.');
  const totalDots = (matrix.size + 8) * moduleDots;
  return { moduleDots, totalDots, actual: totalDots / 8, offset: Math.floor((160 - totalDots) / 2), copies };
}

export function drawLabel(canvas, matrix, plan) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 160, 160);
  ctx.fillStyle = '#000';
  for (let y = 0; y < matrix.size; y++) for (let x = 0; x < matrix.size; x++) {
    if (matrix.get(y, x)) ctx.fillRect(plan.offset + (x + 4) * plan.moduleDots, plan.offset + (y + 4) * plan.moduleDots, plan.moduleDots, plan.moduleDots);
  }
}

export function createPDF(matrix, plan) {
  const pdf = new jsPDF({ unit: 'mm', format: [20, 20], compress: true, precision: 6 });
  pdf.setProperties({ title: 'QR labels 20x20 mm' });
  for (let page = 0; page < plan.copies; page++) {
    if (page) pdf.addPage([20, 20]);
    pdf.setFillColor(0, 0, 0);
    for (let y = 0; y < matrix.size; y++) for (let x = 0; x < matrix.size; x++) {
      if (matrix.get(y, x)) pdf.rect((plan.offset + (x + 4) * plan.moduleDots) / 8, (plan.offset + (y + 4) * plan.moduleDots) / 8, plan.moduleDots / 8, plan.moduleDots / 8, 'F');
    }
  }
  return pdf;
}
