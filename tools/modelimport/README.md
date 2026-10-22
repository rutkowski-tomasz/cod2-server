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

- Every visible mesh but those `--skip` names, such as stray parts a download leaves in, in the pose three.js draws it: skinned meshes as their bones place them.
- One xmodel with the root bone `tag_origin`. A skinned mesh's bones go under it, in the pose three.js draws them and without their scale, which makes an `animated` xmodel; its vertices keep their weights. Any other mesh follows the bone it hangs under, or `tag_origin`. At most 128 bones, the game's limit. One surface per mesh and material. A surface with more than 3000 vertices is split. The converter takes at most 5450 per surface, and it adds vertices of its own at UV seams.
- With `--simplify <share>`, each mesh keeps that share of its triangles in each material, such as 0.25 for a quarter. Edges collapse where they change the shape and shading least. UV seams and open borders keep their outline. Downloads often have far more triangles than a CoD2 model needs. A file of millions of triangles crashes the headless Chrome load: shrink it first with meshoptimizer's gltfpack, which keeps UV seams, such as `bunx gltfpack -i in.glb -o small.glb -si 0.004 -noq` for 0.4% of the triangles. gltf-transform's `simplify` breaks the UVs of a fragmented atlas.
- Normals, UVs (through a map's texture transform and from the UV set it reads) and vertex colours.
- One `model phong` material per source material. Its colour map is the source's, times the material's colour, scaled to power-of-two sides of at most `--texture-size` (default 1024). Without a colour map, it is the material's colour.
- Alpha, from the colour map, the material's opacity and an FBX alpha map: a glTF `MASK` material cuts out at half alpha (`GE128`); a glTF `BLEND` material, or a transparent FBX one, blends. Double-sided materials draw both sides. The game draws a blended surface without depth, so its far side can show through its near side; `--blend mask` cuts such materials out at half alpha instead, as for a character whose cloth only has ragged edges.

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

## Player bodies

`--rig player` binds the meshes to CoD2's multiplayer player skeleton, so the game's own animations move them, as on the stock player bodies:

```bash
node tools/modelimport/modelimport.js shrek.glb --name nl_shrek --rig player --blend mask --simplify 0.5 --texture-size 256
node tools/modelview/modelview.js render nl_shrek --anim pt_stand_shoot_auto --source out/modelimport/nl_shrek
```

- The model must stand facing +X after `--rotate`, with its arms apart from its body (an A-pose or T-pose) and its legs apart. It is scaled to 70 inches tall with its feet on the origin, so `--scale` and `--offset` do not apply. Its own bones and animations are left out.
- The joints are fitted to the mesh's shape. The hands are the farthest points out, the shoulders sit at the armpits (above the top of the gap below an arm angled down, or in the middle of a level arm where it meets the much taller body), and the elbows and wrists lie along the arms at the stock arm's proportions. The spine, neck and head keep the stock heights, scaled below and above the shoulders. The hips, knees and ankles sit in the middle of the legs where they stand apart.
- Each vertex follows the bone of the nearest stretch of body, measured in that stretch's thickness, so a thick belly stays with the spine and does not follow the arm beside it. A limb takes only vertices on its own side, the legs only those below the hips, the body and arms only those above the knees, the shin only those above the ankle and the foot those below it. Near a joint, up to three neighbouring bones share a vertex, the nearer the more, so the skin bends smoothly. The neck and head follow the upper spine, as a rigid head split between bones tears across the face.
- Every other stock bone, such as `tag_weapon_right`, keeps its place on its parent.

Not imported yet: normal and specular maps, LODs and collision. FBXLoader reads an FBX colour map only when it is linked as `DiffuseColor`, as Blender and most exporters write it. 3ds Max's Physical material links it as `base_color_texture`, which is lost: import such a model's glTF instead. Not supported: instanced meshes and KTX2 textures. Draco and meshopt compressed files load.
