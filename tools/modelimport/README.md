# modelimport

Imports glTF, GLB and FBX models into CoD2. The game reads none of these formats: it needs its own binary xmodels, materials and IWI images. modelimport loads the file with three.js in headless Chrome. It writes the CoD2 Mod Tools' source files (`XMODEL_EXPORT`, TGA images and a GDT), then runs the Mod Tools' `converter.exe` under wine for the game files.

```bash
cd tools/modelimport && bun install          # once: three and playwright-core
node tools/modelimport/modelimport.js barrel.gltf
node tools/modelimport/modelimport.js crate.fbx --name nl_crate --rotate 0,90,0 -o ~/Dev/nl-cod2-zom-iwds/iwds/nl2.iwd/crate
node tools/modelview/modelview.js render out/modelimport/barrel/xmodel/barrel
```

The output folder is laid out as in an iwd: `xmodel/<name>`, `xmodelparts/`, `xmodelsurfs/`, `materials/<name>_<n>` and `images/<name>_<n>.iwi`. It goes to `out/modelimport/<name>/` unless `-o` is given. The converter's input is kept in `out/modelimport/.work/<name>/`.

The converter runs in the `cod2-mapcompile` Docker image, built from mapcompile's Dockerfile on the `desktop-linux` context on first use. It is emulated: a model of a few thousand triangles takes seconds, one of 50,000 several minutes.

## Placing the model

The game's front is +X and up is +Z, in inches. glTF and FBX models face +Z with +Y up, which modelimport turns to the game's axes. glTF is in metres, and an FBX file states its unit; `--scale` sets the inches per unit when a file is off. `--rotate pitch,yaw,roll` then turns the model in degrees and `--offset x,y,z` moves it in inches. A player is 70 inches tall.

## What is imported

- Every visible mesh, in the pose three.js draws it: skinned meshes as their bones place them.
- One rigid xmodel: all vertices on the root bone `tag_origin`, one surface per mesh and material. A surface with more than 5000 vertices is split, since the converter takes at most 5450 per surface.
- Normals, UVs and vertex colours.
- One `model phong` material per source material, coloured with the material's colour.

Not imported yet: textures, skeletons and animations, LODs and collision. Not supported: instanced meshes and KTX2 textures. Draco and meshopt compressed files load.
