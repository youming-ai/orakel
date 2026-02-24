FROM oven/bun:1-alpine AS bot-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/bun.lock* web/bun.lockb* ./
RUN bun install --frozen-lockfile
COPY web/ .
RUN bun run build

FROM oven/bun:1-alpine AS release
WORKDIR /app
RUN apk add --no-cache dumb-init
COPY --from=bot-deps /app/node_modules node_modules
COPY package.json bun.lock tsconfig.json config.json ./
COPY src src
COPY --from=web-build /app/web/dist web/dist
RUN mkdir -p /app/data && chown bun:bun /app/data
USER bun
EXPOSE 9999
ENTRYPOINT ["dumb-init", "--"]
CMD ["bun", "run", "src/index.ts"]
