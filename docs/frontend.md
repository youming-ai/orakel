# Frontend Architecture

## 1. Frontend Overview

The Orakel frontend is a real-time trading dashboard built with React 19, providing monitoring and control for the automated Polymarket trading bot.

**Tech Stack**

- Runtime: React 19 with TypeScript
- Build Tool: Vite
- Styling: Tailwind CSS v4 (via Vite plugin)
- UI Components: shadcn/ui (Radix UI primitives)
- Data Fetching: TanStack Query v5 (React Query)
- State Management: Zustand (UI state) + TanStack Query (server state)
- Charts: Recharts
- Routing: React Router v7

**Build and Development Commands**

| Command | Description |
|---------|-------------|
| `cd web && bun install` | Install frontend dependencies |
| `cd web && bun run dev` | Start Vite dev server (default port 5173) |
| `cd web && bun run build` | Production build (outputs to web/dist) |
| `cd web && bun run preview` | Preview production build |

**Deployment**

- Production: Served from backend port 9999 (integrated into Docker image)
- Development: Vite dev server proxies `/api` and `/ws` to backend at localhost:9999

---

## 2. Application Structure

### Entry Point (main.tsx)

Application entry point initializes TanStack Query, React Router, and root providers. Wraps App component with QueryClientProvider for TanStack Query, BrowserRouter for routing, and StrictMode for development checks.

### Root Component (App.tsx)

Root component handles global providers: AlertDialogProvider for action confirmations, Toaster for notifications, and ErrorBoundary for uncaught errors. Routes page requests through React Router.

### Routing Strategy

Single-page application with two main routes:
- `/` → Dashboard page
- `/trades` → Trades page

Both routes render inside a Layout component that provides the persistent Header and navigation.

### Providers Stack

- QueryClientProvider: TanStack Query for data fetching and caching
- AlertDialogProvider: shadcn/ui dialog for confirmations (start/stop actions)
- Toaster: shadcn/ui toast notifications system

---

## 3. Pages

### Dashboard.tsx

Main dashboard page displaying real-time market data, trading signals, and P&L analytics. Contains two tabs managed by shadcn/ui Tabs component:

**OverviewTab**: Shows aggregated statistics (win rate, total P&L, active positions), P&L chart using Recharts, and market card grid for each supported market (BTC, ETH, SOL, XRP).

**TradesTab**: Displays unified trade table with pagination and market comparison table showing side-by-side statistics across markets.

### Trades.tsx

Dedicated trades page with TradesTab component. Provides expanded view of trade history with filtering and detailed market comparison statistics. Shares TradeTable and MarketComparisonTable components with Dashboard TradesTab.

Both pages support view mode switching between paper trading and live trading data via Zustand store.

---

## 4. Component Hierarchy

Components are organized into logical subdirectories under `components/`:

- `analytics/` — Dashboard tabs and charts (OverviewTab, TradesTab)
- `market/` — Market-specific components (MarketCard, MarketIndicators)
- `trades/` — Trade display components (TradeTable with desktop/mobile variants)
- `ui/` — shadcn/ui primitives (alert-dialog, button, card, etc.)

```
App
├── AlertDialog (confirm actions)
├── Toaster (notifications)
└── Layout
    ├── Header
    │   ├── Status indicators (paper/live running states)
    │   ├── 15-minute window countdown timer
    │   ├── View mode toggle (paper/live)
    │   └── Navigation links (Dashboard / Trades)
    └── <Outlet>
        ├── Dashboard
        │   └── Tabs
        │       ├── OverviewTab (from analytics/)
        │       │   ├── StatCard[] (win rate, P&L, positions)
        │       │   ├── P&L Chart (Recharts)
        │       │   └── MarketCard (from market/)
        │       │       └── MarketIndicators (RSI, MACD, edge, confidence)
        │       └── TradesTab (from analytics/)
        │           ├── TradeTable (from trades/)
        │           │   ├── TradeTableDesktop
        │           │   └── TradeTableMobile
        │           └── MarketComparisonTable
        └── Trades
            └── TradesTab
                ├── TradeTable
                │   ├── TradeTableDesktop
                │   └── TradeTableMobile
                └── MarketComparisonTable
```

```
App
├── AlertDialog (confirm actions)
├── Toaster (notifications)
└── Layout
    ├── Header
    │   ├── Status indicators (paper/live running states)
    │   ├── 15-minute window countdown timer
    │   ├── View mode toggle (paper/live)
    │   └── Navigation links (Dashboard / Trades)
    └── <Outlet>
        ├── Dashboard
        │   └── Tabs
        │       ├── OverviewTab
        │       │   ├── StatCard[] (win rate, P&L, positions)
        │       │   ├── P&L Chart (Recharts)
        │       │   └── MarketCard[]
        │       │       └── MarketIndicators (RSI, MACD, edge, confidence)
        │       └── TradesTab
        │           ├── TradeTable
        │           │   ├── TradeTableDesktop
        │           │   └── TradeTableMobile
        │           └── MarketComparisonTable
        └── Trades
            └── TradesTab
                ├── TradeTable
                │   ├── TradeTableDesktop
                │   └── TradeTableMobile
                └── MarketComparisonTable
```

**Error Boundaries**

- AppErrorBoundary: Catches unhandled errors at application level
- ChartErrorBoundary: Isolates chart rendering errors, prevents dashboard failure

---

## 5. State Management

State management uses a two-tier architecture: client-side UI state and server state synchronization.

### UI State (Zustand)

Zustand store (`useUIStore`) manages ephemeral UI state persisted to localStorage.

| State Field | Type | Persistence | Description |
|-------------|------|-------------|-------------|
| viewMode | `"paper" \| "live"` | Yes | Current trading mode view |
| confirmAction | `"start" \| "stop" \| null` | No | Pending confirmation action |

Persisted via Zustand middleware, storage key `orakel-ui`. Only viewMode is persisted.

### Server State (TanStack Query)

TanStack Query manages data fetching, caching, and background synchronization with backend API.

**Queries**

| Query Hook | Data | Refetch Interval | Stale Time |
|------------|------|------------------|------------|
| useDashboardState | DashboardState (markets, config, stats) | 1000ms (if WS disconnected) | 0ms (WS) / 5000ms (HTTP) |
| useTrades(mode) | Trade history for mode | 5000ms | 10000ms |
| usePaperStats | Paper trading statistics | 10000ms | 10000ms |

**Mutations**

- Start/stop paper trading
- Start/stop live trading
- Reset paper stats
- Reset live stats
- Update configuration

Mutations invalidate related queries on completion to trigger refetch.

### WebSocket Integration

When WebSocket is connected, state query polling is disabled (`refetchInterval: false`). WebSocket messages update TanStack Query cache directly via `setQueryData`, eliminating network overhead and reducing latency.

---

### Library Files (lib/)

| File | Purpose |
|------|---------|
| `api.ts` | HTTP client with typed methods (get, post, put) |
| `queries.ts` | TanStack Query hooks and cache handlers |
| `store.ts` | Zustand store for UI state (viewMode, confirmations) |
| `types.ts` | Shared TypeScript types/interfaces |
| `utils.ts` | Pure utility functions (cn, formatters) |
| `variants.ts` | Tailwind variant definitions for components |
| `charts.ts` | Recharts configuration and helpers |
| `constants.ts` | Application constants |
| `format.ts` | Number/date formatting utilities |
| `stats.ts` | Statistics calculation helpers |
| `toast.ts` | Toast notification helpers |
| `ws.ts` | WebSocket client and connection management |

---

## 6. Data Fetching

### API Client (lib/api.ts)

Lightweight fetch wrapper providing typed API methods. Handles authentication via Bearer token from `VITE_API_TOKEN` environment variable.

**HTTP Methods**

| Method | Wrapper | Usage |
|--------|---------|-------|
| GET | `get<T>(path)` | Read-only requests |
| POST | `post<T>(path)` | Actions without body |
| POST | `postJson<T>(path, data)` | Actions with JSON payload |
| PUT | `put<T>(path, data)` | Updates with JSON payload |

All methods throw descriptive errors on failure, including HTTP status code and response text.

### Endpoints

For full API endpoint documentation, see [Backend Documentation](./backend.md#10-api-server).

Key endpoints used by frontend:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/state` | GET | Full dashboard state snapshot |
| `/api/trades?mode={paper\|live}` | GET | Trade history |
| `/api/paper-stats` | GET | Paper trading statistics |
| `/api/paper/start` | POST | Start paper trading |
| `/api/paper/stop` | POST | Stop paper trading |
| `/api/live/start` | POST | Start live trading |
| `/api/live/stop` | POST | Stop live trading |
| `/api/config` | GET | Current configuration |
| `/api/config` | PUT | Update configuration |

### Query Keys

TanStack Query uses hierarchical query keys for cache management:

- `["state"]` - Dashboard state
- `["trades", mode]` - Trade history (keyed by viewMode)
- `["paper-stats"]` - Paper statistics

Query keys enable targeted invalidation via `invalidateQueries()` after mutations.

### Caching Strategy

- HTTP polling fallback ensures data freshness when WebSocket unavailable
- WebSocket cache merging: partial snapshots merge with existing cache to preserve full dataset
- Stale time prevents unnecessary refetches for frequently accessed data
- Background refetch keeps data fresh without blocking UI

---

## 7. Real-time Updates (WebSocket)

### WebSocket Hook (lib/ws.ts)

`useWebSocket` hook manages WebSocket connection lifecycle with automatic reconnection.

**Connection Management**

| Feature | Configuration |
|---------|----------------|
| Auto-reconnect | Yes |
| Max reconnect attempts | 10 |
| Base reconnect interval | 1000ms |
| Reconnect strategy | Exponential backoff (optional) |

**Authentication**

Token passed via query parameter `?token=XXX` using `getApiToken()`. WebSocket URL derived from `VITE_API_BASE` or current origin.

### Message Types

Three message types broadcast from backend:

| Message Type | Payload | Purpose |
|--------------|---------|---------|
| `state:snapshot` | Partial<DashboardState> | Real-time state updates (markets, running states, stats) |
| `signal:new` | Signal data | New trading signal generated |
| `trade:executed` | Trade data | Trade execution notification |

### Versioning

Each message includes `version` number from backend state snapshot. Frontend uses this to detect and discard out-of-order messages.

### Cache Integration

`createWsCacheHandler()` in `lib/queries.ts` integrates WebSocket messages with TanStack Query cache:

- `state:snapshot` messages merge into existing query data
- Only updates fields present in message payload
- Preserves fields not included in snapshot (config, balance, etc.)
- Triggers re-render via TanStack Query's reactive system

When WebSocket connects, state query polling stops automatically (`refetchInterval: false`). WebSocket disconnects restore polling.

---

## 8. Styling

### Tailwind CSS v4

Tailwind v4 integrated via Vite plugin (`@tailwindcss/vite`). Configuration in `web/src/styles/global.css`.

**CSS Variables Theme**

Design tokens defined as CSS variables for theming consistency:

| Variable | Usage |
|----------|-------|
| `--background`, `--foreground` | Base background and text |
| `--card`, `--card-foreground` | Card component colors |
| `--primary`, `--primary-foreground` | Primary action colors |
| `--secondary`, `--secondary-foreground` | Secondary action colors |
| `--muted`, `--muted-foreground` | Subtle elements |
| `--border`, `--ring` | Borders and focus rings |

### Color Scheme

Single dark theme (light mode not implemented). Colors optimized for dark background with high contrast text for dashboard readability.

### Typography

Inter font family loaded via CSS. Font sizes and line heights use Tailwind scale utilities.

### Component Styling

Components use utility classes with `cn()` helper function (`tailwind-merge`) for conditional class composition. Variant definitions in `lib/variants.ts` provide consistent component variants.

---

## 9. UI Primitives (components/ui/)

shadcn/ui primitives built on Radix UI, providing accessible, customizable components.

| Component | Radix Dependency | Purpose |
|-----------|------------------|---------|
| alert-dialog.tsx | @radix-ui/react-alert-dialog | Confirmation dialogs (start/stop actions) |
| badge.tsx | None (div) | Status indicators and labels |
| button.tsx | @radix-ui/react-slot | Action buttons |
| card.tsx | None (div) | Content containers (MarketCard, StatCard) |
| separator.tsx | @radix-ui/react-separator | Visual dividers |
| skeleton.tsx | None (div) | Loading placeholders |
| table.tsx | None (table) | Data tables (TradeTable, MarketComparisonTable) |
| tabs.tsx | @radix-ui/react-tabs | Tab navigation (Overview/Trades tabs) |
| toaster.tsx | @radix-ui/react-toast | Toast notifications |

All primitives support composition with Tailwind classes for customization.

---

## 10. Custom Hooks

### useCycleCountdown

Computes 15-minute window countdown timer. Updates every second, displays time remaining until next quarter-hour boundary (HH:MM:00 or HH:MM:15, HH:MM:30, HH:MM:45).

**Derived from**

Current timestamp aligned to quarter-hour marks minus elapsed time within current window.

### useReducedMotion

Respects user's system reduced motion preference. Returns boolean indicating if motion-reduced UI should be used (prefers-reduced-motion media query).

Used for conditional animations and transitions, improving accessibility for users sensitive to motion.

---

## 11. Build Configuration

### Vite Config (vite.config.ts)

**Plugins**

- `@vitejs/plugin-react` - React 19 support with Fast Refresh
- `@tailwindcss/vite` - Tailwind v4 integration

**Path Aliases**

- `@` resolves to `web/src`

**Dev Server Proxy**

| Path | Target | Description |
|------|--------|-------------|
| `/api` | `http://localhost:9999` | Backend REST API |
| `/ws` | `http://localhost:9999` | Backend WebSocket (ws: true) |

Production deployment: Frontend served from backend port 9999, proxy not used.

**Build Optimization**

- Manual chunk splitting separates heavy dependencies
- `charts` chunk: Recharts
- `ui` chunk: Radix UI + Lucide React icons
- Source maps disabled to reduce build size and memory usage
- Optimized for 1GB VPS deployment

**Environment Variables**

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE` | `/api` | Backend API base URL |
| `API_URL` | `http://localhost:9999` | Proxy target for dev server |
| `VITE_API_TOKEN` | empty | Bearer token for API authentication |

---

## 12. Related Documentation

| Document | Description |
|----------|-------------|
| [System Architecture](./architecture.md) | Overall system architecture, backend modules, data flow |
| [Backend Documentation](./backend.md) | Backend API endpoints, WebSocket protocol, data structures |
| [Trading Strategy](./trading-strategy.md) | Probability model, edge calculation, decision logic |

For complete project structure and development commands, see [README.md](../README.md).
