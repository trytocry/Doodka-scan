export const SETTINGS_KEY = 'qr-duplicator.label-settings.v1';
export const DEFAULT_SETTINGS = Object.freeze({ version: 1, size: 18, copies: 1, labelWidth: 20, labelHeight: 20, fitLabel: false });

export function validSettings(value) {
  return value?.version === 1 && typeof value.size === 'number' && Number.isFinite(value.size)
    && value.size >= 8 && value.size <= (value.fitLabel === true ? 100 : Math.min(value.labelWidth ?? value.labelSize ?? 20, value.labelHeight ?? value.labelSize ?? 20))
    && (value.fitLabel === undefined || typeof value.fitLabel === 'boolean')
    && [value.labelWidth ?? value.labelSize ?? 20, value.labelHeight ?? value.labelSize ?? 20].every(v => Number.isInteger(v) && v >= 20 && v <= 100) && Number.isInteger(value.copies) && value.copies >= 1 && value.copies <= 500;
}

export function loadSettings(storage) {
  try {
    const value = JSON.parse((storage || window.localStorage).getItem(SETTINGS_KEY));
    if (validSettings(value)) return { version: 1, size: value.size, copies: value.copies, labelWidth: value.labelWidth ?? value.labelSize ?? 20, labelHeight: value.labelHeight ?? value.labelSize ?? 20, fitLabel: value.fitLabel ?? false };
  } catch { /* Недоступное хранилище не мешает работе с этикетками. */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(value, storage) {
  if (!validSettings(value)) return false;
  try {
    (storage || window.localStorage).setItem(SETTINGS_KEY, JSON.stringify({ version: 1, size: value.size, copies: value.copies, labelWidth: value.labelWidth ?? value.labelSize ?? 20, labelHeight: value.labelHeight ?? value.labelSize ?? 20, fitLabel: value.fitLabel ?? false }));
    return true;
  } catch { return false; }
}
