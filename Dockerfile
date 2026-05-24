FROM node:22-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

FROM deps AS build

COPY tsconfig.json ./
COPY tsconfig.build.json ./
COPY scripts/clean-dist.mjs ./scripts/clean-dist.mjs
COPY src-node ./src-node
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATABASE_PATH=/app/data/bot.sqlite
ENV IMPORT_DIR=/app/import
ENV GEOCODER_URL=https://nominatim.openstreetmap.org/search
ENV GEOCODER_ACCEPT_LANGUAGE=ru
ENV GEOCODER_COUNTRY_CODES=ru
ENV GEOCODER_CITY_BIAS=Москва
ENV GEOCODER_VIEWBOX=37.15,56.05,38.10,55.45
ENV GEOCODER_BOUNDED=true
ENV GEOCODER_TIMEOUT_MS=5000
ENV GEOCODER_MIN_INTERVAL_MS=1100

WORKDIR /app

RUN addgroup --system citydatebot \
  && adduser --system --ingroup citydatebot citydatebot \
  && mkdir -p /app/data /app/import \
  && chown -R citydatebot:citydatebot /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist-node ./dist-node
COPY package.json ./
COPY scripts/clean-dist.mjs ./scripts/clean-dist.mjs
COPY scripts/run-module.mjs ./scripts/run-module.mjs
COPY migrations ./migrations
COPY data/import ./import

USER citydatebot

EXPOSE 3000

CMD ["npm", "start"]
