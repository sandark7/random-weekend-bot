# Random Weekend Bot

Telegram-бот для случайных прогулок, кофе, ужинов и культурных остановок в Москве и Краснодаре.

Текущий runtime сделан под слабый VPS: TypeScript, grammY, Fastify, SQLite, Drizzle, Zod и pino. SQLite лежит в Docker volume по пути `/app/data/bot.sqlite`, а места собираются в CSV и импортируются в runtime-базу при старте приложения.

## OpenSpec Flow

Активное изменение:

```text
openspec/changes/rewrite-runtime-typescript-sqlite/
```

Читать по порядку:

1. `proposal.md`
2. `specs/runtime/spec.md`
3. `specs/data/spec.md`
4. `design.md`
5. `tasks.md`

## Local Setup

```bash
npm install
cp .env.example .env
```

Заполните `BOT_TOKEN` в `.env`.

Для локального запуска SQLite можно оставить:

```bash
DATABASE_PATH=./data/bot.sqlite
IMPORT_DIR=./data/import
BOT_MODE=polling
```

## Data Import

CSV-файлы лежат в `data/import/`:

- `categories.csv`
- `places.csv`
- `place_categories.csv`

Приложение импортирует CSV при старте. Для ручной проверки импорт можно запустить отдельно:

```bash
npm run db:import
```

Модель данных:

- категории вынесены в справочник;
- одна строка `places.csv` соответствует одной физической точке;
- сетевые точки вроде «Кофемания на Павелецкой» и «Кофемания на Якиманке» хранятся отдельными строками;
- категории хранятся через `place_categories.csv`, поэтому у места может быть несколько категорий;
- `opening_hours_text` и `opening_hours_json` относятся к конкретной точке;
- `city_slug` можно указать явно (`moscow` или `krasnodar`), но если колонки нет или поле пустое, импорт выводит город по координатам внутри поддерживаемого bbox;
- `source` и `source_url` нужны только для понимания происхождения места.

Runtime-схема SQLite намеренно короткая для мест: `places`, `categories`, `place_categories`, `schema_migrations`. Дополнительно в этой же SQLite-базе живут технические таблицы `analytics_events` и `geocode_cache`. Подробные поля геокодинга, рейтингов и аудита остаются в CSV/скриптах подготовки данных, но не импортируются в `places`.

## Run Locally

```bash
npm run dev
```

По умолчанию бот работает через polling. Fastify всё равно поднимает `/healthz`, чтобы контейнер было легко проверять.

Бот понимает адреса текстом: `Тверская 7`, `Пятницкая 25с1`, `Покровка 17`, `Краснодар, Красная 50`, а также несколько известных районов и ориентиров вроде `Павелецкая`, `Патрики`, `Цветной`, `Москва-Сити`, `Парк Краснодар`. Для точных адресов бот строит нормализованный запрос вида `Москва, Тверская улица, 7` или `Краснодар, Красная улица, 50` и принимает результат геокодера только если совпали город, улица, номер дома, bbox и точность результата. Сомнительные результаты уходят в подтверждение, а пользователю показывается короткий label, не сырой `display_name` геокодера.

После распознавания локации обычный nearby-поиск сначала считает прямое расстояние до мест из базы. Пеший маршрут строится только в карточке результата через ссылку на Яндекс Карты.

Для публичного `nominatim.openstreetmap.org` важно соблюдать usage policy: не делать autocomplete, ставить осмысленный `GEOCODER_USER_AGENT` и не превышать лимиты. Для продакшена лучше указать User-Agent с контактом:

```bash
GEOCODER_USER_AGENT=RandomWeekendBot/0.2 your-email@example.com
```

Результаты геокодинга кэшируются в SQLite-таблице `geocode_cache`, включая отрицательные ответы. Это ускоряет повторные адреса и снижает нагрузку на Nominatim после рестартов контейнера.

## Analytics

Продуктовая аналитика пишется локально в SQLite-таблицу `analytics_events`; pino остаётся техническим логгером. В событиях нет сырых `user_id`, `chat_id`, адресов и точных пользовательских координат: id хэшируются через `ANALYTICS_SALT`, координаты округляются, город хранится как `citySlug`.

```bash
ANALYTICS_ENABLED=true
ANALYTICS_SALT=change-me-long-random-string
APP_VERSION=0.2.0
```

Сводка по последним 24 часам и 7 дням:

```bash
npm run analytics:summary
```

## Docker

Собрать и запустить контейнер:

```bash
docker compose up -d --build bot
```

При старте контейнер применит миграции и импортирует `data/import/*.csv` в SQLite. SQLite сохранится в volume `random-weekend-bot-sqlite-data`.

Проверить запуск:

```bash
docker compose logs --tail=80 bot
docker compose exec -T bot node -e "fetch('http://127.0.0.1:3000/healthz').then(async r => console.log(r.status, await r.text()))"
```

Webhook-режим для сервера:

```bash
BOT_MODE=webhook
WEBHOOK_URL=https://example.com/telegram/webhook
WEBHOOK_SECRET=replace-with-random-secret
```

## Telegram Desktop

Кнопка отправки локации надёжно работает на телефоне, но Telegram Desktop часто не отдаёт GPS-локацию с keyboard-кнопки. Поэтому бот поддерживает ручной ввод адреса:

```text
Тверская 7
```

Координаты текстом тоже поддерживаются как технический fallback, но основной пользовательский сценарий теперь адрес.

## Verification

```bash
npm test
npm run build
```
