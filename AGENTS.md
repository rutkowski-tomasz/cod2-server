# Build and test

Run from the repository root. The build fails if libcod does not compile. Build against a local Docker context, never a remote one: `desktop-linux` is Docker Desktop's; if yours has another name (`docker context ls`), use that.

```bash
docker --context desktop-linux build --platform linux/amd64 -f server/Dockerfile --build-arg cod2_patch=3 --build-arg mysql_variant=1 -t cod2-server:local .
```

# server

The image builds [zk_libcod](https://github.com/ibuddieat/zk_libcod) at the commit in `server/UPSTREAM`, applies `server/hooks.patch`, copies in `server/extra/`, and compiles it all with upstream's `doit.sh`.

- Put new code in `server/extra/`. Register GSC functions and methods in `server/extra/nl_functions.cpp`.
- Include upstream headers from `extra/` as `"../name.hpp"`: upstream's `doit.sh` adds no include path for them.
- Change `hooks.patch` only when upstream has no hook for it.
- `server/dev.sh` checks out upstream with the patch and `extra/` into `server/zk_libcod/` for editing. After editing upstream files there, regenerate the patch: `git -C server/zk_libcod diff > server/hooks.patch`.
- To update upstream, change `server/UPSTREAM`, rerun `dev.sh`, and fix the patch if it no longer applies.

`server/FUNCTIONS.md` should list only the *current* function signatures. Update it when a function signature is added, changed, or removed.

# tools

The tools are tested but can still have bugs or missing parts. If one gets in your way while you work on something else, fix it when the fix is small. Otherwise, suggest the fix.

`tools/fxview/` previews `.efx` effects without the game: `node tools/fxview/fxview.js render <efx>` writes a contact sheet to look at, `view` an interactive page, `info` the element list. See `tools/fxview/README.md`.

`tools/menuview/` previews `.menu` files without the game: `node tools/menuview/menuview.js render <menu>` writes a screenshot to look at, `view` an interactive page, `info` the items and their boxes. See `tools/menuview/README.md`.

`tools/mapview/` draws maps (`.map`, `.d3dbsp`, a map's `.iwd` or a stock name) without the game: `node tools/mapview/mapview.js render <map> --at mp_tdm_spawn` writes a screenshot to look at, `view` an interactive page, `info` the entities and materials. See `tools/mapview/README.md`.

`tools/mapcompile/` compiles a `.map` into a map `.iwd` with the Mod Tools under wine in Docker: `tools/mapcompile/mapcompile.sh <file.map> [-o out.iwd] [--fast]`; `--fast` makes lighting about 7× quicker but rougher, for test builds. See `tools/mapcompile/README.md`.

`tools/mapdecompile/` turns a `.d3dbsp` back into a `.map`: `node tools/mapdecompile/mapdecompile.js <d3dbsp | iwd | mp_name> [-o out.map]`. See `tools/mapdecompile/README.md`.

`tools/shared/` holds what the tools share: the asset search over iwds and folders, the `.d3dbsp` reader, material, xmodel, IWI (with its wavelet formats, GPLv3) and PNG codecs, and the module inliner for their file:// pages.

fxview, menuview, mapview, mapcompile and mapdecompile write to `out/<tool>/` (git-ignored) unless `-o` is given; that is scratch.

Before/after screenshots of a change go on the `pr-assets` branch, which PRs embed images from. Check it out once with `git worktree add ~/cod2-server-pr-assets pr-assets`, then follow its `README.md`.

# stacks

Pushing changes under `stacks/<name>/` to `master` deploys that stack to production. Each stack has a small `deploy-<name>.yml` workflow that calls the shared `deploy-stack.yml`. Config names end with `${CONFIG_HASH}`, a hash of every file in the stack folder except `compose.yml`, so editing a config file is enough to roll it out. After deploying, the workflow removes the stack's old configs. Image digests stay pinned unless the image changes (`--resolve-image changed`).
