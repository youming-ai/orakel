#!/usr/bin/env bash
set -euo pipefail

# Orakel Development Setup Script
# This script automates the setup process for new developers

echo "🚀 Setting up Orakel development environment..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if command exists
command_exists() {
	command -v "$1" >/dev/null 2>&1
}

# Print section header
print_section() {
	echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
	echo -e "${BLUE}  $1${NC}"
	echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
	echo ""
}

# Check prerequisites
print_section "Checking Prerequisites"

if ! command_exists bun; then
	echo -e "${RED}✗ Bun is not installed${NC}"
	echo "  Install from: https://bun.sh/"
	exit 1
fi
echo -e "${GREEN}✓${NC} Bun $(bun --version)"

if ! command_exists git; then
	echo -e "${RED}✗ Git is not installed${NC}"
	exit 1
fi
echo -e "${GREEN}✓${NC} Git $(git --version)"

if command_exists docker; then
	echo -e "${GREEN}✓${NC} Docker $(docker --version | cut -d' ' -f3 | tr -d ',')"
else
	echo -e "${YELLOW}⚠${NC} Docker is not installed (optional for local dev)"
fi

echo ""

# Install dependencies
print_section "Installing Dependencies"

echo "Installing bot dependencies..."
bun install
echo -e "${GREEN}✓${NC} Bot dependencies installed"

echo ""
echo "Installing web dependencies..."
cd web
bun install
cd ..
echo -e "${GREEN}✓${NC} Web dependencies installed"

echo ""

# Setup environment files
print_section "Environment Configuration"

if [ ! -f .env ]; then
	echo "Creating .env from .env.example..."
	cp .env.example .env
	echo -e "${GREEN}✓${NC} Created .env file"
	echo -e "${YELLOW}⚠${NC}  Review and update .env with your configuration"
else
	echo -e "${GREEN}✓${NC} .env file already exists"
fi

echo ""

# Setup data directory
print_section "Data Directory Setup"

if [ ! -d data ]; then
	echo "Creating data directory..."
	mkdir -p data
	echo -e "${GREEN}✓${NC} Created data directory"
else
	echo -e "${GREEN}✓${NC} Data directory already exists"
fi

echo ""

# Setup pre-commit hooks
print_section "Git Hooks Setup"

if [ -f scripts/install-git-hooks.sh ]; then
	echo "Installing pre-commit hooks..."
	bash scripts/install-git-hooks.sh
else
	echo -e "${YELLOW}⚠${NC} Git hooks script not found (skipping)"
fi

echo ""

# Run type check to verify setup
print_section "Verifying Setup"

echo "Running type check..."
if bun run typecheck; then
	echo -e "${GREEN}✓${NC} Type check passed"
else
	echo -e "${RED}✗${NC} Type check failed - please fix any TypeScript errors"
	exit 1
fi

echo ""

# Print success message and next steps
print_section "Setup Complete!"

echo -e "${GREEN}✓ Development environment is ready!${NC}"
echo ""
echo "Quick Start:"
echo "  1. Review and update .env if needed"
echo "  2. Run everything:     ${BLUE}bun run dev${NC}"
echo "  3. Run bot only:       ${BLUE}bun run start${NC}"
echo "  4. Run web only:       ${BLUE}cd web && bun run dev${NC}"
echo "  5. Run tests:          ${BLUE}bun run test${NC}"
echo "  6. Run linting:        ${BLUE}bun run lint${NC}"
echo ""
echo "Useful Commands:"
echo "  bun run test:watch     # Run tests in watch mode"
echo "  bun run lint:fix       # Auto-fix lint issues"
echo "  bun run db:reset       # Reset database"
echo "  bun run db:seed        # Seed database with mock data"
echo ""
echo "Documentation:"
echo "  - README.md      - Project overview"
echo "  - CLAUDE.md      - Architectural guide"
echo "  - DEV.md         - Development guide (after first commit)"
echo ""
echo -e "${BLUE}Happy coding! 🎉${NC}"
