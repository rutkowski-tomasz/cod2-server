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
- One xmodel with the root bone `tag_origin`. A skinned mesh's bones go under it, in the pose three.js draws them and without their scale, which makes an `animated` xmodel; its vertices keep their weights. Any other mesh follows the bone it hangs under, or `tag_origin`. At most 128 bones, the game's limit. One surface per mesh and material. A surface with more than 4000 vertices is split. The converter takes at most 5450 per surface, and it adds vertices of its own at UV seams.
- With `--simplify <share>`, each mesh keeps that share of its triangles in each material, such as 0.25 for a quarter. Edges collapse where they change the shape and shading least. UV seams and open borders keep their outline. Downloads often have far more triangles than a CoD2 model needs.
- Normals, UVs (through a map's texture transform and from the UV set it reads) and vertex colours.
- One `model phong` material per source material. Its colour map is the source's, times the material's colour, scaled to power-of-two sides of at most `--texture-size` (default 1024). Without a colour map, it is the material's colour.
- Alpha, from the colour map, the material's opacity and an FBX alpha map: a glTF `MASK` material cuts out at half alpha (`GE128`); a glTF `BLEND` material, or a transparent FBX one, blends. Double-sided materials draw both sides.

Not imported yet: normal and specular maps, animations, LODs and collision. FBXLoader reads an FBX colour map only when it is linked as `DiffuseColor`, as Blender and most exporters write it. 3ds Max's Physical material links it as `base_color_texture`, which is lost: import such a model's glTF instead. Not supported: instanced meshes and KTX2 textures. Draco and meshopt compressed files load.
