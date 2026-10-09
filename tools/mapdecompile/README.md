# mapdecompile

Turns a compiled CoD2 map (`.d3dbsp`) back into a Radiant `.map` that mapview draws and mapcompile compiles again.

```bash
node tools/mapdecompile/mapdecompile.js mp_matmata
node tools/mapdecompile/mapdecompile.js ~/Dev/nl-cod2-library/src/iwds/mp_tower.iwd -o mp_tower.map
node tools/mapview/mapview.js render out/mapdecompile/mp_matmata.map --at mp_tdm_spawn
```

Targets are a `.d3dbsp` file, a map's `.iwd`, or a stock name like `mp_harbor`. A name or `.iwd` is read as `maps/mp/<name>.d3dbsp`: from the target `.iwd` first, else from the same sources as the other tools, `~/Dev/nl-cod2-zom-iwds` folders before `~/Dev/cod2-binaries/1_3` before `1_0`. Output goes to `out/mapdecompile/<name>.map` unless `-o` is given. No dependencies beyond Node.

## What comes back

- Entities with all their keys, minus the ones the compiler adds (`model "*N"`, `gndLt`). Lights, spawns, triggers and misc_models are all kept.
- Collision brushes, one material per side, from the brush lumps. Bevel sides the compiler adds are dropped, since they span no area.
- Detail flags of world brushes. The map keeps no flag, but cod2map builds the world's BSP tree only from the visible faces of structural brushes, so a brush with no face splitting a node (on the node's plane, inside its box) becomes `contents detail;`. Without this, portals break on recompile.
- Brush models (doors, triggers, script_brushmodels) in their entity. One built around an origin brush gets its offset and a 16-unit `origin` brush back.
- Texture size, shift, rotation and skew per face, solved from the draw triangles on the face by inverting cod2map's texture projection. Shifts come back within one repeat. Faces nothing draws (caulk, clip, faces against other brushes) get `64 64 0 0 0 0`.
- Every draw triangle no brush face explains becomes a mesh with its UVs and vertex colours: terrain, curves, decals and non-colliding brushes. A mesh that shares no vertex with patch collision and whose centre lies on no collision triangle gets `contents nonColliding;`.

## What is lost

- Portals. The compiled map keeps only the pieces the compiler cut portal brushes into, and those overlap and fail to compile again, so they are left out. The map compiles as one cell; add portals back in Radiant.
- Lightmap settings, weapon-clip flags, brush order and grouping, prefabs: everything is flattened into the world.
- A structural brush whose faces are all hidden comes back as detail, and a detail brush with a face where a node splits as structural.
- Curves and terrain come back as one mesh per triangle, not as their control grid.
- Collision brushes of misc_models (`collmaps/`) are merged into the world by the compiler, so they come back as extra brushes and are added again on the next compile.
- Non-axial faces fully covered by neighbouring brushes may be missing: the compiler drops them, which can leave a brush reaching into its neighbour.

`mp_escape` compiled, decompiled and compiled again gives the same brushes, drawn area and UVs.
