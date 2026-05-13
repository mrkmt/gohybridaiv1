#!/bin/bash

# Database Backup Script for GoHybrid AI
# Stores backups in ~/backups/db with 7-day retention

BACKUP_DIR="/home/gwtuser/backups/db"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/gohybrid_v1_$TIMESTAMP.sql.gz"

# DB Config (matching .env)
DB_NAME="gohybrid_v1"
DB_USER="automate_user"
export PGPASSWORD="Global@2026"

echo "[$(date)] Starting backup of $DB_NAME..."

# Ensure directory exists
mkdir -p "$BACKUP_DIR"

# Perform backup and compress
pg_dump -h localhost -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "[$(date)] Backup successful: $BACKUP_FILE"
else
    echo "[$(date)] Backup FAILED!"
    exit 1
fi

# Retention policy: Delete backups older than 7 days
echo "[$(date)] Cleaning up backups older than 7 days..."
find "$BACKUP_DIR" -name "gohybrid_v1_*.sql.gz" -mtime +7 -delete

echo "[$(date)] Backup process complete."
