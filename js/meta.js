// STAALREUS — persistent meta progression (localStorage)
// Pilot profiles (Standard / Iron Frame / Iron Core), salvage bank, frame &
// stage unlocks, attributes, art runes, contracts, collection log, trials.
GH.meta = (function () {
  var M = {};
  M.VERSION = '0.9.0';

  M.PROFILES = {
    standard: { key: 'hf_meta_v2', name: 'STANDARD', desc: 'Full hangar support.' },
    iron: { key: 'hf_meta_iron_v1', name: 'IRON FRAME', desc: 'No loadout kits, no bought perks. Self-reliant.' },
    hardcore: { key: 'hf_meta_hc_v1', name: 'IRON CORE', desc: 'Iron rules — and one death wipes the profile.' }
  };
  M.profile = 'standard';

  var defaults = function () {
    return {
      salvage: 0,
      shells: { aegis: true, vulcan: true },
      // frame workshop materials: ALLOY (common) and FRAME CORES (bosses)
      mats: { alloy: 0, cores: 0 },
      // one-off feats (relic prerequisites): harrow, ...
      feats: {},
      // a GAUNTLET / ARENA / WEEKLY run left mid-way with EXIT RUN
      suspended: null,
      // vehicle designs: chosen per lineage, and the second designs bought
      vectorPick: {},
      vectorsOwned: {},
      // world life: zone diaries, the daily board, today's mined veins
      diary: {},
      daily: null,
      nodesMined: {},
      // onboarding
      tutorial: { done: false },
      // hunts: bestiary kills per boss id, and which fell today
      bestiary: {},
      // difficulty band for the Reach (worldlife.js BANDS)
      band: 'bronze',
      huntsToday: { day: null, slain: {} },
      // save hygiene: minutes played, when a code/file was last exported
      playtimeMin: 0,
      lastExport: null,
      saveVersion: 2,
      stages: 1,
      // legacy stat lines — converted into attribute points on load
      devotion: { sol: 0, pyre: 0, keen: 0, verd: 0, ruin: 0 },
      // six attributes: spent free points, unspent points, and the flag
      // that says the old lines were already converted
      attr: {},
      attrPts: 0,
      attrMigrated: false,
      // Combat Art ranks (runes read) and runes waiting to be read
      arts: {},
      runeStock: 0,
      bestWave: {},
      bestArena: 0,
      victories: {},
      weekly: null,
      // hunt contracts
      broker: { active: null, points: 0, completed: 0, unlocks: {} },
      // collection log
      collection: {
        kills: {},          // enemy id -> count
        weapons: {},        // upgrade card id -> true
        resonances: {},     // resonance label -> true
        gems: {},           // gem type -> sockets made
        totalRuns: 0, totalKills: 0, totalWins: 0
      },
      // stage trials: stageId -> { taskId: true }
      trials: {},
      // pilot mastery: mechId -> xp
      mastery: {},
      // relic season: reset when id changes
      season: {
        id: null, pts: 0, done: {}, relics: [], claimed: 0,
        counters: { kills: 0, sparks: 0, resonances: 0, contracts: 0 },
        stagesCleared: {}, framesWon: {}
      },
      // signal ciphers: dry-streak pity + owned chase cosmetics
      cipher: { dry: 0, caches: 0 },
      style: { trail: null, paint: null, drone: null, owned: {} },
      // THE SHATTERED REACH — persistent world scars & expedition save
      world: {
        nests: {},          // nest id -> true (core broken, stays broken)
        lairsDown: {},      // zone id -> true (corrupt frame defeated)
        relaysHeld: {},     // relay id -> true (siege won)
        vaults: {},         // vault id -> true (breached, stays open)
        dungeons: {},       // dungeon zone id (with tier) -> cleared
        dgTier: {},         // dungeon base id -> highest tier cleared (ascension)
        artifacts: {},      // artifact id -> owned
        equipped: null,     // one artifact slot
        exp: null,          // serialized expedition character
        wreck: null,        // {x, z, salvage} where you last fell
        raceBest: 0,        // best circuit time in ms (0 = none)
        duelWins: 0,
        harrowDay: null,    // date stamp of the last day THE HARROW fell
        visited: {},        // zone id -> true (stood in it; unlocks its WAYPOINT)
        fac: null           // houses: reputation, stains, pledge, banner (see factions.js)
      },
      // pilot skill tree: nodeId -> rank, plus unspent points and the
      // persistent XP pool that pays them out
      skills: {},
      skillPoints: 0,
      pilotXP: 0,
      // one-time onboarding hints already shown
      seenHints: {},
      // reward-trait pick counts (for diminishing card weights)
      traitPicks: {}
    };
  };

  M.data = defaults();

  function storageKey() { return M.PROFILES[M.profile].key; }

  M.load = function (profile) {
    if (profile && M.PROFILES[profile]) M.profile = profile;
    else {
      try { M.profile = localStorage.getItem('hf_profile') || 'standard'; } catch (e) { M.profile = 'standard'; }
      if (!M.PROFILES[M.profile]) M.profile = 'standard';
    }
    M.data = defaults();
    try {
      localStorage.setItem('hf_profile', M.profile);
      var raw = localStorage.getItem(storageKey());
      if (raw) {
        var d = JSON.parse(raw);
        var base = M.data;
        for (var k in base) {
          if (d[k] === undefined) continue;
          // merge one level deep so new sub-fields keep defaults
          if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) &&
            d[k] && typeof d[k] === 'object') {
            for (var k2 in d[k]) base[k][k2] = d[k][k2];
          } else {
            base[k] = d[k];
          }
        }
      }
      // migrate the pre-meta coin bank into the standard profile
      if (M.profile === 'standard') {
        var old = parseInt(localStorage.getItem('hf_coins') || '0', 10);
        if (old > 0) {
          M.data.salvage += old;
          localStorage.removeItem('hf_coins');
          M.save();
        }
      }
    } catch (e) { /* storage unavailable — session-only meta */ }
    if (GH.attrs) GH.attrs.migrate();
  };

  M.save = function () {
    try { localStorage.setItem(storageKey(), JSON.stringify(M.data)); } catch (e) { /* ignore */ }
  };

  // ---------------------------------------------------------------
  // Backups: a rolling ring of snapshots per profile, written every few
  // minutes of play and whenever a run ends, so a bad save or a mistaken
  // ABANDON can be undone from the SAVE screen.
  // ---------------------------------------------------------------
  var BACKUP_SLOTS = 4;
  function backupKey(i) { return storageKey() + '_bak' + i; }
  M.backup = function (label) {
    try {
      var list = M.backups();
      var entry = { when: new Date().toISOString(), label: label || 'auto', data: M.data };
      // newest first; drop the oldest
      var raws = [JSON.stringify(entry)];
      for (var i = 0; i < list.length && raws.length < BACKUP_SLOTS; i++) raws.push(localStorage.getItem(backupKey(list[i].slot)));
      for (var j = 0; j < BACKUP_SLOTS; j++) {
        if (raws[j]) localStorage.setItem(backupKey(j), raws[j]); else localStorage.removeItem(backupKey(j));
      }
      return true;
    } catch (e) { return false; }
  };
  M.backups = function () {
    var out = [];
    for (var i = 0; i < BACKUP_SLOTS; i++) {
      try {
        var raw = localStorage.getItem(backupKey(i));
        if (!raw) continue;
        var e = JSON.parse(raw);
        out.push({ slot: i, when: e.when, label: e.label, salvage: e.data.salvage, frames: Object.keys(e.data.shells || {}).length, pilotXP: e.data.pilotXP || 0 });
      } catch (e2) { /* skip */ }
    }
    return out;
  };
  M.restoreBackup = function (slot) {
    try {
      var raw = localStorage.getItem(backupKey(slot));
      if (!raw) return false;
      var e = JSON.parse(raw);
      M.backup('before restore');
      localStorage.setItem(storageKey(), JSON.stringify(e.data));
      M.load(M.profile);
      return true;
    } catch (e3) { return false; }
  };

  // file export / import: the same blob as the save code, as a download
  M.exportBlob = function () {
    M.save();
    var blob = { v: 1, saved: new Date().toISOString().slice(0, 10), profiles: {} };
    for (var p in M.PROFILES) {
      try { var raw = localStorage.getItem(M.PROFILES[p].key); if (raw) blob.profiles[p] = JSON.parse(raw); } catch (e) { /* skip */ }
    }
    blob.memorial = M.memorial();
    M.data.lastExport = new Date().toISOString();
    M.save();
    return JSON.stringify(blob);
  };
  M.importBlob = function (text) {
    try {
      var t = (text || '').trim();
      if (t.indexOf('HF1.') === 0) return M.importCode(t);
      var blob = JSON.parse(t);
      if (!blob || blob.v !== 1 || !blob.profiles) return { ok: false, error: 'Not a STAALREUS save file.' };
      M.backup('before import');
      var count = 0;
      for (var p in blob.profiles) {
        if (!M.PROFILES[p]) continue;
        localStorage.setItem(M.PROFILES[p].key, JSON.stringify(blob.profiles[p]));
        count++;
      }
      if (blob.memorial) localStorage.setItem('hf_memorial', JSON.stringify(blob.memorial));
      M.load(M.profile);
      return { ok: true, profiles: count, saved: blob.saved };
    } catch (e) { return { ok: false, error: 'File is damaged or truncated.' }; }
  };
  // should the title nag about backing up? an hour played and nothing exported in 3 days
  M.wantsBackup = function () {
    if ((M.data.playtimeMin || 0) < 60) return false;
    if (!M.data.lastExport) return true;
    return (Date.now() - new Date(M.data.lastExport).getTime()) > 3 * 86400000;
  };

  M.isIron = function () { return M.profile === 'iron' || M.profile === 'hardcore'; };
  M.isHardcore = function () { return M.profile === 'hardcore'; };

  // Iron Core death: wipe the profile, engrave the fallen pilot
  M.hardcoreWipe = function (frameName, stageName, wave) {
    var entry = {
      frame: frameName, stage: stageName, wave: wave,
      when: new Date().toISOString().slice(0, 10)
    };
    try {
      var mem = JSON.parse(localStorage.getItem('hf_memorial') || '[]');
      mem.unshift(entry);
      localStorage.setItem('hf_memorial', JSON.stringify(mem.slice(0, 12)));
    } catch (e) { /* ignore */ }
    M.data = defaults();
    M.save();
    return entry;
  };

  M.memorial = function () {
    try { return JSON.parse(localStorage.getItem('hf_memorial') || '[]'); } catch (e) { return []; }
  };

  M.unlockShell = function (id) {
    if (!M.data.shells[id]) {
      M.data.shells[id] = true;
      M.save();
      return true;
    }
    return false;
  };

  M.unlockStage = function (n) {
    if (n > M.data.stages) { M.data.stages = n; M.save(); }
  };

  // ---------------------------------------------------------------
  // Save codes: export/import every profile + the memorial as one
  // portable string, so browser storage is never the only copy.
  // ---------------------------------------------------------------
  M.exportCode = function () {
    M.data.lastExport = new Date().toISOString();
    M.save(); // flush the active profile so the code matches live state
    var blob = { v: 1, saved: new Date().toISOString().slice(0, 10), profiles: {} };
    for (var p in M.PROFILES) {
      try {
        var raw = localStorage.getItem(M.PROFILES[p].key);
        if (raw) blob.profiles[p] = JSON.parse(raw);
      } catch (e) { /* skip */ }
    }
    blob.memorial = M.memorial();
    try {
      return 'HF1.' + btoa(unescape(encodeURIComponent(JSON.stringify(blob))));
    } catch (e) { return ''; }
  };

  M.importCode = function (code) {
    try {
      code = (code || '').trim();
      if (code.indexOf('HF1.') !== 0) return { ok: false, error: 'Not a STAALREUS save code.' };
      var blob = JSON.parse(decodeURIComponent(escape(atob(code.slice(4)))));
      if (!blob || blob.v !== 1 || !blob.profiles) return { ok: false, error: 'Code is damaged or truncated.' };
      M.backup('before import');
      var count = 0;
      for (var p in blob.profiles) {
        if (!M.PROFILES[p]) continue;
        localStorage.setItem(M.PROFILES[p].key, JSON.stringify(blob.profiles[p]));
        count++;
      }
      if (blob.memorial) localStorage.setItem('hf_memorial', JSON.stringify(blob.memorial));
      M.load(M.profile); // re-read the active profile from the imported data
      return { ok: true, profiles: count, saved: blob.saved };
    } catch (e) {
      return { ok: false, error: 'Code is damaged or truncated.' };
    }
  };

  // dev overrides: ?unlock=all etc.
  M.applyDevParams = function (search) {
    try {
      var p = new URLSearchParams(search);
      if (p.get('unlock') === 'all') {
        GH.mechs.forEach(function (m) { M.data.shells[m.id] = true; });
        M.data.stages = 6;
      }
      if (p.get('mats')) {
        var mv = parseInt(p.get('mats'), 10) || 0;
        M.data.mats.alloy += mv; M.data.mats.cores += Math.round(mv / 20);
      }
      if (p.get('salvage')) M.data.salvage += parseInt(p.get('salvage'), 10) || 0;
      if (p.get('weakboss') === '1') GH.devWeakBoss = true;
      if (p.get('phaseboss') === '1') GH.devPhaseBoss = true;
      if (p.get('god') === '1') GH.devGod = true;
      if (p.get('grant')) GH.devGrant = p.get('grant').split(',');
    } catch (e) { /* ignore */ }
  };

  return M;
})();
