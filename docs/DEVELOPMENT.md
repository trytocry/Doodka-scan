# Разработка QR Duplicator

Нужен Node.js 22. Команды приведены для Windows:

```powershell
npm ci
npm ci --prefix desktop
npm run dev
```

Для сборки настольной версии и проверок:

```powershell
npm run desktop:dir
npx playwright install chromium
npm test
npm run desktop:package
```

Сборка интерфейса находится в `dist/`, установщики — в `release/`. Зависимости и локальные сборки в Git не включаются. `npm test` проверяет обновления, QR/Data Matrix, сохранение данных маркировки, PDF, мобильную передачу и параметры печати. Тесты не отправляют задания настоящему принтеру.

## Выпуск новой версии

1. Измените версии в `package.json` и `desktop/package.json`, обновите оба lock-файла через `npm install --package-lock-only` и `npm install --prefix desktop --package-lock-only`.
2. Обновите `RELEASE_NOTES.md` и `CHANGELOG.md`, закоммитьте и отправьте изменения.
3. Создайте тег, совпадающий с версией настольного приложения, например `v1.5.3`, и отправьте его:

```powershell
git tag v1.5.3
git push origin main
git push origin v1.5.3
```

GitHub Actions запускает тесты, собирает Setup и Portable, загружает EXE, blockmap и `latest.yml` в черновик релиза и лишь затем публикует его. Приложения увидят новую стабильную версию автоматически. Не перезаписывайте опубликованный релиз: исправления выпускаются новым номером версии.

Токены GitHub не входят в программу и исходники. Workflow использует штатный `github.token` только во время публикации. Пользователю приложения вход в GitHub не нужен.

Физическая печать на TSC TE200 и работа камеры конкретного телефона проверяются на месте. Автотесты проверяют данные и раскладку, но не заменяют контрольную распечатку.

