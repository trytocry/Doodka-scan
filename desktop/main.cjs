const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createUpdates } = require('./updates.cjs');
const phone = require('./phone.cjs');
const { printHTML } = require('./printing.cjs');

app.setName('QR Этикетка');
let window;
let updates, printing = false;
function createWindow() {
  window = new BrowserWindow({
    title: `QR Этикетка ${app.getVersion()}`, width: 1160, height: 900, minWidth: 440, minHeight: 620,
    backgroundColor: '#f3f6fb', show: false,
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
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Файл', submenu: [{ label: 'Выйти', role: 'quit' }] },
    { label: 'Правка', submenu: [
      { label: 'Отменить', role: 'undo' }, { label: 'Повторить', role: 'redo' }, { type: 'separator' },
      { label: 'Вырезать', role: 'cut' }, { label: 'Копировать', role: 'copy' }, { label: 'Вставить', role: 'paste' }, { label: 'Выделить всё', role: 'selectAll' }
    ] },
    { label: 'Вид', submenu: [{ label: 'Увеличить', role: 'zoomIn' }, { label: 'Уменьшить', role: 'zoomOut' }, { label: 'Исходный масштаб', role: 'resetZoom' }] },
    { label: 'Справка', submenu: [{ label: 'Проверить обновления', click: () => updates?.check() }] }
  ]));
  window.once('ready-to-show', () => window.show());
  window.loadFile(path.join(__dirname, 'app', 'index.html'));
}
app.whenReady().then(() => {
  createWindow();
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
  const updatesEnabled = app.isPackaged && !portable && process.env.QR_ETIKETKA_DISABLE_UPDATES !== '1' && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  updates = createUpdates({
    updater: updatesEnabled ? require('electron-updater').autoUpdater : null,
    enabled: updatesEnabled, version: app.getVersion(),
    disabledReason: portable ? 'Переносимая версия. Для автообновлений установите версию Setup из GitHub Releases.' : 'Автообновления доступны в установленной версии.',
    publish: state => { if (window && !window.isDestroyed()) window.webContents.send('updates:state', state); }
  });
  if (updatesEnabled) {
    const firstCheck = setTimeout(() => updates.check(), 15000);
    const repeatedCheck = setInterval(() => updates.check(), 6 * 60 * 60 * 1000);
    firstCheck.unref(); repeatedCheck.unref();
    app.once('before-quit', () => { clearTimeout(firstCheck); clearInterval(repeatedCheck); });
  }
  const handle = (channel, action) => ipcMain.handle(channel, (event, data) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('Недопустимый источник.');
    return action(data);
  });
  handle('phone:start', () => phone.start(data => window.webContents.send('phone:photo', data), () => window.webContents.send('phone:closed')));
  handle('phone:stop', () => phone.stop());
  handle('updates:get', () => updates.state());
  handle('updates:check', () => updates.check());
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
      return await new Promise(resolve => printWindow.webContents.print({ silent: false, deviceName: data.deviceName, pageSize: { width: 20000, height: 20000 }, margins: { marginType: 'none' }, scaleFactor: 100, printBackground: true, copies: 1, pagesPerSheet: 1, duplexMode: 'simplex', color: false }, (success, reason) => resolve({ success, reason })));
    } finally { if (printWindow && !printWindow.isDestroyed()) printWindow.destroy(); printing = false; }
  });
});
app.on('before-quit', () => phone.stop());
app.on('window-all-closed', () => app.quit());
