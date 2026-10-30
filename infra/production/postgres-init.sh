#!/bin/sh
# Runs once, when the database is first created. The API connects as yucampus_app, so row-level security applies
# to it; the migrations give it its table rights. The password comes from APP_DB_PASSWORD in .env.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v pw="$APP_DB_PASSWORD" <<'EOSQL'
CREATE ROLE yucampus_app LOGIN PASSWORD :'pw';
EOSQL
