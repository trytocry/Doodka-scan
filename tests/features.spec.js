import { test, expect } from '@playwright/test';
import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';
import { SETTINGS_KEY, loadSettings, saveSettings } from '../src/label-settings.js';
import { prepareZXingModule, writeBarcode } from 'zxing-wasm';
prepareZXingModule({ overrides: { wasmBinary: await fs.readFile('node_modules/zxing-wasm/dist/full/zxing_full.wasm') } });

async function transfer(page, { bytes, name = 'image.png', type = 'image/png', action = 'drop', count = 1, target = '.upload' }) {
  await page.locator(target).evaluate((element, { bytes, name, type, action, count }) => {
    const data = new DataTransfer();
    for (let i = 0; i < count; i++) data.items.add(new File([new Uint8Array(bytes)], name, { type }));
    const event = action === 'paste'
      ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
      : new DragEvent(action, { dataTransfer: data, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
  }, { bytes: Array.from(bytes), name, type, action, count });
}

test('Перетаскивание и вставка фото; ошибки ввода сохраняют текущий код', async ({ page }) => {
  await page.goto('/');
  const first = await QRCode.toBuffer('first-photo');
  await transfer(page, { bytes: first, action: 'dragenter' });
  await expect(page.locator('.upload')).toHaveClass(/is-dragover/);
  await transfer(page, { bytes: first });
  await expect(page.locator('#decoded')).toHaveText('first-photo');
  await expect(page.locator('.upload')).not.toHaveClass(/is-dragover/);
  for (const invalid of [{ bytes: first, count: 2 }, { bytes: first, type: 'application/pdf', name: 'fake.png' }]) {
    await transfer(page, invalid);
    await expect(page.locator('#status')).toHaveClass('error');
    await expect(page.locator('#decoded')).toHaveText('first-photo');
    await expect(page.locator('#download')).toBeEnabled();
  }
  await page.locator('#photo').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(25 * 1024 * 1024 + 1) });
  await expect(page.locator('#status')).toContainText('больше 25 МБ');
  await expect(page.locator('#decoded')).toHaveText('first-photo');
  await expect(page.locator('#download')).toBeEnabled();
  const second = await QRCode.toBuffer('clipboard-photo');
  await transfer(page, { bytes: second, action: 'paste', target: '#copies' });
  await expect(page.locator('#decoded')).toHaveText('first-photo');
  await transfer(page, { bytes: second, target: 'body' });
  await expect(page.locator('#decoded')).toHaveText('first-photo');
  expect(new URL(page.url()).pathname).toBe('/');
  await transfer(page, { bytes: second, action: 'paste', target: 'body' });
  await expect(page.locator('#decoded')).toHaveText('clipboard-photo');
});

test('Текстовая вставка и открытый диалог не меняют изображение', async ({ page }) => {
  await page.goto('/');
  const first = await QRCode.toBuffer('keep-photo');
  await transfer(page, { bytes: first });
  await expect(page.locator('#decoded')).toHaveText('keep-photo');
  const prevented = await page.evaluate(() => {
    const data = new DataTransfer(); data.setData('text/plain', 'https://example.com/picture.png');
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await page.evaluate(() => { const dialog = document.createElement('dialog'); dialog.id = 'test-dialog'; document.body.append(dialog); dialog.showModal(); });
  await transfer(page, { bytes: await QRCode.toBuffer('blocked'), action: 'paste', target: '#test-dialog' });
  await expect(page.locator('#decoded')).toHaveText('keep-photo');
});

test('Параметры восстанавливаются, PDF использует их, сброс сохраняет фото', async ({ page }) => {
  await page.goto('/');
  await page.locator('#size').fill('16'); await page.locator('#copies').fill('7');
  await page.reload();
  await expect(page.locator('#size')).toHaveValue('16'); await expect(page.locator('#copies')).toHaveValue('7');
  await expect(page.locator('#page-count')).toHaveText('7');
  await page.locator('#copies').fill(''); await page.reload();
  await expect(page.locator('#copies')).toHaveValue('7');
  for (const invalid of ['0', '501', '1.5']) {
    await page.locator('#copies').fill(invalid); await page.reload();
    await expect(page.locator('#copies')).toHaveValue('7');
  }
  await transfer(page, { bytes: await QRCode.toBuffer('saved-settings') });
  await expect(page.locator('#download')).toBeEnabled();
  const waiting = page.waitForEvent('download'); await page.locator('#download').click();
  const pdf = await PDFDocument.load(await fs.readFile(await (await waiting).path()));
  expect(pdf.getPageCount()).toBe(7);
  expect(pdf.getPage(0).getWidth() * 25.4 / 72).toBeCloseTo(20, 4);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), SETTINGS_KEY)).toEqual({ version: 1, size: 16, copies: 7, labelWidth: 20, labelHeight: 20, fitLabel: false });
  await page.locator('#reset-settings').click();
  await expect(page.locator('#decoded')).toHaveText('saved-settings');
  await expect(page.locator('#size')).toHaveValue('18'); await expect(page.locator('#copies')).toHaveValue('1');
  await page.reload(); await expect(page.locator('#copies')).toHaveValue('1'); await expect(page.locator('#size')).toHaveValue('18');
});

test('Повреждённые настройки и отказ хранилища безопасны', async ({ page }) => {
  await page.goto('/');
  for (const value of ['{broken', '{"version":2,"size":16,"copies":7}', '{"version":1,"size":16,"copies":501}']) {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: SETTINGS_KEY, value });
    await page.reload();
    await expect(page.locator('#size')).toHaveValue('18'); await expect(page.locator('#copies')).toHaveValue('1');
  }
  const brokenStorage = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  expect(loadSettings(brokenStorage)).toEqual({ version: 1, size: 18, copies: 1, labelWidth: 20, labelHeight: 20, fitLabel: false });
  expect(saveSettings({ version: 1, size: 16, copies: 7 }, brokenStorage)).toBe(false);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
  });
  await page.reload();
  await page.locator('#copies').fill('2');
  await expect(page.locator('#page-count')).toHaveText('2');
  await transfer(page, { bytes: await QRCode.toBuffer('storage-denied') });
  await expect(page.locator('#download')).toBeEnabled();
});

test('Data Matrix через drop и последний из двух быстрых вводов', async ({ page }) => {
  await page.goto('/');
  const dm = await writeBarcode('Data Matrix drop', { format: 'DataMatrix', scale: 8 });
  await transfer(page, { bytes: Buffer.from(await dm.image.arrayBuffer()) });
  await expect(page.locator('#status')).toContainText('Data Matrix распознан');
  await expect(page.locator('#decoded')).toHaveText('Data Matrix drop');
  const images = await Promise.all(['old-input', 'latest-input'].map(value => QRCode.toBuffer(value, { width: 600 })));
  await page.locator('.upload').evaluate((element, images) => {
    for (const bytes of images) {
      const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'photo.png', { type: 'image/png' }));
      element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    }
  }, images.map(image => Array.from(image)));
  await expect(page.locator('#decoded')).toHaveText('latest-input');
  await expect(page.locator('#download')).toBeEnabled();
});
