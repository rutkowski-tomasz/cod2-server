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

## Pull the iwds first

A map draws correctly only when every iwd it reads is pulled from Git LFS. An iwd still left as an LFS pointer is skipped without an error: its materials draw in flat colours, its models as boxes, and its maps are not found. Pull them all once:

```bash
cd ~/Dev/cod2-binaries && git lfs pull --include "1_0/iw_0[0-5].iwd,1_0/iw_0[7-9].iwd,1_0/iw_1*.iwd,1_3/iw_15.iwd,1_0/localized_polish_iw10.iwd"
```

- `iw_00`–`iw_05`, `1_3/iw_15`: stock maps. `iw_15` has `mp_harbor` and `mp_rhine`, `iw_00` seven single-player maps, `iw_01`–`iw_05` the rest.
- `iw_07`, `1_3/iw_15`: map scripts, for the fog.
- `iw_08`–`iw_12`: images.
- `iw_13`: materials and xmodels.
- `iw_14`: model geometry.
- `localized_polish_iw10`: the censored German materials and images, such as `mtl_dak_crate`, `mtl_barrel_silver` and `mtl_kubel_africa`.

Targets are a `.map` source (what `nl-cod2-library/map_source` generates), a compiled `.d3dbsp`, a map's `.iwd`, a game path or stock name like `mp_harbor`, or the name of a map in `~/Dev/nl-cod2-library/src/iwds/`, like `mp_square`, which opens that map's iwd. Maps, materials and `.iwi` images are looked up, ignoring case, in the same sources as fxview (later wins): `~/Dev/cod2-binaries/1_0`, `~/Dev/cod2-binaries/1_3`, every `~/Dev/nl-cod2-zom-iwds/iwds/<iwd>/<feature>/` folder, then `--source <dir|iwd>`. A target `.iwd` is added as a source, and its map is the one named like the iwd. `misc_prefab` paths in a `.map` resolve next to the map, one and two folders up, and in `--prefabs <dir>`. `list` shows the stock maps found, then the library's iwds.

Output goes to `tools/mapview/out/` unless `-o` is given. `render` writes the page next to the PNG and prints the camera, so the same view can be explored interactively. All three commands print materials that draw without their image, models drawn as boxes, and prefabs not found.

## Checking a map as an agent

1. `info`: bounds, worldspawn sun and light keys, entities by classname with the first origins, every material with its image.
2. `render` from where a player stands: `--at mp_tdm_spawn` (eye 60 units above the entity, facing its angles), `--at 'mp_tdm_spawn[3]'` for the 4th match (quote it, zsh globs brackets), `--at targetname=gate1`, `--at '#12'`. Or `--pos x,y,z --angles pitch,yaw,roll`, the numbers `getOrigin()` + 60 and `getPlayerAngles()` give in game, or `--look x,y,z` to aim at a point. Without these, the view starts at `mp_global_intermission`, else the first spawn.
3. `render --top` for a floor plan with a 256-unit grid and coordinates. `--center x,y --span units` zooms in, `--cut z` hides everything above z (also in perspective), which shows the inside of buildings.
4. Many views: `--batch shots.json`, an array of objects with the view options as keys plus `name` and `size` (`400x300`; `--size` or 1280x720 otherwise), such as `[{ "name": "plan", "top": true, "cut": 240 }, { "name": "spawn", "at": "mp_tdm_spawn[2]", "labels": "off" }]`. Each shot starts from the defaults, and all share one browser.

In the page: click to look around, WASD to move, Shift for speed, E and Q for up and down, the wheel for top-view zoom. L labels (Shift+L all), F entities, T textures, G grid, K tool brushes, M lightmap, O fog, 1 top view, H HUD and FPS counter. The HUD shows the `--pos`/`--angles` or `--center`/`--span` that reproduce the view. URL hash params override the baked view options, as `#at=mp_tdm_spawn&labels=off`.

## What is drawn

- Coordinates are CoD's: Z up, yaw 0 along +X, positive pitch looks down. `--fov` is horizontal, like `cg_fov`, 80 by default.
- `.map`: brushes (plane intersection, cod2map's axial texture mapping), mesh and bezier `curve` patches, `misc_prefab` contents. Lit by three.js from worldspawn `sundirection`, `suncolor`, `sunlight`, `ambient`, `_color`, `sundiffusecolor`, `diffusefraction` and the first 64 `light` entities, with sun shadows.
- `.d3dbsp` (IBSP 4): draw surfaces, brush models, entities, lightmaps, and the faces of collision brushes that no draw surface uses (clip, caulk, mantle, ladder, triggers), rebuilt from their planes and tiled every 64 units. The lightmap is applied like the game's `lmap` shader: three 512×512 RGBA pages of R, G and B coefficients per lightmap, then sun visibility as one 1024×1024 grey page, plus direct sun from the surface normal. No three.js lights or shadows are added, except for a `.d3dbsp` compiled without lightmaps, which is lit like a `.map`.
- Materials: the colour map, downscaled to 512, alpha-tested at 0.4 when the image has alpha, except under a `replace` techset, which the game draws opaque. The techset decides how a surface meets what is behind it: `blend` surfaces (glass, snow edges, terrain, mud) fade by texture alpha, `multiply` layers (stains) darken it, `add` layers brighten it. In a `.d3dbsp` with lightmaps, vertex colours tint it, their alpha fades `blend` layers too, and `multiply` layers are unlit. The sky material's cube map is the background. Tool materials (caulk, clip, hint, …) and collision-only faces are hidden unless `--tools`, and draw at 35% opacity (unlit in a compiled map) with no alpha test, so their images' faint fill shows, red for clip, as in Radiant; `water` techsets are flat translucent blue; decals are pulled toward the camera.
- Models (`misc_model`, `script_model` and the like): the first LOD of each xmodel, placed by `origin`, `angles` and `modelscale`, with its textures and vertex colours. They have no lightmap, so in a compiled map they get a flat 50% light plus the sun by N·L. Missing, skinned and bone-bound xmodels stay boxes.
- Fog: the first `setExpFog` or `setCullFog` with literal numbers in the map's script, `maps/mp/<name>.gsc` in the sources or `~/Dev/nl-cod2-library/src/scripts/<name>.gsc`; `info` prints it. Computed like the game's shaders (`materials/shaders/lib/fogcalc.hlsl` in `iw_07`): by distance from the eye, exp fog as `exp(-density · distance)`, cull fog linear from near to far. The sky, markers and the top view are not fogged; `--fog off` and O turn it off.
- Markers: player-sized boxes with a yaw arrow for spawns (red axis, blue allied, teal other), yellow spheres for lights, magenta boxes for models that are not drawn, orange translucent volumes for triggers; `--ents off` and F hide them all. Labels show `classname [targetname]`, hide behind walls and past 2000 units, and skip lights, models, prefabs, `info_null` and `script_origin` unless `--labels all`; lights, models and prefabs with a targetname keep theirs.

Not drawn:
- Effects, normal and specular maps, animated or scrolling materials.
- Rotation of brush models: an entity's `angles` does not turn its brush model in a `.d3dbsp`. No stock or nL library map sets `angles` on one.

Guesses that may be off:
- Exp fog density: the shader is given `-density`. The engine may scale it first; the scale is not in the shaders.
- How three.js lights a `.map`, which has no lightmaps.
- Patches draw from both sides, since which side Radiant treats as the front is not known.
- `--fov` is applied horizontally at the image's aspect. If the game widens the view for widescreen from a 4:3 base, renders are narrower than in game.

Limits:
- The page embeds every texture and model, so it is large: about 77 MB for `mp_harbor`.
- A batch stops at the first shot whose `at` matches no entity.
- `list` matches the name prefix with case.
