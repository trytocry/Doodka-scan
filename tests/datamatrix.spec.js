import { test, expect } from '@playwright/test';
import { readBarcodes, writeBarcode, prepareZXingModule } from 'zxing-wasm';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { createRequire } from 'node:module';
import { makeMatrix, layout } from '../src/core.js';
const { printHTML } = createRequire(import.meta.url)('../desktop/printing.cjs');
prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync('node_modules/zxing-wasm/dist/full/zxing_full.wasm') } });

for (const fixture of [
  { name: 'обычный', value: 'Data Matrix test 123', options: '' },
  { name: 'GS1 маркировка', value: '[01]04601234567893[21]ABC123[91]ABCD[92]XYZ', options: 'gs1' },
  { name: 'двоичный', value: new Uint8Array([0, 255, 128, 65, 29, 200, 10]), options: '' }
]) test(`Data Matrix: ${fixture.name}, данные сохраняются в этикетке и печати`, async ({ page }) => {
  const generated = await writeBarcode(fixture.value, { format: 'DataMatrix', options: fixture.options, scale: 8 });
  expect(generated.error).toBe('');
  const png = Buffer.from(await generated.image.arrayBuffer());
  const original = (await readBarcodes(png))[0];
  await page.goto('/');
  await page.locator('#photo').setInputFiles({ name: 'datamatrix.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#status')).toContainText('Data Matrix распознан');
  await expect(page.locator('#download')).toBeEnabled();
  const pixels = await page.locator('#qr').evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 160, 160).data));
  const result = (await readBarcodes({ data: new Uint8ClampedArray(pixels), width: 160, height: 160 }))[0];
  expect(result.format).toBe('DataMatrix');
  expect(result.bytes).toEqual(original.bytes);
  expect(result.bytesECI).toEqual(original.bytesECI);
  expect(result.symbologyIdentifier).toBe(original.symbologyIdentifier);
  await page.locator('#copies').fill('3');
  const waiting = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await waiting;
  const pdf = await PDFDocument.load(fs.readFileSync(await download.path()));
  expect(pdf.getPageCount()).toBe(3);
  expect(pdf.getPage(0).getWidth() * 25.4 / 72).toBeCloseTo(20, 4);
  if (fixture.name === 'GS1 маркировка') await page.screenshot({ path: 'test-results/datamatrix.png', fullPage: true });
  const matrix = makeMatrix({ format: 'DataMatrix', symbol: original.symbol });
  const plan = layout(matrix, 18, 1);
  await page.setContent(printHTML({ size: matrix.size, bits: Array.from(matrix.data), moduleDots: plan.moduleDots, offset: plan.offset, copies: 1 }));
  const printed = (await readBarcodes(await page.locator('section').screenshot()))[0];
  expect(printed.format).toBe('DataMatrix');
  expect(printed.bytesECI).toEqual(original.bytesECI);
  expect(printed.symbologyIdentifier).toBe(original.symbologyIdentifier);
});
