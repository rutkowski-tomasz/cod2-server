# modelimport

Imports glTF, GLB and FBX models into CoD2. The game reads none of these formats: it needs its own binary xmodels, materials and IWI images. modelimport loads the file with three.js in headless Chrome. It writes the CoD2 Mod Tools' source files (`XMODEL_EXPORT`, TGA images and a GDT), then runs the Mod Tools' `converter.exe` under wine for the game files.

```bash
cd tools/modelimport && bun install          # once: three and playwright-core
node tools/modelimport/modelimport.js barrel.gltf
node tools/modelimport/modelimport.js crate.fbx --name nl_crate --rotate 0,90,0 -o ~/Dev/nl-cod2-zom-iwds/iwds/nl2.iwd/crate
node tools/modelview/modelview.js render out/modelimport/barrel/xmodel/barrel
```

The output folder is laid out as in an iwd: `xmodel/<name>`, `xmodelparts/`, `xmodelsurfs/`, `xanim/<name>_<animation>`, `materials/<name>_<n>` and `images/<name>_<n>.iwi`. It goes to `out/modelimport/<name>/` unless `-o` is given. The converter's input is kept in `out/modelimport/.work/<name>/`.

The converter runs in the `cod2-mapcompile` Docker image, built from mapcompile's Dockerfile on the `desktop-linux` context on first use. It is emulated: a model of a few thousand triangles takes seconds, one of 50,000 several minutes.

## Placing the model

The game's front is +X and up is +Z, in inches. glTF and FBX models face +Z with +Y up, which modelimport turns to the game's axes. glTF is in metres, and an FBX file states its unit; `--scale` sets the inches per unit when a file is off. `--rotate pitch,yaw,roll` then turns the model in degrees and `--offset x,y,z` moves it in inches. A player is 70 inches tall.

## What is imported

- Every visible mesh, in the pose three.js draws it: skinned meshes as their bones place them.
- One xmodel with the root bone `tag_origin`. A skinned mesh's bones go under it, in the pose three.js draws them and without their scale, which makes an `animated` xmodel; its vertices keep their weights. Any other mesh follows the bone it hangs under, or `tag_origin`. At most 128 bones, the game's limit. One surface per mesh and material. A surface with more than 4000 vertices is split. The converter takes at most 5450 per surface, and it adds vertices of its own at UV seams.
- With `--simplify <share>`, each mesh keeps that share of its triangles in each material, such as 0.25 for a quarter. Edges collapse where they change the shape and shading least. UV seams and open borders keep their outline. Downloads often have far more triangles than a CoD2 model needs.
- Normals, UVs (through a map's texture transform and from the UV set it reads) and vertex colours.
- One `model phong` material per source material. Its colour map is the source's, times the material's colour, scaled to power-of-two sides of at most `--texture-size` (default 1024). Without a colour map, it is the material's colour.
- Alpha, from the colour map, the material's opacity and an FBX alpha map: a glTF `MASK` material cuts out at half alpha (`GE128`); a glTF `BLEND` material, or a transparent FBX one, blends. Double-sided materials draw both sides.

- Every animation of a model with bones, as `xanim/<name>_<animation>`, sampled `--fps` times a second (default 30). Animations named in `--loop` (or all, with `--loop all`) loop; the rest play once. Play one with modelview: `--anim <name>_<animation>`.

## Animations for the player

`--retarget player` writes only the file's animations, moved onto CoD2's multiplayer player skeleton, so they play on the stock player bodies:

```bash
node tools/modelimport/modelimport.js Soldier.glb --retarget player --loop Run
node tools/modelview/modelview.js render playerbody_american_normandy01 --attach head_us_ranger_braeburn,helmet_us_ranger_generic --anim soldier_player_run --source out/modelimport/soldier_player
```

- The skeleton is the stock `playerbody_american_normandy01`'s, read from the stock iwds as modelview reads them. The xanims are built against an `XMODEL_EXPORT` of it.
- Bones are matched by name for Mixamo, 3ds Max Biped and Unreal Engine 4 mannequin rigs: hips, spine, neck, head, clavicles, arms, legs, feet and fingers. Bones that match nothing are listed and left out. The source needs left and right hips, or clavicles, to tell which way it faces.
- The player's skeleton is first posed as the source rests: its arms and legs point where the source's point, since most rigs rest in a T-pose and the player in an A-pose. Each frame, a matched bone turns from there as its source bone turns from its rest. The hips also move as the source's, scaled so they rest as high above the ankles. Every other bone follows its parent, and the player keeps its own proportions.
- The animations are named `<name>_<animation>`, with `<name>` the file's name and `_player` by default. `--scale`, `--rotate`, `--offset`, `--simplify` and `--texture-size` do not apply.

## Guns

`--viewmodel <stock weapon>` makes a gun that the stock weapon's animations play:

```bash
node tools/modelimport/modelimport.js rifle.gltf --name ph_rifle --viewmodel kar98k_mp --rotate 0,-90,0 --parts bolt_a=j_bolt,bolt_b=j_bolt
node tools/modelview/modelview.js render out/modelimport/ph_rifle/weapons/mp/ph_rifle_mp --anim rechamber
```

- It writes `xmodel/viewmodel_<name>` for first person, `xmodel/weapon_<name>` for the world and `weapons/mp/<name>_mp`, the weapon's file with these two models in it. The weapon is read as modelview reads it, nL's iwds over the stock ones; a name a stock asset has is refused.
- The gun must face +X, the game's front: turn it with `--rotate`. It is always centred on the stock gun, and scaled to its length unless `--scale` is given: the viewmodel to the vertices on `j_gun`, the world model to the whole stock world model. `--offset` then moves it in inches.
- The viewmodel has the stock gun's bones, such as `j_gun`, `j_bolt` and `j_clip`. `--parts mesh=bone,…` puts meshes, by their name in the file, on the bones that move. Every other mesh is on `j_gun`. A moving part is stored where the stock idle animation holds its bone, so the animations put it back in place; a bone the idle animation does not place cannot take a part. It turns about the stock part's pivot. The gun's own bones and animations, `--loop` and `--fps` do not apply.
- The world model has the stock one's tags, such as `tag_flash` and `tag_brass`, where the stock gun has them. In first person the stock animations place them, so the muzzle flash and brass stay where the stock gun has them even after `--scale` or `--offset`.

Not imported yet: normal and specular maps, LODs and collision. FBXLoader reads an FBX colour map only when it is linked as `DiffuseColor`, as Blender and most exporters write it. 3ds Max's Physical material links it as `base_color_texture`, which is lost: import such a model's glTF instead. Not supported: instanced meshes and KTX2 textures. Draco and meshopt compressed files load.
