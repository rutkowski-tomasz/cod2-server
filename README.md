# pr-assets

Before and after screenshots of changes, one folder per change: `<area>/<topic>/`.

- `<area>` is the tool or thing that changed (`mapview`, `fxview`, `menuview`).
- `title.txt` holds one line shown in the index, like `mapview: draw normal and specular maps`. Use the PR or commit title, scope first.
- Name screenshots `<view>_before.png` and `<view>_after.png`; the pair shows side by side. Any other image gets a row of its own.
- The tools write an html page (and fxview `--stats` a json) next to each render; `.gitignore` keeps them out of the branch.

PRs embed these images from GitHub, so never rename or move a folder that a PR links to.

## Browse

```bash
git worktree add ../cod2-server-pr-assets pr-assets   # once, from cod2-server
cd ../cod2-server-pr-assets
curl -sf localhost:8642 >/dev/null || nohup node serve.js >/dev/null 2>&1 &
```

Then open http://localhost:8642/: every change, newest first. Open one to see its before and after side by side.
