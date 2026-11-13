#!/bin/sh
set -eu
umask 077
mkdir -p /backups
target="/backups/iban-$(date -u +%Y%m%dT%H%M%SZ).dump"
trap 'rm -f "$target.tmp"' EXIT
pg_dump --format=custom --no-owner --no-privileges > "$target.tmp"
mv "$target.tmp" "$target"
find /backups -maxdepth 1 -type f -name 'iban-*.dump' -mtime +14 -delete
printf 'Резервну копію створено: %s\n' "$target"
