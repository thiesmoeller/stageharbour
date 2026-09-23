FROM node:24-bookworm-slim AS build
WORKDIR /app
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 STORAGE_DIR=/data/storage APP_VERSION=$APP_VERSION
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev && npm cache clean --force \
    && mkdir -p /data/storage && chown node:node /data/storage
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/server/db/migrate.js && exec node dist/server/main.js"]
