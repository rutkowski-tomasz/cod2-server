# mapview for serving `mapview.js live` (stacks/livemap); build from the repository root:
# docker build -f tools/mapview/Dockerfile .
FROM oven/bun:1-alpine AS deps
WORKDIR /app/tools/mapview
COPY tools/mapview/package.json tools/mapview/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM node:24-alpine
WORKDIR /app
COPY tools/shared tools/shared
COPY tools/mapview tools/mapview
COPY --from=deps /app/tools/mapview/node_modules tools/mapview/node_modules
ENTRYPOINT ["node", "tools/mapview/mapview.js"]
