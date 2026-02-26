# 前端

## 1. 技术栈

- React 19 + Vite 7
- shadcn/ui（Button、Card、Tabs、Table、Badge、Alert Dialog、Separator、Toaster）
- Recharts（图表与数据可视化）
- Tailwind CSS v4 + @tailwindcss/vite
- wagmi + viem（Web3 钱包连接）
- TanStack Query v5（数据获取与缓存）
- Zustand（UI 状态管理）
- lucide-react（图标库）

## 2. 组件层级

```
Dashboard（编排器）
├── Web3Provider（wagmi + TanStack Query）
│   ├── Header
│   │   ├── 倒计时（15 分钟周期）
│   │   ├── Bot 状态徽章（Stopped/Starting/Running/Stopping）
│   │   ├── ConnectWallet（实盘模式）
│   │   ├── Paper/Live 模式切换
│   │   └── 主题切换（dark/light）
│   ├── LiveConnect（实盘模式下显示）
│   ├── AnalyticsTabs
│   │   ├── OverviewTab（概览）
│   │   │   ├── 止损警告横幅
│   │   │   ├── 今日统计（P&L、交易数、日限额进度条）
│   │   │   ├── StatCard[]（总 P&L、胜率、最大回撤、交易数）
│   │   │   ├── AreaChart（累计 P&L 时间线）
│   │   │   └── MarketCard[]（市场卡片网格）
│   │   ├── MarketsTab（市场）
│   │   │   ├── BarChart（各市场胜率）
│   │   │   └── Table（市场统计）
│   │   ├── TradesTab（交易）
│   │   │   ├── BarChart（入场时间分布）
│   │   │   ├── PieChart（UP/DOWN 比例）
│   │   │   └── TradeTable（分页）
│   │   └── StrategyTab（策略配置）
│   │       └── Form（边缘阈值、概率、权重、风险参数）
│   ├── AlertDialog（启动/停止确认）
│   └── Toaster（通知）
└── ChartErrorBoundary（图表错误边界）
```

## 3. 核心组件详解

### 3.1 Dashboard（Dashboard.tsx，240 行）

主编排器，包裹整个应用。

- 使用的 Hook：`useUIStore`、`useDashboardStateWithWs`、`useTrades`、`usePaperStats`
- 功能：Web3Provider 包裹、模式切换、确认对话框、错误重试
- 将实盘交易记录转换为统一格式供展示使用

### 3.2 Header（Header.tsx，198 行）

Props：`viewMode`、`paperRunning`、`liveRunning`、`liveWalletReady`、pending 标志、mutation 标志、回调函数

- 左侧：Logo 与图标
- 右侧：倒计时（`useCycleCountdown`，每秒更新）、Bot 状态徽章（带动画图标）、钱包按钮（实盘模式）、Paper/Live 切换、主题切换
- 状态推导：`getBotStatus()` 根据 running 与 pending 标志计算当前状态
- `StatusIcon`：启动/停止中显示旋转动画，运行中显示脉冲圆点

### 3.3 MarketCard（MarketCard.tsx，277 行）

Props：`{ market: MarketSnapshot }`

- 头部：市场 ID、阶段徽章（EARLY/MID/LATE）、剩余时间
- 价格行：现货价格 + PTB
- 主要统计：方向（LONG/SHORT 百分比）、市场价格（UP/DOWN 美分）
- 置信度条：0–100%，颜色渐变（红色 < 琥珀色 < 绿色）
- 可展开的技术指标区域：
  - Heiken Ashi 趋势（5 根 K 线迷你图，通过 `MiniTrend` 组件渲染）
  - RSI(14)，含超买/超卖着色
  - MACD（看涨/看跌标注）
  - VWAP 斜率（上行/下行）
  - 波动率、混合来源、订单簿失衡、套利总和
- 交易信号：ENTER 显示"BUY UP|DOWN | Edge X.X% | HIGH|MEDIUM|LOW"，NO_TRADE 显示"NO TRADE (phase)"
- `SignalLight`：交通灯指示器（绿/琥珀/黄/灰）

### 3.4 AnalyticsTabs（AnalyticsTabs.tsx，375 行）

Props：`stats`、`trades`、`byMarket`、`config`、`markets`、`liveTrades`、`viewMode`、`stopLoss`、`todayStats`

包含 4 个标签页，子组件位于 `analytics/` 目录下。

### 3.5 TradeTable（TradeTable.tsx，234 行）

Props：`{ trades: TradeRecord[], paperMode: boolean }`

- 移动端：堆叠卡片布局
- 桌面端：响应式表格（日期、时间、市场、方向、金额、价格、状态、模式）
- 分页：每页 10 条
- Polymarket 链接：根据市场与时间戳推导 slug
- 状态徽章：Placed、Settled、Won、Lost
- 方向徽章：BUY UP（绿色）/ BUY DOWN（红色）

### 3.6 ConnectWallet（ConnectWallet.tsx，176 行）

- 基于 wagmi 的钱包连接，目标链为 Polygon（chainId 137）
- 显示 USDC.e 余额（ERC-20）与原生 POL 余额
- 下拉菜单包含地址、余额、断开连接选项
- 按 Escape 键自动关闭

### 3.7 LiveConnect（LiveConnect.tsx，117 行）

- 私钥输入框（密码字段），用于后端交易客户端
- 非 localhost 环境下显示明文传输警告横幅
- 组件卸载时从内存中清除私钥
- 连接成功后显示钱包地址与断开连接按钮

## 4. 状态管理

### 4.1 Zustand Store（lib/store.ts）

```
UIState:
  viewMode: "paper" | "live"          // 当前查看模式
  setViewMode(mode)
  confirmAction: "start" | "stop" | null  // 确认对话框状态
  setConfirmAction(action)
  theme: "light" | "dark"             // 主题
  toggleTheme()
```

持久化：使用 localStorage，键名为 `"orakel-ui"`，持久化字段为 `viewMode` 与 `theme`。

### 4.2 TanStack Query（lib/queries.ts）

查询配置：

- `state`：`refetchInterval` 5s（轮询兜底），WebSocket 已连接时 `staleTime` 30s，断开时 1s
- `trades`：`refetchInterval` 15s，`staleTime` 12s
- `paperStats`：`refetchInterval` 15s，`staleTime` 12s

Hook 列表：

- `useDashboardState()` — GET /state
- `useTrades(mode)` — GET /trades?mode=...
- `usePaperStats(enabled)` — GET /paper-stats
- `useDashboardStateWithWs()` — 轮询与 WebSocket 组合

Mutation 列表：

- `usePaperToggle()`、`useLiveToggle()` — 启动/停止交易
- `usePaperCancel()`、`useLiveCancel()` — 取消待处理操作
- `useConfigMutation(viewMode)` — 保存配置
- `usePaperClearStop()` — 重置止损状态
- `useLiveConnect()`、`useLiveDisconnect()` — 钱包连接管理

### 4.3 WebSocket 缓存集成

`createWsCacheHandler(queryClient)` 返回消息处理函数：

- `state:snapshot` — 将 markets、updatedAt、config、running 标志合并写入 Query 缓存
- `trade:executed` — 使 trades 与 paperStats 查询失效
- `signal:new` — 使 state 查询失效

## 5. WebSocket 实时更新（lib/ws.ts）

### 5.1 useWebSocket Hook

选项：`url`、`onMessage`、`onConnect`、`onDisconnect`、`reconnectAttempts`、`reconnectInterval`、`useExponentialBackoff`

返回值：`{ isConnected, connect, disconnect, send }`

### 5.2 连接管理

- 指数退避自动重连（最大间隔 30s）
- 通过 Set 支持多个消息处理器
- URL 推导：优先使用 `VITE_API_BASE`，否则使用 `window.location`
- 使用 mounted ref 防止组件卸载后触发状态更新

### 5.3 消息类型

```
WsMessage<T>:
  type: "state:snapshot" | "signal:new" | "trade:executed"
  data: T
  ts: number      // 时间戳
  version: number  // 消息排序版本号
```

## 6. 数据流

1. Dashboard 挂载 → `useDashboardStateWithWs()` 初始化
2. `useWebSocket()` 连接至 `/api/ws`
3. `useQuery(state)` 每 5s 轮询 `/state` 作为兜底
4. WebSocket 收到 `state:snapshot` → `createWsCacheHandler` 合并写入 Query 缓存 → 组件重新渲染
5. 用户切换模式 → `setViewMode()` 更新 Zustand → `useTrades(viewMode)` 重新获取数据
6. 用户点击启动/停止 → `setConfirmAction()` 打开确认对话框 → mutation 触发 → 使相关查询失效
7. 用户保存配置 → `useConfigMutation()` PUT /config → 使 state 与 paperStats 查询失效

## 7. API 客户端（lib/api.ts）

- 所有函数通过 `fetch` 调用后端接口
- 基础 URL：优先使用 `VITE_API_BASE`，否则为 `""`（开发环境使用 Vite 代理）
- 鉴权：mutation 请求在 `Authorization` 头中携带 `API_TOKEN`
- 响应解析：`json()` 并附带错误处理

导出的核心类型：

- `DashboardState`、`MarketSnapshot`、`PaperStats`、`PaperTradeEntry`、`TradeRecord`
- `StrategyConfig`、`RiskConfig`、`ConfidenceResult`
- `StopLossStatus`、`TodayStats`

## 8. 格式化工具（lib/format.ts）

- `fmtTime()` — HH:MM:SS
- `fmtDate()` — MM/DD
- `fmtDateTime()` — MM/DD HH:MM:SS
- `fmtPrice()` — 按市场精度格式化（BTC：0 位小数，ETH：1 位，SOL：2 位，XRP：4 位）
- `fmtCents()` — 0.65 → "65c"
- `fmtMinSec()` — MM:SS 倒计时格式
- `asNumber()` — 安全数字解析，带默认值兜底

## 9. 图表配置（lib/charts.ts）

- `CHART_COLORS`：emerald（正值）、red（负值）、amber（待定）、坐标轴色、网格色、tooltip 色
- `TOOLTIP` 样式配置，适配 Recharts
- `CHART_HEIGHT` 类名：responsive、tall、compact 三档响应式高度

## 10. 构建配置（vite.config.ts）

- 插件：`react()`、`tailwindcss()`
- 路径别名：`@` → `./src`
- 开发代理：`/api` → `API_URL || http://localhost:9999`（含 WebSocket 代理）

## 11. 响应式设计

- 移动优先，使用 Tailwind 断点（`sm:`、`xl:`）
- 顶部导航栏固定定位，带背景模糊效果
- 移动端堆叠卡片布局，桌面端网格布局
- 移动端标签页支持横向滚动，带渐变淡出效果
