# Port Solano: Windows desktop preview

An early native Windows build of Port Solano, made with Godot 4.6.3. It runs without a browser. The browser game in the rest of this repository is unchanged and is still the main version.

## Download and play

1. Download [PortSolano-Windows-Preview.zip](https://github.com/Jakeclur/CTA/raw/main/desktop/PortSolano-Windows-Preview.zip) (about 71 MB).
2. Extract the whole ZIP into a folder.
3. Open `PortSolano.exe`. Windows SmartScreen may warn that the app is unrecognised because it is not code-signed. Choose **More info** then **Run anyway**.

Start on the **Balanced** graphics setting at 1080p.

## Controls

- WASD: walk or drive. Shift: sprint. Space: jump or handbrake.
- E: enter or exit a stopped car.
- 1 to 4: fists, pistol, shotgun, rifle. Left mouse: attack. Right mouse: aim. R: reload.
- F: buy health and ammunition for $100 at the supplies crate near the start.
- J: start the courier route. M: map (click to set a waypoint).
- N: day or night. T: run or pause the day cycle. F11: fullscreen. Esc: pause.

## What is in this preview

Seeded city layout, scanned PBR surfaces and HDR sky, the attributed Car Concept vehicle, shadows and SSAO, on-foot movement, driving, firearms and melee, police, a courier route, a map with waypoints, day and night, and saves. It is not feature parity with the browser game yet: the full missions, shops and garage, richer traffic and police, rain and more vehicles are still to be ported. Browser saves do not carry over.

The ZIP contains only the compiled game. The Godot project source is not part of this upload. See [BUILD-NOTES.txt](BUILD-NOTES.txt) for the full build notes.

## Credits and licences

See [CREDITS.txt](CREDITS.txt) and the [licenses](licenses/) folder. Godot is MIT licensed. Car Concept is by Eric Chadwick / Darmstadt Graphics Group GmbH (2024), CC BY 4.0. Textures, bench and HDR are from Poly Haven and ambientCG (CC0).
