# mapview

Draws CoD2 maps outside the game: an interactive page for people, headless screenshots and an entity and material list for agents.

```bash
cd tools/mapview && bun install          # once, playwright-core and three
node tools/mapview/mapview.js view   mp_harbor --open
node tools/mapview/mapview.js render mp_harbor --at mp_ctf_spawn_axis
node tools/mapview/mapview.js render mp_harbor --pos -9500,-7500,120 --angles 10,90,0
node tools/mapview/mapview.js render mp_square --top --cut 240
node tools/mapview/mapview.js render mp_harbor --batch shots.json -o out/harbor
node tools/mapview/mapview.js info   mp_harbor
node tools/mapview/mapview.js list   mp_
```

Targets are a `.map` source (what `nl-cod2-library/map_source` generates), a compiled `.d3dbsp`, a map's `.iwd`, a game path or stock name like `mp_harbor`, or the name of a map in `~/Dev/nl-cod2-library/src/iwds/`, like `mp_square`, which opens that map's iwd. Maps, materials and `.iwi` images are looked up, ignoring case, in the same sources as fxview (later wins): `~/Dev/cod2-binaries/1_0`, `~/Dev/cod2-binaries/1_3`, every `~/Dev/nl-cod2-zom-iwds/iwds/<iwd>/<feature>/` folder, then `--source <dir|iwd>`. A target `.iwd` is added as a source, and its map is the one named like the iwd. `misc_prefab` paths in a `.map` resolve next to the map, one and two folders up, and in `--prefabs <dir>`. Needs `iw_13` (materials) and `iw_08`–`iw_12` (images) pulled. Stock maps: `1_3/iw_15` has `mp_harbor` and `mp_rhine`, `iw_00` seven single-player maps, `iw_01`–`iw_05` the rest; `list` shows the ones found, then the library's iwds.

Output goes to `tools/mapview/out/` unless `-o` is given. `render` writes the page next to the PNG and prints the camera, so the same view can be explored interactively. All three commands print materials that draw without their image and prefabs not found.

## Checking a map as an agent

1. `info`: bounds, worldspawn sun and light keys, entities by classname with the first origins, every material with its image.
2. `render` from where a player stands: `--at mp_tdm_spawn` (eye 60 units above the entity, facing its angles), `--at 'mp_tdm_spawn[3]'` for the 4th match (quote it, zsh globs brackets), `--at targetname=gate1`, `--at '#12'`. Or `--pos x,y,z --angles pitch,yaw,roll`, the numbers `getOrigin()` + 60 and `getPlayerAngles()` give in game, or `--look x,y,z` to aim at a point. Without these, the view starts at `mp_global_intermission`, else the first spawn.
3. `render --top` for a floor plan with a 256-unit grid and coordinates. `--center x,y --span units` zooms in, `--cut z` hides everything above z (also in perspective), which shows the inside of buildings.
4. Many views: `--batch shots.json`, an array of objects with the view options as keys plus `name`, such as `[{ "name": "plan", "top": true, "cut": 240 }, { "name": "spawn", "at": "mp_tdm_spawn[2]", "labels": "off" }]`. Each shot starts from the defaults, and all share one browser.

In the page: click to look around, WASD to move, Shift for speed, E and Q (or Space and C) for up and down, the wheel for move speed or top-view zoom. L labels (Shift+L all), O entities, T textures, G grid, K tool brushes, M lightmap, 1 top view, H HUD and FPS counter. The HUD shows the `--pos`/`--angles` or `--center`/`--span` that reproduce the view. URL hash params override the baked view options, as `#at=mp_tdm_spawn&labels=off`.

## What is drawn

- Coordinates are CoD's: Z up, yaw 0 along +X, positive pitch looks down. `--fov` is horizontal, like `cg_fov`, 80 by default.
- `.map`: brushes (plane intersection, cod2map's axial texture mapping), mesh and bezier `curve` patches, `misc_prefab` contents. Lit by three.js from worldspawn `sundirection`, `suncolor`, `sunlight`, `ambient`, `_color`, `sundiffusecolor`, `diffusefraction` and the first 64 `light` entities, with sun shadows.
- `.d3dbsp` (IBSP 4): draw surfaces, brush models, entities, lightmaps. The lightmap is applied like the game's `lmap` shader: four 512×512 pages per lightmap (R, G and B coefficients, then sun visibility), plus direct sun from the surface normal. No three.js lights or shadows are added, except for a `.d3dbsp` compiled without lightmaps, which is lit like a `.map`.
- Materials: the colour map, downscaled to 512, alpha-tested at 0.4 when the image has alpha. The sky material's cube map is the background. Tool materials (caulk, clip, hint, …) are hidden unless `--tools`; `water` techsets are flat translucent blue; decals are pulled toward the camera.
- Markers: player-sized boxes with a yaw arrow for spawns (red axis, blue allied, teal other), yellow spheres for lights, magenta boxes for models, orange translucent volumes for triggers in a `.map` (a `.d3dbsp` keeps no trigger geometry, and most of its triggers have no origin, so they do not show). Labels show `classname [targetname]`, hide behind walls and past 2000 units, and skip lights, models, prefabs, `info_null` and `script_origin` unless `--labels all`; lights, models and prefabs with a targetname keep theirs.

Not drawn:
- xmodel geometry: models are labelled boxes.
- Effects, fog, normal and specular maps, animated or scrolling materials.
- Vertex colours, so blend materials (snow edges, terrain) draw at full strength.
- Triggers in a `.d3dbsp`: it keeps no trigger geometry, and most of its triggers have no origin for a marker.
- Rotation of brush models: an entity's `angles` does not turn its brush model in a `.d3dbsp`.

Guesses that may be off:
- How three.js lights a `.map`, which has no lightmaps.
- Patches draw from both sides, since which side Radiant treats as the front is not known.
- `--fov` is applied horizontally at the image's aspect. If the game widens the view for widescreen from a 4:3 base, renders are narrower than in game.

Limits:
- Stock maps other than `mp_harbor`, `mp_rhine` and the `iw_00` single-player maps need `iw_01`–`iw_05` pulled.
- The page embeds every texture, so it is large: about 56 MB for `mp_harbor`.
- A batch stops at the first shot whose `at` matches no entity.
- `list` matches the name prefix with case.
