# Dynasty

Michael's life franchise-mode app: 12-week seasons, 10 rated attributes, quests, and a trophy case.

## Use it
Open https://mikenels24.github.io/dynasty/ in Safari on iPhone → Share → Add to Home Screen.
Your data lives only on that phone. Back up from Season → Front Office.

## Layout
- Root (`index.html`, `sw.js`, `manifest.webmanifest`, icons): the built app GitHub Pages serves.
- `source/`: editable source (`src/engine.js` scoring rules, `src/app.html` UI), `build.py`, tests.

## Build and test
```
cd source && node test/engine.test.js && python3 build.py   # output in source/dist/site, copy to repo root
```
