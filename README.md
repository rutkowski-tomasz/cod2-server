# pr-assets

Before and after screenshots of changes, one folder per change: `<area>/<what-changed>/`, such as `mapview/draw-normal-and-specular-maps/`. The path is the title: the index shows it as `mapview: draw normal and specular maps`.

- `<area>` is the tool or thing that changed (`mapview`, `fxview`, `menuview`). `<what-changed>` is the PR or commit title in lowercase kebab-case.
- Everything changed in one conversation goes in one folder.
- Name screenshots `<view>_before.png` and `<view>_after.png`; the pair shows side by side. Any other image gets a row of its own.
- The tools write an html page next to each render; the index links it as "interactive". `.gitignore` keeps these pages (mapview's are about 30 MB) and fxview's `--stats` json out of git, so they exist only where they were rendered.
- A folder is dated by its first commit, so keep that commit's date when moving one.

PRs embed these images from GitHub. After renaming or moving a folder, update the links in the PRs that use it.

## Browse

```bash
git worktree add ~/cod2-server-pr-assets pr-assets   # once, from cod2-server
cd ~/cod2-server-pr-assets
curl -sf localhost:8642 >/dev/null || nohup node serve.js >/dev/null 2>&1 &
```

Then open http://localhost:8642/: every change, newest first. Open one to see its before and after side by side.
