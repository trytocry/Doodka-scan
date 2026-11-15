const PRINTER_KEY = 'qr-duplicator.paper-printer.v1';
const supported = (w, h) => [w, h].every(v => Number.isInteger(v) && v >= 18 && v <= 100);
export function setupDriverPaper(applyDimensions) {
  if (!window.desktop?.paperDriver) return { preferredPrinter: () => '' };
  let preferred = ''; try { preferred = localStorage.getItem(PRINTER_KEY) || ''; } catch {}
  const button = document.createElement('button');
  button.id = 'driver-paper'; button.type = 'button'; button.className = 'button secondary driver-paper-button'; button.textContent = 'Профили бумаги в драйвере';
  document.querySelector('.settings-heading').after(button);
  const summary = document.createElement('section'); summary.className = 'active-paper';
  summary.innerHTML = '<div><strong>Профиль бумаги в драйвере</strong><p id="active-paper-status" role="status">Читаем настройки принтера…</p></div><button id="active-paper-refresh" class="button secondary" type="button" aria-label="Обновить активный профиль бумаги">Обновить</button>';
  button.before(summary);
  const summaryText = summary.querySelector('#active-paper-status');
  const refreshButton = summary.querySelector('button');
  let refreshPending = null, revision = 0, lastRefresh = 0;
  function showActive(data, printer) {
    const stock = data.stocks.find(p => p.id === data.currentId);
    summaryText.textContent = `${printer} · ${stock?.name || 'Пользовательский формат'} · ${data.width.toLocaleString('ru-RU')} × ${data.height.toLocaleString('ru-RU')} мм`;
    summary.classList.remove('is-unavailable');
  }
  async function refreshActive() {
    if (refreshPending || busy || dialog.open) return;
    const token = ++revision;
    refreshButton.disabled = true;
    summaryText.textContent = 'Читаем настройки принтера…';
    refreshPending = (async () => {
      try {
        const printers = await window.desktop.printers();
        const printer = printers.find(p => p.name === preferred) || printers.find(p => p.isDefault) || printers[0];
        if (!printer) throw Error('Нет установленного принтера.');
        const data = await window.desktop.paperDriver({ printer: printer.name, action: 'list', stockId: 0 });
        if (token === revision) showActive(data, printer.name);
      } catch (e) {
        if (token === revision) { summaryText.textContent = 'Профиль недоступен: ' + e.message; summary.classList.add('is-unavailable'); }
      } finally { refreshButton.disabled = false; lastRefresh = Date.now(); refreshPending = null; }
    })();
    await refreshPending;
  }

  const dialog = document.createElement('dialog'); dialog.className = 'desktop-dialog paper-dialog';
  dialog.innerHTML = '<h2>Бумага в драйвере принтера</h2><p class="hint">Выбор применяется к настройкам печати Windows для вашего пользователя.</p><label for="paper-printer">Принтер</label><select id="paper-printer"></select><label for="paper-stock">Профиль бумаги</label><select id="paper-stock"></select><p id="paper-current"></p><p class="hint">Для создания профиля откройте «Создать / изменить в драйвере», задайте название и размеры в окне принтера и нажмите ОК. После этого список обновится.</p><p id="paper-message" role="status"></p><div class="dialog-actions"><button id="paper-apply" class="button">Применить в Windows</button><button id="paper-edit" class="button secondary">Создать / изменить в драйвере</button><button id="paper-refresh" class="button secondary">Обновить список</button><button id="paper-close" class="button secondary">Закрыть</button></div>';
  document.body.append(dialog);
  const $ = id => dialog.querySelector('#' + id);
  let state = null, busy = false;
  function controls() {
    const stock = state?.stocks.find(p => String(p.id) === $('paper-stock').value);
    $('paper-apply').disabled = busy || !stock || !supported(stock.width, stock.height);
    $('paper-edit').disabled = busy || !$('paper-printer').value;
    $('paper-refresh').disabled = busy || !$('paper-printer').value;
    $('paper-printer').disabled = busy; $('paper-stock').disabled = busy || !state?.stocks.length;
    $('paper-close').disabled = busy;
  }
  function render(data) {
    state = data;
    $('paper-stock').replaceChildren(...data.stocks.map(p => new Option(`${p.name} — ${p.width.toLocaleString('ru-RU')} × ${p.height.toLocaleString('ru-RU')} мм`, String(p.id), false, p.id === data.currentId)));
    $('paper-current').textContent = `Сейчас в драйвере: ${data.width.toLocaleString('ru-RU')} × ${data.height.toLocaleString('ru-RU')} мм.`;
  }
  function sync(data) {
    preferred = $('paper-printer').value;
    try { localStorage.setItem(PRINTER_KEY, preferred); } catch {}
    ++revision; showActive(data, preferred);
    if (!supported(data.width, data.height)) {
      $('paper-message').textContent = 'Настройки сохранены в Windows. Этот формат вне диапазона программы: стороны должны быть целыми числами от 18 до 100 мм. Размеры в программе не изменены.';
      return;
    }
    applyDimensions(data.width, data.height);
    $('paper-message').textContent = 'Профиль сохранён в настройках печати Windows. Размеры в программе обновлены.';
  }
  async function operation(action) {
    if (busy || !$('paper-printer').value) return;
    busy = true; controls(); $('paper-message').textContent = action === 'edit' ? 'Открыто окно драйвера. Завершите настройку и нажмите ОК или Отмена.' : 'Читаем настройки драйвера…';
    try {
      if (refreshPending) await refreshPending;
      const data = await window.desktop.paperDriver({ printer: $('paper-printer').value, action, stockId: Number($('paper-stock').value || 0) });
      render(data);
      if (action !== 'list' && !data.cancelled) sync(data);
      else $('paper-message').textContent = data.cancelled ? 'Выбор отменён. Список профилей обновлён.' : 'Выберите профиль и нажмите «Применить в Windows». Поддерживаемые размеры: 18–100 мм, целые числа.';
    } catch (error) { state = null; $('paper-stock').replaceChildren(); $('paper-message').textContent = 'Не удалось выполнить операцию: ' + error.message; }
    finally { busy = false; controls(); }
  }
  button.onclick = async () => {
    ++revision;
    dialog.showModal(); state = null; $('paper-printer').replaceChildren(); $('paper-stock').replaceChildren(); $('paper-current').textContent = ''; busy = true; controls(); $('paper-message').textContent = 'Ищем принтеры…';
    try {
      const printers = await window.desktop.printers();
      $('paper-printer').replaceChildren(...printers.map(p => new Option(p.displayName || p.name, p.name)));
      const selected = printers.find(p => p.name === preferred) || printers.find(p => p.isDefault) || printers[0];
      if (selected) $('paper-printer').value = selected.name;
      else $('paper-message').textContent = 'Принтеров нет. Установите драйвер принтера в Windows.';
    } catch (e) { $('paper-message').textContent = e.message; }
    finally { busy = false; controls(); }
    if ($('paper-printer').value) await operation('list');
  };
  $('paper-printer').onchange = () => { state = null; operation('list'); };
  $('paper-stock').onchange = controls;
  $('paper-apply').onclick = () => operation('apply');
  $('paper-edit').onclick = () => operation('edit');
  $('paper-refresh').onclick = () => operation('list');
  $('paper-close').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  refreshButton.onclick = refreshActive;
  dialog.addEventListener('close', refreshActive);
  window.addEventListener('focus', () => { if (Date.now() - lastRefresh > 5000) refreshActive(); });
  refreshActive();
  return { preferredPrinter: () => preferred };
}
