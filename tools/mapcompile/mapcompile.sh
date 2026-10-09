#!/bin/bash
set -euo pipefail

usage() { echo "usage: $0 <file.map> [-o out.iwd] [--fast]" >&2; exit 1; }

[ $# -ge 1 ] || usage
src="$1"; shift
[ -f "$src" ] || usage
out=""
rad_args=""
while [ $# -gt 0 ]; do
    case "$1" in
        -o) [ $# -ge 2 ] || usage; out="$2"; shift 2 ;;
        --fast) rad_args="-Fast"; shift ;;
        *) usage ;;
    esac
done

map="$(basename "$src" .map)"
dir="$(cd "$(dirname "$0")" && pwd)"
binaries="${COD2_BINARIES:-$HOME/Dev/cod2-binaries}"
scratch="$dir/../../out/mapcompile"
build="$scratch/$map"
rm -rf "$build" && mkdir -p "$build/maps/mp" "$build/mp"
out="${out:-$scratch/$map.iwd}"
mkdir -p "$(dirname "$out")"
out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"

cp "$src" "$build/maps/mp/$map.map"
arena="$(dirname "$src")/$map.arena"
[ -f "$arena" ] && cp "$arena" "$build/mp/"

docker --context desktop-linux build --platform linux/amd64 -q -t cod2-mapcompile "$dir" > /dev/null
docker --context desktop-linux run --rm --platform linux/amd64 \
    -v "$build/maps:/cod2/main/maps" -v "$binaries:/binaries:ro" cod2-mapcompile bash -c "
        set -e
        ln -s /binaries/1_0/iw_0[06789].iwd /binaries/1_0/iw_1[0-4].iwd /binaries/1_3/iw_15.iwd /cod2/main/
        wine cod2map.exe -platform pc 'Z:\\cod2\\main\\maps\\mp\\$map'
        wine cod2rad.exe -platform pc $rad_args 'Z:\\cod2\\main\\maps\\mp\\$map'
    "
[ -f "$build/maps/mp/$map.d3dbsp" ] || { echo "$map.d3dbsp was not built" >&2; exit 1; }

rm -f "$build/maps/mp/$map".{map,d3dpoly,d3dprt,lin} "$out"
(cd "$build" && zip -q -r "$out" maps mp)
echo "Built $out"
