const { spawn } = require('node:child_process');
const path = require('node:path');
function runDriver({ printer, action = 'list', stockId = 0, owner = '0' }, { resourcesPath } = {}) {
  if (typeof printer !== 'string' || !printer.trim() || printer.length > 256 || /[\0\r\n]/.test(printer)) return Promise.reject(Error('Некорректное имя принтера.'));
  if (!['list', 'apply', 'edit'].includes(action) || !Number.isInteger(stockId) || stockId < 0 || stockId > 65535 || !/^\d+$/.test(owner)) return Promise.reject(Error('Некорректная операция с профилем бумаги.'));
  return new Promise((resolve, reject) => {
    const script = path.join(resourcesPath || __dirname, 'printer-driver.ps1');
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let output = '', error = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('Драйвер не ответил. Повторите попытку.')); }, action === 'edit' ? 15 * 60 * 1000 : 30000);
    child.stdout.on('data', chunk => { output += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { error += chunk.toString('utf8'); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.stdin.on('error', () => {});
    child.on('close', code => { clearTimeout(timer); if (!output.trim()) { reject(Error(`Драйвер завершил операцию без ответа (код ${code}). ${error.trim()}`)); return; } try { const result = JSON.parse(output.replace(/^\uFEFF/, '')); if (!result.ok) throw Error(result.error); resolve(result.data); } catch (e) { reject(Error(e.message || error || 'Не удалось прочитать настройки драйвера.')); } });
    child.stdin.end(JSON.stringify({ printer, action, stockId, owner }));
  });
}
module.exports = { runDriver };
