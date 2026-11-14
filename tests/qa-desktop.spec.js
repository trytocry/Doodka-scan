import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import QRCode from 'qrcode';

const execute = promisify(execFile);
// Независимая проверка Windows: Electron может вернуть пустые MIME при занятом буфере.
async function clipboardAccess() {
  const script = `Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class QaClipboardAccess {
 [DllImport("user32.dll", SetLastError=true)] public static extern bool OpenClipboard(IntPtr owner);
 [DllImport("user32.dll")] public static extern bool CloseClipboard();
 [DllImport("user32.dll")] public static extern int CountClipboardFormats();
}
'@
$opened=[QaClipboardAccess]::OpenClipboard([IntPtr]::Zero)
$code=[Runtime.InteropServices.Marshal]::GetLastWin32Error()
$count=[QaClipboardAccess]::CountClipboardFormats()
if($opened){[void][QaClipboardAccess]::CloseClipboard()}
@{opened=$opened;code=$code;formats=$count}|ConvertTo-Json -Compress`;
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { windowsHide: true, timeout: 5000 });
  return JSON.parse(stdout.trim());
}

const artifacts = path.resolve('qa-artifacts');
async function launch(profile, updates = false) {
  const application = await electron.launch({
    executablePath: path.resolve('release/win-unpacked/QR Duplicator.exe'),
    args: [`--user-data-dir=${profile}`],
    env: { ...process.env, QR_ETIKETKA_DISABLE_UPDATES: updates ? '0' : '1' }
  });
  await expect.poll(() => application.windows().some(p => p.url().endsWith('/app/index.html'))).toBe(true);
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 1 && BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  expect(path.resolve(await application.evaluate(({ app }) => app.getPath('userData')))).toBe(profile);
  return { application, page: application.windows().find(p => p.url().endsWith('/app/index.html')) };
}
async function profile() {
  const result = path.join(artifacts, 'profiles', randomUUID());
  await fs.mkdir(result, { recursive: true });
  return result;
}
const appearance = locator => locator.evaluate(el => { const css = getComputedStyle(el); return [css.backgroundColor, css.backgroundImage, css.color, css.borderColor, css.boxShadow]; });

test('QA: настоящее Ctrl+V без меню, состояния кнопок и адаптив', async () => {
  test.setTimeout(45000);
  const { application, page } = await launch(await profile());
  let clipboardSaved = false;
  try {
    expect(await application.evaluate(({ Menu }) => Menu.getApplicationMenu())).toBeNull();
    await expect(page.locator('.maker')).toHaveCount(0);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1160, 900));
    const primary = page.locator('label[for="photo"]');
    const initial = await appearance(primary); await primary.hover();
    await expect.poll(() => appearance(primary)).not.toEqual(initial);
    await page.mouse.down(); const pressed = await appearance(primary);
    // Отпускаем мышь вне кнопки, чтобы не открывать системный диалог выбора файла.
    await page.mouse.move(2, 2); await page.mouse.up();
    expect(pressed).not.toEqual(initial);
    const secondary = page.locator('#phone');
    const secondaryInitial = await appearance(secondary); await secondary.hover();
    await expect.poll(() => appearance(secondary)).not.toEqual(secondaryInitial);
    const disabled = page.locator('#print');
    const disabledInitial = await appearance(disabled); await disabled.hover({ force: true });
    expect(await appearance(disabled)).toEqual(disabledInitial);
    await page.screenshot({ path: path.join(artifacts, 'buttons-empty.png') });

    let access;
    await expect.poll(async () => {
      access = await clipboardAccess();
      return access.opened ? 'ready' : `Windows OpenClipboard: error ${access.code}`;
    }, { message: 'Системный буфер должен быть доступен до теста Ctrl+V', timeout: 10000 }).toBe('ready');
    await application.evaluate(async ({ clipboard, ClipboardItem }, expectedFormats) => {
      const items = (await clipboard.read()).filter(item => item.types.length > 0);
      if (expectedFormats > 0 && !items.length) throw Error('Не удалось сохранить исходный буфер: Windows видит форматы, а Electron возвращает пустой список.');
      globalThis.qaClipboard = await Promise.all(items.map(async item => {
        const entries = await Promise.all(item.types.map(async type => [type, await item.getType(type)]));
        return new ClipboardItem(Object.fromEntries(entries));
      }));
    }, access.formats);
    clipboardSaved = true;
    const png = await QRCode.toBuffer('qa-real-clipboard', { width: 600 });
    await page.bringToFront();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())).toBe(true);
    await expect.poll(() => application.evaluate(async ({ clipboard, ClipboardItem }, bytes) => {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }) })]);
      return clipboard.has('image/png');
    }, Array.from(png)), { message: 'Тестовый PNG должен действительно находиться в системном буфере', timeout: 5000 }).toBe(true);
    await page.evaluate(() => {
      window.qaPasteEvents = [];
      document.addEventListener('paste', event => window.qaPasteEvents.push({
        kind: 'paste', trusted: event.isTrusted, target: event.target?.tagName,
        files: Array.from(event.clipboardData?.files || []).map(f => ({ type: f.type, size: f.size })),
        focused: document.hasFocus(), dialog: Boolean(document.querySelector('dialog[open]'))
      }), true);
      document.addEventListener('keydown', event => { if (event.key.toLowerCase() === 'v') window.qaPasteEvents.push({ kind: 'key', ctrl: event.ctrlKey, target: event.target?.tagName, focused: document.hasFocus() }); }, true);
    });
    await page.bringToFront();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await page.locator('h1').click();
    await page.keyboard.press('Control+V');
    try { await expect(page.locator('#decoded')).toHaveText('qa-real-clipboard'); }
    catch (error) {
      console.log('Paste metadata', await page.evaluate(() => ({ events: window.qaPasteEvents, active: document.activeElement?.tagName, focused: document.hasFocus(), status: document.getElementById('status').textContent })));
      console.log('Clipboard metadata', await application.evaluate(async ({ clipboard, BrowserWindow }) => ({ png: await clipboard.has('image/png'), focused: BrowserWindow.getAllWindows()[0].isFocused() })));
      throw error;
    }
    await expect(page.locator('#download')).toBeEnabled();
    await page.locator('#copies').focus(); await page.keyboard.press('Control+V');
    await expect(page.locator('#decoded')).toHaveText('qa-real-clipboard');
    await page.screenshot({ path: path.join(artifacts, 'main-ready.png') });
    expect(await page.locator('#download').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    await page.setViewportSize({ width: 440, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(artifacts, 'main-narrow.png'), fullPage: true });
  } finally {
    if (clipboardSaved) await application.evaluate(async ({ clipboard }) => { if (globalThis.qaClipboard.length) await clipboard.write(globalThis.qaClipboard); else clipboard.clear(); delete globalThis.qaClipboard; });
    await application.close();
  }
});

test('QA: параметры и выключенные автообновления сохраняются после перезапуска', async () => {
  const directory = await profile();
  await fs.writeFile(path.join(directory, 'update-preferences.json'), JSON.stringify({ automatic: false }));
  let session = await launch(directory, true);
  try {
    await expect(session.page.locator('#auto-updates')).toBeEnabled();
    await expect(session.page.locator('#auto-updates')).not.toBeChecked();
    await session.page.locator('#auto-updates').check();
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(directory, 'update-preferences.json'), 'utf8')).automatic).toBe(true);
    await session.page.locator('#auto-updates').uncheck();
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(directory, 'update-preferences.json'), 'utf8')).automatic).toBe(false);
    await session.page.locator('#size').fill('16'); await session.page.locator('#copies').fill('7');
    await session.page.locator('#copies').fill('501');
    await session.application.close();
    session = await launch(directory, true);
    await expect(session.page.locator('#size')).toHaveValue('16');
    await expect(session.page.locator('#copies')).toHaveValue('7');
    await expect(session.page.locator('#page-count')).toHaveText('7');
    await expect(session.page.locator('#auto-updates')).not.toBeChecked();
    const saved = await session.page.evaluate(() => JSON.parse(localStorage.getItem('qr-duplicator.label-settings.v1')));
    expect(Object.keys(saved).sort()).toEqual(['copies', 'labelSize', 'size', 'version']);
    await session.page.locator('#reset-settings').click();
    await session.application.close();
    session = await launch(directory, true);
    await expect(session.page.locator('#size')).toHaveValue('18'); await expect(session.page.locator('#copies')).toHaveValue('1');
  } finally { await session.application.close(); }
});

test('QA: диагностика не закрывает передачу, отсутствие принтера не блокирует PDF', async () => {
  const { application, page } = await launch(await profile());
  try {
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.getPrintersAsync = async () => []; });
    const session = await page.evaluate(() => window.desktop.startPhone());
    const local = new URL(session.urls[0]); local.hostname = '127.0.0.1';
    await page.locator('#readiness').click();
    await expect(page.locator('#readiness-status')).toContainText('Проверка завершена', { timeout: 15000 });
    await expect(page.locator('#readiness-results')).toContainText('Использован порт открытой передачи');
    await expect(page.locator('#readiness-results')).toContainText('Принтеров нет');
    await expect(page.locator('#readiness-results')).toContainText('нельзя подтвердить доступ через брандмауэр');
    expect((await page.request.get(local.href, { headers: { 'User-Agent': 'QR-Duplicator-QA' } })).status()).toBe(200);
    await page.screenshot({ path: path.join(artifacts, 'readiness.png'), fullPage: true });
    await page.locator('#readiness-close').click();
    const png = await QRCode.toBuffer('qa-no-printer', { width: 600 });
    await page.locator('#photo').setInputFiles({ name: 'qa.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('#download')).toBeEnabled();
    await page.locator('#print').click();
    await expect(page.locator('#print-status')).toContainText('Принтеров нет');
    await expect(page.locator('#confirm-print')).toBeDisabled();
  } finally { await application.close(); }
});
