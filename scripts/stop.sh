#!/usr/bin/env bash
set -euo pipefail

# Orakel Stop Script
# Gracefully stops all running Orakel services

echo "🛑 Stopping Orakel services..."

# Ports used by Orakel
BOT_PORT=9999
WEB_PORT=9998

# Function to kill process on a port
kill_port() {
	local port=$1
	local pid=$(lsof -ti :$port 2>/dev/null || true)

	if [ -n "$pid" ]; then
		echo "  Stopping process on port $port (PID: $pid)"
		kill -9 $pid 2>/dev/null || true
		sleep 0.5
		# Verify it's stopped
		if lsof -ti :$port >/dev/null 2>&1; then
			echo "  ⚠️  Process still running, forcing kill..."
			kill -9 $(lsof -ti :$port) 2>/dev/null || true
		fi
		echo "  ✓ Port $port cleared"
	else
		echo "  ○ No process on port $port"
	fi
}

# Stop bot service
echo ""
echo "Stopping bot service..."
kill_port $BOT_PORT

# Stop web service
echo ""
echo "Stopping web service..."
kill_port $WEB_PORT

# Also kill any bun processes related to orakel (fallback)
echo ""
echo "Cleaning up any remaining bun processes..."
BUN_PIDS=$(pgrep -f "orakel" | xargs -I {} pgrep -P {} bun 2>/dev/null || true)
if [ -n "$BUN_PIDS" ]; then
	echo "  Killing remaining bun processes: $BUN_PIDS"
	kill -9 $BUN_PIDS 2>/dev/null || true
else
	echo "  ○ No remaining bun processes"
fi

echo ""
echo "✅ All services stopped!"
echo ""
echo "You can now start fresh with:"
echo "  bun run dev"
