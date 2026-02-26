# CI/CD 快速设置清单

## Step 1: 配置 GitHub Secrets (5 分钟)

进入: `https://github.com/<your-username>/orakel/settings/secrets/actions`

点击 **New repository secret** 添加以下 Secrets:

```
VPS_HOST = 你的VPS IP地址
VPS_PORT = 22 (或你的SSH端口)
VPS_USER = root (或其他SSH用户)
VPS_SSH_KEY = 你的SSH私钥内容 (cat ~/.ssh/id_rsa)
VPS_DEPLOY_PATH = ~/orakel
```

### 获取 SSH 私钥

在本地电脑执行:
```bash
cat ~/.ssh/id_rsa
# 或
cat ~/.ssh/id_ed25519
```

复制**全部内容**（包括 BEGIN 和 END 行）粘贴到 `VPS_SSH_KEY`。

---

## Step 2: VPS 初始化 (10 分钟)

SSH 连接到你的 VPS，执行以下命令：

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker  # 重新登录使权限生效

# 登录 GitHub Container Registry
# 1. 在 GitHub 创建 PAT: Settings → Developer settings → Personal access tokens
# 2. 权限勾选: read:packages, write:packages
docker login ghcr.io
# Username: 你的 GitHub 用户名
# Password: 刚创建的 PAT (不是 GitHub 密码!)

# 克隆项目
git clone https://github.com/<your-username>/orakel.git ~/orakel
cd ~/orakel

# 配置环境
cp .env.example .env
nano .env  # 编辑配置 (至少设置 ACTIVE_MARKETS)

mkdir -p data

# 首次启动 (本地构建)
docker compose up -d

# 验证运行
curl http://localhost:9999/api/health
```

---

## Step 3: 测试自动部署 (2 分钟)

```bash
# 在本地电脑
git commit --allow-empty -m "test: trigger CI/CD"
git push origin main
```

然后在 GitHub 查看 Actions 运行状态：
`https://github.com/<your-username>/orakel/actions`

---

## 完成! 🎉

现在每次推送代码到 `main` 分支，VPS 会自动更新。

---

## 常见问题

### Q: SSH 连接失败
A: 检查 VPS 防火墙:
```bash
sudo ufw allow 22
```

### Q: Docker 登录失败
A: 确认 PAT 权限包含 `read:packages` 和 `write:packages`

### Q: 如何手动部署？
A: 在 VPS 上:
```bash
cd ~/orakel
./scripts/vps-deploy.sh ghcr.io/<username>/orakel:latest
```

### Q: 如何回滚？
A:
```bash
docker images "ghcr.io/<username>/orakel" --format "{{.Tag}} {{.CreatedAt}}"
export IMAGE_TAG="ghcr.io/<username>/orakel:<old-commit-sha>"
docker compose up -d
```
