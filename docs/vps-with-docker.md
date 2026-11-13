# Розгортання на VPS через Docker Compose

Рекомендований варіант для комерційної експлуатації. `compose.yaml` запускає Caddy, дві репліки `web` Next.js, PgBouncer у режимі transaction, PostgreSQL 17, одноразовий `migrate` та `backup`. Вебрепліки підключаються через PgBouncer, міграції та резервне копіювання — безпосередньо до PostgreSQL.

Вимоги: сервер Ubuntu/Debian із встановленими Node.js 24 та Docker Compose.

```sh
git clone https://github.com/amssster/ibanlink-keepincrm.git
cd ibanlink-keepincrm
npm ci
npm run secrets -- --write
```

Скрипт запитає новий пароль власника та автоматично згенерує файл `.env`.

Відредагуйте `.env`:
- `DOMAIN`: ваш зареєстрований домен (наприклад `pay.mybusiness.ua`).
- `APP_URL`: повна адреса з протоколом (`https://pay.mybusiness.ua`).

Запустіть сервіси:

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail 50 web
```

> Ідентифікатор проєкту Docker Compose — `iban-link`: він визначає імена контейнерів, мереж і томів даних.
>
> Том з базою даних має фіксовану назву `iban-payment_database` (історична назва першої інсталяції). Не перейменовуйте його: це призведе до втрати доступу до наявних даних.

Відкрийте `https://pay.mybusiness.ua/login` та увійдіть із створеним паролем. Caddy самостійно отримає безкоштовний сертифікат Let's Encrypt.

Інструкції з резервного копіювання та відновлення наведено в [README](../README.md#резервне-копіювання-docker).
