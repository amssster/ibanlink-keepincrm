# Локальна розробка та тестування

Використовуйте Node.js 24 (така версія використовується в `Dockerfile`), npm і Docker Compose. `npm run secrets` показує пароль під час введення, тому запускайте його в приватному терміналі.

1. Підготуйте залежності, конфігурацію та згенеруйте локальні секрети:
   ```sh
   npm ci
   cp compose.local.example.yaml compose.local.yaml
   npm run secrets -- --local --write
   ```
2. Підніміть локальний PostgreSQL:
   ```sh
   docker compose -f compose.yaml -f compose.local.yaml --profile dev up -d db
   ```
3. Застосуйте міграції бази даних:
   ```sh
   npm run migrate
   ```
4. Запустіть сервіс у режимі розробки:
   ```sh
   npm run dev
   ```
5. Створіть окрему тестову базу на локальному PostgreSQL та налаштуйте `.env.test`. Приклад нижче використовує `POSTGRES_USER=iban` та `POSTGRES_DB=iban`; для інших значень із `.env` замініть їх у команді та URL. Пароль у URL має збігатися з `POSTGRES_PASSWORD` із `.env`:
   ```sh
   docker compose -f compose.yaml -f compose.local.yaml exec db createdb -U iban -O iban iban_test
   cp .env.test.example .env.test
   ```
   Відредагуйте `TEST_DATABASE_URL` у `.env.test`, підставивши локальний пароль. База має бути окремою, а її назва закінчуватися на `_test` або `_e2e`. Тести змінюють і очищують дані; ніколи не використовуйте робочу базу, навіть перейменовану. Змінні, вже задані в середовищі, можуть мати пріоритет над `.env.test`.
6. Встановіть браузер для E2E та запустіть перевірки:
   ```sh
   npx playwright install chromium
   npm test
   npm run test:e2e
   npm run typecheck
   npm run lint
   ```
   E2E запускає окремий dev-сервер на `localhost:3100`, застосовує міграції й очищує тестові таблиці. Порт має бути вільним; не запускайте одночасно інші тести, що використовують цю базу. На Linux можуть знадобитися системні залежності Playwright.
