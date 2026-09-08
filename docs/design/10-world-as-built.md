# 10 — The world as built (terrain, biomes, fauna, tracks)

What shipped in the code for the "make the world amazing" round, so the design docs and the
build agree. Files: `js/terrain.js` (new), `js/atmos.js` (new), `js/models.js`, `js/enemies.js`,
`js/stages.js`, `js/dungeons.js`, `js/world.js`, `js/game.js`, `js/race.js`, `js/assets.js`.

## Shaking objects

The PS1 vertex snap quantised clip space to a 96-step grid regardless of render size. At one-third
resolution that was a jump of about three pixels per step, so everything lurched as the camera
moved. The snap now tracks the real framebuffer (`GH.assets.setSnap` from the resize handler), which
keeps the retro wobble at exactly one render pixel.

## Terrain

Every zone owns an analytic height field `h(x, z)` (seeded value noise, biome shaping, flat pads
under installations, a sealed rim). The same function drives the ground mesh, every entity's y, the
camera, vehicle physics and surface queries. Zones load in 0.2 to 1.0 s in a headless Chromium.

| Zone | Biome | Shape | Ground | Surface effects |
|---|---|---|---|---|
| wreck | DUNE COAST | NE-running dune ridges, a beach and sea to the south (the camp is on the beach) | sand | soft: bog and jump; water hydroplanes |
| glacier | FROST RANGE | rolling valleys, ridged mountain ranges, frozen lakes | snow | soft: snowbound and drift jumps; lakes are ice |
| cloister | RAIN CANOPY | rolling hills, ponds and river basins | moss | water slows, mud slows |
| ember | CINDER WASTES | cinder cones, lava basins with a lava plane | basalt | lava burns both forms |
| storm | THUNDER HIGHLANDS | terraced mesas | slate | none (lightning is the hazard) |
| null | VOID SANCTUM | shard ridges and chasms | void | low gravity (11 vs 24): long jumps |

**Map edge.** A 16-unit cliff bank starts 10 units inside the playable edge, then mountains rise
to about 60 units over the next 100, with ridged noise on top. Portal pads carve level ground in the
four corners so the travel portals stay reachable (see doc 14 for the world grid). Fog now runs 30 to 98 units in the open so hills and the rim
read before the haze takes them. You cannot see off the map from any position or form.

**Pads.** Camp, circuit ring, duel pit, gates, nests, relays, lairs, vaults, chests, objectives,
checkpoints, convoy waypoints and breaches sit on flat pads blended into the field.

**Roads and stains** are painted into the terrain's vertex colours instead of floating decals.

## Vehicle physics on terrain (`updateDrive`)

- Gravity along the slope: climbs bleed speed, descents lend it, sheer rock stops you.
- **Soft ground on a steep face** (sand, snow): above 58% of top speed you launch (`DUNE JUMP`
  / `DRIFT JUMP`); below 48% you bog down. Bogged: forward is a crawl, **reverse gear digs you out**.
- **Crests**: leaving a downslope above 70% top speed goes airborne. Airborne: 25% steering,
  grip 0.6, gravity per biome, hard landings scrub speed and shake the camera. Air time above
  1.5 units banks nitro.
- Reverse gear: hold the opposite direction below 1.5 speed.
- Water: hydroplane (ice grip) and a 70% cap. Lava: burn ticks.
- Races: more than 1.2 units outside the ribbon edge is `OFF TRACK`, 110%/s drag.
- The drive HUD prints one word: `DRIFT`, `BOGGED — REVERSE`, `SNOWBOUND — REVERSE`, `AIR`, `OFF TRACK`.
- The hull pitches with the ground and with its flight arc.

Frame form: climbing costs stride (up to 55% at slope 0.8), descending lends up to 25%, slopes over
1.15 are walls. Water 62%, mud 80%, lava burns, `CHILLED` and `SNARED` statuses from fauna.

## Weather (`GH.atmos`)

One particle cloud per zone wrapped around the pilot: snow (900 flakes), rain streaks (line
segments, 700 to 900), rising embers, wind-gusted sand, drifting void motes. Dungeons get 35%.

## Vegetation and rock

Per-biome prop kinds, clustered by density noise into groves and boulder fields, stamped from
six authored variants per kind into a handful of merged meshes (about 3,000 to 5,000 props per
zone, 10 to 20 draw calls).

| Zone | Kinds |
|---|---|
| wreck | palm, saguaro cactus, dune rock, wreck ribs, bones |
| glacier | snow-capped pine, snow rock, ice spire, dead tree |
| cloister | jungle tree with buttress roots, fern, vine curtain, glowing mushroom, moss rock |
| ember | basalt column cluster, lava rock with glowing seam, charred tree with ember tips, vent stack |
| storm | slate spire, heather, dead tree, menhir |
| null | crystal, floating shard, monolith with a violet stripe, void reed |

## Zone-native hostiles

Common fauna is tinted per zone. Eleven new types with five new behaviours:

| Zone | Type | Behaviour |
|---|---|---|
| wreck | Dune Scarab | armoured chaser, takes 60% damage |
| wreck | Sand Maw | **burrower**: tunnels fast under the crowd (plume only, 30% damage taken), telegraphs, erupts to bite for 2.6 s, re-buries |
| glacier | Frost Stalker | pack dasher, pounces |
| glacier | Rime Wisp | frost shots chill the frame (60% speed for 1.6 s) |
| cloister | Vine Lurker | **ambusher**: a bush until you are within 6.5 units, snares you if inside 4.2, then lunges |
| cloister | Spore Bloat | slow sac; on death a chilling spore cloud |
| ember | Magma Crawler | leaves a burning trail while hunting |
| ember, storm | Drake | **flyer**: circles at height 3.2, dives to strike; melee reaches it only on the dive |
| storm | Storm Sentinel | floating obelisk, three-shot arc bursts |
| null | Void Phantom | **phantom**: blinks out (invulnerable), reappears 4.2 units from you |
| null | Null Shard | crystalline skirmisher, void shots |

Stage rosters and expedition packs use them from wave 2 to 5 onward.

## Race tracks

`genRaceway(size, zoneId)` builds a closed Catmull-Rom spline from authored control points:
DUNE RUN (wreck, esses and a hairpin), THUNDER RIDGE (storm, hairpins), CALDERA LOOP (ember),
ICEFALL (glacier), plus a ring fallback. `GH.terrain.buildTrack` lays a 14-unit ribbon with
red-white curbs and a dashed centre line conforming to the field, tyre walls on the outside of
every real corner, light posts on both sides, and the start gantry across the line. Raceway
dungeons use a gentle field (28% amplitude) so the asphalt rolls.

## Dungeons

Every dungeon is themed by its territory: the biome's ground and rock, 30% prop density, the
territory's weather at 35%, and its **hazard** placed in the field (ice sheets, vine snares, vents,
lightning, drifting rifts), except in authored floors (labyrinth, halls, fluxways, raceway).
Depths, hive and crucible dungeons also carry the biome's water or lava plane.

## Dev hooks

`GH.game.devZone(id)`, `GH.game.devSpeeder(on)`, `GH.game.devState()` drive the headless harness in
the scratchpad (`test.js`, `race.js`, `track.js`): zone loads, screenshots, a scripted race, reverse
and dune-jump checks, and a console-error sweep.

---

## Round two: built territories, collision, 3D circuits, more fauna

**Collision.** Trees, rocks, spires, walls, towers and buildings register circle or box colliders
in a spatial hash; the pilot, wingmate and every grounded enemy are pushed out each frame. Vehicles
that hit one trigger the existing crash rule (speed and nitro dumped). Burrowers and flyers ignore it.

**Five new territories** (expedition only; classic mode keeps its six stages). The travel graph now
has eleven nodes: wreck N → hive, cloister N → ruins, ember S → keep, storm S → warrens, null N → sky,
plus hive E ↔ ruins W and keep E ↔ warrens W.

| Zone | Danger | Made of | Special rule |
|---|---|---|---|
| **SPIRE HIVE** | III | a street grid of stacked hab-blocks with window bands, terraces climbing to a six-tier spire with a beacon | blackout weather closes the fog in |
| **FALLEN CITADEL** | II | colonnades, arches, wall fragments, a dome, plazas with a statue, drowned basins, jungle overgrowth | duststorm weather |
| **BASTION KEEP** | III | an octagonal curtain wall with towers and gatehouses, a moat with bridges at the roads, a donjon, barracks in the wards | siege fog |
| **DEEP WARRENS** | IV | cavern cities cut into solid rock, joined by tunnels; rock is impassable; hab-caves, stalagmites, glowing fungus | dark: lamps and fungus, gas-leak weather ignites pockets |
| **AETHER COURT** | IV | islands hanging over a cloud floor, bridges between them, white towers, arches, the crown court | low gravity; stepping off an island drops you, then the wind returns you to your last footing at a 15% hull cost; gale weather shoves vehicles |

**Structures** (`js/structures.js`) lay out before the ground mesh so the field flattens under them,
then raise merged meshes with colliders. Dungeons of built zones use plain ground in the same palette.

**3D circuits.** Every track carries a height profile, jump gaps, boost pads and banking. The ribbon
rides the ground plus its profile; the field's height function returns the ribbon on it, so vehicles,
rivals and pickups climb it, leave the ground at gap lips, land on the next section, and lean into
banked corners (the hull rolls with the lateral slope). Elevated sections get pillars and rails.
Boost pads push you to 135% top speed for 1.6 s. New circuits: SPIRE CIRCUIT (hive, an 18-unit
elevated loop), CROWN RING (sky, two gaps). THUNDER RIDGE gained a 12-unit bridge and a jump,
DUNE RUN a hill and a jump, ICEFALL a 14-unit descent, CALDERA a jump over the basin.

**More fauna** (twenty new types): Beak Strider, Tide Leech, Howler (calls stalkers), Mandible
Skitter, Bellow Toad, Cinder Hound, Slag Golem (ground slam), Rod Sentry and Ballista (rooted
turrets), Eye Cluster (three-way spread), Masked Slinger, Hab Brute, Warden Knight, Grave Stalker,
Carrion Kite, Glow Mite, Tunnel Maw, Fungal Shambler, Aether Ray, Cloud Wisp. New behaviours:
slammer, turret, caller, latcher (snares on contact), spread volleys. Spawns search for open ground,
never inside rock, a building, or over the sky.

---

## Round three: the recommendation list and the houses

- **Chase camera** (default; V toggles the tactical top-down view). Behind the frame at 10 units,
  behind a vehicle at 13 to 20 with speed, riding over hills. In frame form the mouse's offset from
  centre turns you and a centre crosshair aims; WASD is view-relative. In vehicle form the camera
  follows the heading and WASD steers. Sky islands and hive spires are now something you look up at.
- **Transform mid-race.** T works during a race; a walker on the circuit gets race servos (150%
  stride, double boost regen), so hairpins can be run on foot and jumps still need the vehicle.
- **The weapon economy is back.** Dungeon caches, bosses and a quarter of elites hand out a choice
  of three weapon cards from the thirteen secondaries; classic mode deals cards every third wave.
  Secondaries persist through expedition saves at their levels and sockets.
- **Counters.** Shooting a buried Sand Maw's plume forces it up; a diving drake takes ×1.5; a
  turret takes ×1.8 while it recharges after a burst; a marked phantom cannot blink; killing a
  Howler drops the pack it called; a dash throws leeches and skitters off you.
- **Zone events**, once per visit to a built territory, after 40 to 75 seconds: LOCKDOWN (hive),
  SIEGE (keep), AWAKENING (ruins), CAVE-IN (warrens, rifts open), GALE (sky, wind shoves vehicles).
  Two or three waves, a salvage purse for weathering it.
- **Minimap** draws streets, walls, towers, caverns, tunnels, islands and bridges.
- **Vehicle variety.** Bike (fang, viper, strix): fast, loose, jumps high. Hover-tank (aegis,
  vulcan, titan): slow, planted, rams hard. Disc (hexen, morrow): hovers over sand, snow and water,
  never bogs. Each has its own hull.
- **Kart items.** Item pads on every circuit hand out a shield (6 s), a mine dropped behind you, a
  seeker that hunts the leading rival, or a full bottle. G uses the item.
- **Audio.** Five new generative songs and a looping ambient bed per territory: wind, rain, embers,
  cavern drips, city hum.
- **Save migration.** A pilot restored onto a wall, rock or sky steps to open ground.
- **The houses** (`js/factions.js`, hangar → THE HOUSES): five houses with seats, creeds, doctrines,
  troops, favoured parts and circuits. Regard from −100 to 100 moves with deeds and troop kills;
  allied patrols keep the peace, hostile patrols hunt you from twice the range with a fifth more
  bite. Pledge at 40; a rival pledge is betrayal and leaves a stain that deeds wear down. Raise
  your own banner after ten dungeons or two houses at 60; take a seat with three territories held.
