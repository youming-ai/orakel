# 开发与部署指南

本文档详细说明 Orakel 项目的本地开发流程和生产环境部署流程。

---

## 目录

1. [前置要求](#1-前置要求)
2. [本地开发](#2-本地开发)
3. [Docker 部署](#3-docker-部署)
4. [生产环境部署](#4-生产环境部署)
5. [前端部署](#5-前端部署)
6. [故障排查](#6-故障排查)

---

## 1. 前置要求

### 1.1 必需软件

| 软件 | 版本要求 | 用途 |
|------|----------|------|
| Bun | v1.0+ | JavaScript 运行时 |
| Node.js | v18+ | 前端构建依赖 |
| Docker | 20.10+ | 容器化部署 |
| Docker Compose | 2.0+ | 多容器编排 |

### 1.2 安装 Bun

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# 验证安装
bun --version
```

### 1.3 安装 Docker

**macOS (推荐 OrbStack):**
```bash
brew install orbstack
```

**Ubuntu/Debian:**
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

---

## 2. 本地开发

### 2.1 项目初始化

```bash
# 克隆仓库
git clone https://github.com/youming-ai/orakel.git
cd orakel

# 安装后端依赖
bun install

# 安装前端依赖
cd web && bun install && cd ..

# 复制环境变量配置
cp .env.example .env
```

### 2.2 后端开发

```bash
# 启动后端服务 (端口 9999)
bun run start
```

**后端开发命令：**

| 命令 | 说明 |
|------|------|
| `bun run start` | 启动交易机器人 |
| `bun run typecheck` | TypeScript 类型检查 |
| `bun run lint` | Biome 代码检查 |
| `bun run lint:fix` | 自动修复代码风格问题 |
| `bun run test` | 运行单元测试 |
| `bun run test:watch` | 测试监听模式 |

### 2.3 前端开发

```bash
# 启动前端开发服务器
cd web && bun run dev
```

前端默认运行在 Vite 默认端口（通常是 5173）。

**前端开发命令：**

| 命令 | 说明 |
|------|------|
| `bun run dev` | 启动开发服务器 |
| `bun run build` | 构建生产版本 |
| `bun run preview` | 预览构建结果 |

### 2.4 开发环境配置

编辑 `.env` 文件配置开发环境：

```bash
# 核心配置
PAPER_MODE=true              # 模拟交易模式
API_PORT=9999                # API 服务端口
ACTIVE_MARKETS=BTC,ETH,SOL   # 启用的市场
LOG_LEVEL=info               # 日志级别

# CORS 配置（开发环境）
CORS_ORIGIN=*                # 允许所有来源
```

### 2.5 开发工具集成

**VSCode 推荐扩展：**
- Biome (代码格式化)
- TypeScript Vue Plugin (Volar)
- ESLint

**Git 提交前检查：**
```bash
# 推送前运行完整检查
bun run lint && bun run typecheck && bun run test
```

---

## 3. Docker 部署

### 3.1 本地 Docker 构建

```bash
# 构建镜像
docker build -t orakel:local .

# 运行容器
docker run -d \
  --name orakel \
  -p 9999:9999 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/config.json:/app/config.json:ro \
  --env-file .env \
  orakel:local
```

### 3.2 Docker Compose 部署（推荐）

```bash
# 启动所有服务
docker compose up --build

# 后台运行
docker compose up -d

# 查看日志
docker compose logs -f bot

# 停止服务
docker compose down
```

### 3.3 Docker 架构说明

```
┌─────────────────────────────────────────────────────┐
│                  Docker Compose                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │           Bot Container (Port 9999)           │  │
│  │  ┌────────────────────────────────────────┐  │  │
│  │  │  - Bun Runtime                         │  │  │
│  │  │  - Trading Engine                      │  │  │
│  │  │  - API Server (Hono)                   │  │  │
│  │  │  - WebSocket Server                    │  │  │
│  │  │  - SQLite Database                     │  │  │
│  │  └────────────────────────────────────────┘  │  │
│  │                                               │  │
│  │  Volumes:                                     │  │
│  │  - ./data → /app/data (持久化)               │  │
│  │  - ./config.json → /app/config.json (只读)   │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 3.4 数据持久化

Docker 卷挂载 `./data:/app/data` 持久化：

- `bot.sqlite` — SQLite 数据库
- `paper-daily-state.json` — 模拟交易状态
- `live-daily-state.json` — 实盘交易状态
- `api-creds.json` — API 凭证

---

## 4. 生产环境部署

### 4.1 部署架构图

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   GitHub Push   │ ───> │  GitHub Actions  │ ───> │       VPS       │
│   (main branch) │      │  (Build + Push)  │      │  (Docker Compose)│
└─────────────────┘      └──────────────────┘      └─────────────────┘
                                │
                                │
                                ▼
                       ┌──────────────────┐
                       │ Container Registry│
                       │  (GHCR/DockerHub) │
                       └──────────────────┘
```

### 4.2 GitHub Actions 自动部署

**配置 GitHub Secrets：**

进入仓库 `Settings → Secrets and variables → Actions`，添加：

| Secret 名称 | 说明 | 示例值 |
|------------|------|--------|
| `VPS_HOST` | VPS IP 地址 | `123.45.67.89` |
| `VPS_PORT` | SSH 端口 | `22` |
| `VPS_USER` | SSH 用户名 | `root` |
| `VPS_SSH_KEY` | SSH 私钥 | 完整私钥内容 |
| `VPS_DEPLOY_PATH` | 部署路径 | `~/orakel` |

**获取 SSH 私钥：**
```bash
cat ~/.ssh/id_rsa
# 或
cat ~/.ssh/id_ed25519
```

### 4.3 VPS 初始设置

```bash
# 1. 安装 Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 2. 登录 GitHub Container Registry
# 在 GitHub Settings → Developer settings 创建 Personal Access Token
echo "<GITHUB_PAT>" | docker login ghcr.io -u <username> --password-stdin

# 3. 克隆仓库
git clone https://github.com/<your-username>/orakel.git ~/orakel
cd ~/orakel

# 4. 配置环境
cp .env.example .env
nano .env  # 编辑配置
mkdir -p data

# 5. 首次启动
docker compose up -d
```

### 4.4 自动部署流程

推送代码到 `main` 分支后自动触发：

```bash
git add .
git commit -m "feat: new feature"
git push origin main
```

GitHub Actions 自动执行：
1. **Lint & Test** — 代码质量检查
2. **Build Image** — 构建 Docker 镜像
3. **Push to Registry** — 推送到 GHCR
4. **SSH Deploy** — 在 VPS 上拉取并重启

### 4.5 手动部署

**方式 1：GitHub UI**
- 进入 Actions 标签页
- 选择 "Deploy to VPS" workflow
- 点击 "Run workflow"

**方式 2：VPS 手动执行**
```bash
cd ~/orakel
./scripts/vps-deploy.sh ghcr.io/<username>/orakel:<commit-sha>
```

### 4.6 回滚版本

```bash
# 查看可用镜像
docker images "ghcr.io/<username>/orakel" --format "table {{.Tag}}\t{{.CreatedAt}}"

# 回滚到指定版本
export IMAGE_TAG="ghcr.io/<username>/orakel:<commit-sha>"
docker compose up -d
```

---

## 5. 前端部署

### 5.1 部署方式选择

| 方式 | 适用场景 | 优点 | 缺点 |
|------|----------|------|------|
| Cloudflare Pages | 推荐生产环境 | CDN、自动 HTTPS、GitHub 集成 | 需要配置 CORS |
| Nginx 静态托管 | 与后端同 VPS | 一体部署、简单 | 无 CDN 加速 |
| Vercel/Netlify | 替代方案 | 易用 | 国内访问较慢 |

### 5.2 Cloudflare Pages 部署（推荐）

**快速设置：**

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
3. 选择 `orakel` 仓库，配置：

| 设置 | 值 |
|------|-----|
| Framework preset | Vite |
| Build command | `cd web && bun install && bun run build` |
| Build output directory | `web/dist` |

4. 添加环境变量：`VITE_API_BASE=https://your-api-domain.com`
5. 保存并部署

推送代码到 `main` 分支会自动触发部署。

**详细配置请参考：** [Cloudflare Pages 部署指南](./cloudflare-pages-deployment.md)

### 5.3 Nginx 静态托管（与后端同 VPS）

**构建前端：**
```bash
cd web
bun run build
# 输出: web/dist/
```

**Nginx 配置：**

```nginx
server {
    listen 80;
    server_name orakel.example.com;

    # 前端静态文件
    location / {
        root /var/www/orakel/web/dist;
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api {
        proxy_pass http://localhost:9999;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # WebSocket 代理
    location /ws {
        proxy_pass http://localhost:9999;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
    }
}
```

### 5.4 Nginx 配置示例

```nginx
server {
    listen 80;
    server_name orakel.example.com;

    # 前端静态文件
    location / {
        root /var/www/orakel/web/dist;
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api {
        proxy_pass http://localhost:9999;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket 代理
    location /ws {
        proxy_pass http://localhost:9999;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

---

## 6. 故障排查

### 6.1 常见问题

| 问题 | 解决方案 |
|------|----------|
| **端口被占用** | 修改 `API_PORT` 环境变量 |
| **数据库权限错误** | 检查 `data/` 目录的 UID/GID |
| **RPC 连接失败** | 添加备用 RPC 到 `POLYGON_RPC_URLS` |
| **WebSocket 断连** | 检查防火墙和网络连接 |
| **配置无效** | 查看 Zod 验证错误日志 |

### 6.2 健康检查

```bash
# API 健康检查
curl http://localhost:9999/api/health

# 数据库诊断
curl http://localhost:9999/api/db/diagnostics
```

### 6.3 日志查看

```bash
# Docker 日志
docker compose logs -f bot

# 查看最近 100 行
docker compose logs --tail=100 bot

# 查看容器状态
docker compose ps
```

### 6.4 Docker 镜像加速（国内 VPS）

```bash
sudo nano /etc/docker/daemon.json
```

```json
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com"
  ]
}
```

```bash
sudo systemctl restart docker
```

---

## 7. 快速参考

### 7.1 开发环境启动

```bash
# 终端 1: 后端
bun run start

# 终端 2: 前端
cd web && bun run dev
```

### 7.2 Docker 部署启动

```bash
docker compose up --build
```

### 7.3 推送代码

```bash
# 提交前检查
bun run lint && bun run typecheck && bun run test

# 推送（自动触发部署）
git add . && git commit -m "feat: ..." && git push origin main
```

### 7.4 VPS 手动部署

```bash
cd ~/orakel
./scripts/vps-deploy.sh ghcr.io/<username>/orakel:latest
```

---

## 相关文档

- [系统架构](./architecture.md) — 整体架构设计
- [交易策略](./trading-strategy.md) — 交易逻辑说明
- [部署指南](./deployment.md) — 详细部署配置
