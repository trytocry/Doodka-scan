// Логика обновлений отделена от Electron для проверки без загрузки установщиков.
function createUpdates({ updater, enabled, version, publish = () => {}, disabledReason }) {
  let state = { status: enabled ? 'idle' : 'disabled', version, message: enabled ? 'Обновления проверяются автоматически.' : disabledReason };
  let checking = false, downloaded = false;
  const set = change => { state = { ...state, ...change }; publish({ ...state }); };
  if (enabled) {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on('checking-for-update', () => set({ status: 'checking', message: 'Проверяем обновления…' }));
    updater.on('update-not-available', () => set({ status: 'current', message: 'Установлена актуальная версия.' }));
    updater.on('update-available', info => set({ status: 'downloading', nextVersion: info.version, message: `Скачиваем версию ${info.version}…` }));
    updater.on('download-progress', progress => set({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))), message: `Скачиваем обновление: ${Math.round(progress.percent || 0)}%` }));
    updater.on('update-downloaded', info => {
      downloaded = true;
      set({ status: 'ready', nextVersion: info.version, message: `Версия ${info.version} загружена. Она установится при закрытии программы.` });
    });
    updater.on('error', () => set({ status: 'error', message: 'Не удалось проверить или скачать обновление. Проверьте интернет и повторите позже.' }));
  }
  return {
    state: () => ({ ...state }),
    async check() {
      if (!enabled || checking || downloaded || state.status === 'downloading') return { ...state };
      checking = true;
      try { await updater.checkForUpdates(); }
      catch { set({ status: 'error', message: 'Обновления временно недоступны. Программа продолжает работать.' }); }
      finally { checking = false; }
      return { ...state };
    },
    install() {
      if (!enabled || !downloaded) throw Error('Обновление ещё не загружено.');
      updater.quitAndInstall(false, true);
    }
  };
}
module.exports = { createUpdates };
