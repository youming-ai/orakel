# Deployment Guide

## 1. Quick Start

### 1.1 Prerequisites

- Bun v1.0+ (https://bun.sh/)
- Docker + Docker Compose (containerized deployment)
- OrbStack (macOS recommended) or Docker Desktop

### 1.2 Docker Deployment (Recommended)

```bash
git clone https://github.com/youming-ai/orakel.git
cd orakel
cp .env.example .env
docker compose up --build
```

Visit http://localhost:9998 to view the web dashboard.

### 1.3 Remote Access (Using Tunnel)

Recommended to use Cloudflare Tunnel, frp, or ngrok to expose local port:

```bash
# Cloudflare Tunnel (recommended)
cloudflare tunnel --url http://localhost:9998

# frp
frp tcp --local-port 9998 --remote-port 6000

# ngrok
ngrok http 9998
```

The bot API is available at http://localhost:9999.

### 1.4 Local Development (Optional)

```bash
bun install
cd web && bun install && cd ..
cp .env.example .env
# Terminal 1: Bot
bun run start
# Terminal 2: Web dev server
cd web && bun run dev
```

---

## 2. Docker Architecture

### 2.1 Dockerfile (Multi-stage Build)

Dockerfile divided into two stages:

1. **bot-deps** (`oven/bun:1-alpine`): Installs production dependencies using frozen lockfile
2. **release** (`oven/bun:1-alpine`):
   - Installs `dumb-init` for signal handling
   - Creates user via build args `BUILD_UID` / `BUILD_GID` (default 1000)
   - Copies: `node_modules`, source code
   - Creates `data` directory with correct ownership
   - Runs as non-root user (`bun`)
   - Exposes port 9999
   - Entry point: `dumb-init` → `bun run src/index.ts`

### 2.2 docker-compose.yml

The compose file defines two services: `bot` (backend) and `web` (frontend):

```yaml
services:
  bot:
    # Use pre-built image (CI/CD) or local build
    image: ${IMAGE_TAG:-orakel-bot:local}
    build:
      context: .
      args:
        - BUILD_UID=${UID:-1000}
        - BUILD_GID=${GID:-1000}
    env_file: .env
    environment:
      - PAPER_MODE=${PAPER_MODE:-true}
      - CORS_ORIGIN=${CORS_ORIGIN:-http://localhost:9998}
    ports:
      - "9999:9999"
    volumes:
      - ./data:/app/data                       # Persistent data
      - ./config.json:/app/config.json:ro      # Config (read-only)
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost:9999/api/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    networks:
      - orakel-network

  web:
    image: ${WEB_IMAGE_TAG:-orakel-web:local}
    build:
      context: ./web
    ports:
      - "${WEB_PORT:-9998}:80"
    restart: unless-stopped
    depends_on:
      - bot
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost:80/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5s
    networks:
      - orakel-network

networks:
  orakel-network:
    driver: bridge
```

### 2.3 Data Persistence

Volume mount `./data:/app/data` persists:

- `bot.sqlite` — Trade records, signals, paper trades, daily stats, paper state
- `paper-daily-state.json` — Legacy daily state
- `live-daily-state.json` — Legacy daily state
- `api-creds.json` — Derived API credentials (permissions 0o600)

---

## 3. Environment Variables

### 3.1 Complete Variable Table

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PAPER_MODE` | boolean | false | Enable paper trading at startup |
| `API_PORT` | number | 9999 | API service port |
| `API_TOKEN` | string | "" | API authentication token (protects write operations) |
| `ACTIVE_MARKETS` | string (CSV) | "" | Enabled markets (e.g., `"BTC,ETH,SOL,XRP"`, empty = all) |
| `LOG_LEVEL` | enum | info | Log level (`debug`/`info`/`warn`/`error`/`silent`) |
| `PERSIST_BACKEND` | enum | sqlite | Write backend (`sqlite`/`csv`/`dual`) |
| `READ_BACKEND` | enum | sqlite | Read backend (`sqlite`/`csv`) |
| `POLYMARKET_SLUG` | string | "" | Polymarket market slug |
| `POLYMARKET_AUTO_SELECT_LATEST` | boolean | true | Auto-select latest market |
| `POLYMARKET_LIVE_WS_URL` | string | `wss://ws-live-data.polymarket.com` | Live data WebSocket |
| `POLYMARKET_UP_LABEL` | string | Up | UP outcome label |
| `POLYMARKET_DOWN_LABEL` | string | Down | DOWN outcome label |
| `POLYGON_RPC_URL` | string | `https://polygon-rpc.com` | Polygon RPC primary endpoint |
| `POLYGON_RPC_URLS` | string (CSV) | "" | Polygon RPC fallback list |
| `POLYGON_WSS_URL` | string | "" | Polygon WebSocket primary endpoint |
| `POLYGON_WSS_URLS` | string (CSV) | "" | Polygon WebSocket fallback list |
| `CHAINLINK_BTC_USD_AGGREGATOR` | string | "" | Chainlink BTC/USD aggregator address |
| `HTTPS_PROXY` | string | "" | HTTP proxy |
| `PRIVATE_KEY` | string | "" | 64-digit hex private key (optional `0x` prefix, auto-connects wallet at startup) |
| `CORS_ORIGIN` | string | `*` | CORS allowed origin (recommend setting to frontend domain in production) |

### 3.2 Security Notes

- `PRIVATE_KEY`: 64-digit hex private key (optional `0x` prefix), auto-connects wallet for live trading at startup
- `CORS_ORIGIN`: CORS allowed origin (default `*`, recommend setting to frontend domain in production)
- `API_TOKEN` protects all write operations (POST/PUT), recommend setting in production
- `api-creds.json` stored with 0o600 permissions, contains derived API credentials

---

## 4. CI/CD (.github/workflows/ci.yml)

### 4.1 Triggers

- Push to `main` branch
- Pull Request to `main` branch
- Concurrency control: In-flight jobs for same ref are canceled

### 4.2 Pipeline Steps

**Job 1: check** (Lint · Typecheck · Test)

1. Checkout code
2. Install Bun (latest version)
3. Install dependencies (frozen lockfile)
4. `bunx biome lint src/` — Code linting (stricter than `bun run lint`)
5. `bunx tsc --noEmit -p tsconfig.check.json` — Type checking (excludes test files)
6. `bun run test` — Run all vitest tests

**Job 2: docker** (Docker build, depends on check passing)

1. Checkout code
2. `docker build -t orakel:ci .` — Build Docker image

### 4.3 Local Pre-check

Before pushing, run:

```bash
bun run lint && bun run typecheck && bun run test
```

---

## 5. Configuration Management

### 5.1 config.json

Strategy and risk parameters, see [Backend Documentation](./backend.md#3-core-layer).

### 5.2 Hot Reload

- `config.json` changes auto-detected (`fs.watch`)
- Zod re-validation
- No service restart needed

### 5.3 Update via API

```bash
curl -X PUT http://localhost:9999/api/config \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"strategy": {"edgeThresholdEarly": 0.06}}'
```

---

## 6. Development Commands

### 6.1 Backend Commands

| Command | Description |
|---------|-------------|
| `bun run start` | Start bot (`src/index.ts`, port 9999) |
| `bun run typecheck` | TypeScript type checking (includes test files) |
| `bun run typecheck:ci` | CI type checking (excludes test files) |
| `bun run lint` | Biome check (lint + format) |
| `bun run lint:fix` | Biome auto-fix |
| `bun run format` | Biome formatting |
| `bun run test` | Run all tests (vitest) |
| `bun run test:watch` | Test watch mode |
| `bunx vitest run src/utils.test.ts` | Run single test file |
| `bunx vitest run -t "clamp"` | Run tests matching name |

### 6.2 Frontend Commands

| Command | Description |
|---------|-------------|
| `cd web && bun run dev` | Start frontend dev server |
| `cd web && bun run build` | Build frontend |
| `cd web && bun install` | Install frontend dependencies |

### 6.3 Docker Commands

| Command | Description |
|---------|-------------|
| `docker compose up --build` | Build and start |
| `docker compose up -d` | Start in background |
| `docker compose down` | Stop and remove |
| `docker compose logs -f bot` | View bot logs |
| `docker compose restart bot` | Restart bot |

---

## 7. Operations

### 7.1 Health Check

```bash
curl http://localhost:9999/api/health
# { "ok": true, "timestamp": "...", "uptime": 3600, "memory": {...} }
```

### 7.2 Database Diagnostics

```bash
curl http://localhost:9999/api/db/diagnostics
# { "ok": true, "diagnostics": { "dbPath": "...", "dbSize": ..., ... } }
```

### 7.3 Log Levels

Control via `LOG_LEVEL` environment variable:

| Level | Description |
|-------|-------------|
| `debug` | Detailed diagnostic information |
| `info` | Normal operation (default) |
| `warn` | Recoverable issues |
| `error` | Failures |
| `silent` | Silent |

### 7.4 Troubleshooting

- **Database permissions**: Ensure `data/` directory UID/GID matches container user (`BUILD_UID`/`BUILD_GID`)
- **Port conflicts**: Change `API_PORT` environment variable
- **RPC connection failures**: Add fallback RPCs to `POLYGON_RPC_URLS`
- **WebSocket disconnects**: Auto-reconnect (exponential backoff, max 10s)
- **Invalid config**: Check logs for Zod validation errors, falls back to defaults

---

## 8. CI/CD Auto-Deployment (VPS)

### 8.1 Deployment Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────┐
│   GitHub Push   │ ───> │  GitHub Actions  │ ───> │     VPS     │
│   (main branch) │      │  (Build + Push)  │      │ (Pull + Run)│
└─────────────────┘      └──────────────────┘      └─────────────┘
```

### 8.2 GitHub Secrets Configuration

Go to GitHub repo **Settings → Secrets and variables → Actions**, add these Secrets:

| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `VPS_HOST` | VPS IP address | `123.45.67.89` |
| `VPS_PORT` | SSH port (optional) | `22` |
| `VPS_USER` | SSH username | `root` or `ubuntu` |
| `VPS_SSH_KEY` | SSH private key | `cat ~/.ssh/id_rsa` |
| `VPS_DEPLOY_PATH` | Project path on VPS | `~/orakel` |

#### Getting SSH Private Key

```bash
# From local machine
cat ~/.ssh/id_rsa
# or
cat ~/.ssh/id_ed25519
```

Copy full content (including `-----BEGIN` and `-----END` lines) and paste to GitHub Secret.

### 8.3 VPS Initial Setup

Before first deployment, prepare environment on VPS:

```bash
# 1. Install Docker and Docker Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 2. Login to GitHub Container Registry
# Create PAT in GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
# Permissions: read:packages, write:packages
echo "<YOUR_GITHUB_PAT>" | docker login ghcr.io -u <YOUR_GITHUB_USERNAME> --password-stdin

# 3. Clone repository
git clone https://github.com/<your-username>/orakel.git ~/orakel
cd ~/orakel

# 4. Configure environment
cp .env.example .env
nano .env
mkdir -p data

# 5. First start
docker compose up -d
```

### 8.4 Auto-Deployment Flow

After setup above, **every push to `main` branch auto-deploys**:

```bash
git add .
git commit -m "feat: new feature"
git push origin main
```

GitHub Actions will automatically:
1. Run tests and lint
2. Build Docker image (fast in CI environment)
3. Push to GitHub Container Registry
4. SSH to VPS to pull latest image
5. Restart container

### 8.5 Manual Deployment

**Method 1: GitHub UI**
- Go to Actions tab
- Select "Deploy to VPS" workflow
- Click "Run workflow"

**Method 2: VPS Manual Pull**
```bash
cd ~/orakel
./scripts/vps-deploy.sh ghcr.io/<username>/orakel:<commit-sha>
```

### 8.6 Troubleshooting

| Issue | Solution |
|-------|----------|
| SSH connection fails | Check Secret configuration, confirm VPS firewall allows SSH |
| Docker login fails | Check GITHUB_TOKEN permissions, confirm Workflow permissions enabled |
| Slow image pull | Configure Docker image acceleration (see below) |
| Container startup fails | `docker compose logs -f` to view logs |

**Docker Image Acceleration (for domestic VPS):**
```bash
sudo nano /etc/docker/daemon.json
```
```json
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn"
  ]
}
```
```bash
sudo systemctl restart docker
```

### 8.7 Rollback Version

```bash
# View available images
docker images "ghcr.io/<username>/orakel" --format "table {{.Tag}}\t{{.CreatedAt}}"

# Rollback to specific version
export IMAGE_TAG="ghcr.io/<username>/orakel:<commit-sha>"
docker compose up -d
```
