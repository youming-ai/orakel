#!/usr/bin/env bash
set -euo pipefail

# Orakel Git Hooks Installation
# This script installs pre-commit and pre-push hooks for code quality

echo "📦 Installing Git hooks..."

# Create hooks directory
HOOKS_DIR=".git/hooks"
mkdir -p "$HOOKS_DIR"

# Pre-commit hook
cat > "$HOOKS_DIR/pre-commit" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

echo "🔍 Running pre-commit checks..."

# Run linter
echo "▸ Running Biome linter..."
if ! bun run lint --files-only; then
	echo "❌ Lint check failed"
	echo "   Run 'bun run lint:fix' to auto-fix issues"
	exit 1
fi
echo "✅ Lint check passed"

# Type check staged files only
echo "▸ Running TypeScript type check..."
if ! bun run typecheck; then
	echo "❌ Type check failed"
	exit 1
fi
echo "✅ Type check passed"

echo "✅ Pre-commit checks passed!"
EOF

chmod +x "$HOOKS_DIR/pre-commit"

# Pre-push hook
cat > "$HOOKS_DIR/pre-push" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Running pre-push checks..."

# Type check
echo "▸ Running TypeScript type check..."
if ! bun run typecheck; then
	echo "❌ Type check failed"
	exit 1
fi
echo "✅ Type check passed"

echo "✅ Pre-push checks passed!"
EOF

chmod +x "$HOOKS_DIR/pre-push"

echo "✅ Git hooks installed successfully!"
echo "   - pre-commit: lint + typecheck"
   - pre-push: typecheck
