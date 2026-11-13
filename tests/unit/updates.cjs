const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdates } = require('../../desktop/updates.cjs');

test('Обновление загружается автоматически, установка возможна только после загрузки', async () => {
  const updater = new EventEmitter(); let installed = false;
  updater.checkForUpdates = async () => { updater.emit('checking-for-update'); updater.emit('update-available', { version: '1.4.0' }); };
  updater.quitAndInstall = (silent, runAfter) => { assert.equal(silent, false); assert.equal(runAfter, true); installed = true; };
  const states = [];
  const controller = createUpdates({ updater, enabled: true, version: '1.3.0', publish: state => states.push(state) });
  assert.equal(updater.autoDownload, true); assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.allowDowngrade, false); assert.equal(updater.allowPrerelease, false);
  assert.throws(() => controller.install(), /не загружено/);
  await controller.check(); assert.equal(controller.state().status, 'downloading');
  updater.emit('download-progress', { percent: 58.2 }); assert.equal(controller.state().percent, 58);
  updater.emit('update-downloaded', { version: '1.4.0' });
  assert.equal(controller.state().status, 'ready'); controller.install(); assert.equal(installed, true);
  assert.ok(states.length >= 4);
});

test('Повторная проверка не запускает параллельную загрузку, ошибка сети обрабатывается', async () => {
  const updater = new EventEmitter(); let count = 0, finish;
  updater.checkForUpdates = () => { count++; return new Promise(resolve => { finish = resolve; }); };
  const controller = createUpdates({ updater, enabled: true, version: '1.3.0' });
  const pending = controller.check(); await controller.check(); assert.equal(count, 1); finish(); await pending;
  updater.checkForUpdates = async () => { throw Error('offline'); };
  await controller.check(); assert.equal(controller.state().status, 'error');
  updater.checkForUpdates = async () => updater.emit('update-not-available');
  await controller.check(); assert.equal(controller.state().status, 'current');
});

test('Переносимая версия не обращается за обновлениями', async () => {
  const controller = createUpdates({ updater: null, enabled: false, version: '1.3.0', disabledReason: 'Нужен Setup' });
  assert.equal((await controller.check()).status, 'disabled');
  assert.throws(() => controller.install(), /не загружено/);
});

test('Выключенная настройка блокирует фоновую проверку и установку, но сохраняет ручную проверку', async () => {
  const updater = new EventEmitter(); let calls = 0, saved;
  updater.checkForUpdates = async () => { calls++; assert.equal(updater.autoDownload, true); updater.emit('update-available', { version: '2.0.0' }); updater.emit('update-downloaded', { version: '2.0.0' }); };
  const controller = createUpdates({ updater, enabled: true, version: '1.5.0', automatic: false, saveAutomatic: value => { saved = value; } });
  assert.equal(updater.autoInstallOnAppQuit, false);
  await controller.check({ automatic: true }); assert.equal(calls, 0);
  await controller.check(); assert.equal(calls, 1);
  assert.match(controller.state().message, /Нажмите/);
  controller.setAutomatic(true); assert.equal(saved, true); assert.equal(updater.autoInstallOnAppQuit, true);
  assert.match(controller.state().message, /при закрытии/);
  controller.setAutomatic(false); assert.equal(updater.autoInstallOnAppQuit, false);
  assert.throws(() => controller.setAutomatic('true'), /Некорректное/);
});

test('Выключение во время фоновой проверки запрещает последующее автоматическое скачивание', async () => {
  const updater = new EventEmitter(); let finish;
  updater.checkForUpdates = () => new Promise(resolve => { finish = () => { updater.emit('update-available', { version: '2.0.0' }); resolve(); }; });
  const controller = createUpdates({ updater, enabled: true, version: '1.5.0' });
  const pending = controller.check({ automatic: true });
  controller.setAutomatic(false); assert.equal(updater.autoDownload, false);
  finish(); await pending; assert.equal(controller.state().status, 'available');
});

test('Ошибка сохранения настройки не меняет текущий режим', () => {
  const updater = new EventEmitter();
  const controller = createUpdates({ updater, enabled: true, version: '1.5.0', saveAutomatic: () => { throw Error('write failed'); } });
  assert.throws(() => controller.setAutomatic(false), /write failed/);
  assert.equal(controller.state().automatic, true); assert.equal(updater.autoInstallOnAppQuit, true);
});
