#!/usr/bin/env bash
set -euo pipefail

SOURCE="${1:-.env.example}"
DEST="${2:-.env}"

if [ -f "$DEST" ]; then
  echo "$DEST already exists. Skipping."
  exit 0
fi

cp "$SOURCE" "$DEST"
echo "Created $DEST from $SOURCE"
