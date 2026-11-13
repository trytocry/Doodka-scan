const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const phone = require('./phone.cjs');
const https = require('node:https');

function checkGithub() {
  return new Promise((resolve, reject) => {
    const request = https.request('https://api.github.com/repos/trytocry/Doodka-scan/releases/latest', { method: 'HEAD', headers: { 'User-Agent': 'QR-Duplicator-Readiness' } }, response => {
      response.resume(); response.on('end', () => response.statusCode === 200 ? resolve() : reject(Error(`GitHub вернул HTTP ${response.statusCode}`)));
    });
    request.setTimeout(4000, () => request.destroy(Error('Нет ответа от GitHub за 4 секунды')));
    request.on('error', reject); request.end();
  });
}

async function writable(directory) {
  const file = path.join(directory, `.qr-duplicator-check-${crypto.randomUUID()}.tmp`);
  try { await fs.writeFile(file, 'ok', { flag: 'wx' }); }
  finally { await fs.unlink(file).catch(() => {}); }
}
async function checkReadiness({ app, getPrinters, checkUpdatesNetwork = checkGithub }) {
  const checks = [];
  checks.push({ title: 'Версия для Windows', level: 'info', detail: process.env.PORTABLE_EXECUTABLE_FILE ? 'Переносимая версия: автообновления недоступны. Для постоянного пути программы и удобной настройки брандмауэра используйте установщик Setup. Поддерживаются Windows 10/11 x64.' : 'Установочная сборка для Windows 10/11 x64. Node.js, браузер и дополнительные библиотеки устанавливать не требуется.' });
  checks.push({ title: 'Компоненты программы', level: 'ok', detail: `Electron ${process.versions.electron || '—'}, распознавание QR/Data Matrix и PDF входят в сборку. Для обработки фото интернет не нужен.` });
  const operations = await Promise.allSettled([
    writable(app.getPath('userData')),
    writable(app.getPath('downloads')),
    phone.checkConnection(),
    Promise.race([getPrinters(), new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Служба печати не ответила за 5 секунд')), 5000); timer.unref(); })]),
    checkUpdatesNetwork()
  ]);
  for (const [index, title] of [[0, 'Сохранение настроек'], [1, 'Папка загрузок для PDF']]) {
    checks.push({ title, level: operations[index].status === 'fulfilled' ? 'ok' : 'warning', detail: operations[index].status === 'fulfilled' ? 'Запись доступна.' : 'Нет доступа для записи. Для PDF выберите другую папку; для настроек проверьте права пользователя Windows.' });
  }
  const addresses = Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => (entries || []).filter(x => x.family === 'IPv4' && !x.internal).map(x => `${name}: ${x.address}`));
  checks.push({ title: 'Локальная сеть', level: addresses.length ? 'ok' : 'warning', detail: addresses.length ? addresses.join('; ') : 'Сетевой адрес не найден. Подключите компьютер и телефон к одной Wi-Fi-сети. Работа с файлами и PDF доступна без сети.' });
  const port = operations[2];
  checks.push({ title: 'Порт передачи фото', level: port.status === 'fulfilled' ? 'ok' : 'warning', detail: port.status === 'fulfilled' ? `TCP ${port.value.port}: локальный HTTP-запрос выполнен. ${port.value.active ? 'Использован порт открытой передачи.' : 'Свободный порт проверен и закрыт; при передаче Windows выберет свободный порт снова.'}` : `Не удалось открыть сервис: ${port.reason?.message || 'неизвестная ошибка'}. Проверьте ограничения защитного ПО.` });
  checks.push({ title: 'Доступ с телефона и брандмауэр', level: port.status === 'fulfilled' && port.value.phoneConnected ? 'ok' : 'info', detail: port.status === 'fulfilled' && port.value.phoneConnected ? 'Страница передачи открывалась с другого устройства. Подтвердите передачу фотографией.' : 'С этого компьютера нельзя подтвердить доступ через брандмауэр. Откройте «Добавить с телефона» и отсканируйте QR. Если соединения нет, разрешите QR Duplicator в брандмауэре для частной сети и проверьте, что Wi-Fi не гостевой.' });
  const printers = operations[3];
  if (printers.status === 'fulfilled') {
    const names = printers.value.map(p => p.displayName || p.name);
    checks.push({ title: 'Принтеры Windows', level: names.length ? 'ok' : 'warning', detail: names.length ? `Обнаружены: ${names.join(', ')}. Наличие в списке не подтверждает подключение, бумагу и калибровку.` : 'Принтеров нет. Подключите принтер и установите его драйвер. Сохранение PDF доступно.' });
    checks.push({ title: 'TSC TE200', level: names.some(n => /TE\s*200/i.test(n)) ? 'ok' : 'info', detail: names.some(n => /TE\s*200/i.test(n)) ? 'Очередь TE200 найдена. Проверьте носитель 20 × 20 мм, калибровку и масштаб 100%.' : 'Очередь с именем TE200 не найдена. Для этой модели нужен драйвер TSC; если принтер переименован, выберите его в окне печати.' });
  } else checks.push({ title: 'Принтеры Windows', level: 'warning', detail: 'Не удалось получить список. Проверьте службу «Диспетчер печати» и драйвер принтера.' });
  checks.push({ title: 'Обновления: HTTPS, порт 443', level: operations[4].status === 'fulfilled' ? 'ok' : 'warning', detail: operations[4].status === 'fulfilled' ? 'Каталог релизов GitHub доступен. Доступ к файлам загрузки проверяется при обновлении.' : 'GitHub сейчас недоступен. Проверьте интернет, прокси или ограничения сети. Работа с фото, PDF и принтером не требует интернета.' });
  return { checks, platform: `${os.platform()} ${os.release()} ${os.arch()}` };
}
module.exports = { checkReadiness };
