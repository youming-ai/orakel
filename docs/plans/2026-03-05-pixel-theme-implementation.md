# Pixel Theme Implementation Plan

**Goal:** Add Retro 8-bit (NES/Gameboy) pixel art theme with theme toggle.

**Architecture:** CSS-based `.pixel-theme` class on `<html>`, Google Fonts (Press Start 2P), localStorage persistence.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vite, Vitest

---

## Task 1: Add Google Fonts (5 min)

Modify `web/index.html` - add to `<head>`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
```

Commit: `feat(pixel-theme): add Google Fonts (Press Start 2P)`

---

## Task 2: Create pixel.css (10 min)

Create `web/src/styles/pixel.css` with:
- Pixel theme CSS variables (--pixel-bg, --pixel-card, --pixel-border, etc.)
- Utility classes (.pixel-card, .pixel-btn)
- Responsive mobile styles
- Accessibility (focus styles, high contrast)
- Button, card overrides for pixel theme

Modify `web/src/main.tsx` - add after global.css:
```typescript
import "./styles/pixel.css";
```

Commit: `feat(pixel-theme): create pixel.css with theme variables`

---

## Task 3: Extend Tailwind config (5 min)

Modify `web/tailwind.config.js` - add to theme.extend:
```javascript
colors: { pixel: { bg: '#1a1c2c', card: '#29366f', border: '#4b692a', ... } }
fontFamily: { pixel: ['"Press Start 2P"', 'cursive'] }
borderWidth: { '4': '4px' }
```

Commit: `feat(pixel-theme): extend Tailwind config with pixel colors`

---

## Task 4: Create usePixelTheme hook (15 min)

Create `web/src/hooks/usePixelTheme.ts`:
- useState initialized from localStorage
- useEffect applies .pixel-theme class to documentElement
- togglePixel function
- TypeScript interface for return type

Create `web/src/hooks/__tests__/usePixelTheme.test.ts`:
- Test initialization from localStorage
- Test toggle functionality
- Test class application
- Test persistence

Run: `cd web && bunx vitest run src/hooks/__tests__/usePixelTheme.test.ts`

Commit: `feat(pixel-theme): add usePixelTheme hook with tests`

---

## Task 5: Add theme toggle button to Header (10 min)

Modify `web/src/components/Header.tsx`:
1. Import Gamepad2 icon and usePixelTheme hook
2. Add `const { isPixel, togglePixel } = usePixelTheme();`
3. Add theme toggle button after Paper/Live toggle:
```tsx
<button
  type="button"
  onClick={togglePixel}
  className={cn("flex items-center justify-center size-7 rounded-md transition-all shrink-0 border outline-none bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted", isPixel && "bg-pixel-accent/20 text-pixel-accent border-pixel-accent/30")}
  title={isPixel ? "Switch to Modern" : "Switch to Pixel"}
  aria-label="Toggle pixel theme"
>
  <Gamepad2 className="size-3.5" />
</button>
```

Test: Run dev server, click button to toggle themes

Commit: `feat(pixel-theme): add theme toggle button to Header`

---

## Task 6-15: Component Updates (60 min total)

For each component, add pixel-specific styles to `pixel.css` and test:

Task 6: Badge - `web/src/components/ui/badge.tsx`
Task 7: Card - `web/src/components/ui/card.tsx`  
Task 8: Button - `web/src/components/ui/button.tsx`
Task 9: Header styles - Add to `pixel.css`: header, logo icon, countdown
Task 10: StatCard - `web/src/components/StatCard.tsx`
Task 11: MarketCard - `web/src/components/MarketCard.tsx`
Task 12: TradeTable - `web/src/components/TradeTable.tsx`
Task 13: AlertDialog - `web/src/components/ui/alert-dialog.tsx`
Task 14: Toaster - `web/src/components/ui/toaster.tsx`
Task 15: Layout - `web/src/components/Layout.tsx`

Each commit: `feat(pixel-theme): update [Component] for pixel theme`

---

## Task 16: Full test suite (10 min)

Run: `bun run test`
Run: `bun run typecheck`
Run: `bun run lint:fix`

Commit: `test(pixel-theme): all tests passing`

---

## Task 17: Manual testing (20 min)

Test checklist:
- Theme toggle works
- All pages render in pixel theme (Dashboard, Logs)
- Responsive on mobile (375px)
- Accessibility (keyboard nav, focus states, contrast)
- WebSocket real-time updates work
- Bot integration works

Create: `web/PIXEL_THEME_TESTING.md` with results

Commit: `docs(pixel-theme): add manual testing documentation`

---

## Task 18: Performance optimization (5 min)

Add to `pixel.css`:
```css
@font-face {
  font-family: 'Press Start 2P';
  font-display: swap;
  src: local('Press Start 2P'), local('Courier New');
}
```

Commit: `perf(pixel-theme): optimize font loading`

---

## Task 19: Docker integration test (10 min)

Run: `docker compose build`
Run: `docker compose up -d`
Test dashboard in Docker
Run: `docker compose down`

Update testing doc with Docker results

Commit: `docs(pixel-theme): document Docker compatibility`

---

## Task 20: Create PR (5 min)

Run: `git push -u origin feature/pixel-theme`

Create PR with:
- Title: "feat: Add Retro 8-bit Pixel Theme"
- Summary, features, design doc reference, testing doc, screenshots

Commit: `chore(pixel-theme): ready for review`

---

**Total Estimated Time: 3 hours**
