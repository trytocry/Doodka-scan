import { test, expect } from '@playwright/test';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';
import { makeMatrix, layout } from '../src/core.js';

test('Фото → читаемый QR → PDF 20×20 мм, ошибки и мобильная вёрстка', async ({ page }) => {
  const content = 'https://example.com/наклейка?id=123';
  const buffer = await QRCode.toBuffer(content, { width: 700, margin: 4 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Скачать PDF' })).toBeDisabled();
  await page.locator('#photo').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer });
  await expect(page.locator('#status')).toContainText('QR-код распознан');
  const pixels = await page.locator('#qr').evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 160, 160).data));
  expect(jsQR(new Uint8ClampedArray(pixels), 160, 160).data).toBe(content);
  await page.locator('#copies').fill('3');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать PDF' }).click();
  const download = await waiting;
  const pdf = await PDFDocument.load(await fs.readFile(await download.path()));
  expect(pdf.getPageCount()).toBe(3);
  for (const sheet of pdf.getPages()) {
    expect(sheet.getWidth() * 25.4 / 72).toBeCloseTo(20, 4);
    expect(sheet.getHeight() * 25.4 / 72).toBeCloseTo(20, 4);
  }
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.locator('#copies').fill('1.5');
  await expect(page.locator('#download')).toBeDisabled();
  await page.locator('#copies').fill('1');
  await page.locator('#size').fill('8');
  await expect(page.locator('#validation')).toContainText('слишком плотный');
  await page.locator('#size').fill('18');
  await expect(page.locator('#download')).toBeEnabled();
  await page.locator('#photo').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
  await expect(page.locator('#status')).toContainText('не смог открыть');
  await expect(page.locator('#download')).toBeDisabled();
});

test('Байтовые данные сохраняются и поле не меньше четырёх модулей', () => {
  const bytes = [0, 255, 128, 65, 10, 13, 200];
  const matrix = makeMatrix({ chunks: [{ type: 'byte', bytes }] });
  const plan = layout(matrix, 18, 1);
  const pixels = new Uint8ClampedArray(160 * 160 * 4).fill(255);
  for (let y = 0; y < matrix.size; y++) for (let x = 0; x < matrix.size; x++) if (matrix.get(y, x)) {
    for (let dy = 0; dy < plan.moduleDots; dy++) for (let dx = 0; dx < plan.moduleDots; dx++) {
      const pos = ((plan.offset + (y + 4) * plan.moduleDots + dy) * 160 + plan.offset + (x + 4) * plan.moduleDots + dx) * 4;
      pixels[pos] = pixels[pos + 1] = pixels[pos + 2] = 0;
    }
  }
  expect(jsQR(pixels, 160, 160).binaryData).toEqual(bytes);
  expect(plan.actual).toBeLessThanOrEqual(18);
  expect(plan.offset).toBeGreaterThanOrEqual(0);
});

test('Маленький повёрнутый QR в большом JPEG и второй алгоритм без сети', async ({ page }) => {
  await page.goto('/');
  const expected = 'https://example.com/photo-small';
  const qrURL = await QRCode.toDataURL(expected, { width: 220, margin: 4 });
  const scene = await page.evaluate(async url => {
    const img = new Image(); img.src = url; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = 4200; canvas.height = 3100;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#c3b9a2'; ctx.fillRect(0, 0, 4200, 3100);
    ctx.translate(2830, 1970); ctx.rotate(0.38); ctx.drawImage(img, -110, -110);
    return canvas.toDataURL('image/jpeg', 0.82);
  }, qrURL);
  await page.locator('#photo').setInputFiles({ name: 'phone-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(scene.split(',')[1], 'base64') });
  await expect(page.locator('#status')).toContainText('QR-код распознан', { timeout: 20000 });
  await expect(page.locator('#decoded')).toHaveText(expected);
  await page.evaluate(async () => { window.detailedReader = (await import('/src/recognize.js')).readDetailed; });
  await page.context().setOffline(true);
  const decoded = await page.evaluate(async url => {
    const img = new Image(); img.src = url; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    return await window.detailedReader(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }, qrURL);
  expect(decoded.data).toBe(expected);
  expect(Buffer.from(decoded.chunks[0].bytes).toString('utf8')).toBe(expected);
});
