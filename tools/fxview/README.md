# fxview

Plays CoD2 `.efx` effects outside the game: a standalone WebGL page for people, headless contact sheets and JSON stats for agents.

```bash
cd tools/fxview && bun install          # once, playwright-core only
node tools/fxview/fxview.js view   fx/explosions/grenadeExp_dirt --open
node tools/fxview/fxview.js render ~/Dev/nl-cod2-zom-iwds/iwds/nl1.iwd/m60/fx/muzzleflashes/heavy.efx --forward x --frames 6 --stats
node tools/fxview/fxview.js info   fx/smoke/smoke_grenade_duhoc_40sec
node tools/fxview/fxview.js list   fx/muzzleflashes
```

Targets are a file path or an fx path. Fx paths, sub-effects (`playfx`, `emitfx`, `impactfx`, `deathfx`), materials and `.iwi` images are looked up, ignoring case like the game, in (later wins): `~/Dev/cod2-binaries/1_0`, `~/Dev/cod2-binaries/1_3` (LFS pointers that were not pulled are skipped), every `~/Dev/nl-cod2-zom-iwds/iwds/<iwd>/<feature>/` folder, then `--source <dir|iwd>`. Needs `iw_07` (fx), `iw_13` (materials, models), `iw_14` (model geometry) and `iw_08`–`iw_12` (images) pulled.

Output goes to `tools/fxview/out/` unless `-o` is given. `render` writes the page next to the sheet, so the same frames can be inspected interactively. `--stats` adds a JSON with duration, bounds, warnings, missing assets and per-frame particle counts.

## Checking an effect as an agent

1. `info` — element list, materials, blend modes, missing assets. A missing material or image means the effect will not look right in game either, except images listed as an unsupported format: IWI formats 6 and 7 use a compression the tool cannot decode.
2. `render` with `--forward` matching how the effect is played. The default `z` points up: `playFx` without a forward vector, explosions, impacts and decals (the engine passes the surface normal as forward). Use `x` for muzzle flashes, tracers, anything attached to a tag, and fire or ambient smoke authored with Z up.
3. Look at the sheet: size against the 72-unit player outline and 64-unit grid cells, timing across frames, colour, whether particles leave the ground or fly through it. Use `--bg mid` when the effect is dark smoke or a decal.
4. Default frames are spread over the active duration, denser early; `--times` to pick moments, `--seed` to check randomness, `--cam yaw,pitch,dist` for a fixed view between iterations.

## What is simulated

- Particle, Cloud (billboards), Tail (stretched along motion), OrientedParticle and Decal (in the effect's plane), Light (soft additive glow sized by `size`), Emitter (moving point that emits `emitfx` every `density` units and `deathfx` on death; with `useModel` it draws its xmodel with the colour map and a fixed light, scaled by `size` and turned by `angle` and `angleDelta`), FxRunner (spawns `playfx`), Line (a strip `size` wide from the element's origin to `origin2`; with `org2fromTrace` it runs along the effect forward to the ground, or 512 units if it misses, and `traceImpactFx` plays `impactfx` there; plays `deathfx` on death), CameraShake (shakes the view; sheet labels and `--stats` frames show the amount).
- Graphs: value = scale × (base(t) + r × rand(t)), r fixed per particle, random graph only with the matching `useRandom*` flag. Alpha always applies. Velocity graph 1 uses the particle axis and graph 2 the effect axis; `absoluteVel` and `absoluteVel2` switch each to world. The `velocity` and `acceleration` keys use the particle axis; `absoluteVel` switches `velocity` to world, `absoluteAccel` switches `acceleration`. `velocity`, `acceleration`, `gravity`, `wind`, `bounce` are units per second.
- Spawn: `origin` box, `orgOnCylinder` (`radius` across, `height` along forward), `orgOnSphere`, `axisFromSphere` (random particle axis), `evenDistribution` (spawn delays spread evenly), `randrotaroundfwd` for runners.
- Atlases: `sequence*` keys, start mode 1 random / 2 indexed, play rate mode 1 over life, loop mode 1 with `sequenceLoopTimes`.
- Materials: blend mode from the technique set (`*_add*` additive, `effect_multiply` multiply, else alpha), atlas grid from the material header.
- Physics: `usePhysics` collides with the ground plane only. The first hit plays `impactfx`; `impactKills` also removes the particle.

Not simulated: `relative`, culling and `spawnRange`, lighting, fog, soft (`zfeather`) depth, `rgb` and `alpha` on models. Skinned xmodels and xmodels bound to a bone other than the root are drawn as gray boxes, like missing ones. Unknown constants that may be off: `rotationDelta` and `angleDelta` are taken as degrees per second, `size` as the sprite's full width or the model's scale, and as a CameraShake's amplitude in degrees; a Line's texture is stretched once along it.
