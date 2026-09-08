# 14 — The world grid, corner portals, combat pace, and the film look

What changed in the "world design and combat pacing" round, so the build and the docs agree.
Files: `js/world.js`, `js/game.js`, `js/models.js`, `js/main.js`, `js/util.js`, `js/crt.js`,
`js/controls.js`, `js/atmos.js`, `js/terrain.js`, `js/stages.js`, `css/style.css`, `index.html`.

## 1. The Reach as a map (`GH.world.GRID`)

The old travel graph hung gates on the middle of a map edge (N/S/E/W) and linked the territories in
a chain: the hub reached three zones, most zones reached two, and nothing about a gate's position
told you where it went. Guild Wars 2 does the opposite — every zone has a fixed place on one world
map, and you leave a zone through the side that faces the next one.

The Reach now lives on a **diamond lattice**: every territory has a grid cell (`col + row` even), so
its neighbours lie on the four diagonals. Every territory has up to four travel portals and each one
stands in the **corner** of the map that points at its neighbour.

```
          sky            ember           null
               glacier          cloister
   warrens          [ wreck ]           storm
               hive             ruins
                        keep
```

| Corner of ... | NW | NE | SW | SE |
|---|---|---|---|---|
| wreck (hub, danger I) | glacier | cloister | hive | ruins |
| glacier (II) | sky | ember | warrens | wreck |
| cloister (II) | ember | null | wreck | storm |
| hive (III) | warrens | wreck | — | keep |
| ruins (II) | wreck | storm | keep | — |
| ember (III) | — | — | glacier | cloister |
| storm (III) | cloister | — | ruins | — |
| keep (III) | hive | ruins | — | — |
| warrens (IV) | — | glacier | — | hive |
| sky (IV) | — | — | — | glacier |
| null (IV) | — | — | cloister | — |

Danger rises outward from the hub: ring one is II–III, ring two is III–IV, the two far corners are
IV. Every territory is at most two crossings from the hub.

**Crossing.** Leave through the north-east portal and you arrive beside the south-west portal of the
next map, facing north-east, with the camera swung to look into the new territory — one continuous
journey, not a teleport. A black card with the direction and the zone name holds for about a second
(`zoneFade(dir, name)`), the way GW2 shows a zone's name on entry.

**Finding the portals.** A territory portal is a landmark now: twin obelisks, a wider arch, and a
46-unit column of light that reads through the fog from most of the map. The minimap labels each
corner portal with its destination, and a **zone compass** under the minimap lists the four
neighbours with their danger. The WORLD MAP (M) draws the grid — the loaded territory lit, its four
neighbours marked with their corner arrows — above the per-zone cards. Walking within 15 units of a
portal shows `↗ NORTH-EAST PORTAL: VERDANT CLOISTER — DANGER II`.

**Layout consequences.** `gatePos` puts a corner portal 24 units inside the rim on both axes (edge
gates sat 16 in on one axis). Roads still run from every portal toward the map's heart, pads still
flatten the ground under them, the Keep's curtain wall still opens where the roads cross, and the
Hive's caverns and the Court's islands still anchor on the portals. Dungeon exit gates are unchanged
(south edge; a dungeon is not on the grid). Saved positions from the edge-gate era load fine.

## 2. Combat pace (`GH.PACE`)

The Reach was tuned for one-body-at-a-time combat: enemy hull carried a hidden ×1.5, hostiles
noticed you at 11 units and gave up at 32, nest fields refilled slowly. It read as slow. Gun Metal's
combat is a boost-and-strafe cadence — you are always moving, rounds are fast, and things die in
bursts — so the pace now has one dial in `js/util.js`:

| Dial | Value | Effect |
|---|---|---|
| `atkSpd` | 1.3 | primary and vehicle-strafe cycle rate |
| `projSpd` / `projLife` | 1.35 / 0.82 | faster rounds, ~10% more range |
| `moveSpd` | 1.12 | walking speed |
| `dashSpd` / `boostRegen` | 34 / 1.25 | longer boost dashes (was 26 u/s), quicker refill |
| `cdMult` / `energyRegen` | 0.8 / 1.25 | Combat Arts and signatures recharge faster |
| `enemySpd` / `enemyShot` / `enemyFire` | 1.15 / 1.3 / 0.8 | hostiles close faster and shoot faster and more often |
| `enemyHp` | 1.0 | the old ×1.5 hull stack is gone |
| `aggroMelee` / `aggroRanged` / `leash` | 16 / 22 / 44 | fights come to you and more of a field joins |
| `packWake` / `localCap` | 80 / 26 | roaming packs wake sooner; nest fields hold more |

Nest refill is `max(1.3, 4.6 − 0.8·danger)` s (was `max(1.8, 6 − danger)`). Frames keep their
relative balance — `tools/balance.js` reads the raw definitions, which did not change.

## 3. Weather and lanterns

The Aether Court scattered 360 emissive lanterns on poles; from any distance they were a field of
yellow lights hanging in the haze. There are 70 now, clustered along the walks, with a smaller,
dimmer lamp. The rising embers over Ember Core (380 bright orange points) read the same way and are
now 140 smaller, dimmer motes. Snow, rain, dust and void motes are 35–50% thinner. The Court's ground
and fog moved off pure white so the islands and portals read.

## 4. The look

The scene rendered at one-third resolution through a CRT shader by default. It now renders at **half
resolution**, lit by three lights (a softer hemisphere fill, a harder warm key, a cool rim from
behind so steel edges catch), through a **FILM** post pass: soft halation glow, a colour grade (a
touch more contrast and saturation, warm lights and cool shadows, a soft highlight roll-off) and a
vignette — no scanlines, mask or curvature. The tube is still there: CONTROLS → Screen look offers
Film (default), CRT subtle, CRT strong; **H** still toggles the pass. Saved control profiles from
before this round move onto Film once (`settings.look = 2`).
