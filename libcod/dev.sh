#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if [ -e upstream ]; then
    echo "libcod/upstream already exists, remove it first" >&2
    exit 1
fi

git init -q upstream
git -C upstream fetch -q --depth 1 https://github.com/ibuddieat/zk_libcod.git "$(cat UPSTREAM)"
git -C upstream checkout -q FETCH_HEAD
git -C upstream apply ../hooks.patch
ln -s ../../extra upstream/code/extra
