# ---------- 构建阶段 ----------
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# ---------- 运行阶段 ----------
FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    NOVELS_DIR=/data/novels \
    DATA_DIR=/data/app

COPY --from=build /app/package.json ./
COPY --from=build /app/bun.lock ./
COPY --from=build /app/src ./src
COPY --from=build /app/dist ./dist
RUN bun install --production --frozen-lockfile

EXPOSE 8080
VOLUME ["/data/novels", "/data/app"]

CMD ["bun", "src/server/index.ts"]