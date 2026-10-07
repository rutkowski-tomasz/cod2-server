# Build and test

Run from the repository root. The build fails if libcod does not compile:

```bash
docker build --platform linux/amd64 -f docker/Dockerfile --build-arg cod2_patch=3 --build-arg mysql_variant=1 -t cod2-server:local .
```

# libcod

The image builds [zk_libcod](https://github.com/ibuddieat/zk_libcod) at the commit in `libcod/UPSTREAM`, applies `libcod/hooks.patch`, and compiles `libcod/extra/*.cpp` through upstream's `extra/` mechanism.

- Put new code in `libcod/extra/`. Register GSC functions and methods in `libcod/extra/nl_functions.cpp`.
- Change `hooks.patch` only when upstream has no hook for it.
- `libcod/dev.sh` checks out upstream with the patch and `extra/` into `libcod/upstream/` for editing. After editing upstream files there, regenerate the patch: `git -C libcod/upstream diff > libcod/hooks.patch`.
- To update upstream, change `libcod/UPSTREAM`, rerun `dev.sh`, and fix the patch if it no longer applies.

`libcod/CHANGELOG.md` should list only the *current* function signatures. Update it when a function signature is added, changed, or removed.
