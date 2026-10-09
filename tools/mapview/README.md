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
node tools/mapview/mapview.js live   --open
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

Output goes to `out/mapview/` unless `-o` is given. `render` writes the page next to the PNG and prints the camera, so the same view can be explored interactively. All three commands print materials that draw without their image, models drawn as boxes, and prefabs not found.

## Checking a map as an agent

1. `info`: bounds, worldspawn sun and light keys, entities by classname with the first origins, every material with its image.
2. `render` from where a player stands: `--at mp_tdm_spawn` (eye 60 units above the entity, facing its angles), `--at 'mp_tdm_spawn[3]'` for the 4th match (quote it, zsh globs brackets), `--at targetname=gate1`, `--at '#12'`. Or `--pos x,y,z --angles pitch,yaw,roll`, the numbers `getOrigin()` + 60 and `getPlayerAngles()` give in game, or `--look x,y,z` to aim at a point. Without these, the view starts at `mp_global_intermission`, else the first spawn.
3. `render --top` for a floor plan with a 256-unit grid and coordinates. `--center x,y --span units` zooms in, `--cut z` hides everything above z (also in perspective), which shows the inside of buildings.
4. Many views: `--batch shots.json`, an array of objects with the view options as keys plus `name` and `size` (`400x300`; `--size` or 1280x720 otherwise), such as `[{ "name": "plan", "top": true, "cut": 240 }, { "name": "spawn", "at": "mp_tdm_spawn[2]", "labels": "off" }]`. Each shot starts from the defaults, and all share one browser.

In the page: click to look around, WASD to move, Shift for speed, E and Q for up and down, the wheel for top-view zoom. L labels (Shift+L all), F entities, T textures, G grid, K tool brushes, M lightmap, N normal and specular maps, O fog, 1 top view, H HUD and FPS counter. The HUD shows the `--pos`/`--angles` or `--center`/`--span` that reproduce the view. URL hash params override the baked view options, as `#at=mp_tdm_spawn&labels=off`.

## Live players

`live` follows the dev server: it serves the map the server plays at http://localhost:8643/ (`--port`), with every playing player drawn where the server says. The server's `livemap` module (nl-cod2-zom-scripts) sends `{ map, players: [{ id, name, team, origin, view, pitch, yaw, models, weapon, legs, torso }] }` 10 times a second to the `livemap` relay (`stacks/livemap`), which passes it on to pages at `ws://mynl.pl:28970`; pass another relay as the first argument, such as `ws://localhost:28970`.

- Each player stands on a ring with a yaw arrow, red for axis, blue for allies, teal otherwise, and glides between updates. Its name shows through walls.
- Players wear the models the server streams for them: the body and what is attached to it, such as head and helmet. The live server builds each set once and serves it at `/rigs?key=<models>`; until it arrives, the player is the CTF rifleman. `render` and `view --live` bake in the sets the relay's players wear at that moment.
- Each player holds its current weapon: the weapon file's `worldModel`, in the right hand's `tag_weapon_right`, served at `/weapons?key=<weapon>` and baked like the models.
- Each player plays the animations the server plays for it (libcod `getLegsAnimation()` / `getTorsoAnimation()`, nL's own): the legs' xanim, with the torso's over the bones from `torso_stabilizer` up when it has one, blending in over 0.2 s. Served at `/anims?key=<name>` and baked like the models; the CTF idle until one arrives.
- P follows the next player from its eyes (the server's `getViewOrigin()` and view angles), hiding its own model; after the last one, P frees the camera, as does moving. `--follow <name>` starts there, also in `render`.
- When the server changes map, the page reloads onto the new one. It keeps view params such as `#top=1` and drops the camera. Each map is built once, so the first load of a map takes as long as `view`.
- Entity markers start off (`--ents on`, or F). Other view options work as in `view`.
- A map not in the sources, such as a library map not pulled yet, shows a waiting page until it is.
- `render <map> --live <relay>` screenshots the players where they are, for checking without a browser; `view` takes `--live` too. These file pages cannot follow a map change and only say so.

## What is drawn

- Coordinates are CoD's: Z up, yaw 0 along +X, positive pitch looks down. `--fov` is horizontal, like `cg_fov`, 80 by default.
- `.map`: brushes (plane intersection, cod2map's axial texture mapping), mesh and bezier `curve` patches, `misc_prefab` contents. Lit by three.js from worldspawn `sundirection`, `suncolor`, `sunlight`, `ambient`, `_color`, `sundiffusecolor`, `diffusefraction` and the first 64 `light` entities, with sun shadows.
- `.d3dbsp` (IBSP 4): draw surfaces, brush models, entities, lightmaps, and the faces of collision brushes that no draw surface uses (clip, caulk, mantle, ladder, triggers), rebuilt from their planes and tiled every 64 units. The lightmap is applied like the game's `lmap` shader: three 512×512 RGBA pages of R, G and B coefficients per lightmap, then sun visibility as one 1024×1024 grey page, plus direct sun from the surface normal. No three.js lights or shadows are added, except for a `.d3dbsp` compiled without lightmaps, which is lit like a `.map`.
- Materials: the colour map, downscaled to 512, alpha-tested at 0.4 when the image has alpha, except under a `replace` techset, which the game draws opaque. The techset decides how a surface meets what is behind it: `blend` surfaces (glass, snow edges, terrain, mud) fade by texture alpha, `multiply` layers (stains) darken it, `add` layers brighten it. In a `.d3dbsp` with lightmaps, vertex colours tint it, their alpha fades `blend` layers too, and `multiply` layers are unlit. The sky material's cube map is the background. Tool materials (caulk, clip, hint, …) and collision-only faces are hidden unless `--tools`, and draw at 35% opacity (unlit in a compiled map) with no alpha test, so their images' faint fill shows, red for clip, as in Radiant; `water` techsets are flat translucent blue; decals are pulled toward the camera.
- Normal and specular maps, in a `.d3dbsp` with lightmaps and on its models, as the game's `lmap_s` shader uses them: the normal map's alpha and green bend the normal along the vertex tangent and binormal, and the bent normal takes the sun's N·L. The specular map's colour is added where the half vector between eye and sun meets that normal, at full strength in the sun and 30% in its shadow. Both are embedded at 256 px. `--normals off` and N turn them off.
- Models (`misc_model`, `script_model` and the like): the first LOD of each xmodel, placed by `origin`, `angles` and `modelscale`, with its textures and vertex colours. They have no lightmap, so in a compiled map they get a flat 50% light plus the sun by N·L. Missing, skinned and bone-bound xmodels stay boxes.
- Fog: the first `setExpFog` or `setCullFog` with literal numbers in the map's script, `maps/mp/<name>.gsc` in the sources or `~/Dev/nl-cod2-library/src/scripts/<name>.gsc`; `info` prints it. Computed like the game's shaders (`materials/shaders/lib/fogcalc.hlsl` in `iw_07`): by distance from the eye, exp fog as `exp(-density · distance)`, cull fog linear from near to far. The sky, markers and the top view are not fogged; `--fog off` and O turn it off.
- Players: each `mp_ctf_spawn_allied` is an American rifleman (`playerbody_american_normandy01` with Braeburn's head and helmet) looping the standing idle `pb_stand_alert`, without a weapon, each copy at another point of the loop, lit like models. It stands on the first map surface below its spawn (not models, tool brushes or triggers), as the game drops these spawns to the floor. A player hides while the camera is within 24 units of it sideways, between its feet and 80 units above its spawn, as at `--at mp_ctf_spawn_allied`, and with F. `render` holds every player at its starting pose, so the same view gives the same image. The page redraws continuously only while a shown player is inside the view, even behind a wall. When a model or the animation is missing, these spawns stay boxes and all three commands say so.
- Markers: player-sized boxes with a yaw arrow for other spawns (red axis, blue allied, teal other), yellow spheres for lights, magenta boxes for models that are not drawn, orange translucent volumes for triggers; `--ents off` and F hide them all. Labels show `classname [targetname]`, hide behind walls and past 2000 units, and skip lights, models, prefabs, `info_null` and `script_origin` unless `--labels all`; lights, models and prefabs with a targetname keep theirs.

Not drawn:
- Effects, animated or scrolling materials, detail maps.
- Normal and specular maps in a `.map`, or in a `.d3dbsp` without lightmaps.
- Rotation of brush models: an entity's `angles` does not turn its brush model in a `.d3dbsp`. No stock or nL library map sets `angles` on one.

Guesses that may be off:
- Exp fog density: the shader is given `-density`. The engine may scale it first; the scale is not in the shaders.
- How three.js lights a `.map`, which has no lightmaps.
- Specular colour: the game scales the specular map by its own sun specular constant; here the sun's colour times `sunlight` stands in for it.
- Specular sharpness: the game looks it up in an engine-made table by the specular map's alpha and N·H. The table is not in the iwds, so the exponent is guessed as 2^(8 · alpha).
- Bumped indirect light: the game also weights the lightmap's four coefficients by the bent normal, through another engine-made table. Here the indirect light stays flat; only the sun and specular follow the normal map.
- Patches draw from both sides, since which side Radiant treats as the front is not known.
- Animations start with two per-bone bit sets; the second marks rotations about z alone, the first is not known. Reading the first as a negative quaternion w crosses the idle's legs, so it is ignored.
- `--fov` is applied horizontally at the image's aspect. If the game widens the view for widescreen from a 4:3 base, renders are narrower than in game.

Limits:
- The page embeds every texture and model, so it is large: about 115 MB for `mp_harbor`.
- A batch stops at the first shot whose `at` matches no entity.
- `list` matches the name prefix with case.
