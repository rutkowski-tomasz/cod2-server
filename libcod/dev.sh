#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if [ -e zk_libcod ]; then
    echo "libcod/zk_libcod already exists, remove it first" >&2
    exit 1
fi

git init -q zk_libcod
git -C zk_libcod fetch -q --depth 1 https://github.com/ibuddieat/zk_libcod.git "$(cat UPSTREAM)"
git -C zk_libcod checkout -q FETCH_HEAD
git -C zk_libcod apply ../hooks.patch
ln -s ../../extra zk_libcod/code/extra
