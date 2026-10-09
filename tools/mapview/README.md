# mapview — CoD2 map visualizer

Renders `.map` sources (what `nl-cod2-library/map_source` generates) and compiled `.d3dbsp` maps with stock textures, so an agent can screenshot a map from a given position and judge it without launching the game.

```bash
cd tools/mapview && bun install          # three + playwright-core; Chromium from Playwright's cache or /opt/pw-browsers
node tools/mapview/mapview.js shot <map> --at mp_ctf_spawn_axis --out shot.png
node tools/mapview/mapview.js shot <map> --pos 900,0,80 --angles 0,0,0 --out shot.png
node tools/mapview/mapview.js shot <map> --top --cut 240 --out plan.png
node tools/mapview/mapview.js shot <map> --batch shots.json --out dir/
node tools/mapview/mapview.js info <map>
node tools/mapview/mapview.js serve <map>  # interactive: WASD + mouse, HUD shows the --pos/--angles to reproduce the view
```

`<map>` is a `.map`, `.d3dbsp` or `.iwd` path, or a stock name like `mp_harbor` (looked up in the iwds). Stock iwds come from `$COD2_BINARIES` or `~/Dev/cod2-binaries`; add custom ones with `--iwd`. Run `mapview.js --help` for every option.

## Views

- `--pos x,y,z --angles pitch,yaw,roll` — CoD convention: Z up, yaw 0 = +X, pitch positive = down. Same numbers as `getOrigin()` + 60 and `getPlayerAngles()`.
- `--at <selector>` — eye 60 units above an entity: `mp_tdm_spawn`, `targetname=gate1`, `#12`, `'mp_tdm_spawn[3]'` for the 4th match (quote it, zsh globs brackets).
- `--look x,y,z` — aim at a point. `--fov 80` is horizontal, like `cg_fov`.
- `--top [--center x,y --span units] [--cut z]` — floor plan with a 256-unit grid and coordinates; `--cut` hides everything above z (also works in perspective).
- `shots.json` — array of objects with the same keys (`at`, `pos`, `angles`, `look`, `top`, `cut`, `labels`, …) plus `name`; one browser session for all of them.

Markers: player-sized boxes with a yaw arrow for spawns (red axis, blue allied, teal other), yellow spheres for lights, magenta boxes for models, orange translucent brush volumes for triggers. Labels show `classname [targetname]`, hide behind walls, and skip models and lights unless `--labels all`. `--tools` shows caulk/clip brushes.

## Rendering

- `.map`: brushes (plane intersection, cod2map's axial texture mapping), mesh and bezier `curve` patches, `misc_prefab` includes (resolved next to the map or via `--prefabs`). Lit from worldspawn `sundirection`, `suncolor`, `sunlight`, `ambient`, `_color`, plus `light` entities, with shadows.
- `.d3dbsp` (IBSP 4): draw surfaces, brush models, entities, lightmaps. Lightmaps are reproduced the way the game's `lmap` shader does it: four 512×512 pages per index (directional coefficients for R, G, B and sun visibility), direct sun added from the surface normal.
- Textures: material binary → `colorMap` image → IWI (DXT1/3/5, cubemap skies) decoded in Node, downscaled to 512 and cached as PNG in `~/.cache/cod2-mapview`.
- Not rendered: xmodel geometry (models show as labelled boxes), effects, normal/specular maps, fog.

## Layout

`mapview.js` CLI · `lib/map.js` .map parser · `lib/brush.js` brush/patch geometry · `lib/bsp.js` d3dbsp parser · `lib/iwd.js` zip reader · `lib/iwi.js` image decoder · `lib/material.js` · `lib/assets.js` asset lookup · `lib/scene.js` scene builder · `lib/server.js` HTTP API · `lib/shot.js` Playwright · `viewer/` three.js app.
