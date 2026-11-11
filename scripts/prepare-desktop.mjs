import { cp, readFile, writeFile } from 'node:fs/promises';
await cp('dist', 'desktop/app', { recursive: true });
const file = 'desktop/app/index.html';
let html = await readFile(file, 'utf8');
html = html.replace('Фотографии не отправляются на сервер. Подключение принтера не требуется.', 'Фото обрабатываются на этом компьютере. Передача с телефона — по локальной сети.');
// В настольной версии фотографии выбираются из файлов.
html = html.replace('<label class="button secondary" for="camera">Сфотографировать</label>', '');
await writeFile(file, html);
