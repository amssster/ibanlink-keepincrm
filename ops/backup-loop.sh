#!/bin/sh
set -eu
while true; do
  if ! sh /ops/backup.sh; then
    echo 'Не вдалося створити резервну копію' >&2
    exit 1
  fi
  sleep 86400 &
  wait $!
done
