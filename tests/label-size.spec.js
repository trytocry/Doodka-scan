import { test, expect } from '@playwright/test';
import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { layout, createPDF } from '../src/core.js';
import { loadSettings } from '../src/label-settings.js';
const { printHTML } = createRequire(import.meta.url)('../desktop/printing.cjs');

test('Прямоугольные этикетки: ориентация, центрирование, сохранение и миграция', async ({ page }) => {
  const matrix = QRCode.create('rectangle-label').modules;
  for (const [width, height] of [[40, 30], [30, 40], [100, 20], [20, 100]]) {
    const plan = layout(matrix, Math.min(width, height) - 2, 2, width, height);
    expect(Math.abs(plan.offset * 2 + plan.totalDots - width * 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(plan.offsetY * 2 + plan.totalDots - height * 8)).toBeLessThanOrEqual(1);
    const pdf = await PDFDocument.load(createPDF(matrix, plan).output('arraybuffer'));
    for (const sheet of pdf.getPages()) {
      expect(sheet.getWidth() * 25.4 / 72).toBeCloseTo(width, 4);
      expect(sheet.getHeight() * 25.4 / 72).toBeCloseTo(height, 4);
    }
    await page.setContent(printHTML({ ...plan, size: matrix.size, bits: Array.from(matrix.data) }));
    const print = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true }));
    expect(print.getPageCount()).toBe(2);
    for (const sheet of print.getPages()) {
      expect(Math.abs(sheet.getWidth() * 25.4 / 72 - width)).toBeLessThan(25.4 / 96);
      expect(Math.abs(sheet.getHeight() * 25.4 / 72 - height)).toBeLessThan(25.4 / 96);
    }
  }
  expect(loadSettings({ getItem: () => JSON.stringify({ version: 1, size: 38, copies: 2, labelSize: 40 }) }))
    .toEqual({ version: 1, size: 38, copies: 2, labelWidth: 40, labelHeight: 40, fitLabel: false });
  await page.goto('/');
  await page.locator('#label-width').fill('40');
  await page.locator('#label-height').fill('30');
  await page.locator('#size').fill('28');
  await page.reload();
  await expect(page.locator('#label-width')).toHaveValue('40');
  await expect(page.locator('#label-height')).toHaveValue('30');
  await page.locator('#photo').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: await QRCode.toBuffer('rectangle-label') });
  await expect(page.locator('#download')).toBeEnabled();
  await expect(page.locator('#qr')).toHaveAttribute('width', '320');
  await expect(page.locator('#qr')).toHaveAttribute('height', '240');
  const box = await page.locator('.label-sheet').boundingBox();
  expect(box.width / box.height).toBeCloseTo(4 / 3, 2);
  await page.screenshot({ path: 'qa-artifacts/rectangle-40x30.png', fullPage: true });
  await page.setViewportSize({ width: 440, height: 900 });
  await page.locator('#label-width').fill('30');
  await page.locator('#label-height').fill('40');
  await page.locator('.preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'qa-artifacts/rectangle-30x40.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#size').fill('31');
  await expect(page.locator('#download')).toBeDisabled();
  await page.locator('#size').fill('28');
  await page.locator('#label-height').fill('101');
  await expect(page.locator('#download')).toBeDisabled();
  await page.locator('#reset-settings').click();
  await expect(page.locator('#label-width')).toHaveValue('20');
  await expect(page.locator('#label-height')).toHaveValue('20');
});

test('40 мм: предпросмотр, PDF, сохранение и ограничения', async ({ page }) => {
  await page.goto('/');
  await page.locator('#label-width').fill('40');
  await page.locator('#label-height').fill('40');
  await page.locator('#size').fill('38');
  await page.locator('#copies').fill('3');
  await page.reload();
  await expect(page.locator('#label-width')).toHaveValue('40');
  await expect(page.locator('#size')).toHaveValue('38');
  await page.locator('#photo').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: await QRCode.toBuffer('label-size-40') });
  await expect(page.locator('#download')).toBeEnabled();
  await expect(page.locator('#pdf-format')).toHaveText('PDF · 40 × 40 мм');
  await expect(page.locator('#qr')).toHaveAttribute('width', '320');
  const pending = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('qr-40x40-3pcs.pdf');
  const pdf = await PDFDocument.load(await fs.readFile(await download.path()));
  expect(pdf.getPageCount()).toBe(3);
  for (const sheet of pdf.getPages()) {
    expect(sheet.getWidth() * 25.4 / 72).toBeCloseTo(40, 4);
    expect(sheet.getHeight() * 25.4 / 72).toBeCloseTo(40, 4);
  }
  await page.screenshot({ path: 'qa-artifacts/label-40-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 440, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'qa-artifacts/label-40-narrow.png', fullPage: true });
  await page.locator('#label-width').fill('20');
  await expect(page.locator('#download')).toBeDisabled();
  await expect(page.locator('#validation')).toContainText('не больше этикетки');
  for (const value of ['0', '101', '40.5', '']) {
    await page.locator('#label-width').fill(value);
    await expect(page.locator('#download')).toBeDisabled();
  }
  await page.locator('#reset-settings').click();
  await expect(page.locator('#label-width')).toHaveValue('20');
  await expect(page.locator('#size')).toHaveValue('18');
  await expect(page.locator('#download')).toBeEnabled();
  await expect(page.locator('#decoded')).toHaveText('label-size-40');
});

test('Размеры PDF и печатных страниц совпадают: 20, 40, 100 мм', async ({ page }) => {
  const matrix = QRCode.create('label-size-boundaries').modules;
  for (const labelSize of [20, 40, 100]) {
    const plan = layout(matrix, labelSize - 2, 2, labelSize);
    expect(plan.offset).toBeGreaterThanOrEqual(0);
    expect(plan.offset + plan.totalDots).toBeLessThanOrEqual(labelSize * 8);
    const pdf = await PDFDocument.load(createPDF(matrix, plan).output('arraybuffer'));
    expect(pdf.getPage(0).getWidth() * 25.4 / 72).toBeCloseTo(labelSize, 4);
    const job = { ...plan, size: matrix.size, bits: Array.from(matrix.data) };
    await page.setContent(printHTML(job));
    const printed = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true }));
    expect(printed.getPageCount()).toBe(2);
    for (const sheet of printed.getPages()) {
      expect(Math.abs(sheet.getWidth() * 25.4 / 72 - labelSize)).toBeLessThan(25.4 / 96);
      expect(Math.abs(sheet.getHeight() * 25.4 / 72 - labelSize)).toBeLessThan(25.4 / 96);
    }
    expect(() => printHTML({ ...job, labelWidth: 19 })).toThrow();
    expect(() => printHTML({ ...job, offset: -1 })).toThrow();
  }
  expect(() => layout(matrix, 41, 1, 40)).toThrow();
  expect(() => layout(matrix, 18, 1, 101)).toThrow();
  expect(loadSettings({ getItem: () => JSON.stringify({ version: 1, size: 16, copies: 7 }) }))
    .toEqual({ version: 1, size: 16, copies: 7, labelWidth: 20, labelHeight: 20, fitLabel: false });
});
