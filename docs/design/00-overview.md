# STAALREUS — Design Bible (v1)

> The game is **STAALREUS** (Afrikaans: "steel giant"). Earlier drafts called it Gundam Circuit or HERO FRAME.
> One IP note, stated once: "Gundam" is a Bandai Namco trademark. Everything in these documents is
> *original work inspired by* the referenced anime and games. Frames, weapons and names below are
> original placeholders; before any public release the title should be changed to an original name
> (see §7 for candidates) and no Bandai silhouettes, logos or names should ship.

## 1. What this game is

A third-person, open-terrain **transforming mech action game** in the browser.
You pilot a **Frame** (humanoid mech) that becomes a **Vector** (jet, hover-bike, hover-tank, disc or
light-cycle depending on the frame) at the press of one key. You fly to the fight, stand up to win it.

Three pillars, one hangar:

| Pillar | Fantasy | Primary reference | Secondary references |
|---|---|---|---|
| **SORTIE** | Gun Metal missions over big destructible terrain: defend, escort, assault, dogfight, board a capital ship | Gun Metal (2002) | Armored Core VI (stagger, two-tier lock), Zone of the Enders 2 (multi-lock), Daemon X Machina (two fuels), Granvir (heat) |
| **CIRCUIT** | Vector-form racing: circuit, sprint, drift, drag, outrun, plus Trace (light-cycle) duels | Need for Speed Underground 1 and 2 | Armagetron Advanced, Ridge Racer, Burnout |
| **HANGAR** | Unlock and build: 24+ frames, 60+ weapons, six attributes, three-layer skill trees, gem sockets, rarity tiers | Sacred Gold, World of Warcraft | Diablo 2 synergies, Borderlands parts |

Design promise: **easy to jump in** (one form key, one attack key, one lock key, auto-growth stats)
and **deep to master** (form-gated weapon sets, stagger windows, drift chains, three trees, socket commitments).

## 2. The one-screen pitch

*Gun Metal's transform loop, with NFS Underground's handling in vehicle form, and Sacred/WoW's build
depth under the hood. Every mission hands you a new weapon or a new frame, never both.*

## 3. Core loop

```
HANGAR  ──pick frame + 4 weapons──▶  SORTIE / CIRCUIT
  ▲                                       │
  │   salvage · parts · blueprints ·      │  complete objective, place in race,
  │   pilot XP · frame mastery            │  beat a Revenant mirror, capture a wreck
  └──────────────── unlock ◀──────────────┘
```

A session is 6 to 12 minutes: one mission or one race. A campaign act is 5 missions + 2 races.
Four acts. After the campaign: ascending dungeon tiers (already in the codebase), daily world boss,
weekly challenge, relic seasons.

## 4. What changes from the current build (HERO FRAME)

The codebase began as a wave arena with a bolted-on open world. The research says the target
is a **chase-camera transforming mech game on open terrain**. The five structural changes, in order:

1. **Camera and control**: fixed top-down → third-person chase camera with mouse aim and a floating
   reticle (Starsiege style), two-tier lock-on (AC6 style). Biggest engineering item.
2. **Transform becomes the core verb**, not a Reach-only novelty. Every frame has a Vector form
   with its own weapon set, defensive move and handling model.
3. **One handling model**. Retire `race.js`'s rider sim; every vehicle (races, free-roam, RACEWAY
   dungeon, Trace duels) runs on one `updateDrive` derived from the NFS model in doc 03.
4. **Re-enable the weapon economy**. The 13 dead secondary weapons come back as the first
   entries of a 60+ weapon catalog with parts, rarity and per-form slots (doc 05).
5. **Stats with ceilings**. Replace flat armor and stackable block with WoW-style rating curves and
   diminishing returns (doc 04), so the game can scale 60 levels without becoming invulnerable.

Doc 09 maps each of these onto the current files.

## 5. Document map

| Doc | Contents |
|---|---|
| 01 | Vision, pillars, player fantasy, tone, accessibility ladder |
| 02 | Frame and Vector forms: movement, transform rules, fuels, heat, lock-on, stagger, defense |
| 03 | Driving and racing: the handling model, drift scoring, nitro, race modes, Trace (light-cycle) |
| 04 | Progression: attributes, formulas, skill trees, respec, difficulty bands, onboarding ladder |
| 05 | Weapons: families, parts, rarity, form slots, salvos, unlock plan, the 60-weapon launch catalog |
| 06 | Frames: design language, lines, the 24-frame launch roster, prototype/production/ace tiering, unlock paths |
| 07 | Enemies, bosses and missions: roster, 17 boss puzzles, 4-act mission list, world and dungeons |
| 08 | HUD, controls, camera, onboarding |
| 09 | Codebase gap analysis and build roadmap |
| 10 | The world as built: terrain, biomes, fauna, tracks |
| 11 | Next steps and factions |
| 12 | Release readiness |
| 13 | World life, drifting, vehicles, silhouettes, the balance pass |
| 14 | The world grid and corner portals, the combat pace dial, weather density, the film look |
| research/ | The six raw research reports these docs are distilled from |

## 6. Research caveat

Web fetches of most fan wikis were blocked by the sandbox proxy during research. Facts about NFS,
Gun Metal, Sacred and WoW come from search-engine extracts of the cited pages (URLs are in each
report). Armagetron facts were read directly from its source code and config files on GitHub and are
authoritative. Anything marked **[inference]** in the reports is a reasoned guess, not a sourced fact.

## 7. Name candidates (original, not trademarked by inspection only; check before use)

VECTOR FRAME · HAVOC CIRCUIT · IRON WAVERIDER · SKYFRAME · HERO FRAME (the current code name; safest).
