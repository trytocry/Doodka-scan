const MAX_PHOTO_SIZE = 25 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function photoError(file) {
  if (!file) return 'Выберите одно изображение JPG, PNG или WebP.';
  if (file.size > MAX_PHOTO_SIZE) return 'Файл больше 25 МБ. Выберите уменьшенную фотографию.';
  if (!file.size) return 'Файл пуст. Выберите фотографию JPG, PNG или WebP.';
  const type = (file.type || '').toLowerCase();
  if (type ? !PHOTO_TYPES.has(type) : !/\.(jpe?g|png|webp)$/i.test(file.name || '')) {
    return 'Неподдерживаемый формат. Выберите JPG, PNG или WebP; для HEIC сохраните фото как JPG.';
  }
  return '';
}

export function setupPhotoInput({ zone, accept, reject }) {
  let dragDepth = 0;
  const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  const blocked = () => Boolean(document.querySelector('dialog[open]'));
  const resetDrag = () => { dragDepth = 0; zone.classList.remove('is-dragover'); };
  const receive = files => {
    if (files.length !== 1) { reject('Добавляйте одно изображение за раз. Выберите только один файл.'); return; }
    const error = photoError(files[0]);
    if (error) { reject(error); return; }
    accept(files[0]);
  };
  zone.addEventListener('dragenter', event => {
    if (!hasFiles(event) || blocked()) return;
    event.preventDefault(); dragDepth++; zone.classList.add('is-dragover');
  });
  zone.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = blocked() ? 'none' : 'copy';
  });
  zone.addEventListener('dragleave', event => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) resetDrag();
  });
  zone.addEventListener('drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault(); event.stopPropagation(); resetDrag();
    if (!blocked()) receive(Array.from(event.dataTransfer.files));
  });
  // Не позволяем браузеру открыть перетянутый файл вместо программы.
  document.addEventListener('dragover', event => { if (hasFiles(event)) event.preventDefault(); });
  document.addEventListener('drop', event => { if (hasFiles(event)) event.preventDefault(); resetDrag(); });
  document.addEventListener('dragend', resetDrag);
  window.addEventListener('blur', resetDrag);
  document.addEventListener('paste', event => {
    if (blocked() || event.target?.closest?.('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
    const files = Array.from(event.clipboardData?.files || []).filter(file => /^image\//i.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name));
    if (!files.length) return;
    event.preventDefault(); receive(files);
  });
}
