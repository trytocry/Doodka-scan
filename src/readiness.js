export function setupReadiness() {
  if (!window.desktop?.readiness) return;
  const button = document.createElement('button');
  button.className = 'button secondary'; button.id = 'readiness'; button.textContent = 'Проверка готовности';
  document.querySelector('header').append(button);
  const dialog = document.createElement('dialog'); dialog.className = 'desktop-dialog readiness-dialog';
  dialog.innerHTML = '<h2>Проверка готовности</h2><p id="readiness-status" role="status">Проверяем компьютер…</p><div id="readiness-results"></div><div class="dialog-actions"><button class="button secondary" id="open-printer-settings">Принтеры Windows</button><button class="button secondary" id="open-tsc-driver">Драйвер TSC TE200</button><button class="button secondary" id="open-firewall-settings">Брандмауэр</button><button class="button" id="readiness-repeat">Проверить снова</button><button class="button secondary" id="readiness-close">Закрыть</button></div>';
  document.body.append(dialog);
  const status = dialog.querySelector('#readiness-status');
  const repeat = dialog.querySelector('#readiness-repeat');
  const run = async () => {
    repeat.disabled = true; status.textContent = 'Проверяем компоненты, папки, сеть и принтеры…';
    dialog.querySelector('#readiness-results').replaceChildren();
    try {
      const result = await window.desktop.readiness();
      status.textContent = result.checks.some(c => c.level === 'warning') ? 'Проверка завершена. Некоторые пункты требуют внимания.' : 'Проверка завершена. Результаты ниже.';
      for (const check of result.checks) {
        const row = document.createElement('section'); row.className = `readiness-item ${check.level}`;
        const title = document.createElement('h3'); title.textContent = `${check.level === 'ok' ? '✓' : check.level === 'warning' ? '!' : 'i'} ${check.title}`;
        const detail = document.createElement('p'); detail.textContent = check.detail;
        row.append(title, detail); dialog.querySelector('#readiness-results').append(row);
      }
    } catch { status.textContent = 'Проверка не завершилась. Повторите попытку.'; }
    finally { repeat.disabled = false; }
  };
  button.onclick = () => { dialog.showModal(); run(); };
  repeat.onclick = run;
  dialog.querySelector('#readiness-close').onclick = () => dialog.close();
  for (const [id, target] of [['open-printer-settings', 'printers'], ['open-tsc-driver', 'driver'], ['open-firewall-settings', 'firewall']]) dialog.querySelector(`#${id}`).onclick = async () => {
    try { await window.desktop.openSetup(target); } catch { status.textContent = 'Не удалось открыть настройки. Откройте их через меню «Пуск» Windows.'; }
  };
}
