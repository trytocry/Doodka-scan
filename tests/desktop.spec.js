import { test, expect, _electron as electron } from '@playwright/test';
import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { printHTML } = require('../desktop/printing.cjs');

test('Настольная сборка работает без сети и сохраняет PDF', async () => {
  const application = await electron.launch({ executablePath: path.resolve('release/win-unpacked/QR Этикетка.exe'), env: { ...process.env, QR_ETIKETKA_DISABLE_UPDATES: '1' } });
  try {
    const page = await application.firstWindow();
    await page.context().setOffline(true);
    await expect(page.locator('h1')).toContainText('в готовую наклейку');
    expect(page.url()).toMatch(/^file:/);
    const buffer = await QRCode.toBuffer('https://example.com/desktop-test', { width: 600 });
    await page.locator('#photo').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer });
    await expect(page.locator('#status')).toContainText('QR-код распознан');
    await page.locator('#copies').fill('4');
    const output = path.resolve('test-results/desktop-labels.pdf');
    await application.evaluate(({ BrowserWindow }, output) => {
      globalThis.downloadComplete = false;
      BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => {
        item.setSavePath(output);
        item.once('done', (_event, state) => { globalThis.downloadComplete = state; });
      });
    }, output);
    await page.locator('#download').click();
    await expect.poll(() => application.evaluate(() => globalThis.downloadComplete)).toBe('completed');
    const pdf = await PDFDocument.load(await fs.readFile(output));
    expect(pdf.getPageCount()).toBe(4);
    expect(pdf.getPage(0).getWidth() * 25.4 / 72).toBeCloseTo(20, 4);
    expect(pdf.getPage(0).getHeight() * 25.4 / 72).toBeCloseTo(20, 4);
    await page.screenshot({ path: 'test-results/desktop-app.png', fullPage: true });
  } finally { await application.close(); }
});

test('Передача с мобильной страницы и печать без отправки реальному принтеру', async ({ browser }) => {
  const application = await electron.launch({ executablePath: path.resolve('release/win-unpacked/QR Этикетка.exe'), env: { ...process.env, QR_ETIKETKA_DISABLE_UPDATES: '1' } });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    const page = await application.firstWindow();
    await page.locator('#phone').click();
    await expect(page.locator('#phone-address')).not.toBeEmpty();
    const url = await page.locator('#phone-address').inputValue();
    const local = new URL(url); local.hostname = '127.0.0.1';
    const wrong = await phone.request.get(new URL('/wrong-token', local).href);
    expect(wrong.status()).toBe(404);
    await phone.goto(local.href);
    await phone.screenshot({ path: 'test-results/phone-upload.png', fullPage: true });
    await page.screenshot({ path: 'test-results/phone-dialog.png', fullPage: true });
    const buffer = await QRCode.toBuffer('https://example.com/from-phone', { width: 650 });
    await phone.locator('#gallery').setInputFiles({ name: 'phone.png', mimeType: 'image/png', buffer });
    await expect(phone.locator('#status')).toContainText('Фото передано');
    await expect(page.locator('#status')).toContainText('QR-код распознан');
    await expect(page.locator('#decoded')).toHaveText('https://example.com/from-phone');
    await expect(page.locator('#phone-address')).not.toBeVisible();
    await application.evaluate(({ BrowserWindow, app }) => {
      BrowserWindow.getAllWindows()[0].webContents.getPrintersAsync = async () => [{ name: 'Test TSC', displayName: 'Test TSC', isDefault: true }];
      app.on('browser-window-created', (_event, win) => {
        win.webContents.print = (options, callback) => { globalThis.testPrint = options; callback(false, 'Print job canceled'); };
      });
    });
    await page.locator('#copies').fill('3');
    await page.locator('#print').click();
    await expect(page.locator('#printer')).toHaveValue('Test TSC');
    await page.screenshot({ path: 'test-results/print-dialog.png', fullPage: true });
    await page.locator('#confirm-print').click();
    await expect(page.locator('#print-status')).toHaveText('Печать отменена.');
    const options = await application.evaluate(() => globalThis.testPrint);
    expect(options.pageSize).toEqual({ width: 20000, height: 20000 });
    expect(options.scaleFactor).toBe(100); expect(options.copies).toBe(1); expect(options.silent).toBe(false);
    await page.locator('#close-print').click();
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.getPrintersAsync = async () => []; });
    await page.locator('#print').click();
    await expect(page.locator('#print-status')).toContainText('Принтеров нет');
    await expect(page.locator('#confirm-print')).toBeDisabled();
  } finally { await phone.close(); await application.close(); }
});

test('Печатная раскладка содержит три страницы 20×20 мм', async ({ page }) => {
  const qr = QRCode.create('print-test').modules;
  const moduleDots = 4, offset = Math.floor((160 - (qr.size + 8) * moduleDots) / 2);
  await page.setContent(printHTML({ size: qr.size, bits: Array.from(qr.data), moduleDots, offset, copies: 3 }));
  const pdf = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  expect(pdf.getPageCount()).toBe(3);
  for (const sheet of pdf.getPages()) {
    expect(Math.abs(sheet.getWidth() * 25.4 / 72 - 20)).toBeLessThan(0.15);
    expect(Math.abs(sheet.getHeight() * 25.4 / 72 - 20)).toBeLessThan(0.15);
  }
});

