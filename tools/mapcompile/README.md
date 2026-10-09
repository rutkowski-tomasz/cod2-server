# mapcompile

Compiles a CoD2 `.map` into a map `.iwd` with the CoD2 Mod Tools' `cod2map` and `cod2rad`, run under wine in Docker.

```bash
tools/mapcompile/mapcompile.sh path/to/mp_name.map
tools/mapcompile/mapcompile.sh path/to/mp_name.map -o ~/Dev/nl-cod2-library/src/iwds/mp_name.iwd
tools/mapcompile/mapcompile.sh path/to/mp_name.map --fast
```

The map is named after the file. A `mp_name.arena` next to the `.map` goes into the iwd as `mp/mp_name.arena`. The iwd also holds `maps/mp/mp_name.d3dbsp`, lit by `cod2rad`. Output goes to `out/mapcompile/mp_name.iwd` unless `-o` is given.

Most of the time goes to `cod2rad`, which runs emulated and always on 2 threads. `--fast` passes it `-Fast`: lighting is rougher but about 7× quicker, which suits test builds. Build without it before release.

Runs on the `desktop-linux` Docker context. The first run builds the `cod2-mapcompile` image (about 2 GB): wine, d3dx9_27 and the Mod Tools installer from archive.org. The compilers read stock materials from `~/Dev/cod2-binaries` (set `COD2_BINARIES` for another clone): `1_0/iw_00`, `iw_06`–`iw_13` and `1_3/iw_15` must be pulled.

Check the result with mapview: `node tools/mapview/mapview.js render out/mapcompile/mp_name.iwd --at mp_tdm_spawn`.

Limits:
- Only stock materials: nL textures from `nl-cod2-zom-iwds` are not visible to the compilers.
- `misc_prefab` paths are not resolved, since only the `.map` is copied in.
