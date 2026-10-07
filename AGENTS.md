# Build and test

Run from the repository root. The build fails if libcod does not compile:

```bash
docker build --platform linux/amd64 -f docker/Dockerfile --build-arg cod2_patch=3 --build-arg mysql_variant=1 -t cod2-server:local .
```

# libcod

The image builds [zk_libcod](https://github.com/ibuddieat/zk_libcod) at the commit in `libcod/UPSTREAM`, applies `libcod/hooks.patch`, and compiles it with `libcod/doit.sh`, which also compiles `libcod/extra/*.cpp`.

- Put new code in `libcod/extra/`. Register GSC functions and methods in `libcod/extra/nl_functions.cpp`.
- Prefix new files in `extra/` with `nl_`: their object files share a folder with upstream's and would overwrite one with the same name.
- Change `hooks.patch` only when upstream has no hook for it.
- `libcod/dev.sh` checks out upstream with the patch and `extra/` into `libcod/zk_libcod/` for editing. After editing upstream files there, regenerate the patch: `git -C libcod/zk_libcod diff > libcod/hooks.patch`.
- To update upstream, change `libcod/UPSTREAM`, rerun `dev.sh`, and fix the patch if it no longer applies.

`libcod/FUNCTIONS.md` should list only the *current* function signatures. Update it when a function signature is added, changed, or removed.

# infra

Pushing changes under `infra/services/` to `master` deploys that service to production. Config names include a file hash set by the workflow (`*_HASH`), so editing the file is enough to roll out a new config. Image digests stay pinned unless the image changes (`--resolve-image changed`).
