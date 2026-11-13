const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const phone = require('../../desktop/phone.cjs');
const { checkReadiness } = require('../../desktop/readiness.cjs');

test('Диагностика проверяет запись и порт, не выдавая их за доступ с телефона', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qr-readiness-'));
  try {
    const result = await checkReadiness({ app: { getPath: () => directory }, getPrinters: async () => [], checkUpdatesNetwork: async () => { throw Error('offline'); } });
    assert.equal(result.checks.find(c => c.title === 'Порт передачи фото').level, 'ok');
    assert.equal(result.checks.find(c => c.title === 'Доступ с телефона и брандмауэр').level, 'info');
    assert.equal(result.checks.find(c => c.title === 'Принтеры Windows').level, 'warning');
    assert.equal(result.checks.find(c => c.title.startsWith('Обновления')).level, 'warning');
    assert.deepEqual(await fs.readdir(directory), []);
  } finally { await fs.rmdir(directory); }
});

test('Проверка действующего порта не закрывает передачу и не считает себя телефоном', async t => {
  if (!Object.values(os.networkInterfaces()).flat().some(x => x.family === 'IPv4' && !x.internal)) return t.skip('Нет сетевого интерфейса');
  try {
    const session = await phone.start(() => {}, () => {});
    const result = await phone.checkConnection();
    assert.equal(result.active, true); assert.equal(result.phoneConnected, false);
    const url = new URL(session.urls[0]); url.hostname = '127.0.0.1';
    const code = await new Promise((resolve, reject) => { http.get(url, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject); });
    assert.equal(code, 200);
  } finally { phone.stop(); }
});
