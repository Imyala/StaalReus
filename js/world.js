// STAALREUS — THE SHATTERED REACH
// A zone-streamed world: each territory is its own HUGE map (500×500),
// linked by corner portals laid out on a world grid (see W.GRID), and every territory hides a gated DUNGEON —
// a separate dark map holding its guardian packs, its sealed vault, and
// the corrupt-frame lair at the far end. Only one zone is ever loaded;
// zone builds are procedural and effectively instant, so travel is a
// fade, not a loading screen. Scars persist per zone forever.
GH.world = (function () {
  var W = {};

  W.OVERWORLD_SIZE = 500;   // one territory map
  W.DUNGEON_SIZE = 220;     // one dungeon map

  // THE WORLD GRID — the Reach laid out like a real map. Every territory
  // sits on a diamond lattice (col + row even) so its neighbours lie on
  // the diagonals, and every travel portal stands in the CORNER of the
  // map that points at its neighbour: leave the hub through the
  // north-east portal and you arrive in the south-west corner of the
  // Cloister, still walking north-east. Danger rises outward from the hub.
  //
  //            sky            ember           null
  //                 glacier          cloister
  //     warrens          [ wreck ]           storm
  //                 hive             ruins
  //                          keep
  W.GRID = {
    wreck: [0, 0],
    glacier: [-1, -1], cloister: [1, -1], hive: [-1, 1], ruins: [1, 1],
    ember: [0, -2], storm: [2, 0], keep: [0, 2], warrens: [-2, 0],
    sky: [-2, -2], null: [2, -2]
  };
  // the four corners, as (sign x, sign z): z grows southward on the map
  W.CORNERS = {
    NW: { sx: -1, sz: -1, name: 'NORTH-WEST', arrow: '\u2196' },
    NE: { sx: 1, sz: -1, name: 'NORTH-EAST', arrow: '\u2197' },
    SW: { sx: -1, sz: 1, name: 'SOUTH-WEST', arrow: '\u2199' },
    SE: { sx: 1, sz: 1, name: 'SOUTH-EAST', arrow: '\u2198' }
  };
  W.gridOf = function (zoneId) { return W.GRID[zoneId] || null; };
  // which territory lies through each corner of this one (null = mountains)
  W.neighbours = function (zoneId) {
    var me = W.GRID[zoneId];
    var out = {};
    if (!me) return out;
    for (var c in W.CORNERS) {
      var cr = W.CORNERS[c];
      var tx = me[0] + cr.sx, tz = me[1] + cr.sz;
      out[c] = null;
      for (var id in W.GRID) {
        if (W.GRID[id][0] === tx && W.GRID[id][1] === tz) out[c] = id;
      }
    }
    return out;
  };
  // the corner of `from` that leads to `to`, or null
  W.cornerTo = function (from, to) {
    var nb = W.neighbours(from);
    for (var c in nb) if (nb[c] === to) return c;
    return null;
  };

  W.ZONES = [
    { id: 'wreck', danger: 1 },     // the hub: camp, circuit, duel pit
    { id: 'glacier', danger: 2 },
    { id: 'cloister', danger: 2 },
    { id: 'ember', danger: 3 },
    { id: 'storm', danger: 3 },
    { id: 'null', danger: 4 },
    // built territories
    { id: 'hive', danger: 3 },      // the spire hive: a city stacked to the sky
    { id: 'ruins', danger: 2 },     // the fallen citadel
    { id: 'keep', danger: 3 },      // the bastion keep
    { id: 'warrens', danger: 4 },   // the undercity
    { id: 'sky', danger: 4 }        // the aether court
  ];

  // fixed hub features (live in the wreck zone only)
  W.CAMP = { x: 0, z: 150, r: 16 };
  W.CIRCUIT = { x: 165, z: 140, r: 26, gates: 10 };
  W.DUEL_PIT = { x: -60, z: 185 };

  // the currently loaded zone: clamps and minimap read these live
  W.BOUNDS = { x: W.OVERWORLD_SIZE / 2, z: W.OVERWORLD_SIZE / 2 };
  W.current = null; // {id, danger, dungeon, parent, size, name}

  W.zoneInfo = function (zoneId) {
    // legacy saves: 'dungeon_<zone>' was the single-dungeon era
    if (zoneId.indexOf('dungeon_') === 0) {
      zoneId = GH.dungeons.makeId(zoneId.slice(8), 'depths', 1);
    }
    var dg = GH.dungeons.parseId(zoneId);
    if (dg) {
      var pz = W.zoneById(dg.zone);
      var arch = GH.dungeons.ARCHETYPES[dg.arch];
      return {
        id: zoneId, dungeon: true, parent: dg.zone,
        arch: dg.arch, tier: dg.tier,
        danger: Math.min(4, pz.danger + dg.tier),
        size: arch.size,
        name: W.stageFor(dg.zone).name + ' ' + arch.name +
          (dg.tier > 1 ? ' ' + (['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][dg.tier - 1] || 'T' + dg.tier) : '')
      };
    }
    var zn = W.zoneById(zoneId);
    return {
      id: zoneId, dungeon: false, parent: zoneId,
      danger: zn.danger, size: W.OVERWORLD_SIZE,
      name: W.stageFor(zoneId).name
    };
  };

  W.zoneById = function (id) {
    for (var i = 0; i < W.ZONES.length; i++) if (W.ZONES[i].id === id) return W.ZONES[i];
    return W.ZONES[0];
  };

  W.setZone = function (zoneId) {
    W.current = W.zoneInfo(zoneId);
    W.BOUNDS = { x: W.current.size / 2, z: W.current.size / 2 };
    return W.current;
  };

  W.stageFor = function (zoneId) {
    if (zoneId) {
      if (zoneId.indexOf('dungeon_') === 0) zoneId = zoneId.slice(8);
      var dg = GH.dungeons.parseId(zoneId);
      if (dg) zoneId = dg.zone;
    }
    var all = GH.allStages ? GH.allStages() : GH.stages;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === zoneId) return all[i];
    }
    return GH.stages[0];
  };

  // deterministic per-zone placement rng
  function zrng(seedStr) {
    var s = 0;
    for (var i = 0; i < seedStr.length; i++) s = (Math.imul(s, 31) + seedStr.charCodeAt(i)) >>> 0;
    s = s || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  // a corner portal stands a little further in than the old edge gates
  // did: it is hemmed by the rim on two sides, and the road out of it
  // needs room to turn toward the map's heart
  function gatePos(corner, size) {
    var m = size / 2 - 24;
    var cr = W.CORNERS[corner] || W.CORNERS.NE;
    return { x: cr.sx * m, z: cr.sz * m };
  }

  // ---------------------------------------------------------------
  // Zone layout: everything a single map contains, deterministically.
  // ---------------------------------------------------------------
  W.layoutFor = function (zoneId) {
    var info = W.zoneInfo(zoneId);
    var size = info.size;
    var half = size / 2;
    var rnd = zrng('reach:' + zoneId);
    var lay = { nests: [], gates: [], packs: [], relay: null, lair: null, vault: null, dungeonGate: null };

    if (!info.dungeon) {
      var nbs = W.neighbours(zoneId);
      for (var corner in nbs) {
        if (!nbs[corner]) continue;
        var gp = gatePos(corner, size);
        lay.gates.push({ to: nbs[corner], x: gp.x, z: gp.z, corner: corner, side: corner });
      }
      // FOUR dungeon gates per territory: the depths plus three more
      // archetypes from the zone's set. Each gate leads to the NEXT
      // uncleared tier of its dungeon — clears ascend the gate forever.
      var dgTiers = (GH.meta.data.world && GH.meta.data.world.dgTier) || {};
      var archList = ['depths'].concat(GH.dungeons.ZONE_SETS[zoneId] || []);
      archList.forEach(function (arch, ai) {
        var dgx = (rnd() - 0.5) * (size * 0.62);
        var dgz = (rnd() - 0.5) * (size * 0.62);
        if (zoneId === 'wreck') {
          // keep the hub's gates clear of camp and circuit
          if (ai === 0) { dgx = -140; dgz = -120; }
          if (GH.dist2(dgx, dgz, W.CAMP.x, W.CAMP.z) < 45 * 45) dgz -= 110;
          if (GH.dist2(dgx, dgz, W.CIRCUIT.x, W.CIRCUIT.z) < 50 * 50) dgx -= 110;
        }
        var tier = (dgTiers[GH.dungeons.baseId(zoneId, arch)] || 0) + 1;
        lay.gates.push({ to: GH.dungeons.makeId(zoneId, arch, tier), x: dgx, z: dgz, arch: arch, tier: tier });
      });

      // husk nests scattered wide
      var count = zoneId === 'wreck' ? 8 : 14;
      for (var i = 0; i < count; i++) {
        var nx = (rnd() - 0.5) * (size - 60);
        var nz = (rnd() - 0.5) * (size - 60);
        if (zoneId === 'wreck') {
          if (GH.dist2(nx, nz, W.CAMP.x, W.CAMP.z) < 45 * 45) nx -= 90;
          if (GH.dist2(nx, nz, W.CIRCUIT.x, W.CIRCUIT.z) < 50 * 50) nz -= 90;
        }
        for (var g2 = 0; g2 < lay.gates.length; g2++) {
          if (GH.dist2(nx, nz, lay.gates[g2].x, lay.gates[g2].z) < 30 * 30) { nx *= 0.7; nz *= 0.7; }
        }
        lay.nests.push({
          id: zoneId + '_n' + i, zone: zoneId, x: nx, z: nz,
          hp: 120 * info.danger, maxHp: 120 * info.danger
        });
      }
      // roaming packs: hostiles holding ground between the nests, so
      // the territory reads populated instead of empty road. They wake
      // lazily as the pilot draws near (see updateExpedition).
      var packCount = (zoneId === 'wreck' ? 10 : 16) + info.danger * 4;
      for (var pk = 0; pk < packCount; pk++) {
        var pkx = (rnd() - 0.5) * (size - 70);
        var pkz = (rnd() - 0.5) * (size - 70);
        if (zoneId === 'wreck') {
          if (GH.dist2(pkx, pkz, W.CAMP.x, W.CAMP.z) < 40 * 40) pkx -= 90;
          if (GH.dist2(pkx, pkz, W.CIRCUIT.x, W.CIRCUIT.z) < 45 * 45) pkz -= 90;
        }
        lay.packs.push({
          x: pkx, z: pkz,
          n: 2 + Math.floor(rnd() * 3),
          roam: true
        });
      }

      // siege relays hold the middle of two territories
      if (zoneId === 'wreck') lay.relay = { id: 'relay_wreck', zone: zoneId, x: 110, z: -80 };
      if (zoneId === 'storm') lay.relay = { id: 'relay_storm', zone: zoneId, x: -90, z: 100 };

      // landmarks: ruin rings, crashed hulks, sub-biome stains, and
      // roads running from each travel gate toward the map's heart
      lay.ruins = [];
      for (var ru = 0; ru < 3; ru++) {
        lay.ruins.push({
          x: (rnd() - 0.5) * (size * 0.7),
          z: (rnd() - 0.5) * (size * 0.7),
          kind: ru === 2 ? 'hulk' : 'ring'
        });
      }
      lay.stains = [];
      for (var stn = 0; stn < 4; stn++) {
        lay.stains.push({
          x: (rnd() - 0.5) * (size * 0.8),
          z: (rnd() - 0.5) * (size * 0.8),
          r: 22 + rnd() * 26
        });
      }
    } else {
      // ---- DUNGEONS: exit gate south, archetype decides the rest ----
      lay.gates.push({ to: info.parent, x: 0, z: half - 16, exit: true });
      var arch2 = info.arch;

      if (arch2 === 'depths') {
        var packs = 5;
        for (var p = 0; p < packs; p++) {
          lay.packs.push({
            x: (rnd() - 0.5) * (size - 70),
            z: half - 50 - p * ((size - 90) / packs) + (rnd() - 0.5) * 24,
            n: 3 + Math.floor(rnd() * 3)
          });
        }
        if (info.tier === 1) {
          lay.vault = { id: 'vault_' + info.parent, zone: info.parent, x: (rnd() < 0.5 ? -1 : 1) * (half - 45), z: 0 };
          lay.lair = { id: 'lair_' + info.parent, zone: info.parent, x: 0, z: -half + 30, boss: W.stageFor(info.parent).unlocks };
        } else {
          // tier 2: no vault — a denser garrison and a corrupt rematch
          lay.packs.push({ x: 0, z: 0, n: 5 });
          lay.lair = { id: 'lair2_' + info.parent, zone: info.parent, x: 0, z: -half + 30, boss: W.stageFor(info.parent).unlocks, rematch: true };
        }
      } else if (arch2 === 'hive') {
        var hp2 = 7 + (info.tier === 2 ? 3 : 0);
        for (var h = 0; h < hp2; h++) {
          lay.packs.push({
            x: (rnd() - 0.5) * (size - 60),
            z: (rnd() - 0.5) * (size - 60),
            n: 3 + Math.floor(rnd() * 3)
          });
        }
      } else if (arch2 === 'bastion') {
        lay.objective = {
          x: 0, z: 0,
          def: GH.dungeons.OBJECTIVES[info.parent],
          hp: 500 + info.danger * 150
        };
        // attackers pour from four breaches
        lay.breaches = [
          { x: -half + 20, z: 0 }, { x: half - 20, z: 0 },
          { x: 0, z: -half + 20 }, { x: half - 30, z: -half + 30 }
        ];
      } else if (arch2 === 'labyrinth') {
        lay.maze = GH.dungeons.genMaze(zoneId, 21, Math.floor(size / 21));
        var mid = Math.floor(lay.maze.n / 2);
        lay.heart = GH.dungeons.mazeCellPos(lay.maze, size, mid, mid);
        // the entry gate must stand square with the maze mouth
        var mouth = GH.dungeons.mazeCellPos(lay.maze, size, lay.maze.n - 1, mid);
        lay.gates[0].x = mouth.x;
        // lurkers in the corridors
        for (var lk = 0; lk < 8 + (info.tier === 2 ? 4 : 0); lk++) {
          var lr, lc, guard = 0;
          do {
            lr = 1 + Math.floor(rnd() * (lay.maze.n - 2));
            lc = 1 + Math.floor(rnd() * (lay.maze.n - 2));
          } while (lay.maze.grid[lr][lc] && guard++ < 40);
          var lp = GH.dungeons.mazeCellPos(lay.maze, size, lr, lc);
          lay.packs.push({ x: lp.x, z: lp.z, n: 1 });
        }
      } else if (arch2 === 'gauntlet') {
        lay.checkpoints = GH.dungeons.genGauntlet(zoneId, size);
        // harriers along the route
        lay.checkpoints.forEach(function (cp, ci) {
          if (ci % 2 === 0) lay.packs.push({ x: cp.x + 8, z: cp.z + 8, n: 2 });
        });
      } else if (arch2 === 'fluxways') {
        lay.flux = GH.dungeons.genFlux(size);
        lay.chest = { x: 0, z: -half + 22 };
        lay.packs.push({ x: 0, z: -half + 40, n: 3 }); // the far-side welcome
      } else if (arch2 === 'raceway') {
        lay.raceway = GH.dungeons.genRaceway(size, info.parent);
        lay.chest = { x: 0, z: 0 }; // the winner's circle, mid-infield
      } else if (arch2 === 'halls') {
        // the null reach runs the master set; everywhere else teaches
        lay.halls = GH.dungeons.genHalls(size, info.parent === 'null' ? 'master' : 'teach');
        lay.chest = { x: 0, z: -half + 24 }; // beyond the final seal
      } else if (arch2 === 'convoy') {
        lay.convoyPath = GH.dungeons.genConvoy(zoneId, size);
        lay.chest = { x: 0, z: -half + 24 }; // where the hauler docks
      } else if (arch2 === 'crucible') {
        lay.crucible = { bosses: 3, x: 0, z: -20 };
        lay.chest = { x: 0, z: -half + 24 };
      } else if (arch2 === 'heist') {
        lay.relic = { x: 0, z: -half + 30 }; // the prize, deep in
        lay.noChest = true; // the exit gate pays the heist directly
        for (var hh = 0; hh < 4; hh++) {
          lay.packs.push({
            x: (rnd() - 0.5) * (size - 70),
            z: (rnd() - 0.5) * (size - 90),
            n: 2 + Math.floor(rnd() * 2)
          });
        }
      }
      // every non-depths dungeon pays out at a chest (flux set its own)
      if (!lay.chest && arch2 !== 'depths' && !lay.noChest) {
        lay.chest = arch2 === 'labyrinth' ? { x: lay.heart.x, z: lay.heart.z } :
          arch2 === 'gauntlet' ? { x: lay.checkpoints[lay.checkpoints.length - 1].x, z: lay.checkpoints[lay.checkpoints.length - 1].z } :
          { x: 0, z: -half + 26 };
      }
    }
    return lay;
  };

  // total nests across every territory (for the cleanse counter)
  var totalNestsCache = null;
  W.totalNests = function () {
    if (totalNestsCache === null) {
      totalNestsCache = 0;
      W.ZONES.forEach(function (zn) { totalNestsCache += W.layoutFor(zn.id).nests.length; });
    }
    return totalNestsCache;
  };

  // ---------------------------------------------------------------
  // Daily world state — keyed off the real UTC date
  // ---------------------------------------------------------------
  W.dayStamp = function () { return new Date().toISOString().slice(0, 10); };

  W.WEATHERS = {
    glacier: { id: 'whiteout', name: 'WHITEOUT', desc: 'fog swallows the hollow; everything moves slower' },
    wreck: { id: 'kingtide', name: 'KING TIDE', desc: 'the tide washes salvage ashore' },
    cloister: { id: 'sporebloom', name: 'SPOREBLOOM', desc: 'kills shed extra sparks' },
    ember: { id: 'ashfall', name: 'ASHFALL', desc: 'burning cinders rain from the sky' },
    storm: { id: 'stormsurge', name: 'STORM SURGE', desc: 'the sky hunts anything that moves' },
    null: { id: 'nullwind', name: 'NULL WIND', desc: 'drifting eddies ground your weapons' },
    hive: { id: 'blackout', name: 'BLACKOUT', desc: 'the spire goes dark; the streets close in' },
    ruins: { id: 'duststorm', name: 'DUSTSTORM', desc: 'grit in every joint; the dead city hides itself' },
    keep: { id: 'siegefog', name: 'SIEGE FOG', desc: 'the wards vanish into the fog' },
    warrens: { id: 'gasleak', name: 'GAS LEAK', desc: 'pockets of vapour ignite around you' },
    sky: { id: 'gale', name: 'GALE', desc: 'the wind shoves anything on skids' }
  };

  W.weatherToday = function () {
    var rnd = zrng('weather:' + W.dayStamp());
    var ids = W.ZONES.map(function (z) { return z.id; });
    var a = Math.floor(rnd() * ids.length);
    var b = (a + 1 + Math.floor(rnd() * (ids.length - 1))) % ids.length;
    var out = {};
    out[ids[a]] = W.WEATHERS[ids[a]];
    out[ids[b]] = W.WEATHERS[ids[b]];
    return out;
  };

  // THE HARROW roams the overworld: a different territory every day
  W.harrowToday = function () {
    var rnd = zrng('harrow:' + W.dayStamp());
    var candidates = W.ZONES.filter(function (z) { return z.id !== 'wreck'; });
    var zn = candidates[Math.floor(rnd() * candidates.length)];
    return {
      zone: zn.id,
      x: (rnd() - 0.5) * (W.OVERWORLD_SIZE * 0.6),
      z: (rnd() - 0.5) * (W.OVERWORLD_SIZE * 0.6)
    };
  };

  // circuit centerline (hub zone): a wobbled ring for AI + track checks
  W.circuitPath = function () {
    var pts = [];
    var C = W.CIRCUIT;
    for (var i = 0; i < 64; i++) {
      var a = (i / 64) * Math.PI * 2;
      var r = C.r + Math.sin(a * 3) * 4;
      pts.push({ x: C.x + Math.cos(a) * r, z: C.z + Math.sin(a) * r, a: a });
    }
    return pts;
  };

  // ---------------------------------------------------------------
  // Build ONE zone into the scene. Returns handles for dynamic bits.
  // ---------------------------------------------------------------
  W.buildZone = function (scene, zoneId, deadNests, lairsDown, vaultsOpen) {
    var info = W.setZone(zoneId);
    var lay = W.layoutFor(zoneId);
    var size = info.size;
    var group = new THREE.Group();
    var nestMeshes = {};
    var vaultMeshes = {};
    var st = W.stageFor(zoneId);
    var tex = GH.assets.stageTex[st.id];

    // ground: a real height field with the zone's biome, sealed by a rim.
    // Built territories lay their districts first so the field flattens
    // under them, then raise walls and towers with colliders.
    var srnd = zrng('struct:' + zoneId);
    var terrain = GH.terrain.build(zoneId, info, lay, function (field) {
      lay.structures = GH.structures.layout(field, lay, srnd);
    });
    group.add(terrain);
    var gy = function (x, z) { return GH.terrain.h(x, z); };
    if (lay.raceway) GH.terrain.setTrack(lay.raceway);
    GH.structures.build(group, lay.structures);

    // dungeon perimeter: a tight rock collar so the depths read enclosed
    if (info.dungeon) {
      var collar = new THREE.Mesh(
        new THREE.CylinderGeometry(size * 0.74, size * 0.7, 26, 28, 1, true),
        GH.assets.lambert({ map: tex.wall, side: THREE.BackSide }, { nosnap: true })
      );
      collar.position.y = 12;
      group.add(collar);
    }

    // vegetation and rock: the biome's own kinds, clustered by noise into
    // groves and boulder fields, merged into a handful of draw calls.
    // Mazes and authored floors keep their arenas clean.
    var rnd = zrng('props:' + zoneId);
    var noProps = info.dungeon && (info.arch === 'labyrinth' || info.arch === 'fluxways' || info.arch === 'halls');
    if (!noProps) {
      GH.terrain.scatterProps(group, zoneId, info, rnd, function (px, pz) {
        if (zoneId === 'wreck') {
          if (GH.dist2(px, pz, W.CAMP.x, W.CAMP.z) < 26 * 26) return true;
          if (GH.dist2(px, pz, W.CIRCUIT.x, W.CIRCUIT.z) < (W.CIRCUIT.r + 14) * (W.CIRCUIT.r + 14)) return true;
          if (GH.dist2(px, pz, W.DUEL_PIT.x, W.DUEL_PIT.z) < 24 * 24) return true;
        }
        for (var g3 = 0; g3 < lay.gates.length; g3++) {
          if (GH.dist2(px, pz, lay.gates[g3].x, lay.gates[g3].z) < 12 * 12) return true;
        }
        if (lay.lair && GH.dist2(px, pz, lay.lair.x, lay.lair.z) < 15 * 15) return true;
        if (lay.vault && GH.dist2(px, pz, lay.vault.x, lay.vault.z) < 12 * 12) return true;
        if (lay.chest && GH.dist2(px, pz, lay.chest.x, lay.chest.z) < 8 * 8) return true;
        if (lay.objective && GH.dist2(px, pz, lay.objective.x, lay.objective.z) < 14 * 14) return true;
        if (lay.relic && GH.dist2(px, pz, lay.relic.x, lay.relic.z) < 8 * 8) return true;
        if (lay.crucible && GH.dist2(px, pz, lay.crucible.x, lay.crucible.z) < 26 * 26) return true;
        if (lay.raceway && GH.terrain.trackDistance(lay.raceway, px, pz) < 13) return true;
        if (lay.convoyPath) {
          for (var cv = 0; cv < lay.convoyPath.length; cv++) {
            if (GH.dist2(px, pz, lay.convoyPath[cv].x, lay.convoyPath[cv].z) < 7 * 7) return true;
          }
        }
        if (lay.checkpoints) {
          for (var ck = 0; ck < lay.checkpoints.length; ck++) {
            if (GH.dist2(px, pz, lay.checkpoints[ck].x, lay.checkpoints[ck].z) < 7 * 7) return true;
          }
        }
        for (var nn = 0; nn < lay.nests.length; nn++) {
          if (GH.dist2(px, pz, lay.nests[nn].x, lay.nests[nn].z) < 7 * 7) return true;
        }
        for (var pk = 0; pk < lay.packs.length; pk++) {
          if (GH.dist2(px, pz, lay.packs[pk].x, lay.packs[pk].z) < 5 * 5) return true;
        }
        return false;
      });
    }

    // world features
    lay.nests.forEach(function (n) {
      var nest = GH.models.buildNest(deadNests[n.id]);
      nest.position.set(n.x, gy(n.x, n.z), n.z);
      group.add(nest);
      nestMeshes[n.id] = nest;
    });
    if (lay.relay) {
      var relay = GH.models.buildRelay();
      relay.position.set(lay.relay.x, gy(lay.relay.x, lay.relay.z), lay.relay.z);
      group.add(relay);
    }
    if (lay.lair) {
      var lair = GH.models.buildLair(lairsDown[lay.lair.zone]);
      lair.position.set(lay.lair.x, gy(lay.lair.x, lay.lair.z), lay.lair.z);
      group.add(lair);
    }
    if (lay.vault) {
      var vault = GH.models.buildVault(vaultsOpen[lay.vault.id]);
      vault.position.set(lay.vault.x, gy(lay.vault.x, lay.vault.z), lay.vault.z);
      vault.rotation.y = lay.vault.x > 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(vault);
      vaultMeshes[lay.vault.id] = vault;
    }

    // ---- archetype set pieces ----
    var chestMesh = null, objectiveMesh = null, fluxTiles = null, cpMeshes = null;
    if (lay.maze) {
      // raise the maze: one shared material, a box per wall cell
      var wallMat = GH.assets.lambert({ map: tex.wall });
      var mc = lay.maze.cell;
      for (var mr = 0; mr < lay.maze.n; mr++) {
        for (var mcc = 0; mcc < lay.maze.n; mcc++) {
          if (!lay.maze.grid[mr][mcc]) continue;
          var wp = GH.dungeons.mazeCellPos(lay.maze, size, mr, mcc);
          var wall = new THREE.Mesh(new THREE.BoxGeometry(mc, 7, mc), wallMat);
          wall.position.set(wp.x, 3.5, wp.z);
          group.add(wall);
        }
      }
    }
    if (lay.flux) {
      // the shifting floor: one plate per tile, recolored live
      fluxTiles = [];
      var half2 = size / 2;
      for (var fr = 0; fr < lay.flux.rows; fr++) {
        for (var fc = 0; fc < lay.flux.cols; fc++) {
          var tileMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(lay.flux.tile - 0.6, lay.flux.tile - 0.6),
            new THREE.MeshBasicMaterial({ color: 0x992211, transparent: true, opacity: 0.4, depthWrite: false }));
          tileMesh.rotation.x = -Math.PI / 2;
          var tx = -half2 + 20 + (fc + 0.5) * lay.flux.tile;
          var tz = lay.flux.zTop + (fr + 0.5) * lay.flux.tile;
          tileMesh.position.set(tx, 0.06, tz);
          tileMesh.userData.fx = tx;
          tileMesh.userData.fz = tz;
          group.add(tileMesh);
          fluxTiles.push(tileMesh);
        }
      }
    }
    if (lay.checkpoints) {
      cpMeshes = [];
      lay.checkpoints.forEach(function (cp, ci) {
        var ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.22, 4, 20),
          GH.assets.basic(ci === lay.checkpoints.length - 1 ? 0xffd050 : 0x60c8ff,
            { transparent: true, opacity: 0.8 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.set(cp.x, gy(cp.x, cp.z) + 0.4, cp.z);
        group.add(ring);
        cpMeshes.push(ring);
      });
    }
    if (lay.objective) {
      objectiveMesh = GH.models.buildObjective(lay.objective.def.kind);
      objectiveMesh.position.set(lay.objective.x, gy(lay.objective.x, lay.objective.z), lay.objective.z);
      group.add(objectiveMesh);
    }
    if (lay.chest) {
      chestMesh = GH.models.buildChest();
      chestMesh.position.set(lay.chest.x, gy(lay.chest.x, lay.chest.z), lay.chest.z);
      group.add(chestMesh);
    }
    // RACEWAY: gate pylons, start gantry, and dense trackside furniture —
    // the NFS lesson: speed only reads when things stream PAST you
    var raceLights = null, itemPads = null;
    if (lay.raceway) {
      var rw = lay.raceway;
      for (var rg = 0; rg < rw.gates; rg++) {
        var rpt = rw.path[Math.floor(rg * rw.path.length / rw.gates)];
        var rnx = rw.path[(Math.floor(rg * rw.path.length / rw.gates) + 1) % rw.path.length];
        var rang = Math.atan2(rnx.x - rpt.x, rnx.z - rpt.z);
        var rpg = GH.models.buildPylonPair(rg === 0 ? 0xffd050 : 0x60c8ff);
        rpg.position.set(rpt.x, gy(rpt.x, rpt.z), rpt.z);
        rpg.rotation.y = rang;
        group.add(rpg);
      }
      // the start-light gantry over the line
      var startPt = rw.path[0];
      var nxt = rw.path[1];
      var gantry = GH.models.buildStartGantry();
      gantry.position.set(startPt.x, gy(startPt.x, startPt.z), startPt.z);
      gantry.rotation.y = Math.atan2(nxt.x - startPt.x, nxt.z - startPt.z);
      group.add(gantry);
      raceLights = gantry.userData.lamps;
      // light posts and edge chevrons along the whole ring
      var postGeo = new THREE.BoxGeometry(0.4, 5.5, 0.4);
      var postMat = GH.assets.lambert({ color: 0x2a3038 });
      var lampMatA = GH.assets.basic(0x60c8ff, { transparent: true, opacity: 0.85 });
      var lampMatB = GH.assets.basic(0xffd050, { transparent: true, opacity: 0.85 });
      var lampGeo = new THREE.OctahedronGeometry(0.4);
      // the asphalt itself: hills, banks, jumps, rails, curbs, tyre walls
      GH.terrain.buildTrack(group, rw);
      // item pads: a spinning box on the line, one per authored spot
      itemPads = [];
      rw.path.forEach(function (ip, ipi) {
        if (!ip.item) return;
        var im = GH.models.buildItemPad();
        im.position.set(ip.x, gy(ip.x, ip.z) + 0.9, ip.z);
        group.add(im);
        itemPads.push({ x: ip.x, z: ip.z, mesh: im, cd: 0, i: ipi });
      });
      var postEvery = Math.max(2, Math.floor(rw.path.length / 36));
      for (var tp = 0; tp < rw.path.length; tp += postEvery) {
        var pA = rw.path[tp];
        var pB = rw.path[(tp + 1) % rw.path.length];
        var tang = Math.atan2(pB.x - pA.x, pB.z - pA.z);
        var side = ((tp / postEvery) % 2 === 0) ? 1 : -1;
        var offX = Math.cos(tang) * -side * (rw.width / 2 + 3);
        var offZ = Math.sin(tang) * side * (rw.width / 2 + 3);
        var py = gy(pA.x + offX, pA.z + offZ);
        var post = new THREE.Mesh(postGeo, postMat);
        post.position.set(pA.x + offX, py + 2.75, pA.z + offZ);
        group.add(post);
        var lamp = new THREE.Mesh(lampGeo, (tp / postEvery) % 4 === 0 ? lampMatB : lampMatA);
        lamp.position.set(pA.x + offX, py + 5.8, pA.z + offZ);
        group.add(lamp);
      }
    }
    // CIPHER HALLS: solid walls, seals of four kinds, matter screens,
    // plates, and the portable puzzle kit (cores, relays, the jammer)
    var barrierMeshes = null, plateMeshes = null, coreMeshes = null, relicMesh = null;
    var receptorMeshes = null, switchMeshes = null, screenMeshes = null, beamPool = null;
    if (lay.halls) {
      var hallWallMat = GH.assets.lambert({ map: tex.wall });
      lay.halls.walls.forEach(function (wl) {
        var wm = new THREE.Mesh(new THREE.BoxGeometry(wl.w, 6, wl.d), hallWallMat);
        wm.position.set(wl.x, 3, wl.z);
        group.add(wm);
      });
      barrierMeshes = {};
      lay.halls.barriers.forEach(function (br) {
        // color speaks the rules: cyan = circuit seals, amber = hardened
        // (the jammer cannot take them), green = low conduit fences
        var col = br.opener === 'lock' ? 0x50d080 : br.noJam ? 0xffb040 : 0x60c8ff;
        var hgt = br.opener === 'lock' ? 2.2 : 5;
        var bm = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(br.w * 0.7, br.w - 1.5), hgt, Math.max(br.d * 0.7, br.d - 1.5)),
          GH.assets.basic(col, { transparent: true, opacity: 0.4 }));
        bm.position.set(br.x, hgt / 2, br.z);
        group.add(bm);
        barrierMeshes[br.id] = bm;
      });
      screenMeshes = {};
      (lay.halls.screens || []).forEach(function (sc) {
        var sm = new THREE.Mesh(new THREE.BoxGeometry(sc.w, 5, Math.max(0.5, sc.d * 0.5)),
          GH.assets.basic(0xb060ff, { transparent: true, opacity: 0.18, depthWrite: false }));
        sm.position.set(sc.x, 2.5, sc.z);
        group.add(sm);
        screenMeshes[sc.id] = sm;
      });
      plateMeshes = {};
      lay.halls.plates.forEach(function (pl) {
        var pr = pl.r || 2.4;
        var pm = new THREE.Mesh(new THREE.CylinderGeometry(pr - 0.2, pr, 0.3, 8),
          GH.assets.lambert({ color: 0x3a4450 }));
        pm.position.set(pl.x, 0.15, pl.z);
        var pmGlow = new THREE.Mesh(new THREE.CylinderGeometry(pr - 0.8, pr - 0.8, 0.14, 8),
          GH.assets.basic(0xffd050, { transparent: true, opacity: 0.5 }));
        pmGlow.position.y = 0.24;
        pm.add(pmGlow);
        pm.userData.glow = pmGlow;
        group.add(pm);
        plateMeshes[pl.id] = pm;
      });
      (lay.halls.emitters || []).forEach(function (em) {
        var emesh = GH.models.buildEmitter();
        emesh.position.set(em.x, 0, em.z);
        group.add(emesh);
      });
      receptorMeshes = {};
      (lay.halls.receptors || []).forEach(function (rc) {
        var rm = GH.models.buildReceptor();
        rm.position.set(rc.x, 0, rc.z);
        group.add(rm);
        receptorMeshes[rc.id] = rm;
      });
      switchMeshes = {};
      (lay.halls.switches || []).forEach(function (sw) {
        var swm = GH.models.buildSwitchLever();
        swm.position.set(sw.x, 0, sw.z);
        group.add(swm);
        switchMeshes[sw.id] = swm;
      });
      coreMeshes = {};
      (lay.halls.items || []).forEach(function (it) {
        var cm;
        if (it.kind === 'relay') cm = GH.models.buildRelay();
        else if (it.kind === 'jammer') cm = GH.models.buildJammer();
        else {
          cm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1),
            GH.assets.lambert({ color: 0xffd050, emissive: 0x806010, emissiveIntensity: 0.7 }));
        }
        cm.position.set(it.x, it.kind === 'core' ? 0.8 : 0, it.z);
        group.add(cm);
        coreMeshes[it.id] = cm;
      });
      // a small pool of beam segments, bent to the live links each frame
      beamPool = [];
      var beamGeo = new THREE.BoxGeometry(1, 1, 1);
      for (var bp = 0; bp < 10; bp++) {
        var beam = new THREE.Mesh(beamGeo,
          GH.assets.basic(0x8ae8ff, { transparent: true, opacity: 0.55, depthWrite: false }));
        beam.visible = false;
        group.add(beam);
        beamPool.push(beam);
      }
    }
    // CONVOY: waypoint markers along the hauler's route
    if (lay.convoyPath) {
      lay.convoyPath.forEach(function (wp) {
        var wpd = new THREE.Mesh(new THREE.CircleGeometry(2.2, 12),
          new THREE.MeshBasicMaterial({ color: wp.ambush ? 0xc05050 : 0x60c8ff, transparent: true, opacity: 0.2, depthWrite: false }));
        wpd.rotation.x = -Math.PI / 2;
        wpd.position.set(wp.x, gy(wp.x, wp.z) + 0.05, wp.z);
        group.add(wpd);
      });
    }
    // HEIST: the relic itself, styled after its territory
    if (lay.relic) {
      relicMesh = GH.models.buildObjective(GH.dungeons.OBJECTIVES[info.parent].kind);
      relicMesh.scale.setScalar(0.7);
      relicMesh.position.set(lay.relic.x, gy(lay.relic.x, lay.relic.z), lay.relic.z);
      group.add(relicMesh);
    }

    // ---- overworld landmarks: ruins, hulks, stains, roads ----
    if (!info.dungeon) {
      (lay.stains || []).forEach(function (stn) {
        GH.terrain.paintDisc(stn.x, stn.z, stn.r, [0.08, 0.07, 0.07], 0.45);
      });
      (lay.ruins || []).forEach(function (rn) {
        if (rn.kind === 'hulk') {
          var hulk = GH.models.buildWreckSite();
          hulk.scale.setScalar(2.6);
          hulk.position.set(rn.x, gy(rn.x, rn.z), rn.z);
          group.add(hulk);
        } else {
          for (var rp = 0; rp < 7; rp++) {
            var ra = (rp / 7) * Math.PI * 2;
            var pillar = GH.models.buildPillar();
            var plx = rn.x + Math.cos(ra) * 9, plz = rn.z + Math.sin(ra) * 9;
            pillar.position.set(plx, gy(plx, plz), plz);
            group.add(pillar);
          }
        }
      });
      // roads: worn strips from each edge gate toward the middle
      lay.gates.forEach(function (gt) {
        if (gt.arch) return; // dungeon mouths keep their mystery
        var hx = zoneId === 'wreck' ? W.CAMP.x : 0, hz = zoneId === 'wreck' ? W.CAMP.z : 0;
        GH.terrain.paintStrip(gt.x, gt.z, hx * 0.9, hz * 0.9, 2.6, [0.42, 0.38, 0.33], 0.55);
      });
    }

    // travel gates
    lay.gates.forEach(function (gt) {
      var toInfo = W.zoneInfo(gt.to);
      var mesh = GH.models.buildGate(gt.exit ? 'exit' : (toInfo.dungeon ? 'dungeon' : 'travel'));
      mesh.position.set(gt.x, gy(gt.x, gt.z), gt.z);
      // gates on the map edge face inward
      mesh.rotation.y = Math.atan2(-gt.x, -gt.z);
      group.add(mesh);
      gt.mesh = mesh;
    });

    // the hub: the outpost + race sites (wreck territory only)
    if (zoneId === 'wreck') {
      var camp = new THREE.Group();
      camp.position.set(W.CAMP.x, gy(W.CAMP.x, W.CAMP.z), W.CAMP.z);
      camp.add(GH.models.buildCampFire());
      var stations = [
        { m: GH.models.buildBrokerTable(), x: -5, z: -3 },
        { m: GH.models.buildShrine(), x: 5, z: -3 },
        { m: GH.models.buildMemorialWall(), x: 0, z: -7 },
        { m: GH.models.buildSimConsole(), x: -5, z: 4 },
        { m: GH.models.buildPylonPair(0x60c8ff), x: 6, z: 5 }
      ];
      stations.forEach(function (s) {
        s.m.position.set(s.x, 0, s.z);
        camp.add(s.m);
      });
      // a seated house flies its banner over the camp
      var fac = GH.factions && GH.factions.state();
      if (fac && fac.banner) {
        var bn = GH.models.buildBanner(fac.seated ? 0xe0b050 : 0xb02a2a);
        bn.position.set(0, 0, 9);
        camp.add(bn);
      }
      group.add(camp);

      var path = W.circuitPath();
      for (var g = 0; g < W.CIRCUIT.gates; g++) {
        var pp = path[Math.floor(g * path.length / W.CIRCUIT.gates)];
        var next = path[(Math.floor(g * path.length / W.CIRCUIT.gates) + 1) % path.length];
        var ang = Math.atan2(next.x - pp.x, next.z - pp.z);
        var gate = GH.models.buildPylonPair(g === 0 ? 0xffd050 : 0x60c8ff);
        gate.position.set(pp.x, gy(pp.x, pp.z), pp.z);
        gate.rotation.y = ang;
        group.add(gate);
      }
    }

    scene.add(group);
    return {
      group: group, nestMeshes: nestMeshes, vaultMeshes: vaultMeshes,
      chestMesh: chestMesh, objectiveMesh: objectiveMesh,
      fluxTiles: fluxTiles, cpMeshes: cpMeshes,
      barrierMeshes: barrierMeshes, plateMeshes: plateMeshes,
      coreMeshes: coreMeshes, relicMesh: relicMesh,
      receptorMeshes: receptorMeshes, switchMeshes: switchMeshes,
      screenMeshes: screenMeshes, beamPool: beamPool,
      raceLights: raceLights, terrain: terrain, itemPads: itemPads,
      layout: lay, info: info
    };
  };

  // interact prompts for the loaded zone
  W.interactables = function (layout, zoneId) {
    var list = [];
    if (zoneId === 'wreck') {
      list.push(
        { kind: 'broker', x: W.CAMP.x - 5, z: W.CAMP.z - 3, label: 'TALK TO THE BROKER' },
        { kind: 'shrine', x: W.CAMP.x + 5, z: W.CAMP.z - 3, label: 'KNEEL AT THE SHRINE (ATTRIBUTES & ARTS)' },
        { kind: 'memorial', x: W.CAMP.x, z: W.CAMP.z - 7, label: 'READ THE MEMORIAL (COLLECTION LOG)' },
        { kind: 'console', x: W.CAMP.x - 5, z: W.CAMP.z + 4, label: 'RUN SIM MISSIONS' },
        { kind: 'duel', x: W.CAMP.x + 6, z: W.CAMP.z + 5, label: 'ENTER THE TRACE DUEL' },
        { kind: 'circuit', x: W.CIRCUIT.x + W.CIRCUIT.r + 2, z: W.CIRCUIT.z, label: 'RACE THE SUNSPIRE CIRCUIT' }
      );
    }
    if (layout.relay) {
      list.push({ kind: 'relay', id: layout.relay.id, x: layout.relay.x, z: layout.relay.z, label: 'ACTIVATE THE RELAY (SIEGE)' });
    }
    if (layout.vault) {
      list.push({ kind: 'vault', id: layout.vault.id, x: layout.vault.x, z: layout.vault.z, label: 'BREACH THE VAULT (FIELD TRIAL)' });
    }
    if (layout.objective) {
      list.push({ kind: 'objective', x: layout.objective.x, z: layout.objective.z, label: 'AWAKEN ' + layout.objective.def.name + ' (DEFENSE)' });
    }
    if (layout.chest) {
      list.push({ kind: 'chest', x: layout.chest.x, z: layout.chest.z, label: 'OPEN THE REWARD CACHE' });
    }
    if (layout.raceway) {
      var start = layout.raceway.path[0];
      list.push({ kind: 'racestart', x: start.x, z: start.z, label: 'START THE RACE — 3 LAPS, LIVE FIRE' });
    }
    if (layout.relic) {
      list.push({ kind: 'relic', x: layout.relic.x, z: layout.relic.z, label: 'SEIZE THE RELIC (THE ALARM WILL SOUND)' });
    }
    return list;
  };

  return W;
})();
