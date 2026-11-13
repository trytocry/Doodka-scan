import { recognize } from './recognize.js';
import { photoError, setupPhotoInput } from './photo-input.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './label-settings.js';
import QRCode from 'qrcode';
import './desktop.css';
import { makeMatrix, layout, drawLabel, createPDF } from './core.js';
import './style.css';
import './glass.css';
import { setupReadiness } from './readiness.js';
setupReadiness();
const $ = id => document.getElementById(id);
let matrix = null, currentPlan = null, generation = 0, busy = false;
const sourcePreview = document.createElement('details');
sourcePreview.innerHTML = '<summary>Полученное фото</summary><img id="source-photo" alt="Фотография, которую распознаёт программа" style="max-width:100%;max-height:260px;display:block;margin:12px auto">';
sourcePreview.hidden = true;
document.querySelector('.upload').after(sourcePreview);
function status(message, kind = '') { $('status').textContent = message; $('status').className = kind; }
function update() {
  currentPlan = null; $('download').disabled = true; $('validation').textContent = '';
  if ($('print')) $('print').disabled = true;
  const count = Number($('copies').value);
  $('page-count').textContent = Number.isInteger(count) && count > 0 && count <= 500 ? count : '—';
  if (!matrix) return;
  try {
    currentPlan = layout(matrix, Number($('size').value), count);
    drawLabel($('qr'), matrix, currentPlan); $('qr').hidden = false; $('empty').hidden = true;
    $('actual').textContent = `Фактический размер с полем: ${currentPlan.actual.toLocaleString('ru-RU')} мм. Выровнен по точкам печати 203 dpi.`;
    $('download').disabled = busy;
    if ($('print')) $('print').disabled = busy;
  } catch (e) {
    $('validation').textContent = e.message; $('validation').className = 'error';
    $('qr').hidden = true; $('empty').hidden = false; $('actual').textContent = 'Исправьте параметры для создания PDF.';
  }
}
async function readPhoto(file) {
  if (!file) return;
  const inputError = photoError(file);
  if (inputError) { status(inputError, 'error'); return; }
  const token = ++generation;
  matrix = null; currentPlan = null; $('content').hidden = true; $('decoded').textContent = ''; $('qr').hidden = true; $('empty').hidden = false;
  sourcePreview.hidden = true; sourcePreview.open = false;
  $('actual').textContent = 'Добавьте фото, чтобы подготовить файл.'; update();
  $('file-name').textContent = file.name;
  status('Распознаём QR или Data Matrix…');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url;
    await img.decode();
    if (token !== generation) return;
    const thumb = document.createElement('canvas');
    const thumbScale = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
    thumb.width = Math.round(img.naturalWidth * thumbScale); thumb.height = Math.round(img.naturalHeight * thumbScale);
    thumb.getContext('2d').drawImage(img, 0, 0, thumb.width, thumb.height);
    $('source-photo').src = thumb.toDataURL('image/jpeg', 0.85); sourcePreview.hidden = false;
    const found = await recognize(img, () => token === generation, i => { if (i) status('Проверяем фото подробнее: ищем небольшой или повёрнутый QR-код…'); });
    if (token !== generation) return;
    if (!found) throw new Error('QR-код или Data Matrix не найден. Снимите его ближе, без бликов, сохранив все четыре угла и белое поле.');
    matrix = makeMatrix(found); $('decoded').textContent = found.data || '(Двоичные данные)'; $('content').hidden = false;
    status(`${found.format === 'DataMatrix' ? 'Data Matrix' : 'QR-код'} распознан. Проверьте содержимое и подготовьте этикетки.`, 'success'); update();
  } catch (e) {
    if (token === generation && !sourcePreview.hidden) sourcePreview.open = true;
    if (token === generation) status(e.name === 'EncodingError' ? 'Браузер не смог открыть фото. Выберите JPG, PNG или WebP; для HEIC сохраните фото как JPG.' : e.message, 'error');
  } finally { URL.revokeObjectURL(url); }
}
for (const id of ['photo', 'camera']) $(id).addEventListener('change', event => { const file = event.target.files[0]; if (file) readPhoto(file); event.target.value = ''; });
setupPhotoInput({ zone: document.querySelector('.upload'), accept: readPhoto, reject: message => status(message, 'error') });
const restoredSettings = loadSettings();
$('size').value = restoredSettings.size; $('copies').value = restoredSettings.copies;
for (const id of ['size', 'copies']) $(id).addEventListener('input', () => {
  saveSettings({ version: 1, size: Number($('size').value), copies: Number($('copies').value) });
  update();
});
$('reset-settings').onclick = () => {
  $('size').value = DEFAULT_SETTINGS.size; $('copies').value = DEFAULT_SETTINGS.copies;
  saveSettings(DEFAULT_SETTINGS); update();
};
update();
$('download').addEventListener('click', async () => {
  if (!matrix || !currentPlan || busy) return;
  const selectedMatrix = matrix, selectedPlan = currentPlan;
  busy = true; $('download').disabled = true; $('download').textContent = 'Создаём PDF…';
  await new Promise(resolve => setTimeout(resolve, 30));
  try { createPDF(selectedMatrix, selectedPlan).save(`qr-20x20-${selectedPlan.copies}pcs.pdf`); }
  catch { status('Не удалось сохранить PDF. Попробуйте уменьшить количество копий.', 'error'); }
  finally { busy = false; $('download').textContent = 'Скачать PDF'; update(); }
});

if (window.desktop) {
  const updateBar = document.createElement('section');
  updateBar.className = 'update-bar'; updateBar.setAttribute('aria-label', 'Обновления программы');
  updateBar.innerHTML = '<span id="app-version"></span><span id="update-message" role="status"></span><label class="auto-update-setting"><input id="auto-updates" type="checkbox" disabled>Обновлять автоматически</label><button id="check-update" class="button secondary">Проверить обновления</button><button id="install-update" class="button" hidden>Перезапустить и обновить</button>';
  document.querySelector('footer').before(updateBar);
  const showUpdates = state => {
    $('app-version').textContent = `Версия ${state.version}`;
    $('auto-updates').checked = Boolean(state.enabled && state.automatic);
    $('auto-updates').disabled = !state.enabled;
    $('update-message').textContent = state.message;
    $('check-update').disabled = ['disabled', 'checking', 'downloading', 'ready'].includes(state.status);
    $('install-update').hidden = state.status !== 'ready';
  };
  window.desktop.onUpdate(showUpdates);
  $('auto-updates').onchange = async () => {
    const value = $('auto-updates').checked;
    $('auto-updates').disabled = true;
    try { showUpdates(await window.desktop.setAutoUpdates(value)); }
    catch { $('auto-updates').checked = !value; $('auto-updates').disabled = false; $('update-message').textContent = 'Не удалось сохранить настройку обновлений. Повторите попытку.'; }
  };
  window.desktop.updateState().then(showUpdates).catch(() => { $('update-message').textContent = 'Состояние обновления недоступно.'; });
  $('check-update').onclick = async () => {
    $('check-update').disabled = true;
    try { showUpdates(await window.desktop.checkUpdates()); }
    catch { $('update-message').textContent = 'Проверка не удалась. Повторите позже.'; $('check-update').disabled = false; }
  };
  $('install-update').onclick = async () => {
    try { await window.desktop.installUpdate(); }
    catch (e) { $('update-message').textContent = e.message; }
  };
  document.querySelector('.intro > p').textContent = 'Добавьте фото QR или Data Matrix, выберите размер и печатайте наклейки.';
  const phoneButton = document.createElement('button');
  phoneButton.id = 'phone'; phoneButton.className = 'button secondary'; phoneButton.textContent = 'Добавить с телефона';
  document.querySelector('.upload-actions').append(phoneButton);
  const printButton = document.createElement('button');
  printButton.id = 'print'; printButton.className = 'button download print-button'; printButton.textContent = 'Печать'; printButton.disabled = true;
  $('download').before(printButton); $('download').classList.add('secondary');
  const phoneDialog = document.createElement('dialog'); phoneDialog.className = 'desktop-dialog';
  phoneDialog.innerHTML = '<h2>Добавить с телефона</h2><p>Подключите телефон к той же Wi-Fi-сети и наведите камеру на этот QR-код.</p><canvas id="phone-qr" aria-label="QR-ссылка для телефона"></canvas><label for="phone-address">Адрес компьютера</label><select id="phone-address"></select><p id="phone-link"></p><p id="phone-status" role="status">Ожидаем фотографию…</p><p class="hint">Ссылка действует 15 минут, пока это окно открыто. На телефоне выберите «Сфотографировать» или «Выбрать из галереи». Если страница не открывается, проверьте Wi-Fi и разрешение программы в брандмауэре Windows для частной сети.</p><button id="close-phone" class="button">Закрыть передачу</button>';
  document.body.append(phoneDialog);
  const drawPhoneQR = () => { const url = $('phone-address').value; $('phone-link').textContent = url; return QRCode.toCanvas($('phone-qr'), url, { width: 240, margin: 4 }); };
  phoneButton.onclick = async () => {
    phoneButton.disabled = true;
    try {
      const session = await window.desktop.startPhone();
      $('phone-address').replaceChildren(...session.urls.map(url => new Option(new URL(url).host, url)));
      $('phone-status').textContent = 'Ожидаем фотографию…';
      await drawPhoneQR(); phoneDialog.showModal();
    } catch (e) { status('Не удалось включить передачу: ' + e.message, 'error'); }
    finally { phoneButton.disabled = false; }
  };
  $('phone-address').onchange = drawPhoneQR;
  $('close-phone').onclick = () => phoneDialog.close();
  phoneDialog.addEventListener('close', () => { $('phone-qr').hidden = false; window.desktop.stopPhone().catch(() => {}); });
  window.desktop.onPhoneClosed(() => { $('phone-status').textContent = 'Ссылка истекла. Закройте окно и нажмите «Добавить с телефона» снова.'; $('phone-qr').hidden = true; });
  window.desktop.onPhoto(async data => {
    $('phone-status').textContent = 'Фото получено. Распознаём QR или Data Matrix…';
    await readPhoto(new File([data.bytes], 'Фото с телефона', { type: data.type }));
    $('phone-status').textContent = $('status').textContent;
    if (matrix) phoneDialog.close();
  });
  const printDialog = document.createElement('dialog'); printDialog.className = 'desktop-dialog';
  printDialog.innerHTML = '<h2>Печать наклеек</h2><label for="printer">Принтер</label><select id="printer"></select><p id="print-summary"></p><p class="hint">В системном диалоге проверьте носитель 20 × 20 мм и масштаб 100%. Число копий там оставьте 1: программа уже подготовила нужное число страниц.</p><p id="print-status" role="status"></p><div class="dialog-actions"><button id="confirm-print" class="button">Открыть диалог печати</button><button id="close-print" class="button secondary">Отмена</button></div>';
  document.body.append(printDialog);
  let job;
  printButton.onclick = async () => {
    if (!matrix || !currentPlan) return;
    job = { size: matrix.size, bits: Array.from(matrix.data), moduleDots: currentPlan.moduleDots, offset: currentPlan.offset, copies: currentPlan.copies };
    $('confirm-print').disabled = true; $('print-status').textContent = 'Ищем установленные принтеры…'; $('printer').replaceChildren();
    $('print-summary').textContent = `Наклеек: ${job.copies}. Размер страницы: 20 × 20 мм.`; printDialog.showModal();
    try {
      const printers = await window.desktop.printers();
      $('printer').replaceChildren(...printers.map(p => new Option(p.displayName || p.name, p.name, p.isDefault, p.isDefault)));
      $('confirm-print').disabled = !printers.length;
      $('print-status').textContent = printers.length ? '' : 'Принтеров нет. Установите драйвер принтера в Windows или сохраните PDF.';
    } catch (e) { $('print-status').textContent = 'Не удалось получить принтеры: ' + e.message; }
  };
  $('close-print').onclick = () => printDialog.close();
  $('confirm-print').onclick = async () => {
    $('confirm-print').disabled = true; $('print-status').textContent = 'Проверьте параметры в системном диалоге печати.';
    try {
      const result = await window.desktop.print({ ...job, deviceName: $('printer').value });
      if (result.success) { printDialog.close(); status('Задание передано в очередь печати Windows.', 'success'); }
      else $('print-status').textContent = /cancel/i.test(result.reason || '') ? 'Печать отменена.' : 'Печать не выполнена: ' + (result.reason || 'проверьте принтер и драйвер.');
    } catch (e) { $('print-status').textContent = 'Не удалось напечатать: ' + e.message; }
    finally { $('confirm-print').disabled = false; }
  };
  window.desktop.ready?.();
}
