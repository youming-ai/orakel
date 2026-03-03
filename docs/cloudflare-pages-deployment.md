# Cloudflare Pages 部署指南

本指南详细说明如何将 Orakel 前端部署到 Cloudflare Pages。

---

## 目录

1. [快速开始](#1-快速开始)
2. [架构说明](#2-架构说明)
3. [Cloudflare 配置](#3-cloudflare-配置)
4. [API 和 WebSocket 代理](#4-api-和-websocket-代理)
5. [自定义域名](#5-自定义域名)
6. [故障排查](#6-故障排查)

---

## 1. 快速开始

### 1.1 连接 GitHub 仓库

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
3. 选择 GitHub 仓库 `orakel`
4. 配置构建设置：

| 设置 | 值 |
|------|-----|
| **Project name** | `orakel` |
| **Production branch** | `main` |
| **Framework preset** | `Vite` |
| **Build command** | `cd web && bun install && bun run build` |
| **Build output directory** | `web/dist` |

5. 点击 **Save and Deploy**

### 1.2 配置环境变量

在 Cloudflare Pages 项目设置中添加环境变量：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `VITE_API_BASE` | `https://orakel-bot.um1ng.me` | 后端 API 地址 |

**路径：** Settings → Environment variables → Production

### 1.3 自动部署

配置完成后，每次推送到 `main` 分支会自动触发构建和部署：

```bash
git push origin main
```

---

## 2. 架构说明

### 2.1 部署架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Cloudflare Network                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────┐         ┌──────────────────────┐     │
│  │  Cloudflare Pages    │         │  Cloudflare Workers  │     │
│  │  (Frontend Static)   │         │  (API Proxy - 可选)  │     │
│  │                      │         │                      │     │
│  │  • React 19 SPA      │         │  • /api/* 代理       │     │
│  │  • Vite Build        │         │  • /ws WebSocket     │     │
│  │  • Global CDN        │         │  • CORS 处理         │     │
│  └──────────────────────┘         └──────────┬───────────┘     │
│                                            │                    │
│                                            │                    │
│                                    ┌───────▼────────┐          │
│                                    │  Your VPS API  │          │
│                                    │  (Port 9999)   │          │
│                                    └────────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 部署模式

| 模式 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| **直连 API** | 前端直接访问 VPS API | 配置简单 | 暴露 API 端口 |
| **Workers 代理** | 通过 Cloudflare Workers 代理 API | 隐藏源服务器、增强安全性 | 需要 Worker 配额 |

---

## 3. Cloudflare 配置

### 3.1 构建配置

Cloudflare Pages 会自动检测 Vite 项目，也可手动配置：

```bash
# 构建命令
cd web && bun install && bun run build

# 输出目录
web/dist
```

### 3.2 环境变量

在 **Settings → Environment variables** 中配置：

**Production 环境：**
```bash
VITE_API_BASE=https://orakel-bot.um1ng.me
```

**Preview 环境（可选）：**
```bash
VITE_API_BASE=http://localhost:9999
```

### 3.3 部署预览

每个 Pull Request 会自动创建预览部署：
- 推送到任何分支都会创建预览
- 访问格式：`https://<commit-hash>.orakel.pages.dev`

---

## 4. API 和 WebSocket 代理

### 4.1 直连 API（推荐）

**前端配置：**

环境变量：
```bash
VITE_API_BASE=https://orakel-bot.um1ng.me
```

**VPS 后端配置：**

修改 `.env` 文件：
```bash
CORS_ORIGIN=https://orakel.pages.dev
```

如需支持多个域名：
```bash
CORS_ORIGIN=https://orakel.um1ng.me,https://orakel-bot.um1ng.me
```

### 4.2 Workers 代理（可选）

如果需要隐藏后端 IP，可以使用 Cloudflare Workers 代理：

**创建 Worker** (`api-proxy.js`):

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // WebSocket 代理
    if (url.pathname === '/ws' &&
        request.headers.get('Upgrade') === 'websocket') {
      return handleWebSocket(request, env);
    }

    // API 代理
    if (url.pathname.startsWith('/api')) {
      return handleApi(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleApi(request, env) {
  const apiUrl = env.API_URL || 'https://your-api-domain.com';
  const url = new URL(request.url);
  const targetUrl = apiUrl + url.pathname + url.search;

  const modifiedRequest = new Request(targetUrl, request);
  modifiedRequest.headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP'));

  const response = await fetch(modifiedRequest);

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const newResponse = new Response(response.body, response);
  Object.entries(corsHeaders).forEach(([k, v]) => newResponse.headers.set(k, v));

  return newResponse;
}

async function handleWebSocket(request, env) {
  const apiUrl = env.API_URL || 'https://your-api-domain.com';
  const wsUrl = apiUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws';

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  const backend = new WebSocket(wsUrl);

  backend.addEventListener('message', (event) => server.send(event.data));
  backend.addEventListener('close', () => server.close());
  backend.addEventListener('error', () => server.close(1011, 'Backend error'));

  server.addEventListener('message', (event) => backend.send(event.data));
  server.addEventListener('close', () => backend.close());
  server.addEventListener('error', () => backend.close());

  return new Response(null, { status: 101, webSocket: client });
}
```

**部署 Worker：**

```bash
# 安装 Wrangler
bun install -g wrangler

# 登录
wrangler login

# 创建项目
mkdir api-proxy && cd api-proxy
wrangler init

# 配置 wrangler.toml
name = "api-proxy"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
API_URL = "https://your-api-domain.com"

# 部署
wrangler deploy
```

**前端配置：**

```bash
VITE_API_BASE=https://api-proxy.your-subdomain.workers.dev
```

---

## 5. 自定义域名

### 5.1 添加自定义域名

1. 进入 Cloudflare Pages 项目
2. 点击 **Custom domains**
3. 点击 **Set up a custom domain**
4. 输入域名（如 `orakel.example.com`）
5. 点击 **Continue**

### 5.2 DNS 配置

Cloudflare 会自动添加 DNS 记录：

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| CNAME | orakel | orakel.pages.dev | Proxied (橙色云朵) |

DNS 传播通常 < 5 分钟。

### 5.3 SSL 证书

Cloudflare Pages 自动提供：
- **Universal SSL**（自动生效）
- **Dedicated SSL**（可在 SSL/TLS 设置中申请）

---

## 6. 故障排查

### 6.1 常见问题

| 问题 | 解决方案 |
|------|----------|
| **API 请求被 CORS 阻止** | 检查后端 `CORS_ORIGIN` 包含前端域名 |
| **WebSocket 连接失败** | 确认后端 `/ws` 路径可用，检查防火墙 |
| **构建失败** | 查看部署日志，确认构建命令正确 |
| **环境变量未生效** | 在 Settings → Environment variables 中检查 |
| **404 错误** | 确认构建输出目录为 `web/dist` |

### 6.2 查看部署日志

1. 进入 Cloudflare Pages 项目
2. 点击 **Deployments** → 选择部署
3. 点击 **View logs**

### 6.3 本地预览生产构建

```bash
cd web
bun install
VITE_API_BASE=https://orakel-bot.um1ng.me bun run build
bun run preview
```

### 6.4 回滚部署

1. 进入 **Deployments**
2. 找到之前的成功部署
3. 点击 **...** → **Promote to production**

---

## 7. 快速参考

### 7.1 首次部署清单

- [ ] 连接 GitHub 仓库到 Cloudflare Pages
- [ ] 配置构建命令：`cd web && bun install && bun run build`
- [ ] 设置输出目录：`web/dist`
- [ ] 添加环境变量：`VITE_API_BASE`
- [ ] 配置后端 CORS：`CORS_ORIGIN`
- [ ] （可选）添加自定义域名

### 7.2 部署流程

```bash
# 推送代码，自动触发部署
git push origin main

# 约 1-2 分钟后访问
# https://orakel.pages.dev
```

### 7.3 配置文件位置

| 文件 | 说明 |
|------|------|
| [`web/public/_headers`](../web/public/_headers) | HTTP 响应头 |
| [`web/public/_redirects`](../web/public/_redirects) | URL 重定向规则 |

---

## 相关文档

- [开发与部署指南](./development-and-deployment.md) — 本地开发流程
- [部署指南](./deployment.md) — VPS 部署详情
- [系统架构](./architecture.md) — 整体架构说明
