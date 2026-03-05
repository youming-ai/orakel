# Pixel Theme Testing Documentation

This document outlines the manual testing procedures for the Pixel Theme feature in the Orakel web dashboard.

## Testing Checklist

### 1. Theme Toggle Functionality
- [ ] Click the Gamepad icon in the top navigation bar
- [ ] Verify theme switches between "Default" and "Pixel" modes
- [ ] Confirm theme preference persists across page refreshes (localStorage)
- [ ] Check that the Gamepad icon changes appearance to reflect active theme

### 2. Dashboard Page Rendering
- [ ] Navigate to Dashboard in Pixel theme
- [ ] Verify pixelated font (Press Start 2P) is applied throughout
- [ ] Check that all cards have pixel-style borders (sharp corners, no border-radius)
- [ ] Confirm buttons have pixel-style hover effects
- [ ] Verify color scheme uses retro game palette (green, purple, cyan, orange)
- [ ] Test all market cards (BTC, ETH, SOL, XRP) render correctly
- [ ] Check that stats and metrics display properly with pixel font

### 3. Logs Page Rendering
- [ ] Navigate to Logs page in Pixel theme
- [ ] Verify log entries maintain pixel theme styling
- [ ] Check that log levels (INFO, WARN, ERROR) display with proper colors
- [ ] Confirm table/list structure works with pixel styling
- [ ] Test log filtering and pagination if applicable

### 4. Responsive Design (Mobile Testing)
- [ ] Test at 375px viewport width (iPhone SE)
- [ ] Test at 390px viewport width (iPhone 12/13/14)
- [ ] Test at 428px viewport width (iPhone 14 Pro Max)
- [ ] Verify pixel font remains readable at small sizes
- [ ] Check that navigation collapses properly
- [ ] Confirm market cards stack vertically on mobile
- [ ] Test that all interactive elements remain tappable (min 44x44px)
- [ ] Verify no horizontal scrolling occurs

### 5. Accessibility Testing
- [ ] Test keyboard navigation (Tab key through all interactive elements)
- [ ] Verify visible focus states on all interactive elements
- [ ] Check color contrast ratios meet WCAG AA standards (4.5:1 for text)
- [ ] Test with screen reader (VoiceOver/NVDA) for proper ARIA labels
- [ ] Verify semantic HTML structure is maintained
- [ ] Check that theme toggle is accessible via keyboard
- [ ] Confirm form inputs have proper labels and error states

### 6. WebSocket Real-time Updates
- [ ] Start the bot server: `bun run start`
- [ ] Open dashboard in Pixel theme
- [ ] Verify WebSocket connection establishes (check browser console)
- [ ] Confirm real-time market price updates work
- [ ] Check that new trades appear in real-time
- [ ] Verify signal updates display correctly
- [ ] Test that pixel theme styling is maintained during dynamic updates
- [ ] Check for any layout shifts when data updates

### 7. Bot Integration
- [ ] Start bot in paper mode: `POST /api/paper/start`
- [ ] Verify dashboard shows paper trading as active
- [ ] Confirm pixel theme styling applies to active state indicators
- [ ] Test stop functionality: `POST /api/paper/stop`
- [ ] Verify state changes reflect in pixel theme
- [ ] Check that all API responses work correctly regardless of theme
- [ ] Test live mode controls if `PRIVATE_KEY` is configured

### 8. Cross-Browser Testing
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari (macOS/iOS)
- [ ] Verify consistent pixel font rendering
- [ ] Check that theme toggle works in all browsers
- [ ] Confirm no browser-specific console errors

### 9. Performance Testing
- [ ] Check page load time with Pixel theme (should be < 2s)
- [ ] Verify font loading with `font-display: swap` prevents FOIT
- [ ] Test that theme switch is instant (no noticeable lag)
- [ ] Check browser DevTools Performance tab for layout thrashing
- [ ] Verify no memory leaks when switching themes repeatedly

### 10. Edge Cases
- [ ] Test rapid theme switching (click toggle 10+ times quickly)
- [ ] Verify theme works with all URL parameters and query strings
- [ ] Check that theme persists across browser sessions
- [ ] Test with JavaScript disabled (graceful degradation)
- [ ] Verify theme works with different user zoom levels (100%, 150%, 200%)

## Known Issues & Limitations

### Font Loading
- Press Start 2P is loaded from Google Fonts
- Fallback to `Courier New` if offline
- `font-display: swap` prevents blocking but may cause FOUT (Flash of Unstyled Text)

### Mobile Considerations
- Pixel font size adjusts via CSS custom properties
- Minimum readable size maintained at 10px base
- Touch targets meet iOS/Android guidelines

## Test Environment Setup

```bash
# Install dependencies
cd web && bun install

# Start dev server
bun run dev

# Or build for production testing
bun run build && bun run preview
```

## Automated Testing

While this document focuses on manual testing, the following automated tests should pass:
- All existing vitest tests: `bun run test`
- TypeScript type checking: `bun run typecheck`
- Linting: `bun run lint:fix`

## Bug Reporting Template

When reporting issues, include:
1. Browser and version
2. Viewport size (desktop/mobile)
3. Steps to reproduce
4. Expected vs actual behavior
5. Console errors (if any)
6. Screenshot/screen recording

## Sign-Off Criteria

Pixel Theme feature is considered complete when:
- [ ] All items in this checklist pass
- [ ] No console errors in any browser
- [ ] Accessibility score ≥ 90 in Lighthouse
- [ ] Performance score ≥ 90 in Lighthouse
- [ ] Manual testing approved by at least one other team member
