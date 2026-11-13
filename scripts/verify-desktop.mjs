import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { listPackage } = require('@electron/asar');
const resources = 'release/win-unpacked/resources';
const config = readFileSync(`${resources}/app-update.yml`, 'utf8');
if (!config.includes('owner: trytocry') || !config.includes('repo: Doodka-scan') || /token\s*:/i.test(config)) throw Error('Некорректный адрес обновлений');
const entries = listPackage(`${resources}/app.asar`).map(p => p.replaceAll('\\', '/'));
if (!entries.some(p => p.endsWith('/node_modules/electron-updater/package.json'))) throw Error('В сборке отсутствует electron-updater');
for (const asset of ['/splash.html', '/app/assets/splash-glass.png', '/app/assets/app-icon.png', '/app/assets/CinzelDecorative-Regular.ttf']) {
  if (!entries.includes(asset)) throw Error(`В сборке отсутствует ${asset}`);
}
if (!existsSync('release/win-unpacked/QR Duplicator.exe')) throw Error('EXE не найден');
console.log('Проверены EXE, встроенный updater и адрес GitHub Releases.');
