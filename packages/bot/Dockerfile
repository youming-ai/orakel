# syntax=docker/dockerfile:1

ARG BUILD_UID=1000
ARG BUILD_GID=1000

FROM oven/bun:1-alpine AS deps
WORKDIR /app

COPY package.json bun.workspaces ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/bot/package.json ./packages/bot/
COPY packages/bot/bun.lock* ./packages/bot/ 2>/dev/null || true

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM oven/bun:1-alpine AS release
ARG BUILD_UID
ARG BUILD_GID

WORKDIR /app
RUN apk add --no-cache dumb-init

RUN if id bun >/dev/null 2>&1; then \
		CURRENT_UID=$(id -u bun) && \
		if [ "$CURRENT_UID" != "${BUILD_UID}" ]; then \
			deluser bun; \
			addgroup -g "${BUILD_GID}" -S bun && \
			adduser -u "${BUILD_UID}" -G bun -S -h /home/bun bun; \
		fi \
	else \
		addgroup -g "${BUILD_GID}" -S bun && \
		adduser -u "${BUILD_UID}" -G bun -S -h /home/bun bun; \
	fi

COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules 2>/dev/null || true
COPY package.json bun.workspaces ./
COPY packages/shared packages/shared
COPY packages/bot packages/bot
COPY drizzle drizzle 2>/dev/null || true

USER bun
EXPOSE 9999
ENTRYPOINT ["dumb-init", "--"]
CMD ["bun", "run", "packages/bot/src/index.ts"]
