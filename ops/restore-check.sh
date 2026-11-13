#!/bin/sh
# Відновлення лише в нову тимчасову БД; робоча БД не змінюється.
set -eu
test "$#" -eq 1 || { echo 'Вкажіть шлях до .dump у /backups' >&2; exit 1; }
case "$1" in /backups/iban-*.dump) ;; *) echo 'Недозволений шлях' >&2; exit 1;; esac
test -f "$1"
check="iban_restore_check_$(date -u +%s)"
createdb "$check"
trap 'dropdb --if-exists "$check"' EXIT
pg_restore --exit-on-error --no-owner --no-privileges --dbname="$check" "$1"
psql -v ON_ERROR_STOP=1 --dbname="$check" -c 'SELECT count(*) AS payment_links FROM links; SELECT count(*) AS inbox_events FROM inbox; SELECT count(*) AS settings_rows FROM settings;'
echo 'Перевірка відновлення успішна; тимчасову БД буде видалено.'
