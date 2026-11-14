const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createUpdates } = require('./updates.cjs');
const phone = require('./phone.cjs');
const { printHTML } = require('./printing.cjs');
const { checkReadiness } = require('./readiness.cjs');

// Сохраняем профиль прежних версий при смене отображаемого имени.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'QR Этикетка'));
app.setName('QR Duplicator');
app.setAppUserModelId('local.qr.etiketka');
let window;
let splash, startupTimer, startupDeadline;
let interfaceReady = false, splashReady = false;
function finishStartup() {
  if (!interfaceReady || !splashReady || !window || window.isDestroyed()) return;
  clearTimeout(startupDeadline);
  clearTimeout(startupTimer);
  startupTimer = setTimeout(() => {
    if (!window || window.isDestroyed()) return;
    window.show();
    if (splash && !splash.isDestroyed()) splash.destroy();
  }, 900);
}
let updates, printing = false;
function createWindow() {
  window = new BrowserWindow({
    title: `QR Duplicator ${app.getVersion()}`, width: 1160, height: 960, minWidth: 440, minHeight: 620,
    backgroundColor: '#e5eafa', show: false,
    icon: path.join(__dirname, 'app', 'assets', 'app-icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({
      title: 'Сохранить PDF с наклейками',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
      filters: [{ name: 'Документ PDF', extensions: ['pdf'] }]
    });
  });
  Menu.setApplicationMenu(null);
  window.setMenu(null);
  splash = new BrowserWindow({
    width: 768, height: 512, useContentSize: true, frame: false, resizable: false,
    maximizable: false, show: false, backgroundColor: '#dfeafa',
    icon: path.join(__dirname, 'app', 'assets', 'app-icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  splash.webContents.on('will-navigate', event => event.preventDefault());
  splash.once('ready-to-show', () => { splash.show(); splashReady = true; finishStartup(); });
  const failStartup = () => {
    clearTimeout(startupTimer); clearTimeout(startupDeadline);
    if (splash && !splash.isDestroyed()) splash.destroy();
    if (window && !window.isDestroyed()) {
      window.show();
      dialog.showMessageBox(window, { type: 'error', title: 'Запуск программы', message: 'Не удалось завершить загрузку интерфейса.', detail: 'Закройте программу и запустите её снова. Если ошибка повторяется, переустановите программу.' });
    }
  };
  ipcMain.on('app:ready', event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    interfaceReady = true; finishStartup();
  });
  startupDeadline = setTimeout(failStartup, 30000);
  window.webContents.once('did-fail-load', failStartup);
  window.once('closed', () => {
    clearTimeout(startupTimer); clearTimeout(startupDeadline);
    if (splash && !splash.isDestroyed()) splash.destroy();
  });
  splash.loadFile(path.join(__dirname, 'splash.html')).catch(() => { splashReady = true; finishStartup(); });
  window.loadFile(path.join(__dirname, 'app', 'index.html'));
}
app.whenReady().then(() => {
  createWindow();
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
  const updatesEnabled = app.isPackaged && !portable && process.env.QR_ETIKETKA_DISABLE_UPDATES !== '1' && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  const preferencesPath = path.join(app.getPath('userData'), 'update-preferences.json');
  let automatic = true;
  try { const saved = JSON.parse(fs.readFileSync(preferencesPath, 'utf8')); if (typeof saved.automatic === 'boolean') automatic = saved.automatic; } catch {}
  updates = createUpdates({
    updater: updatesEnabled ? require('electron-updater').autoUpdater : null,
    enabled: updatesEnabled, version: app.getVersion(),
    automatic,
    saveAutomatic: value => {
      fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
      fs.writeFileSync(preferencesPath + '.tmp', JSON.stringify({ automatic: value }));
      fs.renameSync(preferencesPath + '.tmp', preferencesPath);
    },
    disabledReason: portable ? 'Переносимая версия. Для автообновлений установите версию Setup из GitHub Releases.' : 'Автообновления доступны в установленной версии.',
    publish: state => { if (window && !window.isDestroyed()) window.webContents.send('updates:state', state); }
  });
  if (updatesEnabled) {
    const firstCheck = setTimeout(() => updates.check({ automatic: true }), 15000);
    const repeatedCheck = setInterval(() => updates.check({ automatic: true }), 6 * 60 * 60 * 1000);
    firstCheck.unref(); repeatedCheck.unref();
    app.once('before-quit', () => { clearTimeout(firstCheck); clearInterval(repeatedCheck); });
  }
  const handle = (channel, action) => ipcMain.handle(channel, (event, data) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('Недопустимый источник.');
    return action(data);
  });
  handle('phone:start', () => phone.start(data => window.webContents.send('phone:photo', data), () => window.webContents.send('phone:closed')));
  handle('phone:stop', () => phone.stop());
  handle('system:readiness', () => checkReadiness({ app, getPrinters: () => window.webContents.getPrintersAsync() }));
  handle('system:setup', target => {
    const urls = { printers: 'ms-settings:printers', firewall: 'windowsdefender://firewall', driver: 'https://www.bartendersoftware.com/resources/printer-drivers/tsc/tsc-te200' };
    if (!Object.hasOwn(urls, target)) throw Error('Неизвестный раздел настроек.');
    return shell.openExternal(urls[target]);
  });
  handle('updates:get', () => updates.state());
  handle('updates:check', () => updates.check());
  handle('updates:automatic', value => updates.setAutomatic(value));
  handle('updates:install', async () => {
    if (printing) throw Error('Сначала завершите диалог печати.');
    if (updates.state().status !== 'ready') throw Error('Обновление ещё не готово.');
    const answer = await dialog.showMessageBox(window, { type: 'question', title: 'Установить обновление', message: 'Перезапустить программу и установить обновление?', detail: 'Текущий снимок не сохраняется между запусками. Сохраните PDF, если он вам нужен.', buttons: ['Обновить', 'Позже'], defaultId: 1, cancelId: 1 });
    if (answer.response === 0) updates.install();
  });
  handle('printers:list', async () => (await window.webContents.getPrintersAsync()).map(p => ({ name: p.name, displayName: p.displayName, isDefault: p.isDefault })));
  handle('labels:print', async data => {
    if (printing) throw Error('Дождитесь завершения предыдущего задания.');
    const html = printHTML(data);
    const printers = await window.webContents.getPrintersAsync();
    if (!printers.some(p => p.name === data.deviceName)) throw Error('Принтер не найден. Проверьте драйвер и подключение.');
    printing = true;
    let printWindow;
    try {
      printWindow = new BrowserWindow({ show: false, parent: window, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
      await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      return await new Promise(resolve => printWindow.webContents.print({ silent: false, deviceName: data.deviceName, pageSize: { width: (data.labelWidth ?? data.labelSize ?? 20) * 1000, height: (data.labelHeight ?? data.labelSize ?? 20) * 1000 }, margins: { marginType: 'none' }, scaleFactor: 100, printBackground: true, copies: 1, pagesPerSheet: 1, duplexMode: 'simplex', color: false }, (success, reason) => resolve({ success, reason })));
    } finally { if (printWindow && !printWindow.isDestroyed()) printWindow.destroy(); printing = false; }
  });
});
app.on('before-quit', () => phone.stop());
app.on('window-all-closed', () => app.quit());
