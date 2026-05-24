# City Date Bot

Telegram-бот для случайных прогулок, кофе, ужинов и культурных остановок в центре Москвы.

Текущий runtime сделан под слабый VPS: TypeScript, grammY, Fastify, SQLite, Drizzle, Zod и pino. SQLite лежит в Docker volume по пути `/app/data/bot.sqlite`, а места сначала собираются в CSV и импортируются одной командой.

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

Импорт создаёт базу, применяет миграции и делает upsert данных:

```bash
npm run db:import
```

Модель данных:

- категории вынесены в справочник;
- одна строка `places.csv` соответствует одной физической точке;
- сетевые точки вроде «Кофемания на Павелецкой» и «Кофемания на Якиманке» хранятся отдельными строками;
- категории хранятся через `place_categories.csv`, поэтому у места может быть несколько категорий;
- `opening_hours_text` и `opening_hours_json` относятся к конкретной точке;
- `source` и `source_url` нужны только для понимания происхождения места.

Runtime-схема SQLite намеренно короткая: `places`, `categories`, `place_categories`, `schema_migrations`. Подробные поля геокодинга, рейтингов и аудита остаются в CSV/скриптах подготовки данных, но не импортируются в базу бота.

## Run Locally

```bash
npm run dev
```

По умолчанию бот работает через polling. Fastify всё равно поднимает `/healthz`, чтобы контейнер было легко проверять.

Бот понимает адреса текстом: `Тверская 7`, `Пятницкая 25с1`, `Покровка 17`, а также несколько известных районов и ориентиров вроде `Павелецкая`, `Патрики`, `Цветной`, `Москва-Сити`. Для точных адресов бот строит нормализованный запрос вида `Москва, Тверская улица, 7` и принимает результат геокодера только если совпали Москва, улица, номер дома, bbox и точность результата. Сомнительные результаты уходят в подтверждение, а пользователю показывается короткий label, не сырой `display_name` геокодера.

После распознавания локации обычный nearby-поиск сначала считает прямое расстояние до мест из базы. Пеший маршрут строится только в карточке результата через ссылку на Яндекс Карты.

Для публичного `nominatim.openstreetmap.org` важно соблюдать usage policy: не делать autocomplete, ставить осмысленный `GEOCODER_USER_AGENT` и не превышать лимиты. Для продакшена лучше указать User-Agent с контактом:

```bash
GEOCODER_USER_AGENT=citydatebot/0.2 your-email@example.com
```

## Docker

Собрать и запустить контейнер:

```bash
docker compose build
docker compose run --rm bot npm run db:import
docker compose up bot
```

SQLite сохранится в volume `citydatebot-sqlite-data`.

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
