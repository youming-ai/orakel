# syntax=docker/dockerfile:1

ARG BUILD_UID=1000
ARG BUILD_GID=1000

FROM oven/bun:1-alpine AS deps
WORKDIR /app

COPY package.json bun.lock bun.workspaces ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/bot/package.json ./packages/bot/
COPY packages/web/package.json ./packages/web/

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM oven/bun:1-alpine AS release
ARG BUILD_UID
ARG BUILD_GID
ARG POLYMARKET_CLI_VERSION=v0.1.5

WORKDIR /app
RUN apk add --no-cache dumb-init curl
RUN curl -sSL -o /usr/local/bin/polymarket \
    "https://github.com/Polymarket/polymarket-cli/releases/download/${POLYMARKET_CLI_VERSION}/polymarket-linux-amd64" \
    && chmod +x /usr/local/bin/polymarket

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
COPY package.json bun.workspaces ./
COPY packages/shared packages/shared
COPY packages/bot packages/bot
COPY drizzle drizzle

USER bun
EXPOSE 9999
ENTRYPOINT ["dumb-init", "--"]
CMD ["bun", "run", "packages/bot/src/index.ts"]
