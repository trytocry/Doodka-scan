export const SETTINGS_KEY = 'qr-duplicator.label-settings.v1';
export const DEFAULT_SETTINGS = Object.freeze({ version: 1, size: 18, copies: 1 });

export function validSettings(value) {
  return value?.version === 1 && typeof value.size === 'number' && Number.isFinite(value.size)
    && value.size >= 8 && value.size <= 20 && Number.isInteger(value.copies) && value.copies >= 1 && value.copies <= 500;
}

export function loadSettings(storage) {
  try {
    const value = JSON.parse((storage || window.localStorage).getItem(SETTINGS_KEY));
    if (validSettings(value)) return { version: 1, size: value.size, copies: value.copies };
  } catch { /* Недоступное хранилище не мешает работе с этикетками. */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(value, storage) {
  if (!validSettings(value)) return false;
  try {
    (storage || window.localStorage).setItem(SETTINGS_KEY, JSON.stringify({ version: 1, size: value.size, copies: value.copies }));
    return true;
  } catch { return false; }
}
