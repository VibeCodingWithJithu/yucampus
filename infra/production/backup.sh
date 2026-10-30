#!/bin/sh
# Nightly backup of the database and the evidence files (docs/DEPLOY.md, step 9). Keeps 14 days on this server.
# Copy /var/backups/yucampus to a second location in India as well: a backup on the same server does not survive
# losing the server.
set -eu
cd "$(dirname "$0")"
DIR=/var/backups/yucampus
STAMP=$(date +%Y-%m-%d)
mkdir -p "$DIR"

docker compose exec -T postgres pg_dump -U yucampus -d yucampus -Fc > "$DIR/database-$STAMP.dump"
docker run --rm -v yucampus_storage-data:/data:ro -v "$DIR":/backup alpine:3.22 tar czf "/backup/files-$STAMP.tar.gz" -C /data .

find "$DIR" -type f -mtime +14 -delete
echo "Backup written to $DIR ($STAMP)"
