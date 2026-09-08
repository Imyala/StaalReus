// STAALREUS — stage definitions (6 arenas; the GAUNTLET runs GH.WAVES assaults each)
// Bringing down a stage's REVENANT frame on the last assault recovers that
// frame's hulk (or blueprint data) and opens the next stage.
GH.WAVES = 16;        // assaults in a GAUNTLET run
GH.WAVE_HUNT = 8;     // the warden / hunt assault
GH.WAVE_OVERRUN = 12; // the spike
GH.WAVE_CARAPACE = 14;
GH.stages = [
  {
    id: 'wreck', hazard: null, name: 'TIDE WRECKAGE', sub: 'Stage 1', biome: 'dune coast — sand seas, a drowned fleet, the beach camp',
    // sun-bleached island ruin
    floor: { base: 0xb0a078, dark: '#3a3020', mortar: '#584c34' },
    sky: ['#7ec8d8', '#3a7890', '#1a3a48'],
    fog: 0x8fc0c8, hemiSky: 0xd8f0e8, hemiGround: 0x3a5a4a, sun: 0xfff0d0,
    wall: { base: '#6a8a7a', top: '#2a4438' },
    props: ['pillar', 'tree'],
    roster: function (w) {
      var t = [{ id: 'husk', w: 10 }];
      if (w >= 2) t.push({ id: 'shardling', w: 6 + w });
      if (w >= 3) t.push({ id: 'scarab', w: 4 });
      if (w >= 3) t.push({ id: 'beakstrider', w: 3 });
      if (w >= 4) t.push({ id: 'tideleech', w: 3 });
      if (w >= 4) t.push({ id: 'spiker', w: 4 });
      if (w >= 5) t.push({ id: 'burrower', w: 3 });
      if (w >= 6) t.push({ id: 'brute', w: 2 + w * 0.2 });
      return t;
    },
    tint: 0x9ab0a0,
    unlocks: 'fang',
    hpMult: 1, dmgMult: 1
  },
  {
    id: 'glacier', hazard: 'ice', name: 'GLACIER HOLLOW', sub: 'Stage 2', biome: 'frost range — pine valleys, frozen lakes, snowfall',
    floor: { base: 0x8ab0c8, dark: '#16282e', mortar: '#2e4852' },
    sky: ['#bfe8ff', '#5a90c0', '#182848'],
    fog: 0x9fc8dc, hemiSky: 0xbfe8ff, hemiGround: 0x24485a, sun: 0xeaf6ff,
    wall: { base: '#9ec8dc', top: '#4a7890' },
    props: ['pillar', 'crystal'],
    roster: function (w) {
      var t = [{ id: 'husk', w: 8 }, { id: 'shardling', w: 6 + w }];
      if (w >= 2) t.push({ id: 'stalker', w: 6 });
      if (w >= 3) t.push({ id: 'frostwisp', w: 5 });
      if (w >= 5) t.push({ id: 'howler', w: 2 });
      if (w >= 4) t.push({ id: 'orb', w: 4 });
      if (w >= 6) t.push({ id: 'spiker', w: 4 });
      if (w >= 7) t.push({ id: 'brute', w: 2 + w * 0.25 });
      return t;
    },
    tint: 0xa0c8e0,
    unlocks: 'hexen',
    hpMult: 1.35, dmgMult: 1.15
  },
  {
    id: 'cloister', hazard: 'vines', name: 'VERDANT CLOISTER', sub: 'Stage 3', biome: 'rain canopy — jungle, vines, ponds and mud',
    floor: { base: 0x7a8a58, dark: '#1c2410', mortar: '#3a4424' },
    sky: ['#b8d890', '#4a7840', '#122a18'],
    fog: 0x8aa878, hemiSky: 0xd0e8b0, hemiGround: 0x24381a, sun: 0xfff8d0,
    wall: { base: '#5a7848', top: '#243418' },
    props: ['tree', 'tree', 'pillar'],
    roster: function (w) {
      var t = [{ id: 'husk', w: 6 }, { id: 'spiker', w: 5 + w * 0.4 }];
      if (w >= 2) t.push({ id: 'lurker', w: 5 });
      if (w >= 3) t.push({ id: 'shardling', w: 5 });
      if (w >= 4) t.push({ id: 'creeper', w: 5 });
      if (w >= 5) t.push({ id: 'bloat', w: 4 });
      if (w >= 3) t.push({ id: 'skitter', w: 5 });
      if (w >= 6) t.push({ id: 'bellowtoad', w: 3 });
      if (w >= 7) t.push({ id: 'orb', w: 3 });
      if (w >= 8) t.push({ id: 'brute', w: 3 + w * 0.25 });
      return t;
    },
    tint: 0x90b080,
    unlocks: 'viper',
    hpMult: 1.8, dmgMult: 1.32
  },
  {
    id: 'ember', hazard: 'vents', name: 'EMBER CORE', sub: 'Stage 4', biome: 'cinder wastes — basalt, lava basins, ash',
    floor: { base: 0x9a5848, dark: '#200a08', mortar: '#48201a' },
    sky: ['#ff9060', '#8a3020', '#180604'],
    fog: 0x6a3028, hemiSky: 0xffa070, hemiGround: 0x5a2a1c, sun: 0xffc090,
    wall: { base: '#7a4030', top: '#301008' },
    props: ['pillar', 'crystal'],
    roster: function (w) {
      var t = [{ id: 'husk', w: 6 }, { id: 'cinder', w: 6 + w * 0.5 }];
      if (w >= 2) t.push({ id: 'crawler', w: 6 });
      if (w >= 2) t.push({ id: 'cinderhound', w: 6 });
      if (w >= 6) t.push({ id: 'slaggolem', w: 2 });
      if (w >= 3) t.push({ id: 'orb', w: 4 });
      if (w >= 4) t.push({ id: 'drake', w: 4 });
      if (w >= 5) t.push({ id: 'shardling', w: 5 });
      if (w >= 5) t.push({ id: 'brute', w: 4 + w * 0.3 });
      if (w >= 8) t.push({ id: 'spiker', w: 5 });
      return t;
    },
    tint: 0xc08070,
    unlocks: 'morrow',
    hpMult: 2.4, dmgMult: 1.55
  },
  {
    id: 'storm', hazard: 'lightning', name: 'STORMSPIRE', sub: 'Stage 5', biome: 'thunder highlands — terraced mesas, rain, lightning',
    floor: { base: 0x707890, dark: '#141422', mortar: '#2c2c44' },
    sky: ['#9090b8', '#3c3c68', '#0a0a1c'],
    fog: 0x585c78, hemiSky: 0xa8a8d0, hemiGround: 0x1c1c30, sun: 0xd0d0ff,
    wall: { base: '#585c78', top: '#20203a' },
    props: ['pillar', 'crystal', 'tree'],
    roster: function (w) {
      var t = [{ id: 'husk', w: 5 }, { id: 'volt', w: 6 + w * 0.5 }];
      if (w >= 2) t.push({ id: 'sentinel', w: 5 });
      if (w >= 5) t.push({ id: 'rodsentry', w: 2 });
      if (w >= 3) t.push({ id: 'orb', w: 4 });
      if (w >= 4) t.push({ id: 'drake', w: 4 });
      if (w >= 4) t.push({ id: 'shardling', w: 6 });
      if (w >= 5) t.push({ id: 'spiker', w: 5 });
      if (w >= 6) t.push({ id: 'brute', w: 4 + w * 0.3 });
      return t;
    },
    tint: 0x9098b8,
    unlocks: 'strix',
    hpMult: 3.2, dmgMult: 1.8
  },
  {
    id: 'null', hazard: 'rifts', name: 'NULL SANCTUM', sub: 'Final Stage', biome: 'void sanctum — crystal shards, chasms, low gravity',
    floor: { base: 0x8a8a92, dark: '#0a0a0e', mortar: '#26262e' },
    sky: ['#d8d8e0', '#404048', '#000004'],
    fog: 0x3a3a44, hemiSky: 0xe8e8f0, hemiGround: 0x101014, sun: 0xffffff,
    wall: { base: '#4a4a55', top: '#101014' },
    props: ['pillar', 'crystal'],
    roster: function (w) {
      var t = [
        { id: 'husk', w: 5 }, { id: 'shardling', w: 6 }, { id: 'volt', w: 3 },
        { id: 'cinder', w: 3 }, { id: 'creeper', w: 3 }
      ];
      if (w >= 2) t.push({ id: 'phantom', w: 6 });
      if (w >= 3) t.push({ id: 'nullshard', w: 6 });
      if (w >= 4) t.push({ id: 'eyecluster', w: 4 });
      if (w >= 3) t.push({ id: 'orb', w: 4 });
      if (w >= 4) t.push({ id: 'spiker', w: 5 });
      if (w >= 5) t.push({ id: 'brute', w: 5 + w * 0.35 });
      return t;
    },
    tint: 0xb0b0b8,
    unlocks: 'titan',
    hpMult: 4.2, dmgMult: 2.1
  }
];

// Expedition-only territories: built places rather than biomes. They
// never appear in the classic stage ladder, but every world system
// (textures, weather, dungeons, rosters) reads them like a stage.
GH.extraZones = [
  {
    id: 'hive', hazard: null, name: 'SPIRE HIVE', sub: 'Territory', biome: 'hive city — stacked hab-blocks under a mile-high spire',
    floor: { base: 0x5a5e6c, dark: '#14161c', mortar: '#2a2e38' },
    sky: ['#6a5040', '#2a2430', '#0a0a10'],
    fog: 0x3a3440, hemiSky: 0xb09080, hemiGround: 0x1c1c26, sun: 0xffd0a0,
    wall: { base: '#4a4f5c', top: '#1a1c24' },
    props: ['pillar'],
    roster: function (w) {
      var t = [{ id: 'husk', w: 6 }, { id: 'slinger', w: 7 }];
      if (w >= 2) t.push({ id: 'crawler', w: 4 });
      if (w >= 3) t.push({ id: 'shardling', w: 5 });
      if (w >= 4) t.push({ id: 'habbrute', w: 3 });
      if (w >= 5) t.push({ id: 'drake', w: 3 });
      if (w >= 6) t.push({ id: 'rodsentry', w: 2 });
      return t;
    },
    tint: 0x7a7e8c, unlocks: 'strix', hpMult: 3.0, dmgMult: 1.7
  },
  {
    id: 'ruins', hazard: 'vines', name: 'FALLEN CITADEL', sub: 'Territory', biome: 'drowned ruins — colonnades, arches, a dead city under moss',
    floor: { base: 0x6a7a58, dark: '#1c2410', mortar: '#3a4424' },
    sky: ['#c8d8c0', '#6a8a70', '#1a2a20'],
    fog: 0x8aa090, hemiSky: 0xd0e0c8, hemiGround: 0x2a3a2a, sun: 0xfff4d8,
    wall: { base: '#7a7a74', top: '#2a3020' },
    props: ['pillar', 'tree'],
    roster: function (w) {
      var t = [{ id: 'husk', w: 6 }, { id: 'gravestalker', w: 6 }];
      if (w >= 2) t.push({ id: 'lurker', w: 4 });
      if (w >= 3) t.push({ id: 'carrionkite', w: 4 });
      if (w >= 4) t.push({ id: 'orb', w: 3 });
      if (w >= 5) t.push({ id: 'slaggolem', w: 2 });
      if (w >= 6) t.push({ id: 'phantom', w: 3 });
      return t;
    },
    tint: 0x90a888, unlocks: 'viper', hpMult: 2.0, dmgMult: 1.4
  },
  {
    id: 'keep', hazard: null, name: 'BASTION KEEP', sub: 'Territory', biome: 'walled keep — curtain wall, moat, donjon, a garrison in the wards',
    floor: { base: 0x7a7a80, dark: '#1c1c22', mortar: '#3a3a44' },
    sky: ['#b8c0d0', '#5a6a80', '#1a2030'],
    fog: 0x7a8494, hemiSky: 0xc8d0e0, hemiGround: 0x2a2e3a, sun: 0xfff0e0,
    wall: { base: '#6a6a72', top: '#2a2a30' },
    props: ['pillar'],
    roster: function (w) {
      var t = [{ id: 'husk', w: 6 }, { id: 'wardenknight', w: 6 }];
      if (w >= 2) t.push({ id: 'ballista', w: 2 });
      if (w >= 3) t.push({ id: 'stalker', w: 4 });
      if (w >= 4) t.push({ id: 'tideleech', w: 3 });
      if (w >= 5) t.push({ id: 'brute', w: 3 });
      if (w >= 6) t.push({ id: 'drake', w: 3 });
      return t;
    },
    tint: 0x9098a8, unlocks: 'titan', hpMult: 3.2, dmgMult: 1.8
  },
  {
    id: 'warrens', hazard: 'rifts', name: 'DEEP WARRENS', sub: 'Territory', biome: 'undercity — cave cities cut into rock, joined by tunnels',
    floor: { base: 0x4a3a50, dark: '#0a080e', mortar: '#1e1826' },
    sky: ['#1a1420', '#0a080e', '#000000'],
    fog: 0x120e18, hemiSky: 0x9a8ab8, hemiGround: 0x1c1626, sun: 0xb0a8d0,
    wall: { base: '#3a3040', top: '#0a080e' },
    props: ['crystal'],
    roster: function (w) {
      var t = [{ id: 'glowmite', w: 8 }, { id: 'husk', w: 4 }];
      if (w >= 2) t.push({ id: 'tunnelmaw', w: 3 });
      if (w >= 3) t.push({ id: 'bellowtoad', w: 4 });
      if (w >= 4) t.push({ id: 'fungalshambler', w: 3 });
      if (w >= 5) t.push({ id: 'phantom', w: 3 });
      if (w >= 6) t.push({ id: 'creeper', w: 4 });
      return t;
    },
    tint: 0x6a5a80, unlocks: 'morrow', hpMult: 4.0, dmgMult: 2.0
  },
  {
    id: 'sky', hazard: 'lightning', name: 'AETHER COURT', sub: 'Territory', biome: 'a kingdom in the sky — islands, bridges, the court of the crown',
    // cloud-marble ground a shade below white, so the court is not one
    // white-out from the ground to the haze
    floor: { base: 0xc4c8dc, dark: '#4a4a66', mortar: '#8a8ea8' },
    sky: ['#f4f8ff', '#7ab0f8', '#2c58b8'],
    fog: 0x9cb6e6, hemiSky: 0xe8eeff, hemiGround: 0x506898, sun: 0xfff0d0,
    wall: { base: '#f0f0f4', top: '#8090b0' },
    props: ['pillar'],
    roster: function (w) {
      var t = [{ id: 'cloudwisp', w: 7 }, { id: 'aetherray', w: 5 }];
      if (w >= 2) t.push({ id: 'shardling', w: 4 });
      if (w >= 3) t.push({ id: 'sentinel', w: 4 });
      if (w >= 4) t.push({ id: 'wardenknight', w: 3 });
      if (w >= 5) t.push({ id: 'eyecluster', w: 3 });
      if (w >= 6) t.push({ id: 'phantom', w: 3 });
      return t;
    },
    tint: 0xc8d0f0, unlocks: 'hexen', hpMult: 4.2, dmgMult: 2.1
  }
];
GH.allStages = function () { return GH.stages.concat(GH.extraZones); };

// Assault plan for a stage: timers, spawn rates, set-piece waves.
// Wave 8: warden / hunt. Wave 12: OVERRUN spike. Wave 14: carapace midboss.
// Wave 16: the REVENANT frame (the next recoverable frame), then the clear.
GH.wavePlan = function (stage, wave, arena) {
  var plan = {
    duration: 22 + wave * 0.9,
    // deliberate-combat tuning: roughly half the bodies, half again the hull
    rate: (0.7 + wave * 0.24) * 0.55 * (arena ? 1.15 : 1),
    types: stage.roster(wave),
    boss: null, midboss: null,
    hpMult: stage.hpMult * (1 + (wave - 1) * 0.16) * 1.4,
    // contact pressure ramps harder past wave 10, where builds have come online
    dmgMult: stage.dmgMult * (1 + (wave - 1) * 0.06 + Math.max(0, wave - 10) * 0.015),
    overrun: false
  };
  // gentler first minutes on the opening stage for new pilots
  if (stage.id === 'wreck' && wave <= 2) plan.rate *= 0.7;
  if (arena) {
    // endless: scale forever, a warden or hunt every ten
    plan.hpMult = (1 + (wave - 1) * 0.24) * 1.4;
    plan.dmgMult = 1 + (wave - 1) * 0.07;
    plan.types = stage.roster(Math.min(wave, 12));
    if (wave % 10 === 0) plan.midboss = 'warden';
    if (wave >= 14) plan.rate *= 1.25;
    return plan;
  }
  // a shorter ladder climbs a little steeper so the revenant lands as hard
  plan.hpMult *= 1 + (wave - 1) * 0.03;
  if (wave === GH.WAVE_HUNT) plan.midboss = 'warden';
  if (wave === GH.WAVE_OVERRUN) { plan.overrun = true; plan.rate *= 2.4; plan.duration = 26; }
  if (wave === GH.WAVE_CARAPACE) plan.midboss = 'carapace';
  if (wave === GH.WAVES) { plan.boss = stage.unlocks; plan.rate *= 0.5; }
  return plan;
};
