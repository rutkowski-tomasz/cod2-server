# modelview

Shows CoD2 xmodels outside the game: models, a weapon in first and third person, and xanim animations. It builds a standalone three.js page for people, and headless contact sheets for agents.

```bash
cd tools/modelview && bun install          # once: three and playwright-core
node tools/modelview/modelview.js view   mp40_mp --open
node tools/modelview/modelview.js render mp40_mp --anim reload
node tools/modelview/modelview.js render mp40_mp --person third
node tools/modelview/modelview.js render playerbody_american_normandy01 --attach head_us_ranger_braeburn,helmet_us_ranger_generic --anim pb_stand_death_spin
node tools/modelview/modelview.js render crate01
node tools/modelview/modelview.js info   mp40_mp
node tools/modelview/modelview.js list   xanim/pb_stand
```

A target is one of:
- **A weapon file name** under `weapons/mp/`, such as `mp40_mp`. It has two views:
  - `first`: the viewmodel. This is the weapon file's `handModel` (or `--hands`) with its `gunModel` hanging from `tag_weapon`, seen from the eye with cg_fov 80. It comes with every view animation the weapon file names: `idle`, `fire`, `reload`, `reloadEmpty`, `reloadStart` (segmented reloads only), `reloadEnd`, `melee`, `adsUp`, `adsFire` and `adsDown`, plus `aimed`, the last frame of `adsUp` held. Reload animations last their time in the weapon file, as in game, except `reloadEnd`, which lasts `reloadTime`.
  - `third`: mapview's rifleman (or `--body`) holding the weapon's `worldModel` on `tag_weapon_right`. He plays the standing idle that `mp/playeranim.script` picks for the weapon class: `pb_stand_alert_pistol` for pistols, `pb_stand_grenade_pullpin` for grenades, `pb_stand_alert` for everything else.
- **An xmodel**, such as `xmodel/crate01` or `crate01`. `--attach` hangs more models on the bones they share by name, such as a head and helmet on a body.
- **A file path** to either one, such as `~/Dev/nl-cod2-zom-iwds/iwds/zz.iwd/all/weapons/mp/ak47_mp`. The folder above `xmodel/` or `weapons/mp/` becomes an extra source.

Assets are looked up like fxview's, ignoring case, in this order (later wins): stock `~/Dev/cod2-binaries`, then nL's `~/Dev/nl-cod2-zom-iwds/iwds/<iwd>/<feature>/` folders, then `--source`. Models need `iw_13` and `iw_14`, animations `iw_13`, and textures `iw_08`–`iw_12`.

`--anim a,b` adds xanims. Each one goes to the view whose rig has the most of the bones it moves, so `pb_*` animations land in third person and `viewmodel_*` ones in first person. It holds the view's idle pose on the bones it does not move, as the game plays a torso animation over the legs' idle: `--person third --anim pt_reload_stand_rifle` reloads standing. Third-person reload and fire animations are the `torso` ones in `mp/playeranim.script`, such as `pt_reload_stand_rifle`, `pt_rifle_fire` and `pt_stand_shoot_auto`. In first person, `--anim reload` picks one of the weapon's own animations. The first name a view has is the one it shows first. The page's picker switches between all of them.

Output goes to `out/modelview/` unless `-o` is given. `render` writes the page next to the sheet, so the same frames can be checked interactively.

## Checking a model as an agent

1. `info`: bones, tags, surfaces with their materials and images, and animations with frames, fps and length. A missing image or xanim is printed, and will be missing in game too.
2. `render`: with an animation, `--frames 8` spread from its first frame to its last, or `--times` in ms. Without one, `--frames 4` views around the model, or a single frame from the eye in first person. Each cell is labelled with its frame and time, or its yaw.
3. Look at the sheet. `--cam yaw,pitch,dist` keeps a fixed view between iterations; yaw 0 looks at the model's front (+X). `--bones on` draws the skeleton and tag names, which helps when attaching models or effects. `--bg mid` helps with dark textures. The grid's cell size, a power of two near the model's radius, is shown on the page.
4. For a weapon, render both `--person first` and `--person third`. To compare first person with the game, use the in-game shots on IMFDB's Call of Duty 2 page.

## What is drawn

- Skinned and rigid xmodels at their first LOD, posed by `readRig` in `tools/shared/xmodel.js`, so hands stay whole where vertices follow several bones.
- Animations as mapview plays them: rotations replace a bone's own, and translations are offsets from its position in the model file. Each weapon view animation has the last frame of an aiming animation baked in, as the game plays them side by side: the weapon's `adsDownAnim` at the hip, its `adsUpAnim` while aiming, and `adsUp` and `adsDown` the idle's; a bone both move takes the average of the two.
- Materials: the colour map times the vertex colour, with alpha test or blend mode from the techset, lit as mapview lights models in a compiled map: half the light everywhere plus a sun by N·L, here one that follows the camera. Normal and specular maps are drawn as mapview draws them, embedded at 256 px; `--normals off` turns them off.

Not drawn: other LODs, collision, effects (muzzle flash, brass), notetracks and sounds, the movement of `tag_origin` in walking animations, the controllers that turn a third-person player's torso toward where it aims, and two animations blended at once (legs and torso).
