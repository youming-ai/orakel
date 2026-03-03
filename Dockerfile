# syntax=docker/dockerfile:1

ARG BUILD_UID=1000
ARG BUILD_GID=1000

# Backend dependencies
FROM oven/bun:1-alpine AS bot-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

# Frontend builder
FROM oven/bun:1-alpine AS web-builder
WORKDIR /web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY web/tsconfig.json web/vite.config.ts web/index.html ./
COPY web/src ./src
RUN bun run build

# Final release image
FROM oven/bun:1-alpine AS release
ARG BUILD_UID
ARG BUILD_GID

WORKDIR /app
RUN apk add --no-cache dumb-init

# Create user with matching UID/GID to avoid permission issues with mounted volumes
# If bun user already exists with different UID, we need to delete and recreate
RUN if id bun >/dev/null 2>&1; then \
		# Get current UID of bun user
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

COPY --from=bot-deps /app/node_modules node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src src

# Copy frontend build output
COPY --from=web-builder /web/dist ./web/dist

# Create data directory with correct ownership
RUN mkdir -p /app/data && chown -R bun:bun /app/data

USER bun
EXPOSE 9999
ENTRYPOINT ["dumb-init", "--"]
CMD ["bun", "run", "src/index.ts"]
