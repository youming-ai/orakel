# API Conventions

This document describes the API contract conventions between the backend (Bun + Hono) and frontend (React + Vite).

## Response Formats

The API uses two response patterns depending on the endpoint type:

### Read Endpoints (GET)

Return raw data directly:

```typescript
// GET /api/state
{
  "markets": [...],
  "updatedAt": "2026-03-07T10:00:00Z",
  ...
}

// GET /api/paper-stats
{
  "stats": { ... },
  "trades": [...],
  ...
}

// GET /api/logs?mode=paper
[
  { "orderId": "...", "market": "...", ... },
  ...
]
```

### Write Endpoints (POST/PUT)

Return `{ ok: boolean }` with optional message:

```typescript
// Success
{ "ok": true }

// Success with message
{ "ok": true, "message": "Paper trading started" }

// Error
{ "ok": false, "error": "Invalid configuration" }
```

## Type Contracts

### Single Source of Truth

All API types are defined in the backend (`src/contracts/`) and re-exported in the frontend via `@server/*` path mapping:

```typescript
// web/src/contracts/http.ts
export type { DashboardStateDto as DashboardState } from "@server/contracts/http.ts";
```

This ensures:
- Type drift is caught at build time
- No manual synchronization needed
- Frontend types update automatically when backend changes

### Runtime Validation

Frontend uses Zod schemas (in `web/src/contracts/schemas.ts`) to validate all API responses:

```typescript
const result = DashboardStateSchema.safeParse(await response.json());
if (!result.success) {
  console.error("API response validation failed:", result.error);
}
```

## WebSocket Protocol

### Message Format

All WebSocket messages follow this envelope:

```typescript
{
  "type": "state:snapshot" | "signal:new" | "trade:executed" | "balance:snapshot",
  "data": { ... },
  "ts": 1709817600000,
  "version": 1
}
```

### Discriminated Union

Frontend uses Zod discriminated union for type-safe message handling:

```typescript
const WsMessageSchema = z.discriminatedUnion("type", [
  StateSnapshotMessageSchema,
  SignalNewMessageSchema,
  TradeExecutedMessageSchema,
  BalanceSnapshotMessageSchema,
]);
```

### Handler Pattern

```typescript
switch (msg.type) {
  case "state:snapshot":
    // msg.data is typed as StateSnapshotPayload
    updateCache(msg.data);
    break;
  case "trade:executed":
    // msg.data is typed as TradeExecutedPayload
    invalidateTrades();
    break;
  // ...
}
```

## Error Handling

### HTTP Errors

- 4xx: Client error (invalid params, unauthorized)
- 5xx: Server error (logged, generic message to client)

### WS Errors

- Parse errors: Logged, connection stays open
- Invalid messages: Logged, skipped
- Connection errors: Auto-reconnect with exponential backoff

## Authentication

Both HTTP and WebSocket use the same token:

- HTTP: `Authorization: Bearer <token>` header
- WS: `?token=<token>` query parameter

Token is configured via `VITE_API_TOKEN` env var.
