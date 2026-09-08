# STAALREUS

Build your steel giant. Enter the Reach. Become a legend.

**STAALREUS** (Afrikaans: "steel giant") is a browser-based open-world mech action RPG about building steel giants — frames — and taking a persistent pilot through the Shattered Reach: territories, houses, dungeons, hunts, high-speed races, and the Gauntlet.

## Overview

In STAALREUS, you pilot an evolving machine through a world of missions and arenas where performance, upgrades, and strategy all matter. Under every frame sits a pilot in the old action-RPG mould: six attributes that grow with every level, Combat Arts deepened by reading runes, a skill tree, a quest journal, houses to pledge to, and overlapping difficulty bands. Every run helps you gather resources, unlock new parts, and shape a frame built for your playstyle.

## Core Gameplay

- **Develop Your Pilot and Frame**  
  Place attribute points, read runes into Combat Arts, train the skill tree, tune loadouts, and refine your build for different mission types.
- **Take On Quests**  
  Complete objectives across hostile zones to earn progression rewards and unlock tougher operations.
- **Dominate Races**  
  Push your machine to its limits in speed-focused Circuit events where handling and timing decide winners.
- **Run the Gauntlet**  
  Sixteen assaults on one stage — a warden, an overrun, and a REVENANT frame at the end. Bring it down to recover that frame and open the next stage.

## Progression Loop

1. Accept missions and challenges.
2. Earn parts, currency, and upgrade materials.
3. Improve your pilot (attributes, arts, skills) and your frame (workshop, gems, vehicles).
4. Re-enter harder quests and races for greater rewards.

## Key Features

- Single-player open-world mech action RPG in the browser
- A persistent pilot: six attributes (auto-growth plus one free point per level), Combat Art runes, an 18-node skill tree, a quest journal
- Build-focused frame development system: 135 frames, 23 vehicles
- Five houses, fifty hunts, zone diaries, a daily board, relic seasons, stage trials
- Overlapping difficulty bands (BRONZE → PLATINUM) that scale the whole world

## Controls (rebindable under CONTROLS)

MMO-style: **W/S** walk, **A/D** turn, **Q/E** strafe, **hold RIGHT MOUSE** to look around, **WHEEL** zooms.
**LEFT CLICK** attacks and marks a target, **TAB** cycles targets, **1–4** abilities, **Z/X/C** wards,
**SPACE** boost / drift, **SHIFT** special / nitro, **T** transform (W throttle, S brake, A/D steer),
**F** interact, **V** tactical camera, **K** training, **M** map, **P** pilot sheet, **J** quest journal, **ESC** pause / close any menu.
**H** toggles the screen shader; CONTROLS → Screen look picks FILM (glow, vignette, colour grade — the default) or a subtle / strong CRT tube.

## Travelling the Reach

The eleven territories sit on one world grid, the way Guild Wars 2 lays out its zones. Every territory
has up to four **portals, one in each corner**, and each corner points at the neighbour that lies in
that direction: leave the hub through the north-east portal and you arrive in the south-west corner of
the Verdant Cloister, still walking north-east. A zone compass under the minimap names what lies
through each corner, the minimap labels every portal, and the WORLD MAP (M) draws the whole grid.
Danger rises outward from the hub; no territory is more than two crossings away. Territories you have
stood in become **waypoints**: click them on the map to travel for salvage.

The Reach acts on its own: every minute or so a **dynamic event** lights up somewhere in the territory
(escort a hauler, hold a portal against a push, relight three dark beacons, a bounty on a nest) with a
tracker, a timer and a bearing on the HUD, and pays on completion. Crashed hulks can be scavenged.
In a fight, a boost dash through an attack shows **EVADE** and refunds meter, quick kills stack a
**CHAIN** multiplier with salvage milestones, and transforming fires a shockwave.
Details: `docs/design/14-world-grid-pace-look.md` (also the combat pace dial `GH.PACE` in `js/util.js`).

## The 135 frames

- **2 starters** (AEGIS, VULCAN) are yours from the first sortie.
- **4 feat frames** (FANG, HEXEN, VIPER, MORROW) are recovered from their REVENANTS: the dead pilots still driving them at the end of a GAUNTLET stage (or in its lair in the Reach).
- **129 built frames** are assembled in the HANGAR → FRAME WORKSHOP from ⬡ ALLOY (drops from hostiles and
  elites), ◈ FRAME CORES (bosses, wardens, stage clears, dungeon caches) and $ SALVAGE. Each of the 8 lineages
  has 5 packs (AILE, SWORD, LAUNCHER, STORM, PHANTOM) in 3 marks (MK.II → CUSTOM → PROTOTYPE), plus 7 RELIC
  frames gated behind feats.

## The pilot: attributes, Combat Arts, runes, journal

Every pilot level pays one skill point (PILOT TRAINING) and **one free attribute point** (ATTRIBUTES & ARTS).
The six attributes — MIGHT, REACTOR, HULL, SERVO, COOLANT, UPLINK — also grow on their own each level by a
tenth of the lineage's starting spread, so a frame keeps its character and a point is a nudge, never a trap.
RECALIBRATE refunds placed points for salvage. UPLINK raises loot find (alloy, coin and rune drops).

The four abilities and the lineage signature are **Combat Arts**. **ART RUNES** drop from every boss (two from a
revenant) and sometimes from elites; reading one into an art raises its rank — +12% power, +8% recharge —
and only REACTOR pulls the recharge back down. The **QUEST JOURNAL** (J) lists every open contract, daily task,
diary tier, gauntlet trial, season task and feat in one ledger.

## First sortie, saves, sound

A fresh profile's first PLAY is **ZERO HOUR**, a ten-minute guided sortie (replay or skip from the pause
menu). Saves live in the browser: HANGAR → SAVE CODE offers a copyable code, a downloadable save file, and
four automatic backups with one-click restore. Music is composed procedurally per zone and situation
(battle, sortie, race, victory, hangar); CONTROLS has separate music and effects volumes.

## Reach bands

The open world runs at BRONZE, SILVER, GOLD or PLATINUM (title screen or PILOT sheet). Higher bands scale
enemies up and pay more alloy, salvage and cores; they unlock through hunts, diaries, pilot level and gauntlet clears.

## Signatures, hunts, the hangar viewer

Every lineage has a signature ability on key 5. Fifty named HUNT bosses roam the Reach (one per territory
per day, at a skull totem) and stand in for arena midbosses; each fights with its own mechanics and fills the
BESTIARY. The workshop shows the frame you're building and its vehicle turning on a plinth.

## Vehicles, drifting, and living in the Reach

Every lineage folds into two vehicles (23 designs: tanks, crawlers, bikes, beasts, discs, waveriders);
pick one on the frame select screen and build the second in the WORKSHOP → VECTORS tab. Drifting charges a
turbo through three tiers and pays it on release; a slide cooks the skids after 3.4 s. Nitro launches you
higher off crests and keeps burning in the air. The Reach has zone diaries (WORLD MAP), a daily task board
(BROKER), alloy veins to mine, and cache signals to chase. Details: `docs/design/13-world-life-vehicles-balance.md`.
`node tools/balance.js` audits frame power; `tools/gallery.html` renders every frame and vehicle.

## Runs

From the pause menu: **EXIT RUN** saves (the Reach keeps your pilot; a gauntlet or arena climb is parked at its
current wave and offered as CONTINUE RUN on the title), **NEW RUN** or **ABANDON RUN** delete it after a confirm.

## Play online

The latest `main` is deployed by GitHub Pages at <https://imyala.github.io/StaalReus/>. Bug reports and feedback:
<https://github.com/Imyala/StaalReus/issues> (also linked from the title screen).

## Play Locally

No complex setup required.

- Open `index.html` in a modern browser, or
- Run a local server:

```bash
python3 -m http.server
```

Then visit `http://localhost:8000`. `node tools/build-single.js` rebuilds `dist/staalreus.html`, a single-file build.
Dev URL flags: `?unlock=all`, `?salvage=N`, `?mats=N`, `?wave=N`.

## Design Bible

The target design (a Gun Metal style transforming mech game with NFS Underground handling in vehicle
form and Sacred/WoW build depth) lives in [`docs/design/`](docs/design/00-overview.md). The research
it is distilled from (classic mech games, NFS Underground, Armagetron, Sacred Gold, WoW,
Mobile Suit Gundam, Evangelion, Gurren Lagann) is in [`docs/research/`](docs/research/README.md).
Note: older design docs call the game HERO FRAME or Gundam Circuit; the name is now STAALREUS.

## Project Structure

- `/js` — game logic and systems (`world.js` the world grid and zone layouts, `util.js` the `GH.PACE` combat-pace dial, `controls.js` key bindings, `roster.js` the 135-frame roster and workshop, `attrs.js` attributes and Combat Art runes)
- `/css` — UI and presentation styles
- `/lib` — third-party runtime libraries
- `/dist` — bundled output
- `/docs/design` — design bible (15 documents)
- `/docs/research` — raw research reports

## Roadmap Ideas

- Expanded frame part families and specialization paths
- Additional Circuit race tracks and modifiers
- New quest biomes and boss challenge tiers
- Seasonal challenge ladders and rewards

## License

See [LICENSE](LICENSE).
