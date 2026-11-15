import { test, expect } from '@playwright/test';
import QRCode from 'qrcode';
import fs from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.driverCalls = []; window.activeStock = 260;
    const stocks = [{id:260,name:'18x18',width:20,height:20},{id:261,name:'Моя этикетка',width:18,height:18},{id:262,name:'Большая',width:150,height:150}];
    window.desktop = {
      ready(){}, onUpdate(){}, onPhoto(){}, onPhoneClosed(){},
      updateState:async()=>({enabled:false,version:'test',status:'disabled',message:''}),
      printers:async()=>[{name:'Other',isDefault:true},{name:'TSC Test'}],
      paperDriver:async request=>{
        window.driverCalls.push(request);
        if(window.failDriver)throw Error('Нет доступа');
        if(request.action==='apply') window.activeStock=request.stockId;
        if(request.action==='edit' && !window.cancelDriver) window.activeStock=261;
        const id=window.activeStock;
        const stock=stocks.find(p=>p.id===id);
        return {stocks,currentId:id,width:stock.width,height:stock.height,cancelled:request.action==='edit' && Boolean(window.cancelDriver)};
      }
    };
  });
});

test('Профиль применяется в драйвере, размеры берутся из ответа, PDF 18 мм', async ({ page }) => {
  await page.goto('/');
  await page.locator('#driver-paper').click();
  await expect(page.locator('#paper-stock')).toBeEnabled();
  await page.locator('#paper-printer').selectOption('TSC Test');
  await expect(page.locator('#paper-stock')).toBeEnabled();
  await expect(page.locator('#paper-stock option').first()).toHaveText('18x18 — 20 × 20 мм');
  await page.locator('#paper-stock').selectOption('261');
  await page.locator('#paper-apply').click();
  await expect(page.locator('#paper-message')).toContainText('сохранён в настройках печати Windows');
  expect(await page.evaluate(()=>driverCalls.at(-1))).toEqual({printer:'TSC Test',action:'apply',stockId:261});
  await expect(page.locator('#label-width')).toHaveValue('18');
  await expect(page.locator('#label-height')).toHaveValue('18');
  await page.screenshot({path:'qa-artifacts/driver-paper.png',fullPage:true});
  await page.setViewportSize({width:440,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'qa-artifacts/driver-paper-narrow.png'});
  await page.locator('#paper-close').click();
  await page.locator('#photo').setInputFiles({name:'qr.png',mimeType:'image/png',buffer:await QRCode.toBuffer('18 mm profile')});
  await expect(page.locator('#download')).toBeEnabled();
  const pending=page.waitForEvent('download');await page.locator('#download').click();
  const pdf=await PDFDocument.load(await fs.readFile(await (await pending).path()));
  expect(pdf.getPage(0).getWidth()*25.4/72).toBeCloseTo(18,4);
  expect(pdf.getPage(0).getHeight()*25.4/72).toBeCloseTo(18,4);
  await page.locator('#print').click();
  await expect(page.locator('#printer')).toHaveValue('TSC Test');
  await page.locator('#close-print').click();
  await page.reload();
  await expect(page.locator('#label-width')).toHaveValue('18');
  await page.locator('#driver-paper').click();
  await expect(page.locator('#paper-printer')).toHaveValue('TSC Test');
});

test('Создание через окно драйвера, отмена, ошибка и неподдерживаемый формат', async ({ page }) => {
  await page.goto('/');await page.locator('#driver-paper').click();
  await expect(page.locator('#paper-edit')).toBeEnabled();
  await page.evaluate(()=>window.cancelDriver=true);
  await page.locator('#paper-edit').click();
  await expect(page.locator('#paper-message')).toContainText('отменён');
  await expect(page.locator('#label-width')).toHaveValue('20');
  await page.evaluate(()=>window.cancelDriver=false);
  await page.locator('#paper-edit').click();
  await expect(page.locator('#label-width')).toHaveValue('18');
  await page.locator('#paper-stock').selectOption('262');
  await expect(page.locator('#paper-apply')).toBeDisabled();
  await page.evaluate(()=>window.failDriver=true);
  await page.locator('#paper-refresh').click();
  await expect(page.locator('#paper-message')).toContainText('Нет доступа');
  await expect(page.locator('#label-width')).toHaveValue('18');
  await expect(page.locator('#paper-apply')).toBeDisabled();
});


test('Активный профиль на главной: запуск, применение, обновление и ошибка', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#active-paper-status')).toHaveText('Other · 18x18 · 20 × 20 мм');
  await page.locator('#driver-paper').click();
  await expect(page.locator('#paper-stock')).toBeEnabled();
  await page.locator('#paper-printer').selectOption('TSC Test');
  await expect(page.locator('#paper-stock')).toBeEnabled();
  await page.locator('#paper-stock').selectOption('261');
  await page.locator('#paper-apply').click();
  await expect(page.locator('#active-paper-status')).toHaveText('TSC Test · Моя этикетка · 18 × 18 мм');
  await page.locator('#paper-close').click();
  await expect(page.locator('#active-paper-refresh')).toBeEnabled();
  await page.locator('.active-paper').scrollIntoViewIfNeeded();
  await page.screenshot({path:'qa-artifacts/active-paper.png'});
  await page.setViewportSize({width:440,height:900});
  await page.locator('.active-paper').scrollIntoViewIfNeeded();
  await page.screenshot({path:'qa-artifacts/active-paper-narrow.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>window.activeStock=260);
  await page.locator('#active-paper-refresh').click();
  await expect(page.locator('#active-paper-status')).toHaveText('TSC Test · 18x18 · 20 × 20 мм');
  await expect(page.locator('#label-width')).toHaveValue('18');
  await page.evaluate(()=>window.failDriver=true);
  await page.locator('#active-paper-refresh').click();
  await expect(page.locator('#active-paper-status')).toContainText('Профиль недоступен');
  await expect(page.locator('#active-paper-status')).not.toContainText('20 × 20');
});
