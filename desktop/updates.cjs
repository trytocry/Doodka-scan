// Логика обновлений отделена от Electron для проверки без загрузки установщиков.
function createUpdates({ updater, enabled, version, publish = () => {}, disabledReason, automatic = true, saveAutomatic = () => {} }) {
  let state = { status: enabled ? 'idle' : 'disabled', enabled, automatic: Boolean(automatic), version, message: enabled ? (automatic ? 'Обновления проверяются автоматически.' : 'Автообновления выключены. Доступна ручная проверка.') : disabledReason };
  let checking = false, downloaded = false, manualCheck = false;
  const set = change => { state = { ...state, ...change }; publish({ ...state }); };
  const readyMessage = () => `Версия ${state.nextVersion} загружена. ` + (state.automatic ? 'Она установится при закрытии программы.' : 'Нажмите «Перезапустить и обновить» для установки.');
  if (enabled) {
    updater.autoDownload = state.automatic;
    updater.autoInstallOnAppQuit = state.automatic;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on('checking-for-update', () => set({ status: 'checking', message: 'Проверяем обновления…' }));
    updater.on('update-not-available', () => set({ status: 'current', message: 'Установлена актуальная версия.' }));
    updater.on('update-available', info => set(updater.autoDownload
      ? { status: 'downloading', nextVersion: info.version, message: `Скачиваем версию ${info.version}…` }
      : { status: 'available', nextVersion: info.version, message: `Доступна версия ${info.version}. Нажмите «Проверить обновления», чтобы скачать.` }));
    updater.on('download-progress', progress => set({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))), message: `Скачиваем обновление: ${Math.round(progress.percent || 0)}%` }));
    updater.on('update-downloaded', info => {
      downloaded = true;
      set({ status: 'ready', nextVersion: info.version });
      set({ message: readyMessage() });
    });
    updater.on('error', () => set({ status: 'error', message: 'Не удалось проверить или скачать обновление. Проверьте интернет и повторите позже.' }));
  }
  return {
    state: () => ({ ...state }),
    setAutomatic(value) {
      if (typeof value !== 'boolean') throw Error('Некорректное значение настройки.');
      saveAutomatic(value);
      if (enabled) { updater.autoDownload = value || manualCheck; updater.autoInstallOnAppQuit = value; }
      set({ automatic: value });
      if (downloaded) set({ message: readyMessage() });
      else if (enabled && !['checking', 'downloading', 'available'].includes(state.status)) set({ message: value ? 'Обновления проверяются автоматически.' : 'Автообновления выключены. Доступна ручная проверка.' });
      return { ...state };
    },
    async check({ automatic: background = false } = {}) {
      if (background && !state.automatic) return { ...state };
      if (!enabled || checking || downloaded || state.status === 'downloading') return { ...state };
      checking = true; manualCheck = !background;
      updater.autoDownload = state.automatic || manualCheck;
      try { await updater.checkForUpdates(); }
      catch { set({ status: 'error', message: 'Обновления временно недоступны. Программа продолжает работать.' }); }
      finally { checking = false; manualCheck = false; updater.autoDownload = state.automatic; }
      return { ...state };
    },
    install() {
      if (!enabled || !downloaded) throw Error('Обновление ещё не загружено.');
      updater.quitAndInstall(false, true);
    }
  };
}
module.exports = { createUpdates };
