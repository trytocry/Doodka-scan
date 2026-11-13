const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const MAX = 25 * 1024 * 1024;
let server, timer, activePath, phoneConnected = false;
function stop() {
  clearTimeout(timer);
  activePath = null; phoneConnected = false;
  if (server) { server.close(); server.closeAllConnections(); server = null; }
}
async function start(onPhoto, onClosed) {
  stop();
  const addresses = Object.values(os.networkInterfaces()).flat().filter(x => x.family === 'IPv4' && !x.internal).map(x => x.address);
  if (!addresses.length) throw new Error('Подключите компьютер к Wi-Fi или локальной сети.');
  const token = crypto.randomBytes(24).toString('hex');
  const base = '/' + token;
  const expiresAt = Date.now() + 15 * 60 * 1000;
  let receiving = false;
  const html = fs.readFileSync(path.join(__dirname, 'phone.html'));
  server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const reply = (code, message) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(message); };
    if (Date.now() >= expiresAt) return reply(410, 'Ссылка истекла. Создайте новую в программе.');
    if (req.method === 'GET' && req.url === base) {
      const local = new Set(Object.values(os.networkInterfaces()).flat().map(x => x.address));
      local.add('127.0.0.1'); local.add('::1');
      if (!local.has((req.socket.remoteAddress || '').replace(/^::ffff:/, ''))) phoneConnected = true;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
    }
    if (req.method !== 'POST' || req.url !== base + '/upload') return reply(404, 'Ссылка недействительна.');
    if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) return reply(403, 'Недопустимый источник.');
    const type = (req.headers['content-type'] || '').split(';')[0];
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return reply(415, 'Выберите JPG, PNG или WebP.');
    if (Number(req.headers['content-length']) > MAX) return reply(413, 'Фото больше 25 МБ.');
    if (receiving) return reply(409, 'Дождитесь передачи предыдущего фото.');
    receiving = true;
    try {
      let length = 0; const chunks = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > MAX) { reply(413, 'Фото больше 25 МБ.'); return; }
        chunks.push(chunk);
      }
      if (!length) return reply(400, 'Файл пуст.');
      onPhoto({ bytes: new Uint8Array(Buffer.concat(chunks)), type });
      reply(200, 'Фото передано. Проверьте распознанный QR-код на компьютере.');
    } catch { if (!res.headersSent) reply(400, 'Передача прервалась. Попробуйте снова.'); }
    finally { receiving = false; }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', resolve); });
  const port = server.address().port;
  activePath = base;
  try { await checkConnection(); } catch (error) { stop(); throw Error('Не удалось проверить порт передачи: ' + error.message); }
  timer = setTimeout(() => { stop(); onClosed(); }, 15 * 60 * 1000);
  return { urls: [...new Set(addresses)].map(ip => `http://${ip}:${port}${base}`), expiresAt };
}
async function checkConnection() {
  const current = server?.listening ? server : null;
  const probe = current || http.createServer((_req, res) => { res.end('ok'); });
  try {
    if (!current) await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '0.0.0.0', resolve); });
    const port = probe.address().port;
    await new Promise((resolve, reject) => {
      const request = http.get({ host: '127.0.0.1', port, path: current ? activePath : '/' }, response => {
        response.resume(); response.on('end', () => response.statusCode === 200 ? resolve() : reject(Error(`HTTP ${response.statusCode}`)));
      });
      request.setTimeout(2500, () => request.destroy(Error('Сервис не ответил за 2,5 секунды')));
      request.on('error', reject);
    });
    return { port, active: Boolean(current), phoneConnected: current && phoneConnected };
  } finally {
    if (!current) { probe.closeAllConnections(); await new Promise(resolve => probe.close(resolve)); }
  }
}
module.exports = { start, stop, checkConnection };
