#!/usr/bin/env bash
set -euo pipefail

# Orakel Database Reset Script
# WARNING: This will delete all data!

echo "⚠️  WARNING: This will delete all database data!"
echo ""
read -p "Are you sure you want to reset the database? (yes/no): " -r
echo ""

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
	echo "Aborted."
	exit 0
fi

echo "🗑️  Resetting database..."

# Remove SQLite database files
if [ -f data/orakel.db ]; then
	rm data/orakel.db
	echo "✓ Removed data/orakel.db"
fi

if [ -f data/orakel.db-shm ]; then
	rm data/orakel.db-shm
	echo "✓ Removed data/orakel.db-shm"
fi

if [ -f data/orakel.db-wal ]; then
	rm data/orakel.db-wal
	echo "✓ Removed data/orakel.db-wal"
fi

# Remove CSV files (if any)
if [ -f data/trades.csv ]; then
	rm data/trades.csv
	echo "✓ Removed data/trades.csv"
fi

if [ -f data/signals.csv ]; then
	rm data/signals.csv
	echo "✓ Removed data/signals.csv"
fi

if [ -f data/daily_stats.csv ]; then
	rm data/daily_stats.csv
	echo "✓ Removed data/daily_stats.csv"
fi

echo ""
echo "✅ Database reset complete!"
echo "   The database will be recreated on next run."
