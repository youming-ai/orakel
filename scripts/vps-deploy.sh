#!/bin/bash
# VPS 部署脚本 - 手动部署时使用
# 用法: ./scripts/vps-deploy.sh [IMAGE_TAG]

set -e

# 配置
REPO_NAME="${REPO_NAME:-$(git config --get remote.origin.url | sed 's/.*:\(.*\)\.git/\1/')}"
IMAGE_TAG="${1:-ghcr.io/${REPO_NAME}:latest}"
COMPOSE_DIR="${COMPOSE_DIR:-$(pwd)}"

echo "🚀 Orakel VPS 部署脚本"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "镜像: ${IMAGE_TAG}"
echo "目录: ${COMPOSE_DIR}"
echo ""

# 检查是否已登录 GHCR
if ! docker info | grep -q "Username"; then
    echo "⚠️  未登录 Docker Hub / GHCR"
    echo "请先运行: docker login ghcr.io"
    exit 1
fi

echo "📦 拉取最新镜像..."
docker pull "${IMAGE_TAG}"

echo ""
echo "🔄 更新并重启容器..."
export IMAGE_TAG="${IMAGE_TAG}"

# 拉取最新配置（如果使用 git）
if [ -d ".git" ]; then
    git fetch origin
    git checkout origin/main
fi

# 重启服务
docker compose pull
docker compose up -d

echo ""
echo "✅ 部署完成!"
echo ""
echo "📊 服务状态:"
docker compose ps

echo ""
echo "📋 查看日志:"
echo "   docker compose logs -f"
echo ""
echo "🔍 查看服务状态:"
echo "   docker compose ps"
echo "   curl http://localhost:9999/api/health"
