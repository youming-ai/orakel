# 部署指南

## 1. 快速开始

### 1.1 前置要求

- Bun v1.0+ (https://bun.sh/)
- Docker + Docker Compose (容器化部署)
- OrbStack (macOS 推荐) 或 Docker Desktop

### 1.2 Docker 部署 (推荐)

```bash
git clone https://github.com/youming-ai/orakel.git
cd orakel
cp .env.example .env
docker compose up --build
```

- Bot API: http://localhost:9999
- Web 前端: http://localhost:9998 (如已配置 web 服务)

### 1.3 本地开发

```bash
bun install
cd web && bun install && cd ..
cp .env.example .env
# Terminal 1: Bot
bun run start
# Terminal 2: Web 开发服务器
cd web && bun run dev
```

---

## 2. Docker 架构

### 2.1 Dockerfile (多阶段构建)

Dockerfile 分为三个阶段:

1. **bot-deps** (`oven/bun:1-alpine`): 使用冻结锁文件安装生产依赖
2. **web-build** (`oven/bun:1-alpine`): 安装前端依赖并构建静态资源 (`bun run build`)
3. **release** (`oven/bun:1-alpine`):
   - 安装 `dumb-init` 处理进程信号
   - 通过构建参数 `BUILD_UID` / `BUILD_GID` (默认 1000) 创建用户
   - 复制: `node_modules`、源码、构建后的前端资源
   - 创建 `data` 目录并设置正确归属
   - 以非 root 用户 (`bun`) 运行
   - 暴露端口 9999
   - 入口点: `dumb-init` → `bun run src/index.ts`

### 2.2 docker-compose.yml

```yaml
services:
  bot:
    build:
      context: .
      args:
        - BUILD_UID=${UID:-1000}
        - BUILD_GID=${GID:-1000}
    env_file: .env
    environment:
      - PAPER_MODE=${PAPER_MODE:-true}
    ports:
      - "9999:9999"
    volumes:
      - ./data:/app/data                       # 持久化数据
      - ./config.json:/app/config.json:ro      # 配置 (只读)
    restart: unless-stopped
    healthcheck:
      test: wget -q --spider http://localhost:9999/api/health || exit 1
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
```

关键说明:

- `BUILD_UID` / `BUILD_GID` 与宿主机用户匹配, 避免卷挂载权限问题
- `data/` 卷持久化 SQLite 数据库和每日状态
- `config.json` 以只读方式挂载 (文件监听热重载仍然有效)
- 健康检查通过 `/api/health` 端点
- `PAPER_MODE` 默认为 `true` (安全默认值)

### 2.3 数据持久化

卷挂载 `./data:/app/data` 持久化以下内容:

- `bot.sqlite` — 交易记录、信号、模拟交易、每日统计、模拟状态
- `paper-daily-state.json` — 遗留每日状态
- `live-daily-state.json` — 遗留每日状态
- `api-creds.json` — 派生的 API 凭证 (权限 0o600)

---

## 3. 环境变量

### 3.1 完整变量表

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `PAPER_MODE` | boolean | false | 启动时是否启用模拟交易 |
| `API_PORT` | number | 9999 | API 服务端口 |
| `API_TOKEN` | string | "" | API 认证令牌 (保护写操作) |
| `ACTIVE_MARKETS` | string (CSV) | "" | 启用市场 (如 `"BTC,ETH,SOL,XRP"`, 空=全部) |
| `LOG_LEVEL` | enum | info | 日志级别 (`debug`/`info`/`warn`/`error`/`silent`) |
| `PERSIST_BACKEND` | enum | sqlite | 写入后端 (`sqlite`/`csv`/`dual`) |
| `READ_BACKEND` | enum | sqlite | 读取后端 (`sqlite`/`csv`) |
| `POLYMARKET_SLUG` | string | "" | Polymarket 市场 slug |
| `POLYMARKET_AUTO_SELECT_LATEST` | boolean | true | 自动选择最新市场 |
| `POLYMARKET_LIVE_WS_URL` | string | `wss://ws-live-data.polymarket.com` | 实时数据 WebSocket |
| `POLYMARKET_UP_LABEL` | string | Up | UP 结果标签 |
| `POLYMARKET_DOWN_LABEL` | string | Down | DOWN 结果标签 |
| `POLYGON_RPC_URL` | string | `https://polygon-rpc.com` | Polygon RPC 主端点 |
| `POLYGON_RPC_URLS` | string (CSV) | "" | Polygon RPC 备用列表 |
| `POLYGON_WSS_URL` | string | "" | Polygon WebSocket 主端点 |
| `POLYGON_WSS_URLS` | string (CSV) | "" | Polygon WebSocket 备用列表 |
| `CHAINLINK_BTC_USD_AGGREGATOR` | string | "" | Chainlink BTC/USD 聚合器地址 |
| `HTTPS_PROXY` | string | "" | HTTP 代理 |

### 3.2 安全说明

- 实盘交易通过 Web 界面连接钱包, 不再支持 `PRIVATE_KEY` 环境变量
- `API_TOKEN` 保护所有写操作 (POST/PUT), 建议在生产环境设置
- `api-creds.json` 以 0o600 权限存储, 包含派生的 API 凭证

---

## 4. CI/CD (.github/workflows/ci.yml)

### 4.1 触发条件

- Push 到 `main` 分支
- 向 `main` 分支发起 Pull Request
- 并发控制: 同一 ref 的进行中任务会被取消

### 4.2 Pipeline 步骤

**Job 1: check** (Lint · Typecheck · Test)

1. Checkout 代码
2. 安装 Bun (最新版)
3. 安装依赖 (冻结锁文件)
4. `bunx biome lint src/` — 代码检查 (比 `bun run lint` 更严格)
5. `bunx tsc --noEmit -p tsconfig.check.json` — 类型检查 (排除测试文件)
6. `bun run test` — 运行所有 vitest 测试

**Job 2: docker** (Docker 构建, 依赖 check 通过)

1. Checkout 代码
2. `docker build -t orakel:ci .` — 构建 Docker 镜像

### 4.3 本地预检

推送前运行:

```bash
bun run lint && bun run typecheck && bun run test
```

---

## 5. 配置管理

### 5.1 config.json

策略和风险参数, 详见 [后端文档](./backend.md#4-配置系统-srcconfigts)。

### 5.2 热重载

- `config.json` 变更自动检测 (`fs.watch`)
- Zod 重新验证
- 无需重启服务

### 5.3 通过 API 更新

```bash
curl -X PUT http://localhost:9999/api/config \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"strategy": {"edgeThresholdEarly": 0.06}}'
```

---

## 6. 开发命令

### 6.1 后端命令

| 命令 | 说明 |
|------|------|
| `bun run start` | 启动 bot (`src/index.ts`, port 9999) |
| `bun run typecheck` | TypeScript 类型检查 (含测试文件) |
| `bun run typecheck:ci` | CI 类型检查 (排除测试文件) |
| `bun run lint` | Biome 检查 (lint + format) |
| `bun run lint:fix` | Biome 自动修复 |
| `bun run format` | Biome 格式化 |
| `bun run test` | 运行所有测试 (vitest) |
| `bun run test:watch` | 测试监听模式 |
| `bunx vitest run src/utils.test.ts` | 运行单个测试文件 |
| `bunx vitest run -t "clamp"` | 按名称匹配运行测试 |

### 6.2 前端命令

| 命令 | 说明 |
|------|------|
| `cd web && bun run dev` | 启动前端开发服务器 (port 9998) |
| `cd web && bun run build` | 构建前端 |
| `cd web && bun install` | 安装前端依赖 |

### 6.3 Docker 命令

| 命令 | 说明 |
|------|------|
| `docker compose up --build` | 构建并启动 |
| `docker compose up -d` | 后台启动 |
| `docker compose down` | 停止并移除 |
| `docker compose logs -f bot` | 查看 bot 日志 |
| `docker compose restart bot` | 重启 bot |

---

## 7. 运维

### 7.1 健康检查

```bash
curl http://localhost:9999/api/health
# { "ok": true, "timestamp": "...", "uptime": 3600, "memory": {...} }
```

### 7.2 数据库诊断

```bash
curl http://localhost:9999/api/db/diagnostics
# { "ok": true, "diagnostics": { "dbPath": "...", "dbSize": ..., ... } }
```

### 7.3 日志级别

通过 `LOG_LEVEL` 环境变量控制:

| 级别 | 说明 |
|------|------|
| `debug` | 详细诊断信息 |
| `info` | 正常操作 (默认) |
| `warn` | 可恢复问题 |
| `error` | 失败 |
| `silent` | 静默 |

### 7.4 故障排除

- **数据库权限**: 确保 `data/` 目录的 UID/GID 匹配容器用户 (`BUILD_UID`/`BUILD_GID`)
- **端口冲突**: 修改 `API_PORT` 环境变量
- **RPC 连接失败**: 添加备用 RPC 到 `POLYGON_RPC_URLS`
- **WebSocket 断连**: 自动重连 (指数退避, 最大 10s)
- **配置无效**: 查看日志中的 Zod 验证错误, 回退到默认值

---

## 8. CI/CD 自动化部署 (VPS)

### 8.1 部署架构

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────┐
│   GitHub Push   │ ───> │  GitHub Actions  │ ───> │     VPS     │
│   (main branch) │      │  (Build + Push)  │      │ (Pull + Run)│
└─────────────────┘      └──────────────────┘      └─────────────┘
```

### 8.2 GitHub Secrets 配置

进入 GitHub 仓库 **Settings → Secrets and variables → Actions**，添加以下 Secrets:

| Secret 名称 | 说明 | 示例值 |
|------------|------|--------|
| `VPS_HOST` | VPS IP 地址 | `123.45.67.89` |
| `VPS_PORT` | SSH 端口（可选） | `22` |
| `VPS_USER` | SSH 用户名 | `root` 或 `ubuntu` |
| `VPS_SSH_KEY` | SSH 私钥 | `cat ~/.ssh/id_rsa` |
| `VPS_DEPLOY_PATH` | VPS 上项目路径 | `~/orakel` |

#### 获取 SSH 私钥

```bash
# 从本地电脑
cat ~/.ssh/id_rsa
# 或
cat ~/.ssh/id_ed25519
```

复制完整内容（包括 `-----BEGIN` 和 `-----END` 行）粘贴到 GitHub Secret。

### 8.3 VPS 初始设置

第一次部署前，在 VPS 上准备环境：

```bash
# 1. 安装 Docker 和 Docker Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 2. 登录到 GitHub Container Registry
# 在 GitHub Settings → Developer settings → Personal access tokens → Tokens (classic) 创建 PAT
# 权限: read:packages, write:packages
echo "<YOUR_GITHUB_PAT>" | docker login ghcr.io -u <YOUR_GITHUB_USERNAME> --password-stdin

# 3. 克隆仓库
git clone https://github.com/<your-username>/orakel.git ~/orakel
cd ~/orakel

# 4. 配置环境
cp .env.example .env
nano .env
mkdir -p data

# 5. 首次启动
docker compose up -d
```

### 8.4 自动部署流程

完成上述设置后，**每次推送到 `main` 分支会自动部署**：

```bash
git add .
git commit -m "feat: new feature"
git push origin main
```

GitHub Actions 会自动：
1. 运行测试和 lint
2. 构建 Docker 镜像（在 CI 环境，速度快）
3. 推送到 GitHub Container Registry
4. SSH 到 VPS 拉取最新镜像
5. 重启容器

### 8.5 手动部署

**方式 1: GitHub UI**
- 进入 Actions 标签页
- 选择 "Deploy to VPS" workflow
- 点击 "Run workflow"

**方式 2: VPS 手动拉取**
```bash
cd ~/orakel
./scripts/vps-deploy.sh ghcr.io/<username>/orakel:<commit-sha>
```

### 8.6 故障排查

| 问题 | 解决方案 |
|------|----------|
| SSH 连接失败 | 检查 Secret 配置，确认 VPS 防火墙允许 SSH |
| Docker 登录失败 | 检查 GITHUB_TOKEN 权限，确认 Workflow permissions 已启用 |
| 镜像拉取缓慢 | 配置 Docker 镜像加速（见下方） |
| 容器启动失败 | `docker compose logs -f` 查看日志 |

**Docker 镜像加速（国内 VPS）：**
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

### 8.7 回滚版本

```bash
# 查看可用镜像
docker images "ghcr.io/<username>/orakel" --format "table {{.Tag}}\t{{.CreatedAt}}"

# 回滚到特定版本
export IMAGE_TAG="ghcr.io/<username>/orakel:<commit-sha>"
docker compose up -d
```
