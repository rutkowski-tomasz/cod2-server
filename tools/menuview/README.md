# menuview

Draws CoD2 `.menu` files outside the game: an interactive page for people, headless screenshots and an item list for agents.

```bash
cd tools/menuview && bun install          # once, playwright-core only
node tools/menuview/menuview.js view   ui_mp/scriptmenus/ingame --open
node tools/menuview/menuview.js render ui_mp/scriptmenus/weapon_select --hover G3
node tools/menuview/menuview.js render ~/Dev/nl-cod2-zom-iwds/iwds/zz.iwd/all/ui_mp/hud.menu --menu Compass,weaponinfo --outline
node tools/menuview/menuview.js info   ui_mp/scriptmenus/perks_combat
node tools/menuview/menuview.js list   ui_mp/scriptmenus
```

Targets are a file path or a game path (`.menu` optional). `#include`s, materials, `.iwi` images, fonts and `@` localized strings are looked up, ignoring case, in the same sources as fxview (later wins): `~/Dev/cod2-binaries/1_0`, `~/Dev/cod2-binaries/1_3`, every `~/Dev/nl-cod2-zom-iwds/iwds/<iwd>/<feature>/` folder, then `--source <dir|iwd>`. For a file path, includes are first looked up next to it, under the folder that holds its `ui_mp/`. Needs `iw_00` (fonts), `iw_06` and `iw_07` (stock menus and headers), `iw_13` (materials), `iw_08`–`iw_12` (images) and `localized_english_iw99` pulled.

In game, the scripts fill many dvars: lists, prices, info lines, selected tiles, images. `dvars.json` holds sample values in the format the scripts in `nl-cod2-zom-scripts` produce, so previews look like a mid-match player's menus. It is applied by default, after the menus' `onOpen` like the scripts do in game; `--dvar name=value` overrides one value, `--dvars <file>` replaces the file and `--empty` starts without samples. `render` and `view` list referenced dvars that still have no value. When a menu gets a new script-filled dvar, add a sample to `dvars.json`.

Output goes to `tools/menuview/out/` unless `-o` is given. `render` writes the page next to the PNG and prints the open menus, script commands it could not run (`scriptMenuResponse`, `exec`, `uiScript`, menus in other files) and missing images.

## Checking a menu as an agent

1. `info`: every item with its 640×480 box, type, text, image and `dvartest` condition, plus unknown keywords and missing assets.
2. `render`, then look at the PNG. Add `--outline` to see item boxes and names, `--hover <name | text | #index>` to see the hover state, `--click <item>` to run an item's action first (a tab switch), and `--dvar name=value` to try other values than the samples (dvar text, `dvartest`, `WINDOW_STYLE_DVAR_SHADER` images).
3. A file with several menuDefs opens those with `visible 1`, else the first one. Use `--menu a,b` to pick others, such as a popup.

## What is drawn

- Preprocessor: `#include`, `#define` with parameters, `##` (a quoted string pasted to a name stays quoted, like `"hl" ## _hl`), `#ifdef`/`#ifndef`/`#else`/`#endif`.
- Layout: item rects are relative to their menu's rect and take its alignment unless they set their own. `origin` is added. Alignments `CENTER` and `RIGHT`/`BOTTOM` shift by half or all of 640×480. Safe areas are ignored, since the PC game stretches 640×480 to the screen.
- Window styles: filled, gradient, shader (image tinted by `forecolor`), dvar shader. Borders: full, horizontal, vertical.
- Text: the game's own font glyphs, scaled so the font's height becomes 48 × `textscale`. Baseline at `textaligny`, alignment around `textalignx`, `^0`–`^9` colors, `\n`, shadowed and outlined styles, `maxpaintchars` is ignored. `textfont 0` picks small, normal or big by scale (≤ 0.25, between, ≥ 0.4).
- Items without text show their `dvar` value. Edit fields, yes/no, multi (`dvarStrList`), slider and bind items draw their value after the label.
- Visibility: `visible`, `dvartest` with `showDvar`/`hideDvar`.
- Scripts: `onOpen` runs when a menu opens. In the page, hovering runs `mouseEnter` and `onFocus`, leaving runs `mouseExit` and `leaveFocus`, clicking runs `action`, keys run `execKey`, Esc runs `onEsc`. Supported commands: `show`, `hide`, `setcolor`, `setitemcolor`, `setdvar`, `open` and `close` for menus in the same file. Others are logged. Hovered interactive items use the menu's `focuscolor`.

Not drawn: ownerdraws (dashed boxes with their `CG_*`/`UI_*` name; their `background` image is drawn, which shows the low-health overlay at full strength), list boxes, cinematics, 3D models, blinking and pulsing text, fades, `blurWorld`. Guesses that may be off: the shadow offset (1 unit, 2 for `SHADOWEDMORE`), the `^8` (orange) and `^9` (gray) colors, and text placed after a field's label.
