# 贡献指南

感谢你对 Orakel 项目的兴趣！我们欢迎任何形式的贡献，包括但不限于 Bug 修复、功能开发、文档改进等。

## 如何贡献

### 1. 报告问题

如果你发现 Bug 或有新功能建议，请先搜索 [Issues](https://github.com/youming-ai/orakel/issues) 是否已存在。如果不存在，请创建一个新的 Issue 并包含以下信息：

- **Bug 报告**: 复现步骤、预期行为、实际行为、环境信息
- **功能请求**: 详细的功能描述、使用场景、可能的实现方案

### 2. 提交代码

1. **Fork** 本仓库
2. 创建你的特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交你的更改 (`git commit -m 'Add some amazing feature'`)
4. 推送分支 (`git push origin feature/amazing-feature`)
5. 打开 **Pull Request**

### 3. 开发环境设置

```bash
# 克隆你的 Fork
git clone https://github.com/YOUR_USERNAME/orakel.git
cd orakel

# 安装依赖
bun install

# 安装 Web 依赖
cd web && bun install && cd ..

# 创建功能分支
git checkout -b feature/your-feature
```

### 4. 代码规范

- 使用 **TypeScript** 进行开发
- 运行类型检查: `bun run typecheck`
- 遵循项目现有的代码风格
- 添加必要的注释和文档

### 5. Pull Request 指南

- PR 标题应清晰描述所做的事情
- 描述中应包含：
  - 解决的问题或添加的功能
  - 涉及的变更
  - 测试结果（如果有）
- 确保所有测试通过

## 项目结构

```
orakel/
├── src/              # Bot 核心代码
├── web/              # 前端代码
├── docs/             # 文档
├── logs/             # 运行时日志
└── config.json       # 策略配置
```

## 技术栈

- **Backend**: Bun, TypeScript, Hono, ethers
- **Frontend**: React 19, Astro, Tailwind CSS v4, shadcn/ui
- **Blockchain**: Polygon, Polymarket CLOB

## 许可证

通过贡献代码，你同意你的贡献将在 [MIT 许可证](LICENSE) 下发布。

---

任何问题欢迎提交 Issue 或参与讨论！
