// STAALREUS — core game logic
GH.game = (function () {
  var G = {};

  // ---------- scene / world ----------
  var scene, camera, hemi, sun, rim, floor, wallRing, arenaProps;
  var ARENA_R = 33;

  // ---------- run state ----------
  G.state = 'title'; // title | select | stageselect | hangar | play | reward | pause | over | win
  G.mode = 'classic'; // classic | arena
  var player = null;
  var stage = null, stageIndex = 0;
  var enemies = [], projectiles = [], enemyShots = [], pickups = [], mines = [], effects = [];
  var orbitGroup = null, droneMesh = null, droneAngle = 0;
  var waveNum = 0, waveTimer = 0, wavePlan = null, spawnAcc = 0, bossRef = null;
  var kills = 0, coinsRun = 0, runTime = 0, hitCount = 0;
  var sparksRun = 0, elitesSpawned = 0;
  var announceTimer = 0, shake = 0, hitStopT = 0;
  var announceQueue = [];
  var selMechIndex = 0, selPreview = null, selSpin = 0;
  var weekly = null;   // active weekly-challenge modifiers
  var mate = null;     // co-op wingmate (player 2)
  var cipherRun = null; // active signal-cipher step state
  var picoDrone = null, picoAngle = 0;
  G.coop = false;

  G.hitStop = function (t) { hitStopT = Math.max(hitStopT, t); };

  // ---------------------------------------------------------------
  // First-run onboarding hints: shown once per profile, bottom-center,
  // timed into the opening waves so new pilots learn by doing.
  // ---------------------------------------------------------------
  var hintTimer = 0, activeHint = null;

  function showHint(id, text) {
    var seen = GH.meta.data.seenHints;
    if (seen[id] || activeHint) return;
    seen[id] = true;
    GH.meta.save();
    activeHint = id;
    hintTimer = 5;
    var el2 = document.getElementById('hint-line');
    el2.textContent = text;
    el2.classList.remove('hidden');
  }

  function updateHints(dt) {
    if (activeHint) {
      hintTimer -= dt;
      if (hintTimer <= 0) {
        document.getElementById('hint-line').classList.add('hidden');
        activeHint = null;
      }
    }
    var seen = GH.meta.data.seenHints;
    var L = GH.controls.label;
    if (expActive && runTime > 12) {
      showHint('transform', 'Press ' + L('transform') + ' to TRANSFORM — the skimmer is fast and mounts strafe cannons, but its hull is thin');
    }
    if (seen.__done) return;
    if (waveNum === 1) {
      if (runTime > 0.5) showHint('move', L('forward') + '/' + L('back') + ' walk · ' + L('turnLeft') + '/' + L('turnRight') + ' turn · hold RIGHT MOUSE to look around · LEFT CLICK attacks and marks a target');
      if (runTime > 8) showHint('ability', 'Press ' + L('ability1') + ' to cast RUPTURE on your target, ' + L('ability5') + ' for your frame\'s SIGNATURE — abilities spend the blue ENERGY bar');
      if (sparksRun > 0) showHint('sparks', 'SPARKS feed your level AND your persistent PILOT LEVEL — skill points are spent in PILOT TRAINING [' + L('skills') + ']');
    }
    if (waveNum === 2) {
      if (waveTimer < wavePlan.duration - 2) {
        showHint('wards', 'Press ' + L('ward1') + ' / ' + L('ward2') + ' / ' + L('ward3') + ' to raise a WARD — match it to the incoming damage to cut it 75%');
      }
    }
    if (waveNum === 3) {
      showHint('special', L('special') + ' fires your frame’s SPECIAL · ALLOY and FRAME CORES you pick up build new frames in the HANGAR WORKSHOP');
      if (seen.special) { seen.__done = true; GH.meta.save(); }
    }
  }

  // season task announcements
  function seasonTaskNotify(taskId) {
    var t = GH.progress.seasonAward(taskId);
    if (t) queueAnnounce('SEASON — ' + t.desc.toUpperCase() + ' (+' + t.pts + ')', 18);
  }
  function seasonAwardNotify(awardedIds) {
    (awardedIds || []).forEach(function (id) {
      GH.progress.seasonTasks.forEach(function (t) {
        if (t.id === id) queueAnnounce('SEASON — ' + t.desc.toUpperCase() + ' (+' + t.pts + ')', 18);
      });
    });
  }

  // award a stage-trial task; announces the task and any newly-finished tier
  function awardTrial(taskId) {
    if (!stage) return;
    var before = GH.progress.trialTier(stage.id);
    if (!GH.progress.trialAward(stage.id, taskId)) return;
    queueAnnounce('TRIAL — ' + GH.progress.taskDesc(taskId).toUpperCase(), 20);
    GH.audio.levelup();
    var after = GH.progress.trialTier(stage.id);
    if (after > before) {
      queueAnnounce('STAGE TRIAL ' + GH.progress.trialTiers[after - 1].name +
        ' — ' + GH.progress.trialTiers[after - 1].perk.toUpperCase(), 20);
    }
  }

  var raycaster = new THREE.Raycaster();
  var groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  // terrain height under a point (0 in the flat arenas)
  function gy(x, z) { return GH.terrain.h(x, z); }
  var camGround = 0; // smoothed ground height under the camera target
  // CHASE: behind the frame, mouse turns you, the crosshair sits dead centre.
  // TACTICAL: the old top-down view. V swaps them.
  var camMode = 'chase';
  try { camMode = localStorage.getItem('hf_cam') || 'chase'; } catch (e) { /* no storage */ }
  var camYaw = Math.PI;
  var camPitch = 0;      // right-mouse drag tilts the chase camera
  var camDist = 1;       // wheel zoom (0.55 .. 1.9)
  var camPrevX = 0, camPrevZ = 0;
  G.camMode = function () { return camMode; };
  G.setCamMode = function (m) {
    camMode = m === 'top' ? 'top' : 'chase';
    try { localStorage.setItem('hf_cam', camMode); } catch (e) { /* no storage */ }
    if (player) camYaw = player.speederOn && player.drive ? player.drive.heading : (player.facing || Math.PI);
  };
  G.toggleCamera = function () {
    G.setCamMode(camMode === 'chase' ? 'top' : 'chase');
    var L = GH.controls.label;
    announce(camMode === 'chase'
      ? 'CHASE CAMERA — ' + L('turnLeft') + '/' + L('turnRight') + ' TURN · RIGHT-MOUSE LOOKS'
      : 'TACTICAL CAMERA — MOUSE AIMS, ' + L('forward') + L('turnLeft') + L('back') + L('turnRight') + ' MOVES', 20);
  };
  var tmpV3 = new THREE.Vector3();

  // =================================================================
  // INIT
  // =================================================================
  G.init = function () {
    GH.assets.init();
    GH.meta.load();
    GH.meta.applyDevParams(location.search);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x9fc8dc, 18, 52);
    GH.factions.notify = function (text, size) { if (G.state === 'play') queueAnnounce(text, size); };
    camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 220);

    // three-point light: a softer sky fill, a harder warm key, and a cool
    // rim from behind so steel edges catch and frames stand off the ground
    hemi = new THREE.HemisphereLight(0xbfe8ff, 0x24485a, 0.72);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff4d8, 1.15);
    sun.position.set(14, 13, 9); // low enough that slopes shade
    scene.add(sun);
    rim = new THREE.DirectionalLight(0x7f96e0, 0.55);
    rim.position.set(-12, 9, -15);
    scene.add(rim);

    floor = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      GH.assets.lambert({ map: GH.assets.stageTex.glacier.floor }, { nosnap: true })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // encircling cliffs
    wallRing = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA_R + 14, ARENA_R + 10, 16, 24, 1, true),
      GH.assets.lambert({ map: GH.assets.stageTex.glacier.wall, side: THREE.BackSide }, { nosnap: true })
    );
    wallRing.position.y = 7.5;
    scene.add(wallRing);

    arenaProps = new THREE.Group();
    scene.add(arenaProps);

    orbitGroup = new THREE.Group();
    scene.add(orbitGroup);

    G.dmg = makeDamageLayer();
  };

  function applyStageLook(st) {
    var tex = GH.assets.stageTex[st.id];
    scene.background = tex.sky;
    scene.fog.color.setHex(st.fog);
    hemi.color.setHex(st.hemiSky);
    hemi.groundColor.setHex(st.hemiGround);
    sun.color.setHex(st.sun);
    floor.material.map = tex.floor;
    floor.material.needsUpdate = true;
    wallRing.visible = true;
    wallRing.material.map = tex.wall;
    wallRing.material.needsUpdate = true;
    scatterProps(st);
  }

  function scatterProps(st) {
    while (arenaProps.children.length) arenaProps.remove(arenaProps.children[0]);
    for (var i = 0; i < 16; i++) {
      var kind = GH.pick(st.props);
      var p = GH.models.props[kind]();
      var a = Math.random() * Math.PI * 2;
      var r = GH.rand(10, ARENA_R + 6);
      p.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      arenaProps.add(p);
    }
  }

  // =================================================================
  // DAMAGE NUMBER LAYER (DOM)
  // =================================================================
  function makeDamageLayer() {
    var layer = document.getElementById('damage-layer');
    var pool = [];
    for (var i = 0; i < 56; i++) {
      var d = document.createElement('div');
      d.className = 'dmg-num';
      d.style.display = 'none';
      layer.appendChild(d);
      pool.push({ el: d, life: 0, wx: 0, wy: 0, wz: 0, vy: 0 });
    }
    var idx = 0;
    return {
      spawn: function (x, y, z, text, cls, size) {
        var n = pool[idx]; idx = (idx + 1) % pool.length;
        n.life = 0.75;
        n.wx = x + GH.rand(-0.4, 0.4); n.wy = y + gy(x, z); n.wz = z;
        n.vy = 2.6;
        n.el.textContent = text;
        n.el.className = 'dmg-num' + (cls ? ' ' + cls : '');
        n.el.style.fontSize = (size || 17) + 'px';
        n.el.style.display = 'block';
      },
      update: function (dt, w, h) {
        for (var i = 0; i < pool.length; i++) {
          var n = pool[i];
          if (n.life <= 0) continue;
          n.life -= dt;
          if (n.life <= 0) { n.el.style.display = 'none'; continue; }
          n.wy += n.vy * dt;
          n.vy -= 5 * dt;
          tmpV3.set(n.wx, n.wy, n.wz).project(camera);
          n.el.style.left = ((tmpV3.x * 0.5 + 0.5) * w) + 'px';
          n.el.style.top = ((-tmpV3.y * 0.5 + 0.5) * h) + 'px';
          n.el.style.opacity = Math.min(1, n.life * 3);
        }
      }
    };
  }

  // =================================================================
  // WEAPON INSTANCES
  // =================================================================
  function makeWeaponInst(id, def, isPrimary) {
    var w = {};
    for (var k in def) w[k] = def[k];
    var inst = {
      id: id, w: w, isPrimary: !!isPrimary,
      timer: 0, clip: w.clip || 0, reloading: 0,
      burstLeft: 0, burstTimer: 0, burstAngle: 0,
      sockets: [], mods: null, resonance: null,
      sanctityT: 8, prismT: 6, angle: 0
    };
    GH.gems.applySocketBonuses(inst);
    return inst;
  }

  function weaponDamage(inst, actor) {
    var a2 = actor || player;
    var s = player.stats;
    var d = (inst.w.damage + s.flatDamage) * s.damageMult * inst.mods.damageMult;
    if (a2 === player && player.counter.length) {
      d *= 1 + player.counter.length * 0.03; // ward COUNTER stacks
    }
    if (a2.def.passive === 'wrath') {
      var missing = 1 - a2.hp / s.maxHP;
      d *= 1 + Math.min(0.6, missing * 0.75);
    }
    if (inst.w.element || inst.w.cycle || inst.w.cls === 'HEAVY · ELEMENTAL' || inst.w.cls === 'LIGHT · ELEMENTAL') {
      d *= s.elemMult;
    }
    return d;
  }

  function resHas(inst, type) {
    // potency 1 (pure) or 0.6 (3+1 dominant); hybrids have their own
    // named identities and never grant diluted pure effects
    var r = inst.resonance;
    if (!r) return 0;
    if (r.kind === 'prism' || r.kind === 'hybrid') return 0;
    if (r.types.indexOf(type) === -1) return 0;
    return r.kind === 'pure' ? 1 : 0.6;
  }

  function anyHybrid(id) {
    if (!player) return false;
    for (var i = 0; i < player.weapons.length; i++) {
      if (player.weapons[i].hybridId === id) return true;
    }
    return false;
  }

  function currentElement(inst) {
    if (inst.w.cycle) return inst.w.cycle[Math.floor(runTime / 5) % inst.w.cycle.length];
    return inst.w.element || null;
  }

  // =================================================================
  // PLAYER
  // =================================================================
  function makePlayer(mechDef) {
    var s = mechDef.stats;
    var dev = GH.attrs.bonus(mechDef); // six attributes: auto-grown + spent points
    var skl = GH.skills.bonuses(); // the pilot's trained tree
    var p = {
      def: mechDef,
      vec: GH.vehicles.activeFor(mechDef),
      mesh: GH.models.buildMech(mechDef.model),
      x: 0, z: 0, facing: 0, moveX: 0, moveZ: 0,
      stats: {
        maxHP: s.maxHP + dev.maxHP + skl.maxHP, speed: s.speed * 0.42,
        armor: s.armor + skl.armor + dev.armor,
        block: s.block + skl.block + dev.block, crit: s.crit + dev.crit + skl.crit,
        critMult: 1.6,
        lifesteal: s.lifesteal,
        damageMult: 1 + dev.damageMult + skl.damageMult,
        atkSpdMult: 1 + dev.atkSpdMult + skl.atkSpdMult, flatDamage: 0,
        regen: dev.regen, magnet: 3.2 * (1 + dev.magnet), xpGain: 1 + dev.xpGain,
        bonusProj: skl.cleave ? 1 : 0,
        boostRegen: 0.35 + dev.boostRegen + skl.boostRegen, boostCost: 0.34,
        elemMult: mechDef.elemMult || (mechDef.id === 'hexen' ? 1.15 : 1),
        energyMax: skl.energyMax, energyRegen: skl.energyRegen,
        // UPLINK: loot find (% more alloy, coin and rune drops); REACTOR:
        // Combat Art power and recharge
        lootFind: dev.lootFind, artMult: dev.artMult, artCd: dev.artCd
      },
      skillBon: skl,
      energy: skl.energyMax,
      abilityCds: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      sig: GH.skills.signatureFor(mechDef), sigPower: mechDef.kind === 'relic' ? 1.25 : 1, sigT: 0, sigKind: null,
      hp: 0,
      xp: 0, level: 1, xpNeed: 6,
      weapons: [],
      weaponLevels: {},
      protocols: {},
      pendingGems: [],
      pendingCards: [],
      item: null, shieldT: 0,
      boost: 1, dashTime: 0, dashX: 0, dashZ: 0, dashId: 0, dashKind: 'boost',
      blocking: false,
      special: { cd: 0, active: 0 },
      frenzy: [], edgeT: 0,
      ward: null, wardEnergy: 1, wardCd: 0, counter: [],
      hurtCd: 0,
      heal: function (amt) {
        if (p.hp <= 0) return;
        var real = Math.min(amt, p.stats.maxHP - p.hp);
        p.hp += real;
        if (real >= 1) G.dmg.spawn(p.x, 2.4, p.z, '+' + Math.round(real), 'heal', 15);
      }
    };
    p.hp = p.stats.maxHP;
    p.weapons.push(makeWeaponInst('primary', mechDef.weapon, true));
    if (GH.factions) GH.factions.applyDoctrine(p.stats);
    p.mesh.position.set(0, 0, 0);
    scene.add(p.mesh);
    return p;
  }

  function playerDamage(raw, srcE, dmgType) {
    if (!player || player.hp <= 0 || player.dashTime > 0.12 || GH.devGod) return;
    if (player.shieldT > 0) { G.dmg.spawn(player.x, 2.6, player.z, 'SHIELD', 'heal', 14); return; }
    var s = player.stats;
    if (player.speederOn) raw *= 1.25; // skimmer hull is thin — speed is the armor
    if (player.sigKind === 'wall') { raw *= 0.4; player.heal(player.stats.maxHP * 0.03); }
    var block = s.block + (player.protocols.vents && player.hp < s.maxHP * 0.35 ? 10 : 0);
    if (Math.random() * 100 < block) {
      G.dmg.spawn(player.x, 2.6, player.z, 'BLOCK', 'heal', 14);
      GH.audio.block();
      if (player.def.special === 'block') player.heal(2);
      return;
    }
    // matching ward: 75% cut, small energy cost, feeds COUNTER stacks
    var warded = dmgType && player.ward === dmgType;
    if (warded) {
      raw *= 0.25;
      player.wardEnergy = Math.max(0, player.wardEnergy - 0.06);
      player.counter.push(4);
      if (player.counter.length > player.skillBon.counterCap) player.counter.shift();
      G.dmg.spawn(player.x, 3.0, player.z, 'WARDED', 'elem', 13);
      GH.audio.block();
    }
    var armor = s.armor + (player.special.active > 0 && player.def.special === 'bulwark' ? 12 : 0);
    var dmg = Math.max(1, Math.round(raw - armor));
    if (player.blocking) {
      dmg = Math.max(1, Math.round(dmg * 0.3));
      player.heal(3);
      GH.audio.block();
    }
    player.hp -= dmg;
    player.hurtCd = 0.25;
    G.hitStop(0.05);
    shake = Math.min(0.5, shake + 0.18);
    if (cipherRun && cipherRun.steps[cipherRun.idx].id === 'hold') cipherRun.t = 0;
    G.dmg.spawn(player.x, 2.6, player.z, dmg, 'player', 19);
    GH.audio.hurt();
    if (player.protocols.thorns && srcE && !srcE.dead) {
      damageEnemy(srcE, s.armor * 2, { canCrit: false, noRes: true });
    }
    // GLACIER CORE: whatever wounds you is frostbitten in return
    if (srcE && !srcE.dead && artOn('glacier_core')) srcE.slowT = 2.5;
    if (player.hp <= 0) {
      // PHOENIX hybrid: cheat death once per run
      if (!player.phoenixUsed && anyHybrid('phoenix')) {
        player.phoenixUsed = true;
        player.hp = Math.round(s.maxHP * 0.3);
        announce('PHOENIX — REBORN', 30);
        GH.audio.win();
        G.hitStop(0.12);
        spawnBurst(player.x, 1.4, player.z, 0xff9040, 26);
        for (var pi = 0; pi < enemies.length; pi++) {
          var pe = enemies[pi];
          if (pe.dead) continue;
          if (GH.dist2(player.x, player.z, pe.x, pe.z) < 36) {
            damageEnemy(pe, 30 * s.damageMult, { canCrit: false, noRes: true, elem: 'burn' });
            var pa = GH.angleTo(player.x, player.z, pe.x, pe.z);
            pe.vx += Math.sin(pa) * 16 / pe.def.mass;
            pe.vz += Math.cos(pa) * 16 / pe.def.mass;
          }
        }
        return;
      }
      player.hp = 0;
      gameOver(false);
    }
  }

  function gainXP(amount) {
    player.xp += amount * player.stats.xpGain;
    // every spark also feeds the persistent pilot level → skill points
    var gained = GH.skills.gainPilotXP(amount);
    if (gained > 0) {
      var pl = GH.skills.pilotProgress().lvl;
      queueAnnounce('PILOT LEVEL ' + pl + ' — SKILL POINT EARNED [K]', 26);
      GH.audio.win();
    }
    while (player.xp >= player.xpNeed) {
      player.xp -= player.xpNeed;
      player.level++;
      player.xpNeed = 6 + player.level * 3;
      applyLevelUp();
      GH.audio.levelup();
      announce('LVL ' + player.level, 22);
    }
  }

  function applyLevelUp() {
    var g = player.def.levelUp, s = player.stats;
    var apply = function (k, v) {
      if (k === 'maxHP') { s.maxHP += v; player.heal(v); }
      else if (k === 'armor') s.armor += v;
      else if (k === 'block') s.block += v;
      else if (k === 'damage') s.flatDamage += v;
      else if (k === 'atkSpd') s.atkSpdMult += v / 100;
      else if (k === 'crit') s.crit += v;
      else if (k === 'speed') s.speed += v * 0.42;
      else if (k === 'lifesteal') s.lifesteal += v;
      else if (k === 'magnet') s.magnet *= 1 + v / 100;
    };
    for (var k in g) apply(k, g[k]);
  }

  // =================================================================
  // ELEMENTS
  // =================================================================
  // equipped named artifact (lair trophies from THE SHATTERED REACH)
  function artOn(id) { return GH.progress.artifactActive(id); }

  function applyElement(e, elem, power) {
    if (!elem || e.dead) return;
    power = (power || 1) * player.stats.elemMult;
    if (elem === 'burn') {
      e.burn = { dps: 4 * power * (artOn('cinder_heart') ? 1.5 : 1), t: 3 };
    } else if (elem === 'shock') {
      if (Math.random() < 0.4) e.stun = Math.max(e.stun || 0, 0.5);
    } else if (elem === 'frost') {
      e.slowT = 2.2;
    }
  }

  // =================================================================
  // ENEMIES
  // =================================================================
  // the nearest spot a body can stand: not in rock, not in a wall, not over the sky
  function openSpot(x, z, r) {
    var T = GH.terrain;
    var ok = function (px, pz) { return !T.solidAt(px, pz) && !T.voidAt(px, pz) && !T.blockedAt(px, pz, r || 0.6); };
    if (ok(x, z)) return { x: x, z: z };
    for (var i = 0; i < 16; i++) {
      var a = Math.random() * Math.PI * 2, d = 3 + i * 2.2;
      var px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (Math.abs(px) < GH.world.BOUNDS.x - 4 && Math.abs(pz) < GH.world.BOUNDS.z - 4 && ok(px, pz)) return { x: px, z: pz };
    }
    return null;
  }

  function spawnEnemy(typeId, atX, atZ) {
    if (enemies.length > 110) return null;
    var def = GH.enemyDefs[typeId];
    var mesh = def.corrupt ? GH.buildCorrupt(typeId) : GH.enemyBuilders[typeId](stage ? stage.id : null);
    var x, z;
    if (atX !== undefined) { x = atX; z = atZ; }
    else {
      var a = Math.random() * Math.PI * 2;
      var r = GH.rand(18, 24);
      x = GH.clamp(player.x + Math.cos(a) * r, -ARENA_R, ARENA_R);
      z = GH.clamp(player.z + Math.sin(a) * r, -ARENA_R, ARENA_R);
    }
    if (expActive && GH.terrain.active) {
      var spot = openSpot(x, z, def.radius);
      if (!spot) return null;
      x = spot.x; z = spot.z;
    }
    mesh.position.set(x, 0 + gy(x, z), z);
    scene.add(mesh);
    var hpMult = def.boss ? Math.max(1, wavePlan.hpMult * 0.55) : wavePlan.hpMult;
    if (def.boss && expActive && !tutorial) {
      // the band scales bosses too — the low-danger clamp above must not eat it
      var bEhp = GH.worldlife.band().ehp;
      hpMult = Math.max(1, wavePlan.hpMult / bEhp * 0.55) * bEhp;
    }
    if (def.boss && GH.devWeakBoss) hpMult *= 0.03;
    if (def.boss && GH.devPhaseBoss) hpMult *= 0.25;
    if (weekly) hpMult *= weekly.mods.ehp;
    var e = {
      id: typeId, def: def, mesh: mesh,
      x: x, z: z, vx: 0, vz: 0,
      hp: def.hp * hpMult, maxHp: def.hp * hpMult,
      damage: def.damage * wavePlan.dmgMult,
      attackCd: GH.rand(0, 0.5),
      shootCd: def.shootInterval ? GH.rand(1, def.shootInterval) : 0,
      dashCd: def.dashInterval ? GH.rand(1, def.dashInterval) : 0,
      dashing: 0, telegraphing: 0,
      abilityT: 4, summonT: 10,
      burn: null, stun: 0, slowT: 0, burnAcc: 0, burnNumT: 0,
      popT: 0, baseScale: mesh.scale.x,
      anim: Math.random() * 10,
      lastOrbitHit: 0, lastDashId: -1,
      dead: false,
      // territorial AI (expedition): guard home ground until provoked
      homeX: x, homeZ: z,
      aggro: !expActive, // arena waves stay all-out; the Reach is territorial
      wanderT: 0, wanderA: Math.random() * Math.PI * 2,
      // zone-native behaviours
      hgt: 0, buried: def.behavior === 'burrower', emergeT: 0, surfaceT: 0,
      phased: 0, blinkT: def.blinkInterval || 0, sprung: false, trailT: 0,
      burstLeft: 0, burstT: 0, orbitA: Math.random() * Math.PI * 2, diveT: 0
    };
    if (e.buried && mesh.userData.body) { mesh.userData.body.visible = false; }
    // a house's troops know your name
    var fac = expActive && !def.boss ? GH.factions.byTroop(typeId) : null;
    if (fac) {
      var stnd = GH.factions.standing(fac.id);
      e.faction = fac.id;
      if (stnd === 'allied' || stnd === 'pledged') { e.allied = true; e.aggro = false; }
      else if (stnd === 'hostile') { e.hostileHouse = true; e.damage *= 1.2; }
    }
    if (def.behavior === 'ambusher' && mesh.userData.body) { mesh.userData.body.visible = false; }
    if (def.behavior === 'flyer') e.hgt = 3.0;
    // elites: from wave 6, one in ten spawns carries a modifier
    var eliteChance = expActive ? (tutorial ? 0 : GH.worldlife.band().elite) : (atX === undefined && waveNum >= 6 ? 0.10 : 0);
    if (!def.boss && !def.hunt && Math.random() < eliteChance) {
      var mods2 = ['blazing', 'shielded', 'swift', 'volatile', 'vampiric'];
      e.elite = GH.pick(mods2);
      e.hp *= 2.5; e.maxHp *= 2.5;
      e.damage *= 1.4;
      e.baseScale *= 1.35;
      mesh.scale.setScalar(e.baseScale);
      if (e.elite === 'swift') e.speedMult = 1.6;
      var auraColors = { blazing: 0xff7030, shielded: 0x80b0ff, swift: 0xd0ff60, volatile: 0xff40a0, vampiric: 0xc060ff };
      var aura = new THREE.Mesh(new THREE.TorusGeometry(def.radius + 0.45, 0.06, 4, 12),
        GH.assets.basic(auraColors[e.elite], { transparent: true, opacity: 0.7 }));
      aura.rotation.x = Math.PI / 2;
      aura.position.y = 0.25;
      mesh.add(aura);
      elitesSpawned++;
    }
    // dungeon tier modifiers stamp everything born inside
    if (expActive && dungeonState && dungeonState.mods.length) applyDungeonMods(e);
    enemies.push(e);
    if (def.boss) {
      bossRef = e;
      GH.audio.boss();
      GH.music.setBoss(true);
      if (def.hunt && !expActive) GH.music.play('battle');
      announce(def.name, 32);
      showBossBar(def.name);
    }
    return e;
  }

  function damageEnemy(e, raw, opts) {
    if (e.dead || G.state !== 'play') return;
    opts = opts || {};
    if (e.phased > 0) return; // blinked out — nothing to hit
    var dmg = raw;
    if (e.def.armorMult) dmg *= e.def.armorMult;
    if (e.def.behavior === 'hunt' && e.mech) {
      if (e.shieldUp) { G.dmg.spawn(e.x, 3.5, e.z, 'SHIELDED', 'elem', 14); return; }
      if (e.mech.indexOf('weak') !== -1) {
        var fwx = Math.sin(e.faceA || 0), fwz = Math.cos(e.faceA || 0);
        var tpx = player.x - e.x, tpz = player.z - e.z, tl = Math.sqrt(tpx * tpx + tpz * tpz) || 1;
        var dotp = (fwx * tpx + fwz * tpz) / tl;
        if (dotp < -0.3) { dmg *= 2.5; G.dmg.spawn(e.x, 3.5, e.z, 'WEAK POINT', 'crit', 13); }
        else if (dotp > 0.3) dmg *= 0.6;
      }
    }
    if (e.buried) {
      // shoot the plume: enough hits force it up
      dmg *= 0.3;
      e.buriedDmg = (e.buriedDmg || 0) + dmg;
      if (e.buriedDmg > e.maxHp * 0.25 && e.emergeT <= 0) { e.buriedDmg = 0; e.emergeT = 0.3; }
    }
    if (e.def.behavior === 'flyer' && e.hgt < 1.6) dmg *= 1.5;            // caught on the dive
    if (e.def.behavior === 'turret' && e.burstLeft === 0 &&
      e.shootCd > (e.def.shootInterval || 3) - 1.0) dmg *= 1.8;            // hit it while it recharges
    var crit = false;
    var inst = opts.inst;
    if (opts.canCrit !== false) {
      var chance = player.stats.crit + (inst ? inst.mods.crit : 0) +
        (player.edgeT > 0 ? 12 : 0) + (artOn('null_lens') ? 10 : 0);
      if (Math.random() * 100 < chance) {
        dmg *= player.stats.critMult + (inst ? inst.mods.critMult : 0);
        crit = true;
      }
    }
    dmg *= GH.progress.contractDamageBonus(e.id);
    // EXECUTIONER LOGIC (skill tree): finish wounded targets harder
    if (player.skillBon.execute > 0 && e.hp < e.maxHp * 0.35) {
      dmg *= 1 + player.skillBon.execute;
    }
    if (e.elite === 'shielded' && !artOn('null_lens')) dmg *= 0.5;
    if (inst && inst.hybridId === 'executioner' && e.hp < e.maxHp * 0.2) dmg *= 2;
    dmg = Math.max(1, Math.round(dmg));
    hitCount++;
    e.hp -= dmg;
    e.popT = 0.12;
    if (crit) G.hitStop(0.035);
    var cls = crit ? 'crit' : (opts.elem ? 'elem' : (opts.isDot ? 'dot' : ''));
    G.dmg.spawn(e.x, 2.0 + (e.def.boss ? 2 : 0), e.z,
      crit ? dmg + '!' : dmg, cls, crit ? 20 : (opts.isDot ? 12 : 15));
    if (!opts.isDot) { if (crit) GH.audio.crit(); else GH.audio.hit(); }

    // THORNED modifier: melee strikes sting the striker
    if (e.modThorns && opts.inst &&
      (opts.inst.w.type === 'melee' || opts.inst.w.type === 'aura') && !opts.isDot) {
      playerDamage(4 + (zoneNow ? zoneNow.danger * 2 : 2), null, 'kinetic');
    }
    // sustain: global lifesteal + weapon Sol sockets
    if (player.stats.lifesteal > 0) player.heal(dmg * player.stats.lifesteal / 100 * 0.35);
    if (inst && inst.mods.lifegain > 0) player.heal(dmg * inst.mods.lifegain * 0.5);

    // resonance on-hit effects
    if (inst && !opts.noRes) {
      var pot = resHas(inst, 'pyre');
      if (pot > 0) {
        applyElement(e, 'burn', pot * (1 + player.stats.crit * 0.02));
      }
      pot = resHas(inst, 'ruin');
      if (pot > 0 && Math.random() < 0.2 * pot) {
        explode(e.x, e.z, 1.7, dmg * 0.5, { noRes: true });
      }
      // hybrid identities
      if (crit && inst.hybridId === 'lucent') player.heal(2);
      if (crit && inst.hybridId === 'wildfire') applyElement(e, 'burn', 1);
      if (inst.hybridId === 'cataclysm' && Math.random() < 0.12) {
        explode(e.x, e.z, 1.7, dmg * 0.5, { noRes: true });
        applyElement(e, 'burn', 1);
      }
    }
    if (opts.elem && !opts.isDot) applyElement(e, opts.elem, 1);

    if (e.hp <= 0) killEnemy(e, inst);
  }

  function killEnemy(e, inst) {
    if (e.dead) return;
    e.dead = true;
    kills++;
    if (e.def.boss) G.hitStop(0.14);
    else if (e.def.mass >= 3) G.hitStop(0.06);
    scene.remove(e.mesh);
    // kill the caller and the pack it called loses heart
    if (e.def.behavior === 'caller') {
      for (var ci2 = 0; ci2 < enemies.length; ci2++) {
        var cl = enemies[ci2];
        if (!cl.dead && cl.calledBy === e) { cl.hp = 0; killEnemy(cl); }
      }
    }
    if (expActive && GH.factions) GH.factions.troopKilled(e.id);

    // expedition world scars: broken nests stay broken, lairs fall once
    if (expActive) {
      if (e.nestId) {
        GH.meta.data.world.nests[e.nestId] = true;
        // the live core is a child of the world group, not the scene
        if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
        // swap the structure for its dead husk
        var deadNest = GH.models.buildNest(true);
        deadNest.position.set(e.x, 0 + gy(e.x, e.z), e.z);
        worldH.group.add(deadNest);
        var cc = cleanseCount();
        queueAnnounce('NEST BROKEN — ' + cc.dead + '/' + cc.total + ' CLEANSED', 24);
        GH.audio.win();
        coinsRun += 25;
        grantMats(8 + (zoneNow ? zoneNow.danger * 3 : 0), Math.random() < 0.3 ? 1 : 0, false);
        lifeEvent('nests', 1);
        saveExpedition();
      }
      // THE HARROW falls — locked out until it re-roosts tomorrow
      if (e.id === 'harrow') {
        GH.meta.data.world.harrowDay = GH.world.dayStamp();
        GH.meta.data.feats.harrow = true;
        grantMats(40, 3, false);
        harrowSpot = null;
        harrowUp = false;
        coinsRun += 150;
        queueAnnounce('THE HARROW HAS FALLEN — +150 SALVAGE', 30);
        if (GH.progress.grantArtifact('harrow_brand')) {
          queueAnnounce('ARTIFACT — HARROW BRAND', 28);
        }
        saveExpedition();
      }
      // weather windfalls
      if (weatherNow && !e.def.boss) {
        if (weatherNow.id === 'sporebloom' && Math.random() < 0.5) {
          spawnPickup('spark1', e.x + GH.rand(-0.5, 0.5), e.z + GH.rand(-0.5, 0.5));
        }
        if (weatherNow.id === 'kingtide' && Math.random() < 0.18) {
          spawnPickup('coin', e.x, e.z);
        }
      }
      if (e.def.corrupt && e.lairZone) {
        GH.meta.data.world.lairsDown[e.lairZone] = true;
        var shellId = GH.world.stageFor(e.lairZone).unlocks;
        var lairMsg = frameReward(shellId);
        if (lairMsg) queueAnnounce(lairMsg.replace(/<[^>]+>/g, '').replace(/\n/g, ''), 30);
        if (GH.mechById(shellId).kind === 'feat') GH.meta.data.victories[e.lairZone] = true;
        GH.factions.deed(curZone, 'lair', 8);
        var lairArtifacts = {
          wreck: 'bulwark_fragment', glacier: 'glacier_core', cloister: 'harvest_coil',
          ember: 'cinder_heart', storm: 'stormcap', null: 'null_lens'
        };
        var lairArt = lairArtifacts[e.lairZone];
        if (lairArt && GH.progress.grantArtifact(lairArt)) {
          queueAnnounce('ARTIFACT — ' + GH.progress.artifactById(lairArt).name.toUpperCase(), 28);
        }
        // the depths pay like every other dungeon: cleared + ascension
        if (dungeonState) {
          GH.meta.data.world.dungeons[curZone] = true;
          coinsRun += 40 * dungeonState.tier;
          ascendDungeon();
        }
        saveExpedition();
      }
    }

    if (e.tut) tutorialEvent('kill', 1);
    if (e.tutBoss) tutorialEvent('boss', 1);
    if (e.def.hunt && !e.noLedger) { huntSlain(e); if (expActive && !enemies.some(function (o) { return !o.dead && o.def.boss && o !== e; })) GH.music.play(GH.worldlife.rootZone(curZone)); }
    // world life: diaries and the daily board
    if (!e.nestId) {
      lifeEvent('kills', 1);
      if (e.elite) lifeEvent('elites', 1);
    }
    // progression hooks: collection log, contracts, trials, season, ciphers
    GH.progress.logKill(e.id);
    var cdone = GH.progress.contractKill(e.id, stage.id);
    if (cdone && expActive) GH.factions.deed(curZone, 'contract', 8);
    if (cdone) {
      lifeEvent('contract', 1);
      queueAnnounce('CONTRACT COMPLETE — +' + cdone.salvage + ' SALVAGE, +' + cdone.pts + ' PTS', 22);
      GH.audio.win();
      seasonAwardNotify(GH.progress.seasonCounter('contracts', 1));
    }
    if (e.id === 'warden') awardTrial('warden');
    if (e.id === 'carapace') { awardTrial('carapace'); seasonTaskNotify('carapace'); }
    if (e.def.corrupt && !e.phase2) awardTrial('nobound');
    if (e.def.corrupt) {
      seasonTaskNotify('corrupt');
      if (e.phase2) seasonTaskNotify('unbound');
    }
    seasonAwardNotify(GH.progress.seasonCounter('kills', 1));
    // signal cipher drop (pity-protected; never while one is running)
    if (!cipherRun && !e.def.boss && GH.progress.cipherRoll()) {
      spawnPickup('cipher', e.x, e.z);
      queueAnnounce('SIGNAL CIPHER DETECTED', 22);
    }
    spawnBurst(e.x, 1, e.z, e.def.boss ? 0xffd060 : 0xc0c0c0, e.def.boss ? 26 : 8);
    // sparks (XP)
    var xp = e.def.xp;
    while (xp > 0) {
      var size = xp >= 10 ? 2 : (xp >= 3 ? 1 : 0);
      var val = size === 2 ? 10 : (size === 1 ? 3 : 1);
      if (val > xp) { size = 0; val = 1; }
      spawnPickup('spark' + size, e.x + GH.rand(-0.6, 0.6), e.z + GH.rand(-0.6, 0.6));
      xp -= val;
    }
    if (e.def.deathBurn || e.elite === 'blazing') {
      effects.push({ kind: 'patch', x: e.x, z: e.z, t: 3, radius: 1.3, dps: 5,
        mesh: groundDisc(e.x, e.z, 1.3, 0xff5020, 0.3) });
    }
    if (e.def.deathCloud) {
      // a chilling spore cloud: slow poison that saps the servos
      effects.push({ kind: 'patch', x: e.x, z: e.z, t: 4.5, radius: 1.9, dps: 3, chill: true,
        mesh: groundDisc(e.x, e.z, 1.9, 0x80c040, 0.3) });
      spawnBurst(e.x, 0.8, e.z, 0xa0e060, 12);
    }
    if (e.elite === 'volatile' || e.modVolatile) {
      // detonates on death — respect the ARC ward
      spawnBurst(e.x, 1, e.z, 0xff40a0, 14);
      GH.audio.explode();
      if (GH.dist2(e.x, e.z, player.x, player.z) < 6.25) playerDamage(e.damage, null, 'arc');
    }
    if (e.modGilded && Math.random() < 0.35) spawnPickup('coin', e.x, e.z);
    if (e.elite) {
      spawnPickup('coin', e.x, e.z);
      spawnPickup('spark1', e.x + 0.5, e.z);
      spawnPickup('alloy', e.x - 0.5, e.z + 0.4);
    } else if (!e.def.boss && !e.nestId && Math.random() < 0.12 * (1 + player.stats.lootFind / 100)) {
      spawnPickup('alloy', e.x + GH.rand(-0.5, 0.5), e.z + GH.rand(-0.5, 0.5));
    }
    // ART RUNES: every boss carries one (revenants two); elites sometimes
    if (e.def.boss) {
      for (var rn = 0; rn < (e.def.corrupt ? 2 : 1); rn++) spawnPickup('rune', e.x + rn * 1.4 - 0.7, e.z + 1.4);
    } else if (e.elite && Math.random() < 0.08 * (1 + player.stats.lootFind / 100)) {
      spawnPickup('rune', e.x, e.z + 0.8);
    }
    if (e.def.boss) {
      // wardens and other mid-bosses drop a core; true bosses drop two
      var coreN = e.def.mid ? 1 : 2;
      for (var cn = 0; cn < coreN; cn++) spawnPickup('core', e.x + cn * 1.2 - 0.6, e.z - 1.2);
      for (var an = 0; an < (e.def.corrupt ? 8 : 4); an++) spawnPickup('alloy', e.x + GH.rand(-2, 2), e.z + GH.rand(-2, 2));
    }
    if (e.def.boss && expActive) awardCards(3);
    else if (e.elite && expActive && Math.random() < 0.25) awardCards(2);
    if (e.def.boss) {
      for (var c = 0; c < (e.def.corrupt ? 24 : 12); c++) {
        spawnPickup('coin', e.x + GH.rand(-2, 2), e.z + GH.rand(-2, 2));
      }
      var gemDrops = GH.progress.trialTier(stage.id) >= 4 ? 2 : 1;
      for (var gd = 0; gd < gemDrops; gd++) {
        spawnPickup('gem:' + GH.pick(GH.gems.typeIds), e.x + gd, e.z);
      }
      hideBossBar();
      if (bossRef === e) { bossRef = null; GH.music.setBoss(false); }
      GH.audio.explode();
    } else {
      var coinChance = (0.10 + (artOn('harvest_coil') ? 0.12 : 0)) * (1 + player.stats.lootFind / 200);
      if (Math.random() < coinChance) spawnPickup('coin', e.x, e.z);
      if (Math.random() < 0.045) spawnPickup('heart', e.x, e.z);
    }
    // protocols & resonances that trigger on kill
    if (player.protocols.reclaim && Math.random() < player.protocols.reclaim) player.heal(3);
    if (inst) {
      var pot = resHas(inst, 'verd');
      if (pot > 0 && Math.random() < 0.15 * pot) {
        effects.push({ kind: 'shrub', x: e.x, z: e.z, t: 4, emitT: 0.5,
          mesh: addAt(GH.models.buildShrub(), e.x, e.z) });
      }
      // hybrid identities
      if (inst.hybridId === 'grace' && Math.random() < 0.12) spawnPickup('heart', e.x, e.z);
      if (inst.hybridId === 'martyr' && player.hp < player.stats.maxHP * 0.35) player.heal(3);
      if (inst.hybridId === 'ashbloom' && e.burn) spawnPickup('spark1', e.x, e.z);
      if (inst.hybridId === 'rotburst') {
        explode(e.x, e.z, 1.6, e.maxHp * 0.2, { noRes: true });
      }
    }
  }

  function addAt(mesh, x, z) {
    mesh.position.set(x, 0 + gy(x, z), z);
    scene.add(mesh);
    return mesh;
  }

  function groundDisc(x, z, r, color, opacity) {
    var m = new THREE.Mesh(new THREE.CircleGeometry(r, 16),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.04 + gy(x, z), z);
    scene.add(m);
    return m;
  }

  function updateEnemies(dt) {
    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      // a mid-loop death recall can swap the whole zone out under us
      if (!e) break;
      if (e.dead) { enemies.splice(i, 1); continue; }
      var def = e.def;
      // target the nearest alive pilot
      var tgtP = player;
      if (mate && !mate.down) {
        if (GH.dist2(e.x, e.z, mate.x, mate.z) < GH.dist2(e.x, e.z, player.x, player.z)) tgtP = mate;
      }
      // BASTION attackers press the relic unless a pilot is in their face
      if (e.defendObj && dungeonState && dungeonState.defenseActive && worldH.layout.objective) {
        if (GH.dist2(e.x, e.z, player.x, player.z) > 10 * 10) {
          tgtP = { x: worldH.layout.objective.x, z: worldH.layout.objective.z };
        }
      }
      // CONVOY ambushers run down the hauler
      if (e.huntHauler && dungeonState && dungeonState.hauler && !dungeonState.failed) {
        if (GH.dist2(e.x, e.z, player.x, player.z) > 9 * 9) {
          tgtP = { x: dungeonState.hauler.x, z: dungeonState.hauler.z };
        }
      }
      var dx = tgtP.x - e.x, dz = tgtP.z - e.z;
      var dist = Math.sqrt(dx * dx + dz * dz) || 0.001;
      var nx = dx / dist, nz = dz / dist;

      // status
      if (e.burn) {
        e.burn.t -= dt;
        e.burnAcc += e.burn.dps * dt;
        e.burnNumT -= dt;
        if (e.burnNumT <= 0 && e.burnAcc >= 1) {
          var bd = Math.floor(e.burnAcc);
          e.burnAcc -= bd;
          e.burnNumT = 0.5;
          e.hp -= bd;
          hitCount++;
          G.dmg.spawn(e.x, 1.8, e.z, bd, 'dot', 12);
          if (e.hp <= 0) { killEnemy(e); continue; }
        }
        if (e.burn.t <= 0) e.burn = null;
      }
      // static structures (husk nests): damage ticks only — no AI, no
      // movement, no contact. Their spawning runs in updateExpedition.
      if (def.behavior === 'static') continue;
      if (e.stun > 0) {
        e.stun -= dt;
        e.mesh.position.set(e.x, gy(e.x, e.z) + Math.sin(runTime * 30) * 0.03, e.z);
        continue;
      }
      var spd = def.speed * GH.PACE.enemySpd * (e.slowT > 0 ? 0.6 : 1) * (weekly ? weekly.mods.espd : 1) *
        (e.speedMult || 1) *
        (expActive && weatherNow && weatherNow.id === 'whiteout' ? 0.85 : 1);
      if (inHazard('vines', e.x, e.z)) spd *= 0.65;
      if (e.slowT > 0) e.slowT -= dt;
      if (def.boss && e.hp < e.maxHp * 0.35) spd *= 1.35; // enrage

      e.anim += dt * (4 + def.speed);
      if (e.elite === 'vampiric' && e.hp < e.maxHp) {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.02 * dt);
      }
      if (e.modRegen && e.hp < e.maxHp) {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.015 * dt);
      }
      var mx = 0, mz = 0;

      // territorial AI: out in the Reach, hostiles hold their ground.
      // They wake when you close in (or wound them), give chase, and
      // walk home when you leave their hunting range. Event spawns
      // (sieges, defenses, summons, guardians) never stand down.
      if (expActive && !def.boss && !e.event && def.behavior === 'ambusher' && !e.sprung) {
        // a lurker is scenery until you are on top of it
        if (dist < 6.5 || e.hp < e.maxHp) e.aggro = true;
        if (!e.aggro) continue;
      }
      if (e.allied && !e.event) {
        // an allied patrol keeps the peace until you break it
        if (e.hp < e.maxHp) e.allied = false;
        else e.aggro = false;
      }
      if (expActive && !def.boss && !e.event) {
        var aggroR = (def.behavior === 'ranged' ? GH.PACE.aggroRanged : GH.PACE.aggroMelee) * (e.hostileHouse ? 2 : 1);
        if (!e.aggro) {
          if (dist < aggroR || e.hp < e.maxHp) {
            e.aggro = true;
            e.popT = Math.max(e.popT, 0.15); // a startle pop when they notice you
          }
        } else if (dist > GH.PACE.leash) {
          e.aggro = false;
        }
        if (!e.aggro) {
          // idle: drift near the nest, amble back if wandered far
          var hdx = e.homeX - e.x, hdz = e.homeZ - e.z;
          var hd2 = hdx * hdx + hdz * hdz;
          e.wanderT -= dt;
          if (e.wanderT <= 0) {
            e.wanderT = GH.rand(2, 5);
            e.wanderA = Math.random() * Math.PI * 2;
          }
          if (hd2 > 8 * 8) {
            var hd = Math.sqrt(hd2);
            mx = hdx / hd; mz = hdz / hd;
            spd *= 0.55;
          } else {
            mx = Math.sin(e.wanderA); mz = Math.cos(e.wanderA);
            spd *= 0.3;
          }
          // face where it walks, keep the walk-cycle math alive
          nx = mx; nz = mz;
          e.x += (mx * spd) * dt;
          e.z += (mz * spd) * dt;
          e.mesh.position.set(e.x, 0 + gy(e.x, e.z), e.z);
          e.mesh.rotation.y = Math.atan2(nx, nz);
          var idleLimbs = e.mesh.userData.limbs;
          if (idleLimbs) {
            var isw = Math.sin(e.anim) * 0.3;
            idleLimbs.legL.rotation.x = isw;
            idleLimbs.legR.rotation.x = -isw;
          }
          continue; // no attacks, no dashes, no shots while at peace
        }
      }

      if (def.behavior === 'chase') {
        mx = nx; mz = nz;
      } else if (def.behavior === 'ranged') {
        if (dist > def.keepDist + 1) { mx = nx; mz = nz; }
        else if (dist < def.keepDist - 2) { mx = -nx; mz = -nz; }
        e.shootCd -= dt;
        rangedFire(e, def, nx, nz, dist, dt, 22);
        if (def.name === 'Storm Sentinel') e.hgt = 0.6 + Math.sin(e.anim * 0.5) * 0.25;
      } else if (def.behavior === 'turret') {
        mx = 0; mz = 0; spd = 0;
        rangedFire(e, def, nx, nz, dist, dt, 28);
      } else if (def.behavior === 'caller') {
        if (dist > def.keepDist + 1) { mx = nx; mz = nz; }
        else if (dist < def.keepDist - 2) { mx = -nx; mz = -nz; }
        e.summonT -= dt;
        if (e.summonT <= 0 && dist < 26) {
          e.summonT = def.callInterval || 8;
          e.popT = 0.3;
          GH.audio.zap();
          for (var cc2 = 0; cc2 < (def.callCount || 2); cc2++) {
            var called = spawnEnemy(def.calls || 'husk', e.x + GH.rand(-3, 3), e.z + GH.rand(-3, 3));
            if (called) { called.aggro = true; called.event = true; called.calledBy = e; }
          }
        }
      } else if (def.behavior === 'latcher') {
        mx = nx; mz = nz;
      } else if (def.behavior === 'slammer') {
        if (e.telegraphing > 0) {
          e.telegraphing -= dt; spd = 0; mx = 0; mz = 0;
          if (e.telegraphing <= 0) { shake = Math.min(0.5, shake + 0.2); GH.audio.explode(); }
        } else {
          mx = nx; mz = nz;
          e.abilityT -= dt;
          if (e.abilityT <= 0 && dist < 6.5) {
            e.abilityT = def.slamInterval || 4.5;
            e.telegraphing = 0.9;
            spawnTelegraph(e.x + nx * 2.4, e.z + nz * 2.4, 3.0, 0.9, e.damage * 1.4);
          }
        }
      } else if (def.behavior === 'burrower') {
        if (e.buried) {
          // tunnelling: fast and unstoppable, a plume of sand marks the line
          mx = nx; mz = nz; spd = def.speed;
          if (e.mesh.userData.plume) e.mesh.userData.plume.visible = true;
          if (dist < 3.4 && e.emergeT <= 0) {
            e.emergeT = 0.55;
            spawnTelegraph(e.x, e.z, 2.2, 0.55, e.damage);
          }
          if (e.emergeT > 0) {
            spd = 0; mx = 0; mz = 0;
            e.emergeT -= dt;
            if (e.emergeT <= 0) {
              e.buried = false; e.surfaceT = def.surfaceTime || 2.5;
              if (e.mesh.userData.body) e.mesh.userData.body.visible = true;
              if (e.mesh.userData.plume) e.mesh.userData.plume.visible = false;
              e.popT = 0.25;
              spawnBurst(e.x, 0.4, e.z, 0xd8c090, 14);
              GH.audio.explode();
            }
          }
        } else {
          mx = nx; mz = nz; spd = def.speed * 0.28;
          e.surfaceT -= dt;
          if (e.surfaceT <= 0) {
            e.buried = true;
            if (e.mesh.userData.body) e.mesh.userData.body.visible = false;
            spawnBurst(e.x, 0.3, e.z, 0xd8c090, 8);
          }
        }
      } else if (def.behavior === 'flyer') {
        e.orbitA += dt * 0.9;
        if (e.diveT > 0) {
          e.diveT -= dt;
          mx = nx; mz = nz; spd = def.speed * 1.9;
          e.hgt += (0.7 - e.hgt) * Math.min(1, dt * 6);
        } else {
          var ox2 = tgtP.x + Math.sin(e.orbitA) * 7.5, oz2 = tgtP.z + Math.cos(e.orbitA) * 7.5;
          var oa = GH.angleTo(e.x, e.z, ox2, oz2);
          mx = Math.sin(oa); mz = Math.cos(oa);
          e.hgt += (3.2 + Math.sin(e.anim) * 0.3 - e.hgt) * Math.min(1, dt * 3);
          e.shootCd -= dt;
          if (e.shootCd <= 0 && dist < 14) {
            e.shootCd = def.shootInterval * GH.PACE.enemyFire;
            e.diveT = 0.7;
            GH.audio.dash();
          }
        }
        if (e.mesh.userData.wings) {
          var wf = Math.sin(e.anim * 2.5) * 0.6;
          e.mesh.userData.wings[0].rotation.z = wf;
          e.mesh.userData.wings[1].rotation.z = -wf;
        }
      } else if (def.behavior === 'ambusher') {
        if (!e.sprung) {
          mx = 0; mz = 0; spd = 0;
          if (dist < 6.5 || e.hp < e.maxHp) {
            e.sprung = true;
            if (e.mesh.userData.body) e.mesh.userData.body.visible = true;
            if (e.mesh.userData.cover) e.mesh.userData.cover.visible = false;
            e.popT = 0.25;
            spawnBurst(e.x, 0.6, e.z, 0x60c040, 10);
            GH.audio.hit();
            if (dist < 4.2 && tgtP === player) { player.snareT = 0.9; announce('SNARED', 16); }
            e.dashing = def.dashTime; e.dashDirX = nx; e.dashDirZ = nz;
          }
        } else if (e.dashing > 0) {
          e.dashing -= dt; spd = def.dashSpeed; mx = e.dashDirX; mz = e.dashDirZ;
        } else {
          mx = nx; mz = nz;
          e.dashCd -= dt;
          if (e.dashCd <= 0 && dist < 9) {
            e.dashCd = def.dashInterval; e.dashing = def.dashTime; e.dashDirX = nx; e.dashDirZ = nz;
          }
        }
      } else if (def.behavior === 'phantom') {
        if (e.phased > 0) {
          e.phased -= dt; spd = 0; mx = 0; mz = 0;
          if (e.phased <= 0) {
            var pa2 = Math.random() * Math.PI * 2;
            e.x = tgtP.x + Math.sin(pa2) * 4.2; e.z = tgtP.z + Math.cos(pa2) * 4.2;
            e.mesh.visible = true; e.popT = 0.2;
            spawnBurst(e.x, 1, e.z, 0xc080ff, 10);
          }
        } else {
          mx = nx; mz = nz;
          e.blinkT -= dt;
          if (e.blinkT <= 0 && dist > 5 && target !== e) { // a marked phantom cannot slip away
            e.blinkT = def.blinkInterval; e.phased = 0.7; e.mesh.visible = false;
            spawnBurst(e.x, 1, e.z, 0xc080ff, 8);
          }
        }
        e.hgt = 0.5 + Math.sin(e.anim * 0.7) * 0.2;
      } else if (def.behavior === 'dasher') {
        if (e.dashing > 0) {
          e.dashing -= dt;
          spd = def.dashSpeed;
          mx = e.dashDirX; mz = e.dashDirZ;
        } else if (e.telegraphing > 0) {
          e.telegraphing -= dt;
          spd = 0;
          if (e.telegraphing <= 0) {
            e.dashing = def.dashTime;
            e.dashDirX = nx; e.dashDirZ = nz;
          }
        } else {
          mx = nx; mz = nz;
          e.dashCd -= dt;
          if (e.dashCd <= 0 && dist < 12) {
            e.dashCd = def.dashInterval;
            e.telegraphing = 0.5;
          }
        }
      } else if (def.behavior === 'boss') {
        mx = nx; mz = nz;
        e.abilityT -= dt;
        e.summonT -= dt;
        if (e.abilityT <= 0) {
          e.abilityT = def.slamInterval || 6;
          spawnTelegraph(tgtP.x, tgtP.z, 3.2, 1.0, e.damage * 1.3);
        }
        if (e.summonT <= 0) {
          // midbosses spiral up their summons below half hull
          var frantic = e.hp < e.maxHp * 0.5;
          e.summonT = (def.summonInterval || 10) * (frantic ? 0.6 : 1);
          var sid = def.summons || GH.weightedPick(wavePlan.types).id;
          for (var s2 = 0; s2 < (def.summonCount || 3) + (frantic ? 1 : 0); s2++) {
            var smn = spawnEnemy(sid, e.x + GH.rand(-2.5, 2.5), e.z + GH.rand(-2.5, 2.5));
            if (smn) { smn.aggro = true; smn.event = true; } // summons arrive angry
          }
        }
      } else if (def.behavior === 'corrupt') {
        var r = corruptAI(e, dt, dist, nx, nz);
        mx = r.mx; mz = r.mz;
        if (r.spd !== undefined) spd = r.spd;
      } else if (def.behavior === 'hunt') {
        var hr = huntAI(e, dt, dist, nx, nz);
        mx = hr.mx; mz = hr.mz;
        if (hr.spd !== undefined) spd = hr.spd;
      } else if (def.behavior === 'racer') {
        // RACEWAY rival: ride the circuit line, harass the pilot in passing
        var rwLay = worldH && worldH.layout.raceway;
        if (dungeonState && dungeonState.race && dungeonState.race.countdown > 0) {
          // held on the grid until the green
          rwLay = null;
        }
        if (rwLay) {
          var rwp = rwLay.path[e.racePi % rwLay.path.length];
          var rwa = GH.angleTo(e.x, e.z, rwp.x, rwp.z);
          mx = Math.sin(rwa); mz = Math.cos(rwa);
          spd = e.raceSpeed || def.speed;
        }
        e.shootCd -= dt;
        if (e.shootCd <= 0 && dist < 16) {
          e.shootCd = def.shootInterval * GH.PACE.enemyFire;
          spawnEnemyShot(e.x, 1, e.z, nx, nz, def.shotSpeed, e.damage);
        }
        // hover pose
        e.mesh.position.y = gy(e.x, e.z) + 0.12 + Math.sin(runTime * 6 + e.anim) * 0.05;
        if (e.mesh.userData.flames) {
          e.mesh.userData.flames.forEach(function (fl) { fl.visible = true; fl.scale.y = 1.4; });
        }
      }

      // separation
      var sepX = 0, sepZ = 0;
      for (var j = 0; j < enemies.length; j++) {
        if (j === i) continue;
        var o = enemies[j];
        var ox = e.x - o.x, oz = e.z - o.z;
        var d2 = ox * ox + oz * oz;
        var minD = e.def.radius + o.def.radius;
        if (d2 < minD * minD && d2 > 0.0001) {
          var d = Math.sqrt(d2);
          sepX += (ox / d) * (minD - d);
          sepZ += (oz / d) * (minD - d);
        }
      }

      var ePreX = e.x, ePreZ = e.z;
      if (e.buried) { sepX = 0; sepZ = 0; } // tunnels pass under the crowd
      e.x += (mx * spd + sepX * 4 + e.vx) * dt;
      e.z += (mz * spd + sepZ * 4 + e.vz) * dt;
      // a burning trail behind the magma crawler
      if (def.trailBurn && e.aggro && spd > 0) {
        e.trailT -= dt;
        if (e.trailT <= 0) {
          e.trailT = 0.55;
          effects.push({ kind: 'patch', x: e.x, z: e.z, t: 2.2, radius: 0.9, dps: 4,
            mesh: groundDisc(e.x, e.z, 0.9, 0xff5020, 0.28) });
        }
      }
      e.vx *= Math.pow(0.02, dt);
      e.vz *= Math.pow(0.02, dt);
      if (expActive) {
        e.x = GH.clamp(e.x, -GH.world.BOUNDS.x, GH.world.BOUNDS.x);
        e.z = GH.clamp(e.z, -GH.world.BOUNDS.z, GH.world.BOUNDS.z);
        // hostiles respect the solid walls too
        if (zoneBlockedAt(e.x, e.z)) {
          e.x = ePreX;
          e.z = ePreZ;
        }
        if (!e.buried && !(e.hgt > 1.6) && GH.terrain.colliderCount()) {
          var er = GH.terrain.resolve(e.x, e.z, def.radius);
          if (er.hit) { e.x = er.x; e.z = er.z; }
        }
        if (!(e.hgt > 1.6) && GH.terrain.voidAt(e.x, e.z)) {
          e.dead = true; scene.remove(e.mesh); continue;
        }
      } else {
        e.x = GH.clamp(e.x, -ARENA_R - 3, ARENA_R + 3);
        e.z = GH.clamp(e.z, -ARENA_R - 3, ARENA_R + 3);
      }

      // never overlap a pilot: hold attackers on a contact ring
      var ringTargets = mate && !mate.down ? [player, mate] : [player];
      for (var rt = 0; rt < ringTargets.length; rt++) {
        var rp = ringTargets[rt];
        var pdx = e.x - rp.x, pdz = e.z - rp.z;
        var pd = Math.sqrt(pdx * pdx + pdz * pdz) || 0.001;
        var minPD = def.radius + 0.65;
        if (pd < minPD) {
          e.x = rp.x + (pdx / pd) * minPD;
          e.z = rp.z + (pdz / pd) * minPD;
        }
      }

      e.mesh.position.set(e.x, gy(e.x, e.z) + (e.hgt || 0), e.z);
      e.mesh.rotation.y = Math.atan2(nx, nz);

      // animation
      var limbs = e.mesh.userData.limbs;
      if (limbs) {
        var sw = Math.sin(e.anim) * 0.5;
        limbs.legL.rotation.x = sw;
        limbs.legR.rotation.x = -sw;
        limbs.armL.rotation.x = -sw * 0.7;
        limbs.armR.rotation.x = sw * 0.7;
      }
      var parts = e.mesh.userData.parts; // corrupt mechs
      if (parts) {
        var sw2 = Math.sin(e.anim) * 0.5;
        parts.legL.rotation.x = sw2;
        parts.legR.rotation.x = -sw2;
      }
      if (e.mesh.userData.core) {
        e.mesh.userData.core.rotation.y += dt * 3;
        if (e.telegraphing > 0) e.mesh.userData.core.scale.setScalar(1 + Math.sin(e.anim * 6) * 0.25);
      }
      if (e.mesh.userData.ring) e.mesh.userData.ring.rotation.z += dt * 2;

      // burn tint flicker
      if (e.burn && Math.floor(runTime * 20) % 2 === 0) {
        e.mesh.position.y += 0.02;
      }
      // hit pop
      if (e.popT > 0) {
        e.popT -= dt;
        e.mesh.scale.setScalar(e.baseScale * (1 + Math.max(0, e.popT) * 1.4));
      }

      // contact damage (whichever pilot is in reach)
      e.attackCd -= dt;
      if (e.attackCd <= 0 && !e.buried && e.phased <= 0 && !(def.behavior === 'flyer' && e.hgt > 1.6)) {
        if (GH.dist2(e.x, e.z, player.x, player.z) < Math.pow(def.radius + 0.8, 2)) {
          e.attackCd = e.modFrenzied ? 0.75 : 1.1;
          playerDamage(e.damage, e, 'kinetic');
          if (def.behavior === 'hunt' && e.mech && e.mech.indexOf('drain') !== -1) { e.hp = Math.min(e.maxHp, e.hp + e.damage * 3); G.dmg.spawn(e.x, 3, e.z, '+' + Math.round(e.damage * 3), 'heal', 13); }
          if (def.behavior === 'latcher') { player.snareT = Math.max(player.snareT || 0, 0.45); e.attackCd = 0.6; }
        } else if (mate && !mate.down &&
          GH.dist2(e.x, e.z, mate.x, mate.z) < Math.pow(def.radius + 0.8, 2)) {
          e.attackCd = 1.1;
          wingmateDamage(e.damage);
        }
      }
    }
  }

  // ranged fire shared by sentries and turrets: bursts, spreads, single shots
  function rangedFire(e, def, nx, nz, dist, dt, range) {
    e.shootCd -= dt;
    var volley = function (mult) {
      var n = def.spread || 1;
      for (var k = 0; k < n; k++) {
        var off = n > 1 ? (k - (n - 1) / 2) * 0.28 : 0;
        var a = Math.atan2(nx, nz) + off;
        spawnEnemyShot(e.x, 1, e.z, Math.sin(a), Math.cos(a), def.shotSpeed, e.damage * mult, def.shotElement);
      }
    };
    if (e.burstLeft > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) { e.burstT = 0.14; e.burstLeft--; volley(0.7); }
    } else if (e.shootCd <= 0 && dist < range) {
      e.shootCd = def.shootInterval * GH.PACE.enemyFire;
      if (def.burst && def.burst > 1) { e.burstLeft = def.burst; e.burstT = 0; }
      else volley(0.9);
    }
  }

  // ---- revenant boss AI: archetype attacks every few seconds ----
  function corruptAI(e, dt, dist, nx, nz) {
    var out = { mx: nx, mz: nz };
    // phase 2 at half hull: UNBOUND — faster cycle + radial bursts
    if (!e.phase2 && e.hp < e.maxHp * 0.5) {
      e.phase2 = true;
      announce(e.def.name + ' — UNBOUND', 30);
      GH.audio.boss();
      G.hitStop(0.1);
      spawnBurst(e.x, 2, e.z, 0xff2838, 30);
      var aura = new THREE.Mesh(new THREE.TorusGeometry(e.def.radius + 0.6, 0.08, 4, 16),
        GH.assets.basic(0xff2838, { transparent: true, opacity: 0.7 }));
      aura.rotation.x = Math.PI / 2;
      aura.position.y = 0.4;
      e.mesh.add(aura);
      e.abilityT = Math.min(e.abilityT, 1.2);
    }
    // TERMINAL phase for the last two frames' revenants
    if (!e.phase3 && e.phase2 && e.hp < e.maxHp * 0.25 &&
      (e.id === 'strix' || e.id === 'titan')) {
      e.phase3 = true;
      announce(e.def.name + ' — TERMINAL', 32);
      GH.audio.boss();
      G.hitStop(0.12);
      spawnBurst(e.x, 2.5, e.z, 0xffffff, 34);
      e.abilityT = Math.min(e.abilityT, 0.8);
    }
    e.abilityT -= dt;
    e.summonT -= dt;
    if (e.summonT <= 0) {
      e.summonT = e.phase3 ? 7 : (e.phase2 ? 9 : 12);
      for (var s = 0; s < (e.phase2 ? 5 : 4); s++) {
        spawnEnemy(GH.weightedPick(wavePlan.types).id,
          e.x + GH.rand(-3, 3), e.z + GH.rand(-3, 3));
      }
      if (e.phase3 && e.id === 'titan') {
        spawnEnemy('brute', e.x + GH.rand(-3, 3), e.z + GH.rand(-3, 3));
      }
    }
    if (e.phase3) {
      e.terminalT = (e.terminalT || 0) - dt;
      if (e.terminalT <= 0) {
        if (e.id === 'strix') {
          // blink beside the player, then a fanned triple rail volley
          e.terminalT = 3.4;
          spawnBurst(e.x, 1.5, e.z, 0xff6070, 10);
          var ba = Math.random() * Math.PI * 2;
          e.x = GH.clamp(player.x + Math.cos(ba) * 9, -ARENA_R, ARENA_R);
          e.z = GH.clamp(player.z + Math.sin(ba) * 9, -ARENA_R, ARENA_R);
          spawnBurst(e.x, 1.5, e.z, 0xff6070, 10);
          var fa = GH.angleTo(e.x, e.z, player.x, player.z);
          for (var fi = -1; fi <= 1; fi++) {
            spawnLineTelegraph(e.x, e.z, fa + fi * 0.28, 26, 1.0, 1.0, e.damage * 1.2);
          }
        } else {
          // titan: rolling mortar rain
          e.terminalT = 1.3;
          spawnTelegraph(player.x + GH.rand(-3, 3), player.z + GH.rand(-3, 3), 2.4, 1.0, e.damage);
        }
      }
    }
    if (e.dashing > 0) {
      e.dashing -= dt;
      out.spd = 18;
      out.mx = e.dashDirX; out.mz = e.dashDirZ;
      // dash contact
      if (dist < e.def.radius + 1.0 && e.attackCd <= 0) {
        e.attackCd = 0.8;
        playerDamage(e.damage * 0.8, e, 'kinetic');
      }
      return out;
    }
    if (e.abilityT <= 0) {
      e.abilityT = e.phase2 ? 3.2 : 5;
      var id = e.id;
      // UNBOUND: every cycle also throws a radial burst
      if (e.phase2) {
        for (var rb = 0; rb < 8; rb++) {
          var ra = (rb / 8) * Math.PI * 2 + runTime;
          spawnEnemyShot(e.x, 1.4, e.z, Math.sin(ra), Math.cos(ra), 9, e.damage * 0.5);
        }
      }
      if (id === 'fang' || id === 'viper' && Math.random() < 0.4) {
        // predatory dash (fang always; viper sometimes)
        e.dashing = 0.5;
        e.dashDirX = nx; e.dashDirZ = nz;
      } else if (id === 'viper') {
        // dagger fan
        var base = Math.atan2(nx, nz);
        for (var i = -4; i <= 4; i++) {
          var a = base + i * 0.12;
          spawnEnemyShot(e.x, 1.3, e.z, Math.sin(a), Math.cos(a), 14, e.damage * 0.55);
        }
      } else if (id === 'hexen') {
        // element bombs at/near the player
        for (var b = 0; b < 4; b++) {
          spawnTelegraph(player.x + GH.rand(-3.5, 3.5), player.z + GH.rand(-3.5, 3.5),
            2.0, 0.9, e.damage);
        }
      } else if (id === 'morrow') {
        // reap ring around itself
        spawnTelegraph(e.x, e.z, 5.2, 0.9, e.damage * 1.2);
      } else if (id === 'strix') {
        // rail snipe along a telegraphed line
        var la = Math.atan2(nx, nz);
        spawnLineTelegraph(e.x, e.z, la, 26, 1.0, 0.9, e.damage * 1.4);
      } else if (id === 'titan') {
        for (var t2 = 0; t2 < 4; t2++) {
          spawnTelegraph(player.x + GH.rand(-4, 4), player.z + GH.rand(-4, 4), 2.6, 1.1, e.damage);
        }
      } else {
        spawnTelegraph(player.x, player.z, 3.0, 0.9, e.damage * 1.2);
      }
    }
    return out;
  }

  // ---------- HUNT bosses: a mechanics library, phases at 66% / 33% ----------
  function huntHas(e, m) { return e.mech.indexOf(m) !== -1; }
  function huntAI(e, dt, dist, nx, nz) {
    var out = { mx: nx, mz: nz };
    var def = e.def;
    if (!e.mech) {
      e.mech = def.mech.slice(); e.phase = 0; e.cds = {}; e.spiralA = 0; e.sweepA = 0; e.faceA = Math.atan2(nx, nz);
      e.mech.forEach(function (m) { e.cds[m] = GH.rand(1.5, 4); });
    }
    var frac = e.hp / e.maxHp;
    if (e.phase < 1 && frac < 0.66 || e.phase < 2 && frac < 0.33) {
      e.phase++;
      var add = (def.phases || [])[e.phase - 1] || [];
      add.forEach(function (m) { if (e.mech.indexOf(m) === -1) { e.mech.push(m); e.cds[m] = 1.0; } });
      announce(def.name + (e.phase === 1 ? ' — WOUNDED' : ' — DESPERATE') + (add.length ? ': ' + add.map(function (m) { return m.split(':')[0].toUpperCase(); }).join(' + ') : ''), 28);
      GH.audio.boss(); G.hitStop(0.1);
      spawnBurst(e.x, 2, e.z, def.color, 30);
      if (huntHas(e, 'shield')) { e.shieldUp = true; e.shieldT = 0; }
    }
    var enraged = huntHas(e, 'enrage') && frac < 0.3;
    var cdMult = enraged ? 0.6 : 1;
    if (enraged && !e.enrageMsg) { e.enrageMsg = true; announce(def.name + ' — ENRAGED', 26); }
    var spd = def.speed * (enraged ? 1.5 : 1);
    if (huntHas(e, 'weak')) {
      var want = Math.atan2(nx, nz);
      e.faceA = GH.lerpAngle(e.faceA, want, Math.min(1, dt * (e.stunT > 0 ? 0.2 : 1.1)));
      e.mesh.rotation.y = e.faceA;
      out.face = e.faceA;
    }
    if (e.shieldUp) {
      e.shieldT += dt;
      var addsAlive = enemies.some(function (o) { return !o.dead && o.summonedBy === e; });
      if (!addsAlive && e.shieldT > 1.5 || e.shieldT > 12) { e.shieldUp = false; announce(def.name + ' — SHIELD DOWN', 22); GH.audio.zap(); }
      if (e.mesh.userData.crown) e.mesh.userData.crown.scale.setScalar(1 + Math.sin(runTime * 8) * 0.25);
    } else if (e.mesh.userData.crown) e.mesh.userData.crown.scale.setScalar(1);
    if (huntHas(e, 'regen') && dist > 25 && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.03 * dt);
    if (huntHas(e, 'burrow') && e.buried) {
      e.buryT -= dt;
      out.spd = def.speed * 1.8;
      if (e.buryT <= 0) {
        e.buried = false; e.mesh.visible = true;
        spawnTelegraph(e.x, e.z, 3.6, 0.5, e.damage * 1.3);
        spawnBurst(e.x, 0.6, e.z, def.color, 20); GH.audio.explode();
        e.cds.burrow = 9 * cdMult;
      }
      return out;
    }
    if (e.stunT > 0) { e.stunT -= dt; out.spd = 0; return out; }
    if (e.dashing > 0) {
      e.dashing -= dt;
      out.spd = 20; out.mx = e.dashDirX; out.mz = e.dashDirZ;
      if (dist < def.radius + 1.0 && e.attackCd <= 0) { e.attackCd = 0.8; playerDamage(e.damage * 0.9, e, 'kinetic'); }
      if (e.dashing <= 0) e.stunT = 1.4;
      return out;
    }
    for (var mi = 0; mi < e.mech.length; mi++) {
      var m = e.mech[mi];
      e.cds[m] = (e.cds[m] || 0) - dt;
      if (e.cds[m] > 0) continue;
      var kind = m.split(':')[0];
      if (kind === 'slam') { e.cds[m] = 6 * cdMult; spawnTelegraph(player.x, player.z, 3.2, 1.0, e.damage * 1.3); }
      else if (kind === 'ring') {
        e.cds[m] = 5.5 * cdMult;
        for (var rb = 0; rb < 10; rb++) { var ra = (rb / 10) * Math.PI * 2 + runTime; spawnEnemyShot(e.x, 1.4, e.z, Math.sin(ra), Math.cos(ra), 9, e.damage * 0.5); }
      }
      else if (kind === 'line') { e.cds[m] = 5 * cdMult; spawnLineTelegraph(e.x, e.z, Math.atan2(nx, nz), 26, 1.0, 0.9, e.damage * 1.4); }
      else if (kind === 'charge') { e.cds[m] = 7 * cdMult; if (dist > 4) { e.dashing = 0.55; e.dashDirX = nx; e.dashDirZ = nz; spawnBurst(e.x, 1, e.z, def.color, 8); } }
      else if (kind === 'spiral') {
        e.cds[m] = 0.14; e.spiralA += 0.45;
        e.spiralN = (e.spiralN || 0) + 1;
        for (var sp = 0; sp < 2; sp++) { var sa = e.spiralA + sp * Math.PI; spawnEnemyShot(e.x, 1.4, e.z, Math.sin(sa), Math.cos(sa), 8, e.damage * 0.4); }
        if (e.spiralN >= 24) { e.spiralN = 0; e.cds[m] = 7 * cdMult; }
      }
      else if (kind === 'mines') {
        e.cds[m] = 6 * cdMult;
        for (var mn = 0; mn < 4; mn++) {
          var mx2 = player.x + GH.rand(-5, 5), mz2 = player.z + GH.rand(-5, 5);
          effects.push({ kind: 'patch', x: mx2, z: mz2, t: 6, radius: 1.5, dps: e.damage * 0.25, chill: huntHas(e, 'frost'), mesh: groundDisc(mx2, mz2, 1.5, huntHas(e, 'frost') ? 0x80c0ff : 0xff5020, 0.3) });
        }
      }
      else if (kind === 'blink') {
        e.cds[m] = 8 * cdMult;
        spawnBurst(e.x, 1.5, e.z, def.color, 10);
        var ba = Math.random() * Math.PI * 2;
        var bx = player.x + Math.cos(ba) * 6, bz = player.z + Math.sin(ba) * 6;
        var bsp = openSpot(bx, bz, def.radius); if (bsp) { bx = bsp.x; bz = bsp.z; }
        e.x = bx; e.z = bz;
        spawnBurst(e.x, 1.5, e.z, def.color, 10);
        if (e.cds.slam !== undefined) e.cds.slam = Math.min(e.cds.slam, 0.4);
      }
      else if (kind === 'summon') {
        e.cds[m] = 11 * cdMult;
        var sid = m.split(':')[1];
        if (!GH.enemyDefs[sid]) sid = GH.weightedPick(wavePlan.types).id;
        for (var s2 = 0; s2 < 3; s2++) {
          var smn = spawnEnemy(sid, e.x + GH.rand(-3, 3), e.z + GH.rand(-3, 3));
          if (smn) { smn.aggro = true; smn.event = true; smn.summonedBy = e; }
        }
        if (huntHas(e, 'shield') && !e.shieldUp) { e.shieldUp = true; e.shieldT = 0; announce(def.name + ' — SHIELDED · KILL THE ADDS', 22); }
      }
      else if (kind === 'pull') {
        e.cds[m] = 9 * cdMult;
        var pa = GH.angleTo(player.x, player.z, e.x, e.z);
        var pd = Math.max(0, Math.min(dist - def.radius - 1, 6));
        player.x += Math.sin(pa) * pd; player.z += Math.cos(pa) * pd;
        drawLightning(e.x, 1.6, e.z, player.x, 1.2, player.z);
        GH.audio.zap();
        spawnTelegraph(e.x, e.z, def.radius + 3.5, 0.9, e.damage * 1.2);
      }
      else if (kind === 'artillery') {
        e.cds[m] = 7 * cdMult;
        for (var t2 = 0; t2 < 5; t2++) spawnTelegraph(player.x + GH.rand(-4, 4), player.z + GH.rand(-4, 4), 2.4, 1.1 + t2 * 0.15, e.damage);
      }
      else if (kind === 'sweep') {
        e.cds[m] = 0.35; e.sweepA += 0.5;
        e.sweepN = (e.sweepN || 0) + 1;
        spawnLineTelegraph(e.x, e.z, e.sweepA, 22, 1.0, 0.35, e.damage * 0.6);
        if (e.sweepN >= 8) { e.sweepN = 0; e.cds[m] = 9 * cdMult; }
      }
      else if (kind === 'burrow') {
        e.cds[m] = 99;
        e.buried = true; e.buryT = 3.0; e.mesh.visible = false;
        spawnBurst(e.x, 0.5, e.z, 0xc8b080, 14);
      }
      else e.cds[m] = 99; // passive mechanics: shield, weak, enrage, regen, drain, burn, frost, split
    }
    if (huntHas(e, 'burn') && Math.random() < 0.15) {
      effects.push({ kind: 'patch', x: e.x, z: e.z, t: 2.5, radius: 1.2, dps: e.damage * 0.2, mesh: groundDisc(e.x, e.z, 1.2, 0xff5020, 0.25) });
    }
    out.spd = spd;
    return out;
  }

  function huntSlain(e) {
    var def = e.def;
    var d = GH.meta.data;
    d.bestiary = d.bestiary || {};
    var first = !d.bestiary[e.id];
    d.bestiary[e.id] = (d.bestiary[e.id] || 0) + 1;
    var t = GH.bosses.TIER[def.huntTier];
    var bnd = expActive ? GH.worldlife.band() : GH.worldlife.BANDS[0];
    grantMats(Math.round(t.alloy * bnd.alloy), t.cores + bnd.cores, true);
    queueAnnounce(def.name + ' SLAIN — +' + t.cores + ' CORES · +' + t.alloy + ' ALLOY' + (first ? ' · BESTIARY ENTRY' : ''), 28);
    if (expActive) {
      var hd = d.huntsToday;
      if (hd.day !== GH.world.dayStamp()) { hd.day = GH.world.dayStamp(); hd.slain = {}; }
      hd.slain[e.id] = true;
      if (huntSpot && huntSpot.id === e.id) { huntSpot = null; huntUp = false; }
    }
    lifeEvent('hunts', 1);
    if (e.mech && e.mech.indexOf('split') !== -1 && !e.isSplit) {
      for (var i = 0; i < 2; i++) {
        var h = spawnEnemy(e.id, e.x + (i ? 2 : -2), e.z);
        if (h) { h.isSplit = true; h.hp = h.maxHp = Math.round(e.maxHp * 0.3); h.mesh.scale.multiplyScalar(0.6); h.baseScale = h.mesh.scale.x; h.aggro = true; h.mech = def.mech.filter(function (m) { return m !== 'split'; }); h.phase = 2; h.cds = {}; h.noLedger = true; }
      }
      queueAnnounce(def.name + ' SPLITS', 22);
    }
    GH.meta.save();
  }

  // ---------- telegraphs ----------
  function spawnTelegraph(x, z, radius, delay, dmg) {
    var m = groundDisc(x, z, radius, 0xff2020, 0.35);
    effects.push({ kind: 'telegraph', mesh: m, t: delay, radius: radius, damage: dmg, x: x, z: z });
  }

  function spawnLineTelegraph(x, z, angle, len, width, delay, dmg) {
    var geo = new THREE.PlaneGeometry(width, len);
    var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xff2020, transparent: true, opacity: 0.4, depthWrite: false
    }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -angle;
    m.position.set(x + Math.sin(angle) * len / 2, 0.05 + gy(x, z), z + Math.cos(angle) * len / 2);
    scene.add(m);
    effects.push({ kind: 'lineTele', mesh: m, t: delay, x: x, z: z, angle: angle, len: len, width: width, damage: dmg });
  }

  // =================================================================
  // FIRING
  // =================================================================
  // ---- pooled short-lived meshes (projectiles, shots, shards, flashes) ----
  var meshPool = { cone: [], box: [], sphere: [], flash: [] };

  function poolGet(kind, color) {
    var m = meshPool[kind].pop();
    if (!m) {
      if (kind === 'flash') {
        m = new THREE.Sprite(new THREE.SpriteMaterial({
          map: GH.assets.flashTex, transparent: true, depthWrite: false
        }));
      } else {
        m = new THREE.Mesh(GH.assets.geo[kind], GH.assets.basic(color || 0xffffff));
        m.rotation.order = 'YXZ';
      }
      m.userData.poolKind = kind;
    }
    if (kind !== 'flash' && color !== undefined) m.material = GH.assets.basic(color);
    if (kind === 'flash') m.material.opacity = 1;
    m.visible = true;
    m.rotation.set(0, 0, 0);
    return m;
  }

  function poolPut(m) {
    scene.remove(m);
    var kind = m.userData.poolKind;
    if (kind && meshPool[kind].length < 220) meshPool[kind].push(m);
  }

  function projMesh(size, color) {
    var m = poolGet('cone', color);
    m.scale.setScalar(size);
    return m;
  }

  function fireShot(inst, originX, originZ, aimAngle, actor) {
    var w = inst.w;
    // soft aim assist
    var bestE = null, bestDiff = 0.35;
    for (var ai = 0; ai < enemies.length; ai++) {
      var ae = enemies[ai];
      if (ae.dead) continue;
      if (GH.dist2(originX, originZ, ae.x, ae.z) > 28 * 28) continue;
      var aa = GH.angleTo(originX, originZ, ae.x, ae.z);
      var ad = Math.abs(((aa - aimAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (ad < bestDiff) { bestDiff = ad; bestE = ae; }
    }
    if (bestE) aimAngle = GH.angleTo(originX, originZ, bestE.x, bestE.z);

    var elem = currentElement(inst);
    var color = w.color;
    if (elem && GH.elements[elem] && w.cycle) color = GH.elements[elem].color;

    var count = w.count + (inst.isPrimary ? player.stats.bonusProj : 0) +
      ((inst.isPrimary || inst.id === 'strafe') && artOn('harrow_brand') &&
        player.hp > player.stats.maxHP * 0.7 ? 1 : 0);
    var dmgMult = 1;
    var frag = resHas(inst, 'keen');
    if (frag > 0) {
      count += frag >= 1 ? 2 : 1;
      dmgMult = frag >= 1 ? 0.65 : 0.75;
    }
    var dmg = weaponDamage(inst, actor) * dmgMult;
    for (var i = 0; i < count; i++) {
      var off = count > 1
        ? (i - (count - 1) / 2) * (Math.max(w.spread, frag > 0 ? 0.3 : w.spread) / Math.max(1, count - 1) * 2)
        : GH.rand(-w.spread, w.spread) * 0.5;
      var a = aimAngle + off;
      var m = projMesh(w.size, color);
      m.position.set(originX, 1.2 + gy(originX, originZ), originZ);
      scene.add(m);
      projectiles.push({
        mesh: m, x: originX, z: originZ,
        dirX: Math.sin(a), dirZ: Math.cos(a),
        speed: w.speed * inst.mods.projSpd * GH.PACE.projSpd, life: w.life * GH.PACE.projLife,
        damage: dmg, inst: inst, elem: elem,
        pierce: w.pierce || 0, homing: w.homing || 0, aoe: w.aoe || 0,
        returning: w.type === 'boomerang', retAt: w.life * 0.45, returned: false,
        hitSet: []
      });
    }
    spawnFlash(originX, 1.2, originZ);
    GH.audio.shoot();
  }

  function spawnFlash(x, y, z) {
    var s = poolGet('flash');
    s.position.set(x, y + gy(x, z), z);
    s.scale.setScalar(GH.rand(0.7, 1.1));
    scene.add(s);
    effects.push({ kind: 'sprite', mesh: s, t: 0.07, total: 0.07 });
  }

  function nearestEnemy(x, z, maxDist, exclude) {
    var best = null, bestD = (maxDist || 999) * (maxDist || 999);
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead || (exclude && exclude.indexOf(e) !== -1)) continue;
      var d2 = GH.dist2(x, z, e.x, e.z);
      if (d2 < bestD) { bestD = d2; best = e; }
    }
    return best;
  }

  function frenzyMult(actor) {
    var a2 = actor || player;
    if (a2.def.passive !== 'frenzy') return 1;
    return 1 + a2.frenzy.length * 0.08;
  }

  function fireWeaponOnce(inst, aim) {
    var w = inst.w;
    if (w.type === 'shot' || w.type === 'boomerang') {
      var a = inst.isPrimary ? aim
        : (function () {
          var t = nearestEnemy(player.x, player.z, 26);
          return t ? GH.angleTo(player.x, player.z, t.x, t.z) : aim;
        })();
      if (w.burst) {
        inst.burstLeft = w.burst - 1;
        inst.burstTimer = 0.05;
        inst.burstAngle = a;
      }
      fireShot(inst, player.x + Math.sin(a) * 0.8, player.z + Math.cos(a) * 0.8, a);
    } else if (w.type === 'melee') {
      meleeSwing(inst, aim);
    } else if (w.type === 'aura') {
      auraTick(inst);
    } else if (w.type === 'zap') {
      zapChain(inst);
    } else if (w.type === 'mine') {
      dropMine(inst);
    } else if (w.type === 'cone') {
      coneTick(inst, aim);
    } else if (w.type === 'mortar') {
      fireMortar(inst, aim);
    } else if (w.type === 'ringwave') {
      // an expanding shock ring rolling out from the frame
      var rw = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.2, 24),
        new THREE.MeshBasicMaterial({ color: 0x80d0ff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
      rw.rotation.x = -Math.PI / 2;
      rw.position.set(player.x, 0.35 + gy(player.x, player.z), player.z);
      scene.add(rw);
      GH.audio.zap();
      effects.push({
        kind: 'ringwaveFx', mesh: rw, t: w.range / 9, total: w.range / 9,
        x: player.x, z: player.z, maxR: w.range,
        dmg: weaponDamage(inst), inst: inst, elem: w.element, hitSet: []
      });
    } else if (w.type === 'vortex') {
      // hurl an anchor that drags the swarm together, then pops
      var tgt3 = nearestEnemy(player.x, player.z, 22);
      if (tgt3) {
        var vm = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.1, 4, 14),
          GH.assets.basic(0xc0a0ff, { transparent: true, opacity: 0.8 }));
        vm.rotation.x = Math.PI / 2;
        vm.position.set(tgt3.x, 0.4 + gy(tgt3.x, tgt3.z), tgt3.z);
        scene.add(vm);
        GH.audio.shoot();
        effects.push({
          kind: 'vortexFx', mesh: vm, t: 1.6, total: 1.6,
          x: tgt3.x, z: tgt3.z, pull: w.pull,
          dmg: weaponDamage(inst), aoe: w.aoe, inst: inst
        });
      }
    } else if (w.type === 'drone') {
      var t2 = nearestEnemy(droneMesh ? droneMesh.position.x : player.x,
        droneMesh ? droneMesh.position.z : player.z, 24);
      if (t2 && droneMesh) {
        var a3 = GH.angleTo(droneMesh.position.x, droneMesh.position.z, t2.x, t2.z);
        var tmp = makeWeaponInst('dronefire', {
          type: 'shot', damage: w.damage, speed: w.speed, life: w.life,
          size: w.size, color: w.color, spread: 0, count: 1
        });
        tmp.sockets = inst.sockets; tmp.mods = inst.mods; tmp.resonance = inst.resonance;
        fireShot(tmp, droneMesh.position.x, droneMesh.position.z, a3);
      }
    }
  }

  // skimmer-form armament: twin hull-mounted strafe cannons. Light, fast,
  // mouse-aimed, no clip — the main suite stays folded until you transform back.
  var STRAFE_DEF = {
    type: 'shot', damage: 4, interval: 0.26, speed: 26, life: 0.95,
    size: 0.18, color: 0x70c0ff, spread: 0.16, count: 2
  };

  // =================================================================
  // TARGET-BASED COMBAT — pick a fight, don't hose the room.
  // Left click attacks with the equipped weapon (clicking a hostile
  // also marks it; Tab cycles); the attack homes on the marked target
  // when it's in reach, and abilities spend energy on it.
  // =================================================================
  var target = null;
  var reticle = null;

  function setTarget(e) {
    target = e || null;
    if (!reticle) {
      reticle = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 4, 20),
        new THREE.MeshBasicMaterial({ color: 0xffd050, transparent: true, opacity: 0.85, depthWrite: false }));
      reticle.rotation.x = Math.PI / 2;
      scene.add(reticle);
    }
    reticle.visible = !!target;
    if (target) {
      reticle.scale.setScalar(target.def.radius + 0.5);
      GH.audio.card();
    }
  }

  function maintainTarget() {
    if (target && (target.dead ||
      GH.dist2(player.x, player.z, target.x, target.z) > 45 * 45)) {
      setTarget(null);
    }
    // soft acquire: something already in your face is fair game
    if (!target) {
      var e = nearestEnemy(player.x, player.z, 9);
      if (e) setTarget(e);
    }
    if (reticle && target) {
      reticle.position.set(target.x, 0.12 + gy(target.x, target.z), target.z);
      reticle.rotation.z += 0.02;
    }
  }

  G.clickTarget = function (ndc) {
    if (G.state !== 'play' || !player) return false;
    raycaster.setFromCamera(ndc, camera);
    var meshes = [];
    for (var i = 0; i < enemies.length; i++) {
      if (!enemies[i].dead) meshes.push(enemies[i].mesh);
    }
    var hits = raycaster.intersectObjects(meshes, true);
    if (hits.length) {
      var obj = hits[0].object;
      while (obj && meshes.indexOf(obj) === -1) obj = obj.parent;
      for (i = 0; i < enemies.length; i++) {
        if (enemies[i].mesh === obj) { setTarget(enemies[i]); return true; }
      }
    }
    // near-miss: pick whatever stands close to the clicked ground point
    if (raycaster.ray.intersectPlane(groundPlane, tmpV3)) {
      var e = nearestEnemy(tmpV3.x, tmpV3.z, 3);
      if (e) { setTarget(e); return true; }
    }
    return false;
  };

  G.tabTarget = function () {
    if (!player) return;
    var e = nearestEnemy(player.x, player.z, 32, target ? [target] : null);
    if (e) setTarget(e);
  };

  function attackRange(inst) {
    var t = inst.w.type;
    if (t === 'melee') return inst.w.range + 0.8;
    if (t === 'aura') return inst.w.range + 0.5;
    return 20;
  }

  // ---------------- abilities: the hotbar ----------------
  function castAbility(slot) {
    var ab = GH.skills.ABILITIES[slot];
    var bon = player.skillBon;
    if (!ab) return;
    if (!bon.slots[slot]) {
      announce(ab.name + ' — LOCKED (TRAIN IT · K)', 18);
      return;
    }
    if (player.abilityCds[slot] > 0) return;
    if (player.energy < ab.cost) {
      announce('LOW ENERGY', 16);
      GH.audio.hit();
      return;
    }
    var needsTarget = slot !== 2;
    if (needsTarget && (!target || target.dead)) {
      announce('NO TARGET — CLICK A HOSTILE', 16);
      return;
    }
    var inst = player.weapons[0];
    // runes read into this art raise its power; REACTOR and the tree pull
    // the recharge back down
    var dmg = weaponDamage(inst) * player.stats.artMult * GH.attrs.artPower(slot);
    var range = slot === 1 ? attackRange(inst) : 20;
    if (needsTarget && GH.dist2(player.x, player.z, target.x, target.z) > range * range) {
      announce('OUT OF RANGE', 16);
      return;
    }
    player.energy -= ab.cost;
    player.abilityCds[slot] = ab.cd * GH.PACE.cdMult * bon.cdMult * player.stats.artCd * GH.attrs.artRecharge(slot);
    tutorialEvent('ability', 1);

    if (slot === 1) {          // RUPTURE — focused strike
      player.facing = GH.angleTo(player.x, player.z, target.x, target.z);
      if (inst.w.type === 'melee') {
        player.swingArm = 'R';
        player.swingDur = 0.26;
        player.swingT = 0.26;
      }
      damageEnemy(target, dmg * 2.2, { inst: inst });
      spawnBurst(target.x, 1.4, target.z, 0xfff0c0, 12);
      var ra = GH.angleTo(player.x, player.z, target.x, target.z);
      target.vx += Math.sin(ra) * 8 / target.def.mass;
      target.vz += Math.cos(ra) * 8 / target.def.mass;
      GH.audio.crit();
      G.hitStop(0.05);
    } else if (slot === 2) {   // SWEEP — radial blowout
      GH.audio.explode();
      var m = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.9, 24),
        new THREE.MeshBasicMaterial({ color: 0xffb050, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(player.x, 0.3 + gy(player.x, player.z), player.z);
      scene.add(m);
      effects.push({ kind: 'boom', mesh: m, t: 0.3, total: 0.3, grow: 6 });
      for (var si2 = 0; si2 < enemies.length; si2++) {
        var se = enemies[si2];
        if (se.dead) continue;
        var rr = 4.5 + se.def.radius;
        if (GH.dist2(player.x, player.z, se.x, se.z) <= rr * rr) {
          damageEnemy(se, dmg * 1.3, { inst: inst });
          var sa = GH.angleTo(player.x, player.z, se.x, se.z);
          se.vx += Math.sin(sa) * 18 / se.def.mass;
          se.vz += Math.cos(sa) * 18 / se.def.mass;
        }
      }
    } else if (slot === 3) {   // SHACKLE — chain the cluster down
      GH.audio.zap();
      drawLightning(player.x, 1.6, player.z, target.x, 1.2, target.z);
      for (var ci2 = 0; ci2 < enemies.length; ci2++) {
        var ce2 = enemies[ci2];
        if (ce2.dead) continue;
        if (ce2 === target || GH.dist2(target.x, target.z, ce2.x, ce2.z) < 2.5 * 2.5) {
          damageEnemy(ce2, dmg * 1.0, { inst: inst, elem: 'shock' });
          ce2.slowT = 3.5;
          if (Math.random() < 0.5) ce2.stun = Math.max(ce2.stun || 0, 0.8);
        }
      }
    } else if (slot === 4) {   // OVERLOAD — detonate their footing
      explode(target.x, target.z, 3.5, dmg * 2.8, { inst: inst, elem: 'burn' });
      G.hitStop(0.08);
    }
  }

  // ---------------- signature abilities (slot 5, one per lineage) ----------------
  function castSignature() {
    var sg = player.sig;
    if (!sg || player.abilityCds[5] > 0) return;
    if (player.energy < sg.cost) { announce('LOW ENERGY', 16); GH.audio.hit(); return; }
    var key = player.def.kind === 'relic' ? player.def.relicBase : (player.def.lineage || player.def.id);
    var inst = player.weapons[0];
    var dmg = weaponDamage(inst) * player.sigPower * player.stats.artMult * GH.attrs.artPower(5);
    var needsTarget = key === 'fang' || key === 'viper';
    if (needsTarget && (!target || target.dead)) { announce('NO TARGET — CLICK A HOSTILE', 16); return; }
    if (needsTarget && GH.dist2(player.x, player.z, target.x, target.z) > 18 * 18) { announce('OUT OF RANGE', 16); return; }
    player.energy -= sg.cost;
    player.abilityCds[5] = sg.cd * GH.PACE.cdMult * player.skillBon.cdMult * player.stats.artCd * GH.attrs.artRecharge(5);
    announce(sg.name, 22);
    tutorialEvent('ability', 1);
    var i, e, a;
    if (key === 'aegis') {
      player.sigT = 5; player.sigKind = 'wall';
      GH.audio.block();
      for (i = 0; i < enemies.length; i++) {
        e = enemies[i]; if (e.dead) continue;
        if (GH.dist2(player.x, player.z, e.x, e.z) < 36) { a = GH.angleTo(player.x, player.z, e.x, e.z); e.vx += Math.sin(a) * 20 / e.def.mass; e.vz += Math.cos(a) * 20 / e.def.mass; damageEnemy(e, dmg * 0.8, { inst: inst }); }
      }
      spawnBurst(player.x, 1, player.z, 0xffd040, 18);
    } else if (key === 'vulcan') {
      var base = player.facing;
      for (i = -7; i <= 6; i++) fireShot(inst, player.x, player.z, base + i * 0.09 + 0.045, player);
      GH.audio.shoot(); G.hitStop(0.04);
    } else if (key === 'fang') {
      a = GH.angleTo(target.x, target.z, player.x, player.z);
      player.x = target.x + Math.sin(a) * (target.def.radius + 0.9);
      player.z = target.z + Math.cos(a) * (target.def.radius + 0.9);
      player.facing = GH.angleTo(player.x, player.z, target.x, target.z);
      player.dashTime = 0.12;
      damageEnemy(target, dmg * 2.5, { inst: inst });
      target.vx += Math.sin(player.facing) * 10 / target.def.mass; target.vz += Math.cos(player.facing) * 10 / target.def.mass;
      player.frenzy.push(4, 4); while (player.frenzy.length > 5) player.frenzy.shift();
      spawnBurst(target.x, 1.4, target.z, 0xff5040, 14); GH.audio.crit(); G.hitStop(0.06);
    } else if (key === 'hexen') {
      if (inst.w.cycle) inst.cycleT = 0;
      var elem = currentElement(inst) || 'burn';
      for (i = 0; i < 12; i++) {
        var tmp = makeWeaponInst('spellstorm', { type: 'shot', damage: Math.round(dmg * 0.9), speed: 18, life: 2.0, size: 0.28, color: GH.elements[elem] ? GH.elements[elem].color : 0x50e8d8, spread: 0, count: 1, homing: 6, aoe: 1.6, elem: elem });
        fireShot(tmp, player.x, player.z, player.facing + (i - 5.5) * 0.5, player);
      }
      GH.audio.zap(); spawnBurst(player.x, 1.4, player.z, 0x50e8d8, 16);
    } else if (key === 'viper') {
      a = GH.angleTo(player.x, player.z, target.x, target.z);
      spawnBurst(player.x, 1, player.z, 0x9ae848, 10);
      player.x = target.x + Math.sin(a) * (target.def.radius + 1.0);
      player.z = target.z + Math.cos(a) * (target.def.radius + 1.0);
      player.facing = GH.angleTo(player.x, player.z, target.x, target.z);
      player.dashTime = 0.15;
      player.edgeT = 4;
      for (i = 0; i < enemies.length; i++) { e = enemies[i]; if (!e.dead && !e.def.boss && GH.dist2(player.x, player.z, e.x, e.z) < 225) e.stun = Math.max(e.stun || 0, 1.2); }
      if (target.def.boss) target.stunT = Math.max(target.stunT || 0, 1.0);
      damageEnemy(target, dmg * 1.5, { inst: inst });
      spawnBurst(player.x, 1, player.z, 0x9ae848, 10); GH.audio.dash();
    } else if (key === 'morrow') {
      var healed = 0;
      for (i = 0; i < enemies.length; i++) {
        e = enemies[i]; if (e.dead) continue;
        if (GH.dist2(player.x, player.z, e.x, e.z) < 81) {
          a = GH.angleTo(e.x, e.z, player.x, player.z);
          var pullD = Math.max(0, Math.sqrt(GH.dist2(player.x, player.z, e.x, e.z)) - e.def.radius - 1.2) * (e.def.boss ? 0.3 : 0.9);
          e.x += Math.sin(a) * pullD; e.z += Math.cos(a) * pullD;
          var before = e.hp; damageEnemy(e, dmg * 1.2, { inst: inst }); healed += Math.max(0, before - Math.max(0, e.hp));
        }
      }
      player.heal(healed * 0.3);
      spawnBurst(player.x, 1.2, player.z, 0xb03050, 22); GH.audio.explode();
    } else if (key === 'strix') {
      player.dashX = Math.sin(player.facing); player.dashZ = Math.cos(player.facing);
      player.dashTime = 0.4; player.dashId++; player.dashKind = 'lunge'; player.dashMult = 2.2;
      player.edgeT = 3;
      GH.audio.dash(); spawnBurst(player.x, 1, player.z, 0xf05060, 10);
    } else if (key === 'titan') {
      player.sigT = 5; player.sigKind = 'siege';
      player.stats.atkSpdMult *= 2.2; player.stats.armor += 12;
      if (inst.w.aoe) { inst.w.aoe *= 1.5; player.sigAoe = inst; }
      GH.audio.block(); spawnBurst(player.x, 0.4, player.z, 0xf0a030, 16);
    }
  }
  function updateSignature(dt) {
    if (player.sigT > 0) {
      player.sigT -= dt;
      if (player.sigT <= 0) {
        if (player.sigKind === 'siege') {
          player.stats.atkSpdMult /= 2.2; player.stats.armor -= 12;
          if (player.sigAoe) { player.sigAoe.w.aoe /= 1.5; player.sigAoe = null; }
        }
        player.sigKind = null;
      }
    }
  }

  function updateWeapons(dt, input) {
    var s = player.stats;
    // the trigger: a click (or held button) from mouse, or an active aim
    // stick on gamepad/touch (twin-stick devices fire while aiming).
    // Consumed here every frame like the other pressed flags.
    var trigger = !!(input.attackPressed || input.attackHeld ||
      input.padAimActive || input.touchAimActive);
    input.attackPressed = false;
    // the capacitor always refills; cooldowns always tick
    // (a DAMPENED dungeon chokes the reactor)
    var enRate = dungeonState && dungeonState.modIds.dampened ? 0.55 : 1;
    player.energy = Math.min(s.energyMax, player.energy + s.energyRegen * GH.PACE.energyRegen * enRate * dt);
    for (var c = 1; c <= 5; c++) {
      if (player.abilityCds[c] > 0) player.abilityCds[c] -= dt;
    }
    maintainTarget();

    if (player.speederOn) {
      // skimmer cannons fire on the trigger — at the marked target when
      // one's in reach, otherwise straight along the hull's heading
      if (inHazard('rifts', player.x, player.z)) { player.suppressed = true; return; }
      player.suppressed = false;
      if (!player.strafeInst) player.strafeInst = makeWeaponInst('strafe', STRAFE_DEF, false);
      var si = player.strafeInst;
      si.timer -= dt * (s.atkSpdMult || 1) * GH.PACE.atkSpd;
      if (si.timer <= 0 && trigger) {
        si.timer = si.w.interval;
        var sAim = (target && !target.dead &&
          GH.dist2(player.x, player.z, target.x, target.z) < 22 * 22)
          ? GH.angleTo(player.x, player.z, target.x, target.z)
          : (player.drive ? player.drive.heading : player.facing);
        var surge = player.skillBon.surge ? 1.4 : 1;
        var keep = si.w.damage;
        si.w.damage = keep * surge;
        fireShot(si, player.x + Math.sin(sAim) * 0.7, player.z + Math.cos(sAim) * 0.7, sAim);
        si.w.damage = keep;
      }
      return; // the main suite stays folded
    }
    // null rifts suppress every weapon while you stand inside one
    if (inHazard('rifts', player.x, player.z)) {
      player.suppressed = true;
      return;
    }
    player.suppressed = false;

    updateSignature(dt);
    if (input.abilityPressed && input.abilityPressed[5]) { input.abilityPressed[5] = false; castSignature(); }
    // hotbar casts
    if (input.abilityPressed) {
      for (c = 1; c <= 4; c++) {
        if (input.abilityPressed[c]) {
          input.abilityPressed[c] = false;
          castAbility(c);
        }
      }
    }

    var inst = player.weapons[0];
    var w = inst.w;
    var spdMult = s.atkSpdMult * frenzyMult() * GH.PACE.atkSpd *
      (player.special.active > 0 && player.def.special === 'overdrive' ? 2 : 1) *
      inst.mods.atkSpdMult;

    // burst continuation (already aimed)
    if (inst.burstLeft > 0) {
      inst.burstTimer -= dt;
      if (inst.burstTimer <= 0) {
        inst.burstLeft--;
        inst.burstTimer = 0.05;
        fireShot(inst, player.x + Math.sin(inst.burstAngle) * 0.8,
          player.z + Math.cos(inst.burstAngle) * 0.8, inst.burstAngle);
      }
    }

    // reload
    if (inst.reloading > 0) {
      inst.reloading -= dt * spdMult;
      if (inst.reloading <= 0) {
        inst.clip = w.clip;
        onReload(inst);
      }
      return;
    }

    // resonance pulses keep their own clocks
    if (resHas(inst, 'sol') > 0 && !w.clip) {
      inst.sanctityT -= dt;
      if (inst.sanctityT <= 0) { inst.sanctityT = 8; sanctitySmite(inst); }
    }
    if (inst.resonance && inst.resonance.kind === 'prism') {
      inst.prismT -= dt;
      if (inst.prismT <= 0) { inst.prismT = 6; prismBlast(inst); }
    }

    // manual attack: the cycle winds down on its own, but nothing fires
    // until the pilot pulls the trigger — left mouse (hold to keep
    // swinging/shooting), or the aim stick on pad/touch. Only ranged
    // weapon types launch projectiles; melee frames swing steel.
    inst.timer = Math.max(0, inst.timer - dt * spdMult);
    if (inst.timer <= 0 && trigger) {
      inst.timer = w.interval;
      var aim = player.facing;
      if (target && !target.dead) {
        var range = attackRange(inst);
        if (GH.dist2(player.x, player.z, target.x, target.z) <= range * range) {
          var ta = GH.angleTo(player.x, player.z, target.x, target.z);
          // melee never spins you onto a mark behind your back — a swing
          // only squares up on a target you're already roughly facing
          var tdiff = Math.abs(((ta - aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (w.type !== 'melee' || tdiff <= (w.arc || 2) / 2 + 0.35) {
            aim = ta;
            player.facing = aim; // square up like you mean it
          }
        }
      }
      fireWeaponOnce(inst, aim);
      if (w.clip) {
        inst.clip--;
        if (inst.clip <= 0) inst.reloading = w.reload;
      }
    }
  }

  function onReload(inst) {
    GH.audio.card();
    var pot = resHas(inst, 'sol');
    if (pot > 0) sanctitySmite(inst, pot);
  }

  function sanctitySmite(inst, pot) {
    pot = pot || 1;
    var hit = 0;
    var dmg = weaponDamage(inst) * 1.2 * pot;
    for (var i = 0; i < enemies.length && hit < 3; i++) {
      var e = enemies[i];
      if (e.dead) continue;
      if (GH.dist2(player.x, player.z, e.x, e.z) < 49) {
        damageEnemy(e, dmg, { inst: inst, noRes: true });
        var m = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 6, 6),
          GH.assets.basic(0xfff2c0, { transparent: true, opacity: 0.7 }));
        m.position.set(e.x, 3 + gy(e.x, e.z), e.z);
        scene.add(m);
        effects.push({ kind: 'fade', mesh: m, t: 0.25, total: 0.25 });
        hit++;
      }
    }
    if (hit > 0) {
      player.heal(6 * pot);
      GH.audio.heart();
    }
  }

  function prismBlast(inst) {
    GH.audio.zap();
    var m = new THREE.Mesh(new THREE.RingGeometry(0.4, 1.0, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(player.x, 0.3 + gy(player.x, player.z), player.z);
    scene.add(m);
    effects.push({ kind: 'boom', mesh: m, t: 0.35, total: 0.35, grow: 8 });
    var dmg = weaponDamage(inst) * 1.5;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead) continue;
      if (GH.dist2(player.x, player.z, e.x, e.z) < 64) {
        damageEnemy(e, dmg, { inst: inst, noRes: true });
        var a = GH.angleTo(player.x, player.z, e.x, e.z);
        e.vx += Math.sin(a) * 14 / e.def.mass;
        e.vz += Math.cos(a) * 14 / e.def.mass;
      }
    }
  }

  function meleeSwing(inst, aim, actor) {
    var a2 = actor || player;
    var w = inst.w;
    GH.audio.melee();
    // fan centered on the swing direction: after the -PI/2 X-rotation a
    // circle point (cosθ, sinθ) lands at world (cosθ, -sinθ), so the
    // world aim direction (sin a, cos a) is θ = a - PI/2
    var geo = new THREE.CircleGeometry(w.range, 12, aim - Math.PI / 2 - w.arc / 2, w.arc);
    var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xfff0c0, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(a2.x, 0.35 + gy(a2.x, a2.z), a2.z);
    scene.add(m);
    effects.push({ kind: 'fade', mesh: m, t: 0.18, total: 0.18 });
    // kick the swing animation (windup + cut, see poseMeleeSwing);
    // dual-wield frames alternate arms
    var dual = a2.def.model && (a2.def.model.prop === 'claws' || a2.def.model.prop === 'daggers');
    a2.swingArm = dual && a2.swingArm === 'R' ? 'L' : 'R';
    a2.swingDur = GH.clamp(w.interval * 0.45, 0.2, 0.34);
    a2.swingT = a2.swingDur;

    var dmg = weaponDamage(inst, a2);
    // RESONANT EDGE capstone: primary swings carve a wider arc
    var arcW = w.arc * (a2 === player && inst.isPrimary && player.skillBon.cleave ? 1.35 : 1);
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead) continue;
      var rr = w.range + e.def.radius;
      if (GH.dist2(a2.x, a2.z, e.x, e.z) > rr * rr) continue;
      var angTo = GH.angleTo(a2.x, a2.z, e.x, e.z);
      var diff = Math.abs(((angTo - aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff <= arcW / 2 + 0.25) {
        damageEnemy(e, dmg, { inst: inst });
        var kb = w.knockback / e.def.mass;
        e.vx += Math.sin(angTo) * kb;
        e.vz += Math.cos(angTo) * kb;
      }
    }
    // cutting wave projectile
    if (w.wave) {
      var wm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.16),
        GH.assets.basic(w.wave.color, { transparent: true, opacity: 0.85 }));
      wm.position.set(a2.x, 1.2 + gy(a2.x, a2.z), a2.z);
      wm.rotation.y = aim;
      scene.add(wm);
      projectiles.push({
        mesh: wm, x: a2.x, z: a2.z,
        dirX: Math.sin(aim), dirZ: Math.cos(aim),
        speed: w.wave.speed, life: w.wave.life,
        damage: weaponDamage(inst, a2) * (w.wave.damage / w.damage),
        inst: inst, elem: null, pierce: 99, homing: 0, aoe: 0,
        hitSet: [], flat: true
      });
    }
    if (w.clip) { /* melee has no clip */ }
    sanctityMaybe(inst);
  }

  function sanctityMaybe() { /* handled by timers */ }

  function auraTick(inst, actor) {
    var a2 = actor || player;
    var w = inst.w;
    var range = w.range *
      (a2.special && a2.special.active > 0 && a2.def.special === 'frenzy' ? 1.9 : 1);
    var dmg = weaponDamage(inst, a2);
    var hitAny = false;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead) continue;
      var rr = range + e.def.radius;
      if (GH.dist2(a2.x, a2.z, e.x, e.z) <= rr * rr) {
        damageEnemy(e, dmg, { inst: inst });
        hitAny = true;
      }
    }
    if (hitAny) GH.audio.melee();
    var m = new THREE.Mesh(new THREE.RingGeometry(range - 0.25, range, 22),
      new THREE.MeshBasicMaterial({ color: 0xc04060, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(a2.x, 0.3 + gy(a2.x, a2.z), a2.z);
    scene.add(m);
    effects.push({ kind: 'fade', mesh: m, t: 0.22, total: 0.22 });
  }

  function coneTick(inst, aim) {
    var w = inst.w;
    var dmg = weaponDamage(inst);
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead) continue;
      var rr = w.range + e.def.radius;
      if (GH.dist2(player.x, player.z, e.x, e.z) > rr * rr) continue;
      var angTo = GH.angleTo(player.x, player.z, e.x, e.z);
      var diff = Math.abs(((angTo - aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff <= w.arc / 2) {
        damageEnemy(e, dmg, { inst: inst, elem: w.element });
      }
    }
    // flame puffs
    for (var f = 0; f < 2; f++) {
      var d = GH.rand(1.5, w.range);
      var a = aim + GH.rand(-w.arc / 2, w.arc / 2) * 0.8;
      var s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: GH.assets.flashTex, color: 0xff7030, transparent: true, depthWrite: false
      }));
      s.position.set(player.x + Math.sin(a) * d, GH.rand(0.6, 1.6), player.z + Math.cos(a) * d);
      s.scale.setScalar(GH.rand(0.8, 1.6));
      scene.add(s);
      effects.push({ kind: 'sprite', mesh: s, t: 0.2, total: 0.2 });
    }
  }

  function fireMortar(inst, aim, actor) {
    var a2 = actor || player;
    var w = inst.w;
    var count = w.count || 1;
    for (var i = 0; i < count; i++) {
      var tgt = nearestEnemy(a2.x, a2.z, 20);
      var tx, tz;
      if (tgt && (!inst.isPrimary || a2 !== player)) {
        tx = tgt.x + GH.rand(-1.5, 1.5); tz = tgt.z + GH.rand(-1.5, 1.5);
      }
      else {
        // primary mortar drops at the aim point (snapping to a nearby enemy)
        raycaster.setFromCamera(G._mouseNDC || new THREE.Vector2(), camera);
        if (raycaster.ray.intersectPlane(groundPlane, tmpV3)) {
          tx = GH.clamp(tmpV3.x, -ARENA_R, ARENA_R);
          tz = GH.clamp(tmpV3.z, -ARENA_R, ARENA_R);
        } else { tx = a2.x + Math.sin(aim) * 8; tz = a2.z + Math.cos(aim) * 8; }
        var near = nearestEnemy(tx, tz, 6);
        if (near) { tx = near.x; tz = near.z; }
        tx += GH.rand(-0.8, 0.8);
        tz += GH.rand(-0.8, 0.8);
      }
      var shell = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), GH.assets.basic(w.color));
      scene.add(shell);
      var disc = groundDisc(tx, tz, w.aoe * 0.8, 0xffa040, 0.18);
      effects.push({
        kind: 'pshell', mesh: shell, disc: disc, t: w.arcTime, total: w.arcTime,
        x0: a2.x, z0: a2.z, x1: tx, z1: tz,
        damage: weaponDamage(inst, a2), aoe: w.aoe, inst: inst
      });
    }
    GH.audio.shoot();
  }

  function zapChain(inst) {
    var w = inst.w;
    var hit = [];
    var fromX = player.x, fromZ = player.z, fromY = 1.6;
    var dmg = weaponDamage(inst);
    for (var t = 0; t < w.targets; t++) {
      var e = nearestEnemy(fromX, fromZ, w.range, hit);
      if (!e) break;
      hit.push(e);
      drawLightning(fromX, fromY, fromZ, e.x, 1.2, e.z);
      damageEnemy(e, dmg, { inst: inst, elem: w.element });
      fromX = e.x; fromZ = e.z; fromY = 1.2;
    }
    if (hit.length) GH.audio.zap();
  }

  function drawLightning(x1, y1, z1, x2, y2, z2) {
    var pts = [];
    var segs = 6;
    for (var i = 0; i <= segs; i++) {
      var t = i / segs;
      var jit = (i > 0 && i < segs) ? 0.4 : 0;
      pts.push(new THREE.Vector3(
        GH.lerp(x1, x2, t) + GH.rand(-jit, jit),
        GH.lerp(y1, y2, t) + GH.rand(-jit, jit),
        GH.lerp(z1, z2, t) + GH.rand(-jit, jit)
      ));
    }
    var line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x80e8ff, transparent: true, opacity: 0.9 })
    );
    scene.add(line);
    effects.push({ kind: 'fade', mesh: line, t: 0.15, total: 0.15 });
  }

  function dropMine(inst) {
    var w = inst.w;
    var m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.18, 8),
      GH.assets.mat(0xc8b040, { emissive: 0x604010 }));
    m.position.set(player.x, 0.1 + gy(player.x, player.z), player.z);
    scene.add(m);
    mines.push({ mesh: m, x: player.x, z: player.z, life: w.life, damage: weaponDamage(inst), aoe: w.aoe, inst: inst });
  }

  function updateMines(dt) {
    for (var i = mines.length - 1; i >= 0; i--) {
      var mn = mines[i];
      mn.life -= dt;
      mn.mesh.rotation.y += dt * 2;
      var boom = mn.life <= 0;
      if (!boom) {
        for (var j = 0; j < enemies.length; j++) {
          var e = enemies[j];
          if (!e.dead && GH.dist2(mn.x, mn.z, e.x, e.z) < 1.4 * 1.4) { boom = true; break; }
        }
      }
      if (boom) {
        explode(mn.x, mn.z, mn.aoe, mn.damage, { inst: mn.inst });
        scene.remove(mn.mesh);
        mines.splice(i, 1);
      }
    }
  }

  function explode(x, z, radius, dmg, opts) {
    GH.audio.explode();
    spawnBurst(x, 0.8, z, 0xffa040, 14);
    shake = Math.min(0.5, shake + 0.12);
    if (dmg > 0) G.hitStop(0.03);
    var m = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.6, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffc060, transparent: true, opacity: 0.7 }));
    m.position.set(x, 0.8 + gy(x, z), z);
    scene.add(m);
    effects.push({ kind: 'boom', mesh: m, t: 0.25, total: 0.25, grow: radius });
    var scorch = groundDisc(x, z, radius * 0.7, 0x181410, 0.35);
    effects.push({ kind: 'fadeSlow', mesh: scorch, t: 2.5, total: 2.5 });
    if (dmg <= 0) return;
    opts = opts || {};
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead) continue;
      var rr = radius + e.def.radius;
      if (GH.dist2(x, z, e.x, e.z) <= rr * rr) {
        damageEnemy(e, dmg, { inst: opts.inst, noRes: opts.noRes });
      }
    }
  }

  function updateOrbit(dt) {
    var inst = null;
    for (var i = 0; i < player.weapons.length; i++) {
      if (player.weapons[i].w.type === 'orbit') { inst = player.weapons[i]; break; }
    }
    if (!inst) { orbitGroup.visible = false; return; }
    var w = inst.w;
    orbitGroup.visible = true;
    while (orbitGroup.children.length < w.count) {
      var b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.9),
        GH.assets.mat(0xd0d8e8, { emissive: 0x304050 }));
      orbitGroup.add(b);
    }
    while (orbitGroup.children.length > w.count) orbitGroup.remove(orbitGroup.children[orbitGroup.children.length - 1]);
    inst.angle += dt * w.spin;
    var now = runTime;
    for (var k = 0; k < orbitGroup.children.length; k++) {
      var blade = orbitGroup.children[k];
      var a = inst.angle + (k / w.count) * Math.PI * 2;
      var bx = player.x + Math.sin(a) * w.radius;
      var bz = player.z + Math.cos(a) * w.radius;
      blade.position.set(bx, 1.0 + gy(bx, bz), bz);
      blade.rotation.y = a + Math.PI / 2;
      for (var j = 0; j < enemies.length; j++) {
        var e = enemies[j];
        if (e.dead) continue;
        var rr = 0.7 + e.def.radius;
        if (GH.dist2(bx, bz, e.x, e.z) <= rr * rr && now - e.lastOrbitHit > w.interval) {
          e.lastOrbitHit = now;
          damageEnemy(e, weaponDamage(inst), { inst: inst });
          var ang = GH.angleTo(player.x, player.z, e.x, e.z);
          e.vx += Math.sin(ang) * 3 / e.def.mass;
          e.vz += Math.cos(ang) * 3 / e.def.mass;
        }
      }
    }
  }

  function updateDrone(dt) {
    var has = false;
    for (var i = 0; i < player.weapons.length; i++) {
      if (player.weapons[i].w.type === 'drone') { has = true; break; }
    }
    if (!has) { if (droneMesh) droneMesh.visible = false; return; }
    if (!droneMesh) {
      droneMesh = new THREE.Group();
      var body = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), GH.assets.mat(0x60c0e0, { emissive: 0x104050 }));
      var fin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.2), GH.assets.mat(0x385868));
      droneMesh.add(body, fin);
      scene.add(droneMesh);
    }
    droneMesh.visible = true;
    droneAngle += dt * 1.6;
    droneMesh.position.set(
      player.x + Math.sin(droneAngle) * 3.2,
      gy(player.x, player.z) + 3.0 + Math.sin(runTime * 2) * 0.2,
      player.z + Math.cos(droneAngle) * 3.2
    );
    droneMesh.rotation.y += dt * 3;
  }

  // ---------- projectile updates ----------
  function updateProjectiles(dt) {
    var i, p2;
    for (i = projectiles.length - 1; i >= 0; i--) {
      p2 = projectiles[i];
      if (!p2) break; // zone swapped mid-frame
      p2.life -= dt;
      // boomerang javelins swing back through the swarm
      if (p2.returning && !p2.returned && p2.life < p2.retAt) {
        p2.returned = true;
        p2.hitSet.length = 0;   // fresh hits on the way home
        p2.pierce = 99;
        var backA = GH.angleTo(p2.x, p2.z, player.x, player.z);
        p2.dirX = Math.sin(backA); p2.dirZ = Math.cos(backA);
      }
      if (p2.returned) {
        var homeA = GH.angleTo(p2.x, p2.z, player.x, player.z);
        p2.dirX = Math.sin(homeA); p2.dirZ = Math.cos(homeA);
        if (GH.dist2(p2.x, p2.z, player.x, player.z) < 1.2) p2.life = 0;
      }
      if (p2.homing > 0) {
        var tgt = nearestEnemy(p2.x, p2.z, 14, p2.hitSet);
        if (tgt) {
          var want = GH.angleTo(p2.x, p2.z, tgt.x, tgt.z);
          var cur = Math.atan2(p2.dirX, p2.dirZ);
          var na = GH.lerpAngle(cur, want, Math.min(1, p2.homing * dt));
          p2.dirX = Math.sin(na); p2.dirZ = Math.cos(na);
        }
      }
      p2.x += p2.dirX * p2.speed * dt;
      p2.z += p2.dirZ * p2.speed * dt;
      p2.mesh.position.set(p2.x, 1.2 + gy(p2.x, p2.z), p2.z);
      p2.mesh.rotation.y = Math.atan2(p2.dirX, p2.dirZ);
      if (!p2.flat) p2.mesh.rotation.x = Math.PI / 2;

      // out-of-bounds cull must track the active battlefield: the arena
      // ring in wave modes, the whole continent on expedition
      var kill = p2.life <= 0 || (expActive
        ? (Math.abs(p2.x) > GH.world.BOUNDS.x + 10 || Math.abs(p2.z) > GH.world.BOUNDS.z + 10)
        : (Math.abs(p2.x) > ARENA_R + 10 || Math.abs(p2.z) > ARENA_R + 10));
      if (!kill) {
        for (var j = 0; j < enemies.length; j++) {
          var e = enemies[j];
          if (e.dead || p2.hitSet.indexOf(e) !== -1) continue;
          var rr = 0.55 + e.def.radius;
          if (GH.dist2(p2.x, p2.z, e.x, e.z) <= rr * rr) {
            if (p2.aoe > 0) {
              explode(p2.x, p2.z, p2.aoe, p2.damage, { inst: p2.inst });
              if (p2.elem) applyElement(e, p2.elem, 1);
              kill = true;
              break;
            }
            damageEnemy(e, p2.damage, { inst: p2.inst, elem: p2.elem });
            p2.hitSet.push(e);
            if (p2.pierce > 0) p2.pierce--;
            else { kill = true; break; }
          }
        }
      }
      if (kill) {
        if (p2.mesh.userData.poolKind) poolPut(p2.mesh);
        else scene.remove(p2.mesh);
        projectiles.splice(i, 1);
      }
    }

    for (i = enemyShots.length - 1; i >= 0; i--) {
      p2 = enemyShots[i];
      if (!p2) break; // zone swapped mid-frame
      p2.life -= dt;
      p2.x += p2.dirX * p2.speed * dt;
      p2.z += p2.dirZ * p2.speed * dt;
      p2.mesh.position.set(p2.x, p2.y + gy(p2.x, p2.z), p2.z);
      var dead = p2.life <= 0;
      if (!dead && GH.dist2(p2.x, p2.z, player.x, player.z) < 0.8 * 0.8) {
        playerDamage(p2.damage, null, 'ballistic');
        if (p2.elem === 'frost') { player.chillT = 1.6; announce('CHILLED', 14); }
        dead = true;
      }
      if (!dead && mate && !mate.down &&
        GH.dist2(p2.x, p2.z, mate.x, mate.z) < 0.8 * 0.8) {
        wingmateDamage(p2.damage);
        dead = true;
      }
      if (dead) {
        poolPut(p2.mesh);
        enemyShots.splice(i, 1);
      }
    }
  }

  function spawnEnemyShot(x, y, z, dirX, dirZ, speed, dmg, elem) {
    var color = elem === 'shock' ? 0x90d0ff : elem === 'frost' ? 0xd8f8ff : elem === 'void' ? 0xc060ff : 0xff4060;
    var m = poolGet('sphere', color);
    m.scale.setScalar(elem === 'void' ? 0.3 : 0.22);
    m.position.set(x, y + gy(x, z), z);
    scene.add(m);
    enemyShots.push({ mesh: m, x: x, y: y, z: z, dirX: dirX, dirZ: dirZ, speed: speed * GH.PACE.enemyShot, damage: dmg, life: 4.5 / GH.PACE.enemyShot, elem: elem });
  }

  // =================================================================
  // PICKUPS
  // =================================================================
  function spawnPickup(type, x, z) {
    if (pickups.length > 160) {
      var old = pickups.shift();
      collectPickup(old, true);
    }
    var mesh;
    if (type === 'spark0') mesh = GH.models.buildSpark(0);
    else if (type === 'spark1') mesh = GH.models.buildSpark(1);
    else if (type === 'spark2') mesh = GH.models.buildSpark(2);
    else if (type === 'heart') mesh = GH.models.buildHeart();
    else if (type.indexOf('gem:') === 0) mesh = GH.models.buildGemDrop(type.slice(4));
    else if (type === 'cipher') mesh = GH.models.buildCipher();
    else if (type === 'cache') mesh = GH.models.buildCache();
    else if (type === 'alloy') mesh = GH.models.buildAlloy();
    else if (type === 'core') mesh = GH.models.buildCore();
    else if (type === 'rune') mesh = GH.attrs.buildRuneMesh();
    else mesh = GH.models.buildCoin();
    mesh.position.set(x, 0.5 + gy(x, z), z);
    scene.add(mesh);
    pickups.push({ type: type, mesh: mesh, x: x, z: z, vx: GH.rand(-2, 2), vz: GH.rand(-2, 2), t: Math.random() * 10 });
  }

  function collectPickup(pk, silent) {
    scene.remove(pk.mesh);
    if (pk.type === 'spark0') sparkGain(1, silent);
    else if (pk.type === 'spark1') sparkGain(3, silent);
    else if (pk.type === 'spark2') sparkGain(10, silent);
    else if (pk.type === 'heart') { player.heal(20); if (!silent) GH.audio.heart(); }
    else if (pk.type.indexOf('gem:') === 0) {
      player.pendingGems.push(pk.type.slice(4));
      announce(GH.gems.types[pk.type.slice(4)].name.toUpperCase() + ' GEM', 20);
      if (!silent) GH.audio.levelup();
    }
    else if (pk.type === 'cipher') {
      startCipher();
      if (!silent) GH.audio.levelup();
    }
    else if (pk.type === 'cache') {
      var loot = GH.progress.openCache();
      coinsRun += loot.salvage;
      if (pk.signal) {
        signalSpot = null;
        var sgPerk = expActive ? GH.worldlife.zonePerk(curZone).alloy : 1;
        grantMats(Math.round((18 + (zoneNow ? zoneNow.danger * 8 : 0)) * sgPerk), zoneNow && zoneNow.danger >= 3 && Math.random() < 0.4 ? 1 : 0, true);
        queueAnnounce('SIGNAL CACHE RECOVERED', 22);
        GH.audio.signal();
        lifeEvent('signals', 1);
        tutorialEvent('signal', 1);
      }
      if (loot.unique) {
        queueAnnounce('CACHE — ' + loot.unique.name.toUpperCase() + ' UNLOCKED', 24);
      } else if (loot.gem) {
        player.pendingGems.push(loot.gem);
        queueAnnounce('CACHE — ' + loot.salvage + ' SALVAGE + A GEM', 22);
      }
      if (!silent) GH.audio.win();
    }
    else if (pk.type === 'alloy') {
      var alN = (GH.rand(1, 3) | 0) || 1;
      if (expActive) alN = Math.round(alN * GH.worldlife.zonePerk(curZone).alloy * GH.worldlife.band().alloy * (1 + (zoneNow ? (zoneNow.danger - 1) * 0.25 : 0)));
      grantMats(alN, 0, silent);
      lifeEvent('alloy', alN);
    }
    else if (pk.type === 'core') { grantMats(0, 1, silent); }
    else if (pk.type === 'rune') {
      // banked at once, like materials; read in the hangar's ATTRIBUTES & ARTS
      GH.attrs.addRunes(1); runesRun++;
      if (!silent) { queueAnnounce('ART RUNE RECOVERED — ' + GH.attrs.runeStock() + ' HELD · READ IT IN THE HANGAR', 22); GH.audio.levelup(); }
    }
    else { coinsRun++; if (!silent) GH.audio.coin(); }
  }

  // workshop materials bank the moment they're picked up (a death never
  // takes them back); cores are rare enough to announce
  var alloyRun = 0, coresRun = 0, runesRun = 0;
  function grantMats(alloy, cores, silent) {
    var m = GH.meta.data.mats;
    if (alloy > 0) { m.alloy += alloy; alloyRun += alloy; if (!silent) GH.audio.coin(); }
    if (cores > 0) {
      m.cores += cores; coresRun += cores;
      if (!silent) { queueAnnounce('FRAME CORE RECOVERED — ' + m.cores + ' BANKED', 22); GH.audio.levelup(); }
    }
    GH.meta.save();
  }
  G.matsRun = function () { return { alloy: alloyRun, cores: coresRun }; };

  // a stage or lair reward: feat frames unlock outright, everything
  // else pays workshop materials toward building it
  function frameReward(shellId) {
    var def = GH.mechById(shellId);
    if (def.kind === 'feat' || GH.roster.STARTERS.indexOf(shellId) !== -1) {
      if (GH.meta.unlockShell(shellId)) return '<b>' + def.name + ' HULK RECOVERED</b> — the hangar has rebuilt it: a new frame is yours.\n';
      return '';
    }
    grantMats(80, 3, true);
    GH.meta.data.feats['reward_' + shellId] = true;
    return '<b>' + def.name + ' BLUEPRINT DATA</b> — +80 alloy, +3 frame cores. Build it in the WORKSHOP.\n';
  }

  function sparkGain(v, silent) {
    if (G.mode !== 'weekly' && GH.progress.hasRelic('gravity')) v *= 1.15;
    if (anyHybrid('quicksilver')) player.boost = Math.min(1, player.boost + 0.02);
    gainXP(v);
    sparksRun += v;
    if (sparksRun >= 40) awardTrial('sparks40');
    seasonAwardNotify(GH.progress.seasonCounter('sparks', v));
    if (!silent) GH.audio.gem();
    // Spark Reactor protocol
    if (player.protocols.reactor && Math.random() < player.protocols.reactor) {
      var t = nearestEnemy(player.x, player.z, 20);
      if (t) {
        var tmp = makeWeaponInst('reactor', {
          type: 'shot', damage: 10, speed: 30, life: 1.0, size: 0.18, color: 0xfff060, spread: 0, count: 1
        });
        fireShot(tmp, player.x, player.z, GH.angleTo(player.x, player.z, t.x, t.z));
      }
    }
  }

  function updatePickups(dt) {
    for (var i = pickups.length - 1; i >= 0; i--) {
      var pk = pickups[i];
      pk.t += dt;
      pk.x += pk.vx * dt; pk.z += pk.vz * dt;
      pk.vx *= Math.pow(0.05, dt); pk.vz *= Math.pow(0.05, dt);
      // magnet toward the nearest pilot; either can collect
      var px2 = player.x, pz2 = player.z;
      var d2 = GH.dist2(pk.x, pk.z, px2, pz2);
      if (mate && !mate.down) {
        var dm = GH.dist2(pk.x, pk.z, mate.x, mate.z);
        if (dm < d2) { d2 = dm; px2 = mate.x; pz2 = mate.z; }
      }
      var mag = player.stats.magnet;
      if (d2 < mag * mag) {
        var d = Math.sqrt(d2) || 0.01;
        var pull = (1 - d / mag) * 26 + 6;
        pk.x += ((px2 - pk.x) / d) * pull * dt;
        pk.z += ((pz2 - pk.z) / d) * pull * dt;
      }
      pk.mesh.position.set(pk.x, gy(pk.x, pk.z) + 0.5 + Math.sin(pk.t * 3) * 0.12, pk.z);
      pk.mesh.rotation.y += dt * 2.5;
      if (pk.mesh.userData.spin) pk.mesh.userData.spin.rotation.y += dt * 3;
      if (d2 < 0.75 * 0.75) {
        collectPickup(pk);
        pickups.splice(i, 1);
      }
    }
  }

  // =================================================================
  // EFFECTS
  // =================================================================
  function spawnBurst(x, y, z, color, n) {
    for (var i = 0; i < n; i++) {
      var m = poolGet('box', color);
      m.scale.setScalar(0.14);
      m.position.set(x, y + gy(x, z), z);
      scene.add(m);
      effects.push({
        kind: 'shard', mesh: m, t: GH.rand(0.3, 0.6),
        vx: GH.rand(-5, 5), vy: GH.rand(2, 7), vz: GH.rand(-5, 5)
      });
    }
  }

  function updateEffects(dt) {
    for (var i = effects.length - 1; i >= 0; i--) {
      var fx = effects[i];
      if (!fx) break; // zone swapped mid-frame
      fx.t -= dt;
      if (fx.kind === 'shard') {
        fx.vy -= 18 * dt;
        fx.mesh.position.x += fx.vx * dt;
        fx.mesh.position.y = Math.max(gy(fx.mesh.position.x, fx.mesh.position.z) + 0.05, fx.mesh.position.y + fx.vy * dt);
        fx.mesh.position.z += fx.vz * dt;
        fx.mesh.rotation.x += dt * 8;
        fx.mesh.rotation.y += dt * 8;
      } else if (fx.kind === 'streak') {
        // speed dust: rips backward past the hull, thins out and dies
        fx.mesh.position.x += fx.vx * dt;
        fx.mesh.position.z += fx.vz * dt;
        fx.mesh.scale.z *= 1 - Math.min(0.9, 4 * dt);
        fx.mesh.scale.x = fx.mesh.scale.y = 0.06 * Math.max(0.2, fx.t / fx.total);
      } else if (fx.kind === 'skidmark') {
        // scorch ribbon: lies where it was laid, shrinking away
        var skk = GH.clamp(fx.t / fx.total, 0, 1);
        fx.mesh.scale.x = fx.sx * (0.3 + skk * 0.7);
      } else if (fx.kind === 'fade') {
        fx.mesh.material.opacity = Math.max(0, fx.t / fx.total) * 0.6;
      } else if (fx.kind === 'fadeSlow') {
        fx.mesh.material.opacity = Math.max(0, fx.t / fx.total) * 0.35;
      } else if (fx.kind === 'sprite') {
        fx.mesh.material.opacity = Math.max(0, fx.t / fx.total);
      } else if (fx.kind === 'boom') {
        var k = 1 - fx.t / fx.total;
        fx.mesh.scale.setScalar(0.4 + k * 2.2);
        fx.mesh.material.opacity = 0.7 * (1 - k);
      } else if (fx.kind === 'telegraph') {
        fx.mesh.material.opacity = 0.25 + Math.sin(runTime * 20) * 0.12;
        if (fx.t <= 0) {
          if (GH.dist2(fx.x, fx.z, player.x, player.z) < fx.radius * fx.radius) {
            playerDamage(fx.damage, null, 'arc');
          }
          if (mate && !mate.down && GH.dist2(fx.x, fx.z, mate.x, mate.z) < fx.radius * fx.radius) {
            wingmateDamage(fx.damage);
          }
          explode(fx.x, fx.z, fx.radius * 0.8, 0);
        }
      } else if (fx.kind === 'lineTele') {
        fx.mesh.material.opacity = 0.3 + Math.sin(runTime * 24) * 0.14;
        if (fx.t <= 0) {
          // beam strike: perpendicular distance from segment
          var relX = player.x - fx.x, relZ = player.z - fx.z;
          var along = relX * Math.sin(fx.angle) + relZ * Math.cos(fx.angle);
          var across = Math.abs(relX * Math.cos(fx.angle) - relZ * Math.sin(fx.angle));
          if (along > 0 && along < fx.len && across < fx.width + 0.5) {
            playerDamage(fx.damage, null, 'arc');
          }
          var beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, fx.len),
            GH.assets.basic(0xff8090, { transparent: true, opacity: 0.9 }));
          beam.position.set(fx.x + Math.sin(fx.angle) * fx.len / 2, 1.2,
            fx.z + Math.cos(fx.angle) * fx.len / 2);
          beam.rotation.y = fx.angle;
          scene.add(beam);
          effects.push({ kind: 'fade', mesh: beam, t: 0.2, total: 0.2 });
          GH.audio.zap();
        }
      } else if (fx.kind === 'pshell') {
        var tt = 1 - fx.t / fx.total;
        var px = GH.lerp(fx.x0, fx.x1, tt);
        var pz = GH.lerp(fx.z0, fx.z1, tt);
        fx.mesh.position.set(px, gy(px, pz) + 1 + Math.sin(tt * Math.PI) * 7, pz);
        if (fx.t <= 0) {
          scene.remove(fx.disc);
          explode(fx.x1, fx.z1, fx.aoe, fx.damage, { inst: fx.inst });
        }
      } else if (fx.kind === 'patch') {
        fx.mesh.material.opacity = 0.15 + Math.sin(runTime * 10) * 0.08;
        if (GH.dist2(fx.x, fx.z, player.x, player.z) < fx.radius * fx.radius) {
          fx.tick = (fx.tick || 0) - dt;
          if (fx.tick <= 0) { fx.tick = 0.5; playerDamage(fx.dps * 0.5 + player.stats.armor, null, 'arc'); }
          if (fx.chill) player.chillT = Math.max(player.chillT || 0, 0.6);
        }
      } else if (fx.kind === 'friendPatch') {
        // artifact trails: scorch the swarm, never the pilot
        fx.mesh.material.opacity = 0.2 + Math.sin(runTime * 10) * 0.08;
        fx.tick = (fx.tick || 0) - dt;
        if (fx.tick <= 0) {
          fx.tick = 0.4;
          for (var fpi = 0; fpi < enemies.length; fpi++) {
            var fpe = enemies[fpi];
            if (fpe.dead) continue;
            if (GH.dist2(fx.x, fx.z, fpe.x, fpe.z) < (fx.radius + fpe.def.radius) * (fx.radius + fpe.def.radius)) {
              damageEnemy(fpe, fx.dps * 0.4 * player.stats.damageMult,
                { canCrit: false, noRes: true, isDot: true, elem: fx.elem });
            }
          }
        }
      } else if (fx.kind === 'ringwaveFx') {
        var rk = 1 - fx.t / fx.total;
        var rr2 = 0.8 + rk * fx.maxR;
        fx.mesh.scale.setScalar(rr2);
        fx.mesh.material.opacity = 0.7 * (1 - rk * 0.7);
        for (var ri = 0; ri < enemies.length; ri++) {
          var re = enemies[ri];
          if (re.dead || fx.hitSet.indexOf(re) !== -1) continue;
          var rd = Math.sqrt(GH.dist2(fx.x, fx.z, re.x, re.z));
          if (Math.abs(rd - rr2) < 0.9 + re.def.radius) {
            fx.hitSet.push(re);
            damageEnemy(re, fx.dmg, { inst: fx.inst, elem: fx.elem });
          }
        }
      } else if (fx.kind === 'vortexFx') {
        fx.mesh.rotation.z += dt * 6;
        fx.mesh.material.opacity = 0.5 + Math.sin(runTime * 12) * 0.2;
        for (var vi = 0; vi < enemies.length; vi++) {
          var ve = enemies[vi];
          if (ve.dead) continue;
          var vd2 = GH.dist2(fx.x, fx.z, ve.x, ve.z);
          if (vd2 < fx.pull * fx.pull && vd2 > 0.2) {
            var vd = Math.sqrt(vd2);
            var vs = 7 / ve.def.mass;
            ve.x += ((fx.x - ve.x) / vd) * vs * dt;
            ve.z += ((fx.z - ve.z) / vd) * vs * dt;
          }
        }
        if (fx.t <= 0) {
          explode(fx.x, fx.z, fx.aoe, fx.dmg, { inst: fx.inst });
        }
      } else if (fx.kind === 'ventEnemies' || fx.kind === 'boltStrike') {
        if (fx.t <= 0) {
          // environmental damage scalds the swarm too
          for (var ei = 0; ei < enemies.length; ei++) {
            var ee = enemies[ei];
            if (ee.dead) continue;
            if (GH.dist2(fx.x, fx.z, ee.x, ee.z) < (fx.r + ee.def.radius) * (fx.r + ee.def.radius)) {
              damageEnemy(ee, fx.dmg, { canCrit: false, noRes: true });
            }
          }
          if (fx.kind === 'boltStrike') {
            var by = gy(fx.x, fx.z);
            drawLightning(fx.x, by + 14, fx.z, fx.x, by + 0.3, fx.z);
            GH.audio.zap();
            shake = Math.min(0.5, shake + 0.15);
          } else {
            spawnBurst(fx.x, 0.6, fx.z, 0xff7030, 10);
          }
        }
      } else if (fx.kind === 'shrub') {
        fx.emitT -= dt;
        if (fx.emitT <= 0) {
          fx.emitT = 0.7;
          spawnPickup('spark0', fx.x + GH.rand(-0.5, 0.5), fx.z + GH.rand(-0.5, 0.5));
        }
      }
      if (fx.t <= 0) {
        if (fx.mesh.userData.poolKind) {
          poolPut(fx.mesh); // pooled meshes share geometry — never dispose it
        } else {
          scene.remove(fx.mesh);
          if (fx.mesh.geometry) fx.mesh.geometry.dispose();
        }
        if (fx.disc) scene.remove(fx.disc);
        effects.splice(i, 1);
      }
    }
  }

  // =================================================================
  // WAVES
  // =================================================================
  function startWave(n) {
    waveNum = n;
    if (n === 10) lifeEvent('wave10', 1);
    wavePlan = GH.wavePlan(stage, n, G.mode !== 'classic');
    // ARENA every ten waves and the GAUNTLET's hunt assault draw a HUNT from this stage's pool
    if (wavePlan.midboss && (G.mode !== 'classic' || n === GH.WAVE_HUNT) && Math.random() < 0.7) {
      var hb2 = GH.bosses.pickFor(stage.id, G.mode === 'classic' ? 2 : Math.min(4, 1 + Math.floor(n / 10)));
      if (hb2) wavePlan.midboss = hb2.id;
    }
    if (weekly) {
      wavePlan.rate *= weekly.mods.rate;
      if (weekly.mods.midbossEvery && n % weekly.mods.midbossEvery === 0 && !wavePlan.midboss) {
        wavePlan.midboss = 'warden';
      }
    }
    waveTimer = wavePlan.duration;
    spawnAcc = 0;
    spawnStageHazards(n);
    if (n >= 5) awardTrial('wave5');
    if (n >= 10) awardTrial('wave10');
    if (mate && mate.down) reviveWingmate(0.5);
    if (wavePlan.overrun) {
      announce('OVERRUN', 44);
    } else {
      announce('WAVE ' + n, 40);
    }
    GH.audio.wave();
    if (wavePlan.boss) spawnEnemy(wavePlan.boss);
    if (wavePlan.midboss) spawnEnemy(wavePlan.midboss);
    updateHUDStatic();
  }

  function updateWave(dt) {
    if (!(bossRef && wavePlan.boss)) {
      spawnAcc += wavePlan.rate * dt;
      while (spawnAcc >= 1) {
        spawnAcc -= 1;
        spawnEnemy(GH.weightedPick(wavePlan.types).id);
      }
    }
    waveTimer -= dt;
    if (waveTimer <= 0) {
      if (bossRef && !bossRef.dead) { waveTimer = 0; return; }
      endWave();
    }
  }

  function endWave() {
    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      scene.remove(e.mesh);
      if (Math.random() < 0.35) spawnPickup('spark0', e.x, e.z);
    }
    enemies.length = 0;
    bossRef = null;
    GH.music.setBoss(false);
    hideBossBar();
    for (i = enemyShots.length - 1; i >= 0; i--) scene.remove(enemyShots[i].mesh);
    enemyShots.length = 0;

    GH.meta.save(); // persist run tracking each wave, not only at run end

    if (G.mode === 'classic' && waveNum >= GH.WAVES) {
      gameOver(true);
      return;
    }
    showRewards();
  }

  // =================================================================
  // REWARD SCREEN (cards + gem socketing)
  // =================================================================
  var rewardQueue = [];

  function showRewards() {
    // every third wave hands out parts; dropped gems still need socketing
    var cards = (waveNum % 3 === 0) ? GH.rollRewards(player, waveNum, 3) : null;
    if (player.pendingGems.length === 0 && !cards) {
      startWave(waveNum + 1);
      updateHUDStatic();
      return;
    }
    G.state = 'reward';
    rewardQueue = [];
    document.getElementById('reward-heading').innerHTML = cards ? 'WAVE&nbsp;SALVAGE' : 'SOCKET&nbsp;GEM';
    if (cards) rewardQueue.push({ cards: cards });
    player.pendingGems.forEach(function (t) { rewardQueue.push({ gemType: t }); });
    player.pendingGems = [];
    document.getElementById('reward-screen').classList.remove('hidden');
    nextRewardStep();
  }

  function nextRewardStep() {
    var step = rewardQueue.shift();
    if (!step) {
      document.getElementById('reward-screen').classList.add('hidden');
      G.state = 'play';
      if (expActive) {
        // back into the open world — no wave restart
        saveExpedition();
        updateHUDStatic();
        return;
      }
      startWave(waveNum + 1);
      updateHUDStatic();
      return;
    }
    if (step.gemType) renderSocketPicker(step.gemType, true);
    else renderCards(step.cards);
  }

  function renderCards(cards) {
    var wrap = document.getElementById('reward-cards');
    var sub = document.getElementById('reward-sub');
    sub.textContent = 'Choose one upgrade';
    wrap.innerHTML = '';
    cards.forEach(function (card, i) {
      var lvl = player.weaponLevels[card.id] || 0;
      var kindLabel =
        card.kind === 'weapon' ? ((card.cls || 'WEAPON') + (lvl ? ' · LVL ' + (lvl + 1) : '')) :
        card.kind === 'gem' ? 'GEM' :
        card.kind === 'protocol' ? 'PROTOCOL' : 'TRAIT';
      var div = document.createElement('div');
      div.className = 'reward-card ' + (card.rarity || '');
      div.innerHTML =
        '<div class="rc-kind">' + kindLabel + '</div>' +
        '<div class="rc-glyph">' + card.glyph + '</div>' +
        '<div class="rc-name">' + card.name + '</div>' +
        '<div class="rc-desc">' + card.desc.replace(/\n/g, '<br>') + '</div>' +
        '<div class="rc-key">[' + (i + 1) + ']</div>';
      div.onclick = function () { pickReward(card); };
      wrap.appendChild(div);
    });
    G._rewardCards = cards;
  }

  function pickReward(card) {
    GH.audio.card();
    G._rewardCards = null;
    if (card.kind === 'trait' || card.kind === 'protocol') {
      card.apply(player);
      var tp = GH.meta.data.traitPicks;
      tp[card.id] = (tp[card.id] || 0) + 1;
    } else if (card.kind === 'gem') {
      renderSocketPicker(card.gemType, false);
      return; // socketing continues this step
    } else {
      var lvl = player.weaponLevels[card.id] || 0;
      if (lvl === 0) {
        player.weapons.push(makeWeaponInst(card.id, card.weapon));
        if (GH.progress.logWeapon(card.id)) GH.meta.save();
      } else {
        for (var i = 0; i < player.weapons.length; i++) {
          if (player.weapons[i].id === card.id) {
            card.perLevel(player.weapons[i].w);
            GH.gems.applySocketBonuses(player.weapons[i]);
          }
        }
      }
      player.weaponLevels[card.id] = lvl + 1;
    }
    nextRewardStep();
  }

  function weaponDisplayName(inst) {
    if (inst.isPrimary) return inst.w.name || 'Primary';
    for (var j = 0; j < GH.upgrades.length; j++) {
      if (GH.upgrades[j].id === inst.id) return GH.upgrades[j].name;
    }
    return inst.id;
  }

  function renderSocketPicker(gemType, fromDrop) {
    var t = GH.gems.types[gemType];
    var wrap = document.getElementById('reward-cards');
    var sub = document.getElementById('reward-sub');
    sub.innerHTML = 'Socket the <span style="color:' + t.css + '">' + t.name.toUpperCase() +
      ' GEM</span> (' + t.bonusText + ') into a weapon' + (fromDrop ? ' — boss trophy' : '');
    wrap.innerHTML = '';
    var any = false;
    player.weapons.forEach(function (inst, i) {
      if (inst.sockets.length >= 4) return;
      any = true;
      var div = document.createElement('div');
      div.className = 'reward-card socket-card';
      var dots = '';
      for (var d = 0; d < 4; d++) {
        var g = inst.sockets[d];
        dots += '<span class="socket-dot" style="' +
          (g ? 'background:' + GH.gems.types[g].css + ';border-color:#fff' : '') + '"></span>';
      }
      var resPreview = '';
      if (inst.sockets.length === 3) {
        var cls = GH.gems.classify(inst.sockets.concat([gemType]));
        resPreview = '<div class="rc-res">→ ' + GH.gems.resonanceLabel(cls) + '</div>';
      } else if (inst.resonance) {
        resPreview = '<div class="rc-res">' + GH.gems.resonanceLabel(inst.resonance) + '</div>';
      }
      div.innerHTML =
        '<div class="rc-kind">' + (inst.w.cls || 'WEAPON') + '</div>' +
        '<div class="rc-glyph">' + (inst.isPrimary ? '★' : '⬦') + '</div>' +
        '<div class="rc-name">' + weaponDisplayName(inst) + '</div>' +
        '<div class="rc-sockets">' + dots + '</div>' +
        resPreview +
        '<div class="rc-key">[' + (i + 1) + ']</div>';
      div.onclick = function () { socketGem(inst, gemType); };
      wrap.appendChild(div);
    });
    if (!any) {
      var skip = document.createElement('div');
      skip.className = 'reward-card';
      skip.innerHTML = '<div class="rc-kind">ALL SOCKETS FULL</div><div class="rc-glyph">✕</div>' +
        '<div class="rc-name">Scrap the gem</div><div class="rc-desc">+15 salvage</div>';
      skip.onclick = function () { coinsRun += 15; GH.audio.coin(); nextRewardStep(); };
      wrap.appendChild(skip);
    }
    G._socketChoices = { gemType: gemType };
  }

  function socketGem(inst, gemType) {
    inst.sockets.push(gemType);
    GH.gems.applySocketBonuses(inst);
    GH.progress.logGem(gemType);
    GH.audio.levelup();
    if (inst.sockets.length === 4 && inst.resonance) {
      announce(GH.gems.resonanceLabel(inst.resonance) + ' RESONANCE', 26);
      GH.progress.logResonance(GH.gems.resonanceLabel(inst.resonance));
      awardTrial('resonance');
      seasonAwardNotify(GH.progress.seasonCounter('resonances', 1));
    }
    GH.meta.save();
    G._socketChoices = null;
    nextRewardStep();
  }

  G.pickRewardIndex = function (i) {
    if (G.state !== 'reward') return;
    if (G._rewardCards && G._rewardCards[i]) { pickReward(G._rewardCards[i]); return; }
    if (G._socketChoices) {
      var open = player.weapons.filter(function (w2) { return w2.sockets.length < 4; });
      if (open[i]) socketGem(open[i], G._socketChoices.gemType);
    }
  };

  // =================================================================
  // SPECIALS / BOOST
  // =================================================================
  function tryBoost() {
    var cost = player.stats.boostCost;
    if (player.boost < cost) return;
    player.boost -= cost;
    var mx = player.moveX, mz = player.moveZ;
    if (mx === 0 && mz === 0) { mx = Math.sin(player.facing); mz = Math.cos(player.facing); }
    var len = Math.sqrt(mx * mx + mz * mz);
    player.dashX = mx / len; player.dashZ = mz / len;
    player.dashTime = 0.22;
    player.dashId++;
    player.dashKind = 'boost';
    GH.audio.dash();
    spawnBurst(player.x, 0.6, player.z, player.trailColor || 0xa0c8ff, 6);
    // a dash shakes leeches and skitters loose
    for (var li = 0; li < enemies.length; li++) {
      var le = enemies[li];
      if (le.dead || le.def.behavior !== 'latcher') continue;
      if (GH.dist2(player.x, player.z, le.x, le.z) < 2.4 * 2.4) {
        le.stun = 1.0;
        var la = GH.angleTo(player.x, player.z, le.x, le.z);
        le.vx += Math.sin(la) * 12 / le.def.mass; le.vz += Math.cos(la) * 12 / le.def.mass;
      }
    }
    if (cipherRun) cipherRun.boosts++;
    // artifact-charged boosts
    if (artOn('stormcap')) {
      var zapped = 0;
      for (var zi = 0; zi < enemies.length && zapped < 3; zi++) {
        var ze = enemies[zi];
        if (ze.dead) continue;
        if (GH.dist2(player.x, player.z, ze.x, ze.z) < 64) {
          drawLightning(player.x, 1.6, player.z, ze.x, 1.2, ze.z);
          damageEnemy(ze, 9 * player.stats.damageMult, { canCrit: false, elem: 'shock' });
          zapped++;
        }
      }
      if (zapped) GH.audio.zap();
    }
    if (artOn('cinder_heart')) {
      effects.push({ kind: 'friendPatch', x: player.x, z: player.z, t: 2.5,
        radius: 1.4, dps: 8, elem: 'burn',
        mesh: groundDisc(player.x, player.z, 1.4, 0xff6020, 0.28) });
    }
    if (artOn('trace_emblem')) {
      effects.push({ kind: 'friendPatch', x: player.x, z: player.z, t: 3.5,
        radius: 1.1, dps: 12, elem: 'shock',
        mesh: groundDisc(player.x, player.z, 1.1, 0x60c8ff, 0.34) });
    }
    // FANG frenzy stacks / VIPER edge
    if (player.def.passive === 'frenzy') {
      player.frenzy.push(4);
      if (player.frenzy.length > 5) player.frenzy.shift();
    }
    if (player.def.passive === 'edge') player.edgeT = 2;
  }

  function trySpecial() {
    var sp = player.special;
    var kind = player.def.special;
    if (kind === 'block') return;
    if (sp.cd > 0) return;
    if (kind === 'overdrive') { sp.cd = 9; sp.active = 3; announce('OVERDRIVE', 20); }
    else if (kind === 'nova') {
      sp.cd = 7;
      var elem = currentElement(player.weapons[0]);
      var color = elem && GH.elements[elem] ? GH.elements[elem].color : 0x50e8d8;
      GH.audio.explode();
      spawnBurst(player.x, 1, player.z, color, 16);
      var m = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.9, 24),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(player.x, 0.3 + gy(player.x, player.z), player.z);
      scene.add(m);
      effects.push({ kind: 'boom', mesh: m, t: 0.3, total: 0.3, grow: 6 });
      for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (e.dead) continue;
        if (GH.dist2(player.x, player.z, e.x, e.z) < 49) {
          var a = GH.angleTo(player.x, player.z, e.x, e.z);
          e.vx += Math.sin(a) * 16 / e.def.mass;
          e.vz += Math.cos(a) * 16 / e.def.mass;
          damageEnemy(e, 10 * player.stats.damageMult, { canCrit: false, elem: elem });
        }
      }
    }
    else if (kind === 'frenzy') { sp.cd = 9; sp.active = 4; announce('FRENZY', 20); }
    else if (kind === 'lunge') {
      sp.cd = 3.5;
      var mx = player.moveX, mz = player.moveZ;
      if (mx === 0 && mz === 0) { mx = Math.sin(player.facing); mz = Math.cos(player.facing); }
      var len = Math.sqrt(mx * mx + mz * mz);
      player.dashX = mx / len; player.dashZ = mz / len;
      player.dashTime = 0.2;
      player.dashId++;
      player.dashKind = 'lunge';
      GH.audio.dash();
      if (player.def.passive === 'frenzy') {
        player.frenzy.push(4);
        if (player.frenzy.length > 5) player.frenzy.shift();
      }
    }
    else if (kind === 'blink') {
      sp.cd = 4;
      var mx2 = player.moveX, mz2 = player.moveZ;
      if (mx2 === 0 && mz2 === 0) { mx2 = Math.sin(player.facing); mz2 = Math.cos(player.facing); }
      var len2 = Math.sqrt(mx2 * mx2 + mz2 * mz2);
      spawnBurst(player.x, 1, player.z, 0xf05060, 8);
      player.x = GH.clamp(player.x + mx2 / len2 * 6.5, -ARENA_R, ARENA_R);
      player.z = GH.clamp(player.z + mz2 / len2 * 6.5, -ARENA_R, ARENA_R);
      player.dashTime = 0.15; // brief i-frames on arrival
      spawnBurst(player.x, 1, player.z, 0xf05060, 8);
      GH.audio.dash();
      if (player.def.passive === 'edge') player.edgeT = 2;
    }
    else if (kind === 'bulwark') {
      sp.cd = 10; sp.active = 4;
      announce('BULWARK', 20);
      GH.audio.block();
    }
  }

  // =================================================================
  // SKIMMER DRIVING — the Underground lessons, played top-down:
  // heading and velocity are separate things; holding SPACE drops the
  // lateral grip so the tail steps out (drift); time spent sideways at
  // speed banks nitro; SHIFT burns the bottle; a wall dumps your speed
  // AND everything you banked. Speed is drawn, not stated: FOV pull,
  // world streaks, skid ribbons, camera shake.
  // =================================================================
  function approachAngle(a, b, maxStep) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (d > maxStep) d = maxStep;
    if (d < -maxStep) d = -maxStep;
    return a + d;
  }

  // a fresh drivetrain: heading picks up the frame's facing, tank empty
  function freshDrive() {
    return {
      heading: player.facing || 0, spd: 0, nitro: 0, nitroT: 0,
      slip: 0, fwd: 0, top: 1, drift: false, crashCd: 0,
      skidT: 0, streakT: 0, score: 0,
      // drift state: time in the slide, charge tier, cooldown after a release,
      // how long the wheel has been straight, turbo left from the last release
      driftT: 0, driftTier: 0, driftCd: 0, straightT: 0, turboT: 0, driftHeat: 0,
      air: false, hgt: 0, vy: 0, airT: 0, nitroJump: 0, bog: 0, bogMsg: false, offTrack: false, jumpMsgT: 0
    };
  }

  function updateDrive(dt, input, spd, onIce) {
    var d = player.drive;
    if (!d || d.bog === undefined) d = player.drive = freshDrive();
    player.dashTime = 0; // no frame-dash on the throttle
    var V = GH.VECTORS[player.vec.kind] || GH.VECTORS.bike;
    var top = spd * 3.3 * V.top;
    // the bottle: SHIFT burns while there's charge
    var wantNitro = !!input.special && d.nitro > 0.03 && !d.air;
    if (wantNitro) {
      d.nitro = Math.max(0, d.nitro - 0.38 * dt);
      d.nitroT = 0.12;
    } else {
      d.nitroT = Math.max(0, d.nitroT - dt);
    }
    var nitroOn = d.nitroT > 0;
    if (nitroOn) top *= 1.5;
    var hasInput = player.moveX !== 0 || player.moveZ !== 0;
    var steerIn = 0; // -1..1, filled by whichever steering model runs below
    var T = GH.terrain;
    var fx0 = Math.sin(d.heading), fz0 = Math.cos(d.heading);
    // the ground ahead: how steep, how soft, what it is
    var slope = T.active ? T.slope(player.x, player.z, fx0, fz0) : 0;
    var soft = T.active ? T.soft(player.x, player.z) : 0;
    var surf = T.active ? T.surface(player.x, player.z) : null;
    var authority = d.air ? 0.25 : 1;
    var mmo = input.mmoDrive;
    if (mmo) {
      // MMO wheel: A/D steer the skids, W opens the throttle, S brakes
      var sfM = GH.clamp(Math.abs(d.spd) / Math.max(0.01, top), 0, 1);
      var turnM = (d.drift ? 3.8 : 2.6 - sfM * 1.1) * dt * authority;
      // a standing skimmer still pivots, just slower
      steerIn = mmo.steer;
      if (mmo.steer) d.heading -= mmo.steer * turnM * (d.spd < -0.5 ? -1 : 1) * (Math.abs(d.spd) < 1 ? 0.6 : 1);
      if (mmo.thr > 0.05 && !d.air) {
        d.spd = Math.min(top, d.spd + (nitroOn ? 40 : 22) * V.accel * mmo.thr * dt);
      } else if (mmo.thr < -0.05) {
        if (d.spd > 1.5) d.spd = Math.max(0, d.spd - 34 * dt);
        else d.spd = Math.max(-top * 0.22, d.spd - 14 * dt);
      } else {
        d.spd = d.spd > 0 ? Math.max(0, d.spd - (d.drift ? 6 : 12) * dt) : Math.min(0, d.spd + 12 * dt);
      }
    } else if (hasInput) {
      var want = Math.atan2(player.moveX, player.moveZ);
      var speedFrac = GH.clamp(Math.abs(d.spd) / Math.max(0.01, top), 0, 1);
      // grip narrows the wheel at speed; a drift throws it wide open
      var turn = (d.drift ? 3.8 : 2.6 - speedFrac * 1.1) * dt * authority;
      var wdiff = Math.atan2(Math.sin(want - d.heading), Math.cos(want - d.heading));
      steerIn = GH.clamp(-wdiff / 0.8, -1, 1);
      d.heading = approachAngle(d.heading, want, turn);
      var dot = Math.sin(d.heading) * player.moveX + Math.cos(d.heading) * player.moveZ;
      if (dot < -0.55 && d.spd > 1.5) {
        d.spd = Math.max(0, d.spd - 34 * dt); // stand on the brakes
      } else if (dot < -0.55) {
        d.spd = Math.max(-top * 0.22, d.spd - 14 * dt); // reverse gear
      } else if (!d.air) {
        d.spd = Math.min(top, d.spd + (nitroOn ? 40 : 22) * V.accel * dt);
      }
    } else {
      d.spd = d.spd > 0 ? Math.max(0, d.spd - (d.drift ? 6 : 12) * dt) : Math.min(0, d.spd + 12 * dt);
    }
    // ---- the drift, arcade rules (Underground entry, Ridge Racer exit, Kart turbo) ----
    // Entry: hold the drift button while steering at speed. The tail steps
    // out with a lateral kick. Sustain: the slide charges a turbo through
    // three tiers (0.8 / 1.8 / 2.8 s) and scrubs speed the whole time.
    // Exit: let go, straighten the wheel for a quarter second, hit a wall,
    // run out of speed, or cook the skids past 3.4 s (forced release).
    // Every exit pays the charged turbo and starts a short cooldown, so a
    // held button can never slide forever.
    d.driftCd = Math.max(0, d.driftCd - dt);
    d.turboT = Math.max(0, d.turboT - dt);
    // seat time counts for the diaries and the daily board
    d.lifeT = (d.lifeT || 0) + dt;
    if (d.lifeT >= 5) { lifeEvent('driveT', d.lifeT); d.lifeT = 0; }
    d.driftHeat = Math.max(0, d.driftHeat - dt * 0.5);
    var wantDrift = !!input.boostHeld && !d.air && d.driftCd <= 0 && d.driftHeat < 0.5;
    if (!d.drift) {
      if (wantDrift && d.spd > top * 0.35 && Math.abs(steerIn) > 0.25) {
        d.drift = true; d.driftT = 0; d.driftTier = 0; d.straightT = 0;
        d.spd *= 0.95;
        // lateral kick toward the outside of the turn
        var kick = 0.32 * d.spd * steerIn;
        player.velX += Math.cos(d.heading) * kick;
        player.velZ += -Math.sin(d.heading) * kick;
        GH.audio.dash();
      }
    } else {
      d.driftT += dt;
      d.driftTier = d.driftT > 2.8 ? 3 : d.driftT > 1.8 ? 2 : d.driftT > 0.8 ? 1 : 0;
      d.spd = Math.max(0, d.spd - (3.5 + d.slip * 0.25) * dt); // the slide scrubs speed
      // a straight wheel with a settled tail snaps back into grip
      if (Math.abs(steerIn) < 0.15 && d.slip < 1.0) d.straightT += dt; else d.straightT = 0;
      var cooked = d.driftT > 3.4;
      var release = !input.boostHeld || d.air || d.straightT > 0.25 || d.spd < top * 0.18 || d.crashCd > 0.9 || cooked;
      if (release) {
        d.drift = false;
        d.driftCd = cooked ? 0.9 : 0.35;
        if (cooked) d.driftHeat = 1;
        if (d.driftTier > 0 && d.crashCd <= 0.9) {
          // mini-turbo: the charged slide pays out on release
          var tb = [0, 0.5, 1.0, 1.6][d.driftTier];
          d.turboT = tb;
          d.boostT = Math.max(d.boostT || 0, tb);
          d.spd = Math.min(top * 1.35, d.spd + top * [0, 0.15, 0.25, 0.35][d.driftTier]);
          d.nitro = Math.min(1, d.nitro + [0, 0.06, 0.12, 0.2][d.driftTier]);
          announce(['', 'TURBO', 'SUPER TURBO', 'ULTRA TURBO'][d.driftTier], 16 + d.driftTier * 2);
          lifeEvent('drift', 1);
          tutorialEvent('drift', 1);
          GH.audio.turbo(d.driftTier);
          spawnBurst(player.x, 0.4, player.z, [0, 0x70c0ff, 0xffa020, 0xc060ff][d.driftTier], 6 + d.driftTier * 4);
          GH.audio.dash();
        }
        d.driftT = 0; d.driftTier = 0;
      }
    }
    // gravity works along the slope: climbs bleed speed, descents lend it
    if (!d.air && T.active) {
      d.spd -= slope * 15 * dt;
      d.spd = GH.clamp(d.spd, -top * 0.22, top * (d.boostT > 0 ? 1.35 : 1.08));
      // sheer rock is a wall
      if (slope > 1.0 && soft < 0.5 && d.spd > 3) d.spd = 3;
    }
    var gNow = T.h(player.x, player.z);
    // the ground fell away (a cliff, a ramp end, the edge of an island)
    if (!d.air && d.groundY !== undefined && d.groundY - gNow > 1.2 && Math.abs(d.fwd) > 1.5) {
      d.air = true; d.hgt = d.groundY - gNow; d.absY = d.groundY; d.vy = 0; d.airT = 0;
      if (nitroOn) { d.vy += 3.5 * V.jump; d.nitroJump = 0.45; }
    }
    // boost pads on the asphalt
    d.boostCd = Math.max(0, (d.boostCd || 0) - dt);
    d.boostT = Math.max(0, (d.boostT || 0) - dt);
    if (T.active && T.active.track && !d.air) {
      var tsb = T.trackSample(T.active.track, player.x, player.z);
      if (tsb.on && tsb.boost && d.boostCd <= 0) {
        d.boostCd = 1.4; d.boostT = 1.6;
        d.spd = Math.min(top * 1.35, Math.max(d.spd, top * 0.6) + 14);
        d.nitro = Math.min(1, d.nitro + 0.2);
        announce('BOOST', 16);
        spawnBurst(player.x, 0.4, player.z, 0xffa020, 10);
        GH.audio.dash();
      }
    }
    // a gale over the sky court shoves anything on skids
    if (weatherNow && weatherNow.id === 'gale' && !d.air) {
      player.velX += Math.sin(runTime * 0.6) * 9 * dt;
      player.velZ += Math.cos(runTime * 0.45) * 9 * dt;
    }
    // soft ground on a steep face: blast over it with momentum, or bog down
    var steepSoft = !d.air && soft > 0.5 && slope > 0.26 && !V.hover;
    if (steepSoft) {
      if (d.fwd > top * 0.58) {
        d.air = true; d.hgt = 0.02; d.absY = gNow + 0.02; d.airT = 0;
        d.vy = Math.max(5, d.fwd * slope * 1.05) * V.jump * (nitroOn ? 1.35 : 1);
        if (nitroOn) d.nitroJump = 0.45;
        if (d.jumpMsgT <= 0) { d.jumpMsgT = 6; announce(surf === 'snow' ? 'DRIFT JUMP' : 'DUNE JUMP', 18); }
        GH.audio.dash();
      } else if (d.fwd < top * 0.48 && d.spd > 0) {
        d.bog = Math.min(1, d.bog + dt * 2.6);
      }
    }
    // the crest: leave the ground when it falls away under speed
    // (nitro launches off gentler crests, and launches them higher)
    if (!d.air && T.active && slope < (nitroOn ? -0.3 : -0.42) && d.fwd > top * 0.7) {
      d.air = true; d.hgt = 0.02; d.absY = gNow + 0.02; d.airT = 0;
      d.vy = nitroOn ? 4.5 * V.jump : 0.5;
      if (nitroOn) { d.nitroJump = 0.45; announce('NITRO JUMP', 18); }
    }
    d.jumpMsgT = Math.max(0, d.jumpMsgT - dt);
    if (d.bog > 0) {
      // dug in: forward is a crawl, reversing digs you out
      if (d.spd > 0) d.spd = Math.min(d.spd, top * 0.1);
      if (d.spd < 0) d.bog = Math.max(0, d.bog - dt * 1.6);
      if (!steepSoft) d.bog = Math.max(0, d.bog - dt * 0.7);
      if (d.bog > 0.5 && !d.bogMsg) {
        d.bogMsg = true;
        announce((surf === 'snow' ? 'SNOWBOUND' : 'BOGGED DOWN') + ' — REVERSE TO DIG OUT', 20);
        GH.audio.hit();
      }
      if (Math.random() < 0.5) {
        spawnBurst(player.x - fx0 * 1.2, 0.2, player.z - fz0 * 1.2, surf === 'snow' ? 0xf0f4ff : 0xd8c090, 2);
      }
    } else d.bogMsg = false;
    // airborne: ballistic, barely steerable, and it lands hard
    if (d.air) {
      d.airT += dt;
      // the bottle keeps burning in the air: lift for the first half second
      // of a nitro launch, and thrust that holds the forward speed
      if (nitroOn && d.nitroJump > 0) { d.vy += 9 * V.jump * dt; d.nitroJump -= dt; }
      if (nitroOn) d.spd = Math.min(top, d.spd + 6 * dt);
      d.vy -= T.gravity() * (V.glide ? 0.55 : 1) * dt;
      d.absY += d.vy * dt;
      d.hgt = d.absY - gNow;
      if (d.hgt <= 0) {
        d.air = false; d.hgt = 0; d.nitroJump = 0;
        if (d.airT > 1.2) { d.nitro = Math.min(1, d.nitro + 0.1); announce('BIG AIR', 18); }
        var impact = Math.min(0.5, Math.abs(d.vy) * 0.03);
        shake = Math.min(0.6, shake + impact);
        spawnBurst(player.x, 0.2, player.z, surf === 'snow' ? 0xf0f4ff : 0xd8c090, 8);
        if (d.vy < -14) { d.spd *= 0.8; announce('HARD LANDING', 16); }
        d.vy = 0;
        GH.audio.hit();
      }
    }
    // water and lava under the skids: hydroplane, scald
    if (surf === 'water' && !V.hover) { onIce = true; d.spd = Math.min(d.spd, top * 0.7); }
    if (surf === 'lava') {
      player.lavaT = (player.lavaT || 0) - dt;
      if (player.lavaT <= 0) {
        player.lavaT = 0.5;
        playerDamage(5 + (zoneNow ? zoneNow.danger * 3 : 3), null, 'arc');
        spawnBurst(player.x, 0.3, player.z, 0xff6020, 5);
      }
    }
    // races: leaving the asphalt costs speed
    d.offTrack = false;
    if (dungeonState && dungeonState.race && worldH && worldH.layout.raceway && !d.air) {
      var rwL = worldH.layout.raceway;
      if (T.trackDistance(rwL, player.x, player.z) > (rwL.width || 14) * 0.5 + 1.2) {
        d.offTrack = true;
        d.spd -= d.spd * 1.1 * dt;
      }
    }
    // decompose velocity: forward chases the throttle, lateral bleeds by grip
    var fx = fx0, fz = fz0;
    var fwd = player.velX * fx + player.velZ * fz;
    var latX = player.velX - fx * fwd, latZ = player.velZ - fz * fwd;
    var grip = d.drift ? 1.5 * V.driftGrip : (onIce ? 2.4 : 7.5 * V.grip);
    if (d.air) grip = 0.6;
    var gk = Math.min(1, grip * dt);
    latX -= latX * gk;
    latZ -= latZ * gk;
    fwd += (d.spd - fwd) * Math.min(1, (d.air ? 1.5 : 9) * dt);
    player.velX = fx * fwd + latX;
    player.velZ = fz * fwd + latZ;
    d.slip = Math.sqrt(latX * latX + latZ * latZ);
    d.fwd = fwd;
    d.top = top;
    d.crashCd = Math.max(0, d.crashCd - dt);
    // sideways at speed banks nitro — the Underground loop
    if (d.drift && d.slip > 2 && fwd > top * 0.3) {
      d.nitro = Math.min(1, d.nitro + 0.28 * dt);
      var styleGain = d.slip * dt * 2;
      d.score += styleGain;
      if (dungeonState && dungeonState.race) {
        dungeonState.race.style = (dungeonState.race.style || 0) + styleGain;
      }
    }
    // air time pays too
    if (d.air && d.hgt > 1.5) d.nitro = Math.min(1, d.nitro + 0.12 * dt);
    d.groundY = gNow;
  }

  // =================================================================
  // PLAYER UPDATE
  // =================================================================
  function updatePlayer(dt, input) {
    var s = player.stats;
    G._mouseNDC = input.mouseNDC;
    // the aim plane follows the ground under the frame
    groundPlane.constant = -gy(player.x, player.z);

    // T: fold between frame and skimmer form — a true combat transform.
    // Skimmer: 2.6x speed, ram hits, its own strafe cannons, +25% damage taken.
    if (input.transformPressed) {
      input.transformPressed = false;
      if (dungeonState && dungeonState.carrying && !player.speederOn) {
        announce('SERVOS LOADED — CANNOT TRANSFORM', 18);
        GH.audio.hit();
      } else {
        toggleSpeeder();
      }
    }

    // CHASE camera, MMO rules: A/D turn the frame and the camera together,
    // a held right mouse button drags the view, the wheel zooms. The
    // frame always faces where the camera looks.
    var chaseNow = camMode === 'chase';
    var turnAxis = 0;
    var sens = GH.controls.settings.sens || 1;
    if (chaseNow) {
      turnAxis = (input.keys.d ? 1 : 0) - (input.keys.a ? 1 : 0);
      if (input.padAimActive) turnAxis += input.padAimX;
      else if (input.touchAimActive) turnAxis += input.touchAimX;
      turnAxis = GH.clamp(turnAxis, -1, 1);
      camYaw -= turnAxis * 2.8 * dt;
      if (input.lookDX) { camYaw -= input.lookDX * 0.0045 * sens; }
      if (input.lookDY) {
        camPitch += input.lookDY * 0.003 * sens * (GH.controls.settings.invertY ? -1 : 1);
        camPitch = GH.clamp(camPitch, -0.55, 0.75);
      }
      if (input.zoomDelta) camDist = GH.clamp(camDist + input.zoomDelta * 0.12, 0.55, 1.9);
    }
    if (tutorial) tutorial.lookAcc += Math.abs(input.lookDX) + Math.abs(input.lookDY);
    input.lookDX = 0; input.lookDY = 0; input.zoomDelta = 0;
    input.mmoDrive = null;
    if (chaseNow && !player.speederOn) {
      player.facing = camYaw;
    } else if (chaseNow) {
      // skimmer form: W throttle, S brake/reverse, A/D steer the skids
      var thr = (input.keys.w ? 1 : 0) - (input.keys.s ? 1 : 0) - (input.padMoveY + input.touchMoveY);
      input.mmoDrive = { thr: GH.clamp(thr, -1, 1), steer: GH.clamp(turnAxis + input.padMoveX + input.touchMoveX, -1, 1) };
    } else if (input.padAimActive) {
      player.facing = Math.atan2(input.padAimX, input.padAimY);
    } else if (input.touchAimActive) {
      player.facing = Math.atan2(input.touchAimX, input.touchAimY);
    } else {
      raycaster.setFromCamera(input.mouseNDC, camera);
      if (raycaster.ray.intersectPlane(groundPlane, tmpV3)) {
        player.facing = GH.angleTo(player.x, player.z, tmpV3.x, tmpV3.z);
      }
    }

    var mx, mz;
    if (chaseNow) {
      // view-relative: W walks where the camera looks, Q/E sidestep
      mx = (input.keys.e ? 1 : 0) - (input.keys.q ? 1 : 0) + input.padMoveX + input.touchMoveX;
      mz = (input.keys.s ? 1 : 0) - (input.keys.w ? 1 : 0) + input.padMoveY + input.touchMoveY;
      var yr = camYaw - Math.PI, cyr = Math.cos(yr), syr = Math.sin(yr);
      var rmx = mx * cyr + mz * syr, rmz = -mx * syr + mz * cyr;
      mx = rmx; mz = rmz;
      if (player.speederOn && input.mmoDrive) {
        // the drivetrain reads throttle/steer directly; moveX/Z only
        // tells the rest of the sim which way the nose is pointing
        var hd = player.drive ? player.drive.heading : player.facing;
        mx = Math.sin(hd) * input.mmoDrive.thr; mz = Math.cos(hd) * input.mmoDrive.thr;
      }
    } else {
      mx = (input.keys.d ? 1 : 0) - (input.keys.a ? 1 : 0) + (input.keys.e ? 1 : 0) - (input.keys.q ? 1 : 0) + input.padMoveX + input.touchMoveX;
      mz = (input.keys.s ? 1 : 0) - (input.keys.w ? 1 : 0) + input.padMoveY + input.touchMoveY;
    }
    if (input.itemPressed) { input.itemPressed = false; useItem(); }
    if (player.shieldT > 0) player.shieldT -= dt;
    var len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0.001) {
      var nlen = Math.max(1, len);
      player.moveX = mx / nlen; player.moveZ = mz / nlen;
    } else { player.moveX = 0; player.moveZ = 0; }

    player.blocking = player.def.special === 'block' && input.special && !player.speederOn;

    var spd = s.speed * GH.PACE.moveSpd * (player.blocking ? 0.55 : 1) * (player.sigKind === 'siege' ? 0.02 : 1);
    if (player.protocols.vents && player.hp < s.maxHP * 0.35) spd *= 1.2;
    if (artOn('circuit_laurel')) spd *= 1.08;
    // a shouldered power core weighs on the servos
    if (dungeonState && dungeonState.carrying) spd *= 0.8;
    // race servos: a walker on the circuit sprints, so a hairpin can be taken on foot
    var inRace = !!(dungeonState && dungeonState.race);
    if (inRace && !player.speederOn) spd *= 1.5;

    // hazards underfoot: vines snare, ice steals traction
    if (inHazard('vines', player.x, player.z)) spd *= 0.65;
    var onIce = !!inHazard('ice', player.x, player.z);
    // the ground itself: frozen lakes, ponds, mud, lava
    var surf = GH.terrain.surface(player.x, player.z);
    if (surf === 'ice') onIce = true;
    if (surf === 'water') spd *= 0.62;
    if (surf === 'mud') spd *= 0.8;
    if (surf === 'lava') {
      player.lavaT = (player.lavaT || 0) - dt;
      if (player.lavaT <= 0) {
        player.lavaT = 0.5;
        playerDamage(5 + (zoneNow ? zoneNow.danger * 3 : 3), null, 'arc');
        spawnBurst(player.x, 0.3, player.z, 0xff6020, 5);
      }
    } else if (surf === 'water' && (player.moveX || player.moveZ) && Math.random() < 0.3) {
      spawnBurst(player.x, 0.1, player.z, 0x9ad8e8, 1);
    }
    // status: chilled by rime shots and spore clouds, snared by lurkers
    if (player.chillT > 0) { player.chillT -= dt; spd *= 0.6; }
    if (player.snareT > 0) { player.snareT -= dt; spd *= 0.05; }

    var preMoveX = player.x, preMoveZ = player.z; // for maze wall resolution
    if (player.speederOn) {
      // skimmer form drives on the NFS model: momentum, drift, nitro
      input.boostPressed = false; // no frame-dash in vehicle form
      updateDrive(dt, input, spd, onIce);
      player.x += player.velX * dt;
      player.z += player.velZ * dt;
    } else if (player.dashTime > 0) {
      player.dashTime -= dt;
      player.x += player.dashX * GH.PACE.dashSpd * dt;
      player.z += player.dashZ * GH.PACE.dashSpd * dt;
      // ramming boost (AEGIS) / lunge slash (FANG)
      if (player.def.special === 'block' || player.dashKind === 'lunge') {
        for (var i = 0; i < enemies.length; i++) {
          var e = enemies[i];
          if (e.dead || e.lastDashId === player.dashId) continue;
          var rr = 1.3 + e.def.radius;
          if (GH.dist2(player.x, player.z, e.x, e.z) <= rr * rr) {
            e.lastDashId = player.dashId;
            var dmg = (player.dashKind === 'lunge'
              ? (12 + s.flatDamage * 2) * s.damageMult
              : (10 + s.armor + s.block) * s.damageMult) * (player.dashMult || 1);
            damageEnemy(e, dmg, {});
            var a = GH.angleTo(player.x, player.z, e.x, e.z);
            e.vx += Math.sin(a) * 14 / e.def.mass;
            e.vz += Math.cos(a) * 14 / e.def.mass;
          }
        }
      }
    } else {
      // ice sheets carry momentum: velocity eases toward intent
      var wantX = player.moveX * spd, wantZ = player.moveZ * spd;
      if (onIce) {
        player.velX = GH.lerp(player.velX || 0, wantX, dt * 2.2);
        player.velZ = GH.lerp(player.velZ || 0, wantZ, dt * 2.2);
      } else {
        player.velX = wantX;
        player.velZ = wantZ;
      }
      // hills: climbing costs stride, descending lends it, cliffs stop you
      if (GH.terrain.active && (player.velX || player.velZ)) {
        var sl = GH.terrain.slope(player.x, player.z, player.velX, player.velZ);
        if (sl > 1.15) { player.velX = 0; player.velZ = 0; }
        else if (sl > 0) { var kUp = 1 - Math.min(0.8, sl) * 0.55; player.velX *= kUp; player.velZ *= kUp; }
        else { var kDn = 1 + Math.min(0.25, -sl * 0.3); player.velX *= kDn; player.velZ *= kDn; }
      }
      player.x += player.velX * dt;
      player.z += player.velZ * dt;
    }
    if (expActive) {
      player.x = GH.clamp(player.x, -GH.world.BOUNDS.x, GH.world.BOUNDS.x);
      player.z = GH.clamp(player.z, -GH.world.BOUNDS.z, GH.world.BOUNDS.z);
      // solid walls (labyrinth cells, hall dividers, closed barriers):
      // resolve per axis so you slide along them
      var laden = !!(dungeonState && dungeonState.carrying);
      if (zoneBlockedAt(player.x, player.z, laden)) {
        if (!zoneBlockedAt(player.x, preMoveZ, laden)) {
          player.z = preMoveZ;
        } else if (!zoneBlockedAt(preMoveX, player.z, laden)) {
          player.x = preMoveX;
        } else {
          player.x = preMoveX;
          player.z = preMoveZ;
        }
      }
      // trees, walls and buildings are solid
      if (GH.terrain.colliderCount()) {
        var rs = GH.terrain.resolve(player.x, player.z, player.speederOn ? 0.9 : 0.6);
        if (rs.hit) { player.x = rs.x; player.z = rs.z; }
      }
      // the sky court: step off an island and you fall until the wind hands you back
      if (GH.terrain.active && GH.terrain.active.biome.voidBelow !== undefined) {
        var overVoid = GH.terrain.voidAt(player.x, player.z);
        var airborne = player.speederOn && player.drive && player.drive.air;
        if (!overVoid) { player.safeX = player.x; player.safeZ = player.z; player.fallT = 0; }
        else if (!airborne) {
          player.fallT = (player.fallT || 0) + dt;
          if (player.fallT > 0.35) {
            player.fallT = 0;
            playerDamage(Math.round(player.stats.maxHP * 0.15) + player.stats.armor, null, 'kinetic');
            player.x = player.safeX || 0; player.z = player.safeZ || 0;
            if (player.drive) { player.drive.spd = 0; player.drive.air = false; player.drive.hgt = 0; }
            player.velX = 0; player.velZ = 0;
            announce('FELL INTO THE SKY — CAUGHT BY THE WIND', 22);
            shake = Math.min(0.6, shake + 0.4);
          }
        }
      }
    } else {
      player.x = GH.clamp(player.x, -ARENA_R, ARENA_R);
      player.z = GH.clamp(player.z, -ARENA_R, ARENA_R);
    }

    player.boost = Math.min(1, player.boost + s.boostRegen * GH.PACE.boostRegen * dt * (inRace && !player.speederOn ? 2 : 1));
    if (input.boostPressed) { tryBoost(); input.boostPressed = false; }
    if (input.specialPressed) { trySpecial(); input.specialPressed = false; }

    player.special.cd = Math.max(0, player.special.cd - dt);
    player.special.active = Math.max(0, player.special.active - dt);
    player.hurtCd = Math.max(0, player.hurtCd - dt);
    player.edgeT = Math.max(0, player.edgeT - dt);
    updateWard(dt, input);
    for (var f = player.frenzy.length - 1; f >= 0; f--) {
      player.frenzy[f] -= dt;
      if (player.frenzy[f] <= 0) player.frenzy.splice(f, 1);
    }

    if (s.regen > 0) player.heal(s.regen * dt);

    // pose
    if (player.speederOn) {
      var sm = player.speederMesh;
      var dr = player.drive;
      var fwdFrac = dr ? GH.clamp(dr.fwd / Math.max(0.01, dr.top), 0, 1) : 0;
      // wall check: the hull expected to travel but barely moved — a crash.
      // NFSU2's harshest rule kept: the wall takes your speed AND your bottle.
      if (dr && dr.crashCd <= 0 && !dr.air && dr.bog <= 0) {
        var expX = player.velX * dt, expZ = player.velZ * dt;
        var exp2 = expX * expX + expZ * expZ;
        var actX = player.x - preMoveX, actZ = player.z - preMoveZ;
        var act2 = actX * actX + actZ * actZ;
        if (exp2 > 0.004 && act2 < exp2 * 0.2 && dr.fwd > dr.top * 0.45) {
          dr.crashCd = 0.9;
          dr.spd *= 0.25;
          player.velX *= 0.2; player.velZ *= 0.2;
          if (dr.nitro > 0.15) {
            announce('WALL — NITRO DUMPED', 18);
          }
          dr.nitro = 0;
          dr.nitroT = 0;
          shake = Math.min(0.6, shake + 0.3);
          spawnBurst(player.x, 1, player.z, 0xffb040, 12);
          GH.audio.hit();
        }
      }
      sm.position.set(player.x, 0 + gy(player.x, player.z), player.z);
      var movingS = dr ? dr.fwd > 0.6 : false;
      player.speederHeading = dr ? dr.heading : player.facing;
      sm.rotation.y = player.speederHeading;
      // bank into the slide: lateral slip leans the hull
      var slipSign = 0;
      if (dr && dr.slip > 0.2) {
        var latDot = player.velX * Math.cos(dr.heading) - player.velZ * Math.sin(dr.heading);
        slipSign = latDot > 0 ? 1 : -1;
      }
      var leanT = dr ? GH.clamp(-slipSign * dr.slip * 0.045, -0.55, 0.55) : 0;
      // and leans with a banked road (lateral slope under the skids)
      if (dr && !dr.air) {
        var latSl = GH.terrain.slope(player.x, player.z, Math.cos(dr.heading), -Math.sin(dr.heading));
        leanT += GH.clamp(latSl * 0.9, -0.5, 0.5);
      }
      sm.rotation.z = GH.lerp(sm.rotation.z, leanT, dt * 7);
      sm.position.y = gy(player.x, player.z) + 0.12 + (dr ? dr.hgt : 0) + Math.sin(runTime * 6) * 0.06; // hover bob
      // pitch the hull with the ground it rides (and the arc it flies)
      var pitchT = dr && dr.air ? GH.clamp(-dr.vy * 0.04, -0.5, 0.5)
        : GH.clamp(-GH.terrain.slope(player.x, player.z, Math.sin(dr.heading), Math.cos(dr.heading)) * 0.8, -0.5, 0.5);
      sm.rotation.x = GH.lerp(sm.rotation.x, pitchT, dt * 6);
      var nitroLive = dr && dr.nitroT > 0;
      if (sm.userData.flames) {
        sm.userData.flames.forEach(function (fl) {
          fl.visible = movingS || Math.floor(runTime * 16) % 2 === 0;
          fl.scale.y = nitroLive ? 2.6 : movingS ? 1.2 + fwdFrac * 0.8 : 0.7;
        });
      }
      // world streaks: dust ripped past the hull sells the speed
      if (dr) {
        dr.streakT -= dt;
        if (fwdFrac > 0.45 && dr.streakT <= 0) {
          dr.streakT = 0.035;
          var va = Math.atan2(player.velX, player.velZ);
          for (var stx = 0; stx < 2; stx++) {
            var sideOff = (Math.random() < 0.5 ? -1 : 1) * GH.rand(2.5, 9);
            var aheadOff = GH.rand(6, 16);
            var stm = poolGet('box', nitroLive ? 0xbfe8ff : 0xdfe8f0);
            stm.scale.set(0.06, 0.06, 1.6 + dr.fwd * 0.09);
            stm.position.set(
              player.x + Math.sin(va) * aheadOff + Math.cos(va) * sideOff,
              gy(player.x, player.z) + GH.rand(0.5, 3),
              player.z + Math.cos(va) * aheadOff - Math.sin(va) * sideOff);
            stm.rotation.set(0, va, 0);
            scene.add(stm);
            effects.push({
              kind: 'streak', mesh: stm, t: 0.3, total: 0.3,
              vx: -player.velX * 0.55, vz: -player.velZ * 0.55
            });
          }
        }
        // skid ribbons under a real slide
        if (dr.drift && dr.slip > 2.2 && dr.fwd > 3) {
          dr.skidT -= dt;
          if (dr.skidT <= 0) {
            dr.skidT = 0.055;
            var ha = dr.heading;
            for (var sk = -1; sk <= 1; sk += 2) {
              var skm = poolGet('box', 0x14181e);
              skm.scale.set(0.5, 0.03, 1.9);
              skm.position.set(
                player.x + Math.cos(ha) * 0.8 * sk - Math.sin(ha) * 1.1,
                gy(player.x, player.z) + 0.04,
                player.z - Math.sin(ha) * 0.8 * sk - Math.cos(ha) * 1.1);
              skm.rotation.set(0, Math.atan2(player.velX, player.velZ), 0);
              scene.add(skm);
              effects.push({ kind: 'skidmark', mesh: skm, t: 2.4, total: 2.4, sx: 0.5 });
            }
          }
          if (Math.random() < 0.35) {
            spawnBurst(player.x - Math.sin(dr.heading) * 1.2, 0.2,
              player.z - Math.cos(dr.heading) * 1.2, 0xffd050, 1);
          }
        }
        if (nitroLive && Math.random() < 0.5) {
          spawnBurst(player.x - Math.sin(dr.heading) * 1.6, 0.5,
            player.z - Math.cos(dr.heading) * 1.6, 0x70c0ff, 2);
        }
      }
      // ram: the skimmer's mass is its weapon
      if (movingS) {
        for (var ri2 = 0; ri2 < enemies.length; ri2++) {
          var re2 = enemies[ri2];
          if (re2.dead || re2.def.behavior === 'static') continue;
          var rr2b = 1.6 + re2.def.radius;
          if (GH.dist2(player.x, player.z, re2.x, re2.z) < rr2b * rr2b &&
            (!re2.ramT || re2.ramT < runTime)) {
            re2.ramT = runTime + 0.8;
            damageEnemy(re2, (8 + s.flatDamage) * s.damageMult * ((GH.VECTORS[player.vec.kind] || GH.VECTORS.bike).ram), { canCrit: false, noRes: true });
            var ra2 = GH.angleTo(player.x, player.z, re2.x, re2.z);
            re2.vx += Math.sin(ra2) * 15 / re2.def.mass;
            re2.vz += Math.cos(ra2) * 15 / re2.def.mass;
          }
        }
      }
      player.mesh.visible = false;
      sm.visible = !(player.hurtCd > 0 && Math.floor(runTime * 24) % 2 === 0);
      return;
    }
    player.mesh.position.set(player.x, 0 + gy(player.x, player.z), player.z);
    player.mesh.rotation.y = player.facing;
    var parts = player.mesh.userData.parts;
    var moving = player.moveX !== 0 || player.moveZ !== 0;
    var t = runTime * (moving ? 9 : 2);
    var sw = moving ? Math.sin(t) * 0.55 : 0;
    parts.legL.rotation.x = sw;
    parts.legR.rotation.x = -sw;
    parts.torso.position.y = 1.72 + Math.abs(Math.sin(t)) * (moving ? 0.06 : 0.02);
    if (!poseMeleeSwing(player, parts, dt)) {
      var aimingP = player.def.weapon.type !== 'melee';
      if (parts.armR && aimingP) parts.armR.rotation.x = -1.35;
      else if (parts.armR) parts.armR.rotation.x = GH.lerp(parts.armR.rotation.x, -0.2, dt * 6);
      GH.models.aimMounts(parts, aimingP);
      if (parts.armL) {
        if (player.def.model.prop === 'guns') parts.armL.rotation.x = -1.35;
        else if (player.def.model.prop === 'claws' || player.def.model.prop === 'daggers')
          parts.armL.rotation.x = GH.lerp(parts.armL.rotation.x, -0.2, dt * 6);
      }
      parts.torso.rotation.y = GH.lerp(parts.torso.rotation.y, 0, dt * 8);
    }
    if (player.blocking && parts.armL) parts.armL.rotation.x = -1.5;
    if (player.def.weapon.type === 'aura' && parts.weapon) parts.weapon.rotation.y += dt * 10;
    if (parts.gem) parts.gem.rotation.y += dt * 3;
    // thruster flames while dashing/moving fast
    if (parts.flames) {
      var thrust = player.dashTime > 0;
      parts.flames.forEach(function (fl) {
        fl.visible = thrust || (moving && Math.floor(runTime * 20) % 3 !== 0);
        fl.scale.y = thrust ? 1.6 : 0.8;
      });
    }
    player.mesh.visible = !(player.hurtCd > 0 && Math.floor(runTime * 24) % 2 === 0);
  }

  // =================================================================
  // THE SHATTERED REACH — expedition mode. One persistent continent:
  // territory nests spawn until broken, lairs guard frames, the camp
  // is home, and what you destroy stays destroyed.
  // =================================================================
  var expActive = false;
  var worldH = null;          // {group, nestMeshes, vaultMeshes, layout}
  var interactables = [];
  var nearInteract = null;
  var veins = [];            // today's alloy veins in the loaded zone
  var huntSpot = null, huntUp = false, huntTotem = null; // today's HUNT in this territory
  var signalT = 0, signalSpot = null; // the next cache signal, and the live one

  // diary / daily payouts announced in the field
  function payDiary(list) {
    (list || []).forEach(function (pd) {
      GH.audio.diary();
      queueAnnounce('DIARY — ' + pd.name + ' ' + pd.tier.name + ' COMPLETE · +' + pd.tier.reward.alloy + ' ALLOY' +
        (pd.tier.reward.cores ? ' +' + pd.tier.reward.cores + ' CORES' : '') + (pd.tier.perk ? ' · ' + pd.tier.perk.label.toUpperCase() : ''), 26);
      GH.audio.win();
    });
  }
  function payDaily(list) {
    (list || []).forEach(function (t) {
      queueAnnounce('DAILY TASK DONE — ' + t.desc.toUpperCase() + ' · CLAIM AT THE BROKER', 22);
      GH.audio.levelup();
    });
  }
  function lifeEvent(kind, n) {
    if (expActive) payDiary(GH.worldlife.zoneEvent(curZone, kind, n));
    payDaily(GH.worldlife.dailyEvent(kind, n));
  }
  G.lifeEvent = lifeEvent;

  function mineVein(it) {
    var v = it.vein;
    if (v.mined) return;
    v.mined = true;
    if (v.mesh) v.mesh.visible = false;
    GH.worldlife.mineNode(curZone, v.idx);
    var perk = GH.worldlife.zonePerk(curZone);
    var got = Math.round(v.alloy * perk.alloy * GH.worldlife.band().alloy);
    grantMats(got, v.core ? 1 : 0, false);
    spawnBurst(v.x, 0.8, v.z, 0xc8d8f0, 14);
    GH.audio.coin();
    queueAnnounce('VEIN MINED — +' + got + ' ALLOY' + (v.core ? ' · A FRAME CORE INSIDE' : ''), 20);
    GH.audio.vein();
    lifeEvent('nodes', 1);
    tutorialEvent('vein', 1);
    saveExpedition();
  }
  var zoneNow = null;
  var siege = null;           // {relay, phase, timer, burst}
  var wreckMesh = null;
  var expLevelUps = 0;
  // daily world state
  var weatherToday = null;    // zoneId -> weather def (2 zones/day)
  var weatherNow = null;      // the front you're standing in
  var weatherT = 0;
  var harrowSpot = null;      // where THE HARROW stands today (null = slain today)
  var harrowTotem = null;
  var harrowUp = false;

  // ---- race items: pads on the line hand out a shield, a mine, a missile, a bottle ----
  var ITEM_NAMES = { shield: 'SHIELD', mine: 'MINE', missile: 'SEEKER', nitro: 'BOTTLE' };
  function updateItemPads(dt) {
    if (!worldH || !worldH.itemPads) return;
    for (var i = 0; i < worldH.itemPads.length; i++) {
      var pad = worldH.itemPads[i];
      pad.cd = Math.max(0, pad.cd - dt);
      pad.mesh.visible = pad.cd <= 0;
      if (pad.mesh.userData.spin) pad.mesh.userData.spin.rotation.y += dt * 2.4;
      if (pad.cd <= 0 && !player.item && player.speederOn &&
        GH.dist2(player.x, player.z, pad.x, pad.z) < 2.8 * 2.8) {
        pad.cd = 7;
        player.item = GH.pick(['shield', 'mine', 'missile', 'nitro']);
        announce('ITEM — ' + ITEM_NAMES[player.item] + ' [G]', 20);
        GH.audio.gem();
      }
    }
  }
  function useItem() {
    if (!player || !player.item) return;
    var it = player.item;
    player.item = null;
    var s = player.stats;
    if (it === 'shield') {
      player.shieldT = 6;
      announce('SHIELD UP — 6s', 18);
    } else if (it === 'nitro') {
      if (player.drive) player.drive.nitro = 1;
      announce('BOTTLE FULL', 18);
    } else if (it === 'mine') {
      var h = player.drive ? player.drive.heading : player.facing;
      var mx = player.x - Math.sin(h) * 2.6, mz = player.z - Math.cos(h) * 2.6;
      var m = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.2, 8),
        GH.assets.mat(0xff5030, { emissive: 0x802010 }));
      m.position.set(mx, gy(mx, mz) + 0.1, mz);
      scene.add(m);
      mines.push({ mesh: m, x: mx, z: mz, life: 25, damage: 60 * s.damageMult, aoe: 3.2, inst: null });
      announce('MINE DROPPED', 16);
    } else if (it === 'missile') {
      var tgt = null;
      if (dungeonState && dungeonState.race) {
        var best = -1;
        dungeonState.race.rivals.forEach(function (rr) {
          if (rr.dead) return;
          var pg = racewayProgress(rr.raceLap, rr.raceGate);
          if (pg > best) { best = pg; tgt = rr; }
        });
      }
      if (!tgt) tgt = nearestEnemy(player.x, player.z, 40);
      if (tgt) {
        var tmp = makeWeaponInst('seeker', {
          type: 'shot', damage: 90, speed: 30, life: 4, size: 1.3, color: 0xff5030, spread: 0, count: 1, homing: 9, aoe: 2.2
        });
        fireShot(tmp, player.x, player.z, GH.angleTo(player.x, player.z, tgt.x, tgt.z));
        announce('SEEKER AWAY', 16);
      } else {
        announce('NO TARGET FOR THE SEEKER', 16);
        player.item = 'missile';
        return;
      }
    }
    GH.audio.card();
  }

  // ---- zone events: a built territory answers an intruder ----
  var zoneEvent = null, zoneEventT = 0;
  var ZONE_EVENTS = {
    hive: { name: 'LOCKDOWN', line: 'THE SPIRE SEALS THE STREETS — HOLD UNTIL THE SIREN STOPS', types: ['slinger', 'habbrute', 'rodsentry'], waves: 3, gap: 9, dur: 34 },
    keep: { name: 'SIEGE', line: 'THE WALLS WAKE — BALLISTAE AND KNIGHTS', types: ['wardenknight', 'ballista', 'stalker'], waves: 3, gap: 10, dur: 36 },
    ruins: { name: 'AWAKENING', line: 'THE STATUES REMEMBER HOW TO WALK', types: ['slaggolem', 'gravestalker', 'carrionkite'], waves: 2, gap: 12, dur: 32 },
    warrens: { name: 'CAVE-IN', line: 'THE TUNNELS SHIFT — RIFTS OPEN UNDERFOOT', types: ['tunnelmaw', 'glowmite', 'fungalshambler'], waves: 3, gap: 8, dur: 30, hazard: 'rifts' },
    sky: { name: 'GALE', line: 'THE WIND TURNS — THE BRIDGES ARE NO PLACE TO STAND', types: ['aetherray', 'cloudwisp', 'sentinel'], waves: 3, gap: 9, dur: 30, weather: 'gale' }
  };
  function scheduleZoneEvent() {
    zoneEvent = null;
    zoneEventT = ZONE_EVENTS[curZone] && zoneNow && !zoneNow.dungeon ? 40 + Math.random() * 35 : 0;
  }
  function updateZoneEvent(dt) {
    var def = ZONE_EVENTS[curZone];
    if (!def || !zoneNow || zoneNow.dungeon) return;
    if (!zoneEvent) {
      if (zoneEventT <= 0) return;
      zoneEventT -= dt;
      if (zoneEventT > 0 || siege || dungeonState) return;
      zoneEvent = { def: def, t: 0, wave: 0, waveT: 1.5, done: false, savedWeather: weatherNow };
      announce(def.name + ' — ' + def.line, 26);
      GH.music.setBoss(true);
      GH.audio.boss();
      if (def.weather) weatherNow = { id: def.weather, name: def.name };
      if (def.hazard) {
        for (var hi = 0; hi < 5; hi++) {
          var ha = Math.random() * Math.PI * 2, hr = 8 + Math.random() * 14;
          var hz = makeHazard(def.hazard, player.x + Math.cos(ha) * hr, player.z + Math.sin(ha) * hr);
          hz.event = true;
          hazards.push(hz);
        }
      }
      return;
    }
    if (zoneEvent.done) return;
    zoneEvent.t += dt;
    zoneEvent.waveT -= dt;
    if (zoneEvent.waveT <= 0 && zoneEvent.wave < def.waves) {
      zoneEvent.wave++;
      zoneEvent.waveT = def.gap;
      var n = 3 + zoneNow.danger + zoneEvent.wave;
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, r = 13 + Math.random() * 9;
        var ev = spawnEnemy(GH.pick(def.types), player.x + Math.cos(a) * r, player.z + Math.sin(a) * r);
        if (ev) { ev.aggro = true; ev.event = true; ev.allied = false; }
      }
      queueAnnounce(def.name + ' — WAVE ' + zoneEvent.wave + '/' + def.waves, 20);
    }
    if (zoneEvent.t >= def.dur) {
      zoneEvent.done = true;
      var pay = 40 * zoneNow.danger;
      coinsRun += pay;
      GH.music.setBoss(false);
      if (def.weather) weatherNow = zoneEvent.savedWeather;
      for (var hz2 = hazards.length - 1; hz2 >= 0; hz2--) {
        if (hazards[hz2].event) { if (hazards[hz2].mesh) scene.remove(hazards[hz2].mesh); hazards.splice(hz2, 1); }
      }
      queueAnnounce(def.name + ' WEATHERED — +' + pay + ' SALVAGE', 26);
      GH.audio.win();
    }
  }

  function expeditionPlan(zone) {
    var st = GH.world.stageFor(zone.id);
    // pace tuning lives in GH.PACE: more bodies that go down faster.
    // Dungeon tiers stack a garrison multiplier on top.
    var tm = zone.tier ? GH.dungeons.tierMult(zone.tier) : { hp: 1, dmg: 1 };
    return {
      duration: 999, rate: 0,
      types: st.roster(4 + zone.danger * 3),
      boss: null, midboss: null,
      hpMult: (0.8 + (zone.danger - 1) * 0.9) * GH.PACE.enemyHp * tm.hp * (tutorial ? 1 : GH.worldlife.band().ehp),
      dmgMult: (0.9 + (zone.danger - 1) * 0.45) * tm.dmg * (tutorial ? 1 : GH.worldlife.band().edmg),
      overrun: false
    };
  }

  function serializeCharacter() {
    return {
      zone: curZone,
      mech: GH.mechs.indexOf(player.def),
      mechId: player.def.id,
      stats: JSON.parse(JSON.stringify(player.stats)),
      hp: player.hp, xp: player.xp, level: player.level, xpNeed: player.xpNeed,
      weapons: player.weapons.map(function (inst) {
        return { id: inst.id, w: JSON.parse(JSON.stringify(inst.w)), sockets: inst.sockets.slice(), isPrimary: inst.isPrimary };
      }),
      weaponLevels: JSON.parse(JSON.stringify(player.weaponLevels)),
      protocols: JSON.parse(JSON.stringify(player.protocols)),
      phoenixUsed: !!player.phoenixUsed,
      item: player.item || null,
      x: player.x, z: player.z
    };
  }

  function saveExpedition() {
    if (!expActive || !player) return;
    GH.meta.data.world.exp = serializeCharacter();
    GH.meta.save();
  }

  function restoreCharacter(saved) {
    // stats are re-derived, never copied: base frame + attributes + the
    // CURRENT skill tree + mastery + per-level growth. That way training
    // or respeccing at camp reaches a live character immediately.
    var savedDef = saved.mechId ? GH.mechById(saved.mechId) : GH.mechs[saved.mech];
    player = makePlayer(savedDef || GH.mechs[0]);
    var mbr = GH.progress.masteryBonus(player.def.id);
    player.stats.damageMult += mbr.damageMult;
    player.stats.maxHP += mbr.maxHP;
    player.stats.boostRegen += mbr.boostRegen;
    if (mbr.energyBonus) player.stats.energyRegen *= 1.1;
    player.xp = saved.xp; player.level = saved.level; player.xpNeed = saved.xpNeed;
    for (var lv = 1; lv < saved.level; lv++) applyLevelUp();
    player.hp = Math.min(saved.hp, player.stats.maxHP);
    player.weaponLevels = saved.weaponLevels || {};
    player.protocols = saved.protocols || {};
    player.phoenixUsed = saved.phoenixUsed;
    // one weapon: the frame's CURRENT primary definition (weapon defs
    // evolve between patches — only the sockets carry over from the save)
    var savedSockets = (saved.weapons[0] && saved.weapons[0].sockets) || [];
    var prim = player.weapons[0];
    prim.sockets = savedSockets.slice();
    GH.gems.applySocketBonuses(prim);
    // secondaries come back from their catalogue definitions at saved level
    (saved.weapons || []).forEach(function (sw) {
      if (sw.isPrimary) return;
      var def = null;
      for (var ui = 0; ui < GH.upgrades.length; ui++) if (GH.upgrades[ui].id === sw.id) def = GH.upgrades[ui];
      if (!def || def.kind !== 'weapon') return;
      var inst = makeWeaponInst(sw.id, def.weapon);
      var lvl = (saved.weaponLevels || {})[sw.id] || 1;
      for (var l = 1; l < lvl; l++) def.perLevel(inst.w);
      inst.sockets = (sw.sockets || []).slice();
      GH.gems.applySocketBonuses(inst);
      player.weapons.push(inst);
    });
    player.item = saved.item || null;
    player.x = saved.x; player.z = saved.z;
  }

  // rebuild the live expedition character so fresh training/respec lands now
  G.refreshPilot = function () {
    if (!player || !expActive || G.state === 'race') return;
    var snap = serializeCharacter();
    if (wardDome && wardDome.parent === player.mesh) player.mesh.remove(wardDome);
    if (player.speederMesh) scene.remove(player.speederMesh);
    scene.remove(player.mesh);
    restoreCharacter(snap);
    updateHUDStatic();
    saveExpedition();
  };

  // ------------------------------------------------------------
  // ZONE STREAMING — one map loaded at a time; gates swap maps
  // behind a fade so travel never shows a loading screen.
  // ------------------------------------------------------------
  var curZone = 'wreck';
  var travelCd = 0; // keeps a fresh arrival from bouncing back through
  var AMBIENT = { wreck: 'wind', glacier: 'wind', cloister: 'rain', ember: 'embers', storm: 'rain', null: 'hum',
    hive: 'city', ruins: 'wind', keep: 'wind', warrens: 'cave', sky: 'wind' };

  var zoneFadeTimer = null;
  function zoneFade(dirText, nameText) {
    var f = document.getElementById('zone-fade');
    if (!f) return;
    var t = document.getElementById('zone-fade-text');
    if (t) {
      if (nameText) {
        t.innerHTML = '<div class="zf-dir">' + (dirText || '') + '</div><div class="zf-name">' + nameText + '</div>';
        t.classList.remove('hidden');
      } else t.classList.add('hidden');
    }
    f.classList.add('on');
    if (zoneFadeTimer) clearTimeout(zoneFadeTimer);
    // a named crossing lingers like a GW2 zone card; a plain fade just blinks
    zoneFadeTimer = setTimeout(function () { f.classList.remove('on'); zoneFadeTimer = null; }, nameText ? 950 : 280);
  }

  // look for the loaded zone: stage palette, or dungeon gloom
  function applyZoneLook(info, st) {
    applyStageLookLite(st);
    if (info.dungeon) {
      scene.background = new THREE.Color(0x07080e);
      scene.fog.color.setHex(0x0d1018);
      scene.fog.near = 18; scene.fog.far = 84;
      hemi.color.setHex(0x8a94b4);
      hemi.groundColor.setHex(0x2e3246);
      sun.color.setHex(0xc0cce4);
    } else if (GH.terrain.dark()) {
      // the undercity: lamps and fungus, not sky
      scene.background = new THREE.Color(0x06040a);
      scene.fog.color.setHex(0x120e18);
      scene.fog.near = 12; scene.fog.far = 52;
    } else {
      // open ground: let the hills and the rim show before the haze takes them
      scene.fog.near = 30; scene.fog.far = 98;
    }
  }

  // tear down everything zone-local (never the pilot) and build the next map
  function loadZone(zoneId, fromZoneId) {
    [enemies, projectiles, enemyShots, pickups, mines].forEach(function (list) {
      for (var i = 0; i < list.length; i++) scene.remove(list[i].mesh);
      list.length = 0;
    });
    for (var fi = 0; fi < effects.length; fi++) {
      scene.remove(effects[fi].mesh);
      if (effects[fi].disc) scene.remove(effects[fi].disc);
    }
    effects.length = 0;
    clearHazards();
    if (cipherRun) {
      if (cipherRun.marker) scene.remove(cipherRun.marker);
      cipherRun = null; // trials don't cross zone lines
    }
    siege = null;
    setTarget(null);
    bossRef = null;
    hideBossBar();
    GH.music.setBoss(false);
    if (worldH) { scene.remove(worldH.group); worldH = null; }
    if (wreckMesh) { scene.remove(wreckMesh); wreckMesh = null; }
    if (harrowTotem) { scene.remove(harrowTotem); harrowTotem = null; }
    if (dungeonState && dungeonState.haulerMesh) scene.remove(dungeonState.haulerMesh);
    harrowUp = false;

    curZone = zoneId;
    var w = GH.meta.data.world;
    GH.terrain.clear();
    GH.atmos.clear(scene);
    worldH = GH.world.buildZone(scene, zoneId, w.nests, w.lairsDown, w.vaults);
    GH.atmos.set(scene, zoneId, !!worldH.info.dungeon);
    camGround = player ? gy(player.x, player.z) : 0;
    zoneNow = worldH.info;
    interactables = GH.world.interactables(worldH.layout, zoneId);
    // alloy veins (Albion-style gathering): richer in dangerous territory
    veins = GH.worldlife.nodesFor(zoneId, GH.world.BOUNDS);
    veins.forEach(function (v) {
      var sp = openSpot(v.x, v.z, 1.2);
      if (sp) { v.x = sp.x; v.z = sp.z; }
      var m = GH.models.buildOreNode(v.rich);
      m.position.set(v.x, gy(v.x, v.z), v.z);
      m.visible = !v.mined;
      worldH.group.add(m);
      v.mesh = m;
      interactables.push({ kind: 'vein', vein: v, x: v.x, z: v.z, label: 'MINE THE ' + (v.rich ? 'RICH ' : '') + 'ALLOY VEIN' });
    });
    signalT = GH.worldlife.signalInterval(zoneNow.danger) * (0.5 + Math.random() * 0.5);
    signalSpot = null;
    // today's hunt: a skull totem somewhere in the territory
    huntSpot = null; huntUp = false;
    if (huntTotem) { scene.remove(huntTotem); huntTotem = null; }
    if (!zoneNow.dungeon) {
      var hd0 = GH.meta.data.huntsToday;
      if (hd0.day !== GH.world.dayStamp()) { hd0.day = GH.world.dayStamp(); hd0.slain = {}; }
      var hb = GH.bosses.todayFor(zoneId, GH.world.dayStamp(), hd0.slain);
      if (hb) {
        var hrng = GH.worldlife.nodesFor(zoneId, GH.world.BOUNDS);
        var hp0 = hrng.length ? hrng[hrng.length - 1] : { x: 0, z: -40 };
        var hx = hp0.x * 0.7, hz = hp0.z * 0.7;
        if (zoneId === 'wreck' && GH.dist2(hx, hz, GH.world.CAMP.x, GH.world.CAMP.z) < 50 * 50) hz -= 90;
        var hsp = openSpot(hx, hz, 2.5); if (hsp) { hx = hsp.x; hz = hsp.z; }
        huntSpot = { id: hb.id, name: hb.name, x: hx, z: hz };
        huntTotem = GH.models.buildHarrowTotem();
        huntTotem.position.set(hx, gy(hx, hz), hz);
        if (huntTotem.userData.core && huntTotem.userData.core.material && huntTotem.userData.core.material.color) huntTotem.userData.core.material.color.setHex(hb.color);
        worldH.group.add(huntTotem);
      }
    }
    if (fromZoneId && !zoneNow.dungeon) {
      var dp = GH.worldlife.diaryProgress(zoneId);
      var pk0 = GH.worldlife.zonePerk(zoneId);
      queueAnnounce(zoneNow.name + ' — DANGER ' + ['I', 'II', 'III', 'IV'][zoneNow.danger - 1] +
        ' · DIARY ' + dp.doneTiers + '/' + dp.total + (pk0.labels.length ? ' · ' + pk0.labels.join(', ').toUpperCase() : ''), 22);
      if (huntSpot) queueAnnounce('HUNT: ' + huntSpot.name + ' — MARKED ON THE MAP', 20);
    }
    stage = GH.world.stageFor(zoneId);
    applyZoneLook(zoneNow, stage);
    applyWeatherFor(zoneId);
    GH.music.play(stage.id);
    wavePlan = expeditionPlan(zoneNow);

    // arriving through a portal: appear beside its twin in the opposite
    // corner, still walking the way you left — the camera swings to look
    // into the new territory so travel reads as one continuous journey
    var arrivedVia = null;
    if (fromZoneId && player) {
      var back = null;
      worldH.layout.gates.forEach(function (gt) { if (gt.to === fromZoneId) back = gt; });
      if (back) {
        var ina = Math.atan2(-back.x, -back.z);
        player.x = back.x + Math.sin(ina) * 9;
        player.z = back.z + Math.cos(ina) * 9;
        if (!zoneNow.dungeon && back.corner) {
          player.facing = ina;
          camYaw = ina;
          if (player.drive) player.drive.heading = ina;
          arrivedVia = GH.world.cornerTo(fromZoneId, zoneId);
        }
      } else {
        player.x = 0; player.z = 0;
      }
      travelCd = 2;
      if (mate) { mate.x = player.x + 2; mate.z = player.z + 1.5; }
    }
    refreshZoneCompass();

    // the day's phenomena, where they belong
    if (harrowSpot && harrowSpot.zone === zoneId) {
      harrowTotem = GH.models.buildHarrowTotem();
      harrowTotem.position.set(harrowSpot.x, 0 + gy(harrowSpot.x, harrowSpot.z), harrowSpot.z);
      scene.add(harrowTotem);
    }
    if (w.wreck && (w.wreck.zone || 'wreck') === zoneId) {
      wreckMesh = GH.models.buildWreckSite();
      wreckMesh.position.set(w.wreck.x, 0 + gy(w.wreck.x, w.wreck.z), w.wreck.z);
      scene.add(wreckMesh);
    }
    // dungeon setup: garrison + the archetype's objective machine
    dungeonState = null;
    if (zoneNow.dungeon) initDungeon();
    if (player) camGround = gy(player.x, player.z);
    scheduleZoneEvent();
    GH.audio.ambient(AMBIENT[stage.id] || 'wind');

    if (fromZoneId) {
      announce(zoneNow.name + ' — DANGER ' + ['I', 'II', 'III', 'IV'][zoneNow.danger - 1], 28);
      zoneFade(arrivedVia ? (GH.world.CORNERS[arrivedVia].arrow + ' ' + GH.world.CORNERS[arrivedVia].name) : (zoneNow.dungeon ? 'DESCENDING' : 'RETURNING'), zoneNow.name);
      saveExpedition();
    }
  }

  // the HUD compass under the minimap: which territory lies through each
  // corner portal of the loaded map, so travel always has a direction
  function refreshZoneCompass() {
    var el = document.getElementById('zone-compass');
    if (!el) return;
    if (!zoneNow || zoneNow.dungeon || !GH.world.gridOf(curZone)) { el.classList.add('hidden'); return; }
    var nbs = GH.world.neighbours(curZone);
    var html = '';
    ['NW', 'NE', 'SW', 'SE'].forEach(function (c) {
      var cr = GH.world.CORNERS[c];
      var to = nbs[c];
      var st = to ? GH.world.stageFor(to) : null;
      var dz = to ? GH.world.zoneById(to).danger : 0;
      html += '<div class="zc-row' + (to ? '' : ' zc-none') + '"><span class="zc-arrow">' + cr.arrow + '</span>' +
        '<span class="zc-name">' + (st ? st.name : 'the mountains') + '</span>' +
        (to ? '<span class="zc-danger">' + ['I', 'II', 'III', 'IV'][dz - 1] + '</span>' : '') + '</div>';
    });
    el.innerHTML = html;
    el.classList.remove('hidden');
  }
  G.refreshZoneCompass = refreshZoneCompass;
  G.currentZone = function () { return expActive ? curZone : null; };

  function travelZone(gate) {
    saveExpedition();
    loadZone(gate.to, curZone);
  }

  // ------------------------------------------------------------
  // DUNGEON ARCHETYPES — each gate leads to a different kind of run
  // ------------------------------------------------------------
  var dungeonState = null;

  function initDungeon() {
    var lay = worldH.layout;
    var baseId = GH.dungeons.baseId(zoneNow.parent, zoneNow.arch);
    var mods = GH.dungeons.modsFor(baseId, zoneNow.tier);
    var modIds = {};
    mods.forEach(function (m) { modIds[m.id] = true; });
    dungeonState = {
      arch: zoneNow.arch, tier: zoneNow.tier, baseId: baseId,
      mods: mods, modIds: modIds,
      done: false, opened: false, spawned: false,
      firstClear: !GH.meta.data.world.dungeons[curZone],
      remaining: 0,
      cp: 0, timer: 26,
      defenseActive: false, defenseWon: false, failed: false,
      wave: 0, waveT: 0, objHp: 0, objMax: 0,
      fluxTick: 0,
      // raceway
      race: null,
      // cipher halls
      barrierOpen: {}, carrying: null, corePos: {},
      // convoy
      hauler: null, haulerMesh: null,
      // crucible
      cruIdx: 0, cruWaitT: 2.5,
      // heist
      heistCarrying: false, heistT: 0
    };
    // garrison
    lay.packs.forEach(function (pk) {
      for (var pi = 0; pi < pk.n; pi++) {
        var pa = Math.random() * Math.PI * 2;
        spawnEnemy(GH.weightedPick(wavePlan.types).id,
          pk.x + Math.cos(pa) * GH.rand(1, 5), pk.z + Math.sin(pa) * GH.rand(1, 5));
      }
    });
    dungeonState.spawned = true;
    if (lay.objective) {
      dungeonState.objMax = lay.objective.hp;
      dungeonState.objHp = lay.objective.hp;
    }
    if (lay.halls) {
      lay.halls.items.forEach(function (it) {
        dungeonState.corePos[it.id] = { x: it.x, z: it.z };
      });
      dungeonState.switchT = {};
      dungeonState.litR = {};
      dungeonState.jammedB = {};
      dungeonState.beamLinks = [];
      queueAnnounce(lay.halls.variant === 'master'
        ? 'THE ARCHIVE GIVES NOTHING AWAY — EVERY TOOL YOU KNOW, TURNED AGAINST YOU'
        : 'READ THE ROOM — EACH CHAMBER TEACHES ONE TRUTH', 22);
    }
    if (lay.convoyPath) {
      dungeonState.hauler = {
        x: lay.convoyPath[0].x, z: lay.convoyPath[0].z,
        wp: 1, hp: 400 + zoneNow.danger * 120, max: 400 + zoneNow.danger * 120,
        fired: {}
      };
      dungeonState.haulerMesh = GH.models.buildHauler();
      dungeonState.haulerMesh.position.set(dungeonState.hauler.x, 0 + gy(dungeonState.hauler.x, dungeonState.hauler.z), dungeonState.hauler.z);
      scene.add(dungeonState.haulerMesh);
      queueAnnounce('THE HAULER ROLLS — KEEP IT ALIVE', 24);
    }
    if (lay.crucible) {
      queueAnnounce('THE CRUCIBLE — THEY COME ONE BY ONE', 24);
    }
    queueAnnounce(GH.dungeons.ARCHETYPES[zoneNow.arch].desc.toUpperCase(), 20);
    mods.forEach(function (m) {
      queueAnnounce('MODIFIER — ' + m.name + ': ' + m.desc.toUpperCase(), 18);
    });
    if (lay.raceway && lay.raceway.name) queueAnnounce('CIRCUIT — ' + lay.raceway.name, 22);
    spawnDungeonHazards();
  }

  // every dungeon carries its territory's hazard: ice sheets under the
  // frost range, vine snares under the canopy, vents in the cinder
  // wastes, lightning over the highlands, drifting rifts in the void
  function spawnDungeonHazards() {
    clearHazards();
    if (!stage || !stage.hazard || !zoneNow || !zoneNow.dungeon) return;
    var arch = zoneNow.arch;
    if (arch === 'labyrinth' || arch === 'halls' || arch === 'fluxways' || arch === 'raceway') return;
    var kind = stage.hazard;
    if (kind === 'lightning') { hazards.push({ kind: 'lightning', t: GH.rand(3, 6) }); return; }
    var half = GH.world.BOUNDS.x - 16;
    for (var i = 0; i < 6; i++) {
      var x = GH.rand(-half, half), z = GH.rand(-half, half);
      if (GH.dist2(x, z, player.x, player.z) < 16 * 16) continue;
      if (zoneBlockedAt(x, z)) continue;
      hazards.push(makeHazard(kind, x, z));
    }
  }

  function makeHazard(kind, x, z) {
    var h = { kind: kind, x: x, z: z, t: GH.rand(2, 5) };
    if (kind === 'ice') {
      h.r = GH.rand(4, 5.5);
      h.mesh = groundDisc(x, z, h.r, 0xa0e0ff, 0.22);
    } else if (kind === 'vines') {
      h.r = GH.rand(3, 4);
      h.mesh = groundDisc(x, z, h.r, 0x3aa040, 0.3);
    } else if (kind === 'vents') {
      h.r = 2.4;
      h.mesh = groundDisc(x, z, 0.9, 0x803020, 0.5);
      h.t = GH.rand(3, 7);
    } else if (kind === 'rifts') {
      h.r = 3;
      h.mesh = groundDisc(x, z, h.r, 0x9040d0, 0.25);
      h.vx = GH.rand(-1, 1); h.vz = GH.rand(-1, 1);
    }
    return h;
  }

  // tier modifiers stamp every hostile born in this dungeon
  function applyDungeonMods(e) {
    var ids = dungeonState.modIds;
    if (ids.armored) { e.hp *= 1.4; e.maxHp *= 1.4; }
    if (ids.swift) e.speedMult = (e.speedMult || 1) * 1.25;
    if (ids.frenzied) e.modFrenzied = true;
    if (ids.volatile) e.modVolatile = true;
    if (ids.regen) e.modRegen = true;
    if (ids.thorns) e.modThorns = true;
    if (ids.gilded) e.modGilded = true;
  }

  // a clear pushes this dungeon's gate up a tier, forever
  function ascendDungeon() {
    var w = GH.meta.data.world;
    w.dgTier = w.dgTier || {};
    if ((w.dgTier[dungeonState.baseId] || 0) < dungeonState.tier) {
      w.dgTier[dungeonState.baseId] = dungeonState.tier;
    }
    lifeEvent('tier', dungeonState.tier);
    GH.meta.save();
    queueAnnounce('THE ' + GH.dungeons.ARCHETYPES[dungeonState.arch].name +
      ' ASCENDS — TIER ' + (dungeonState.tier + 1) + ' NOW WAITS AT ITS GATE', 26);
  }

  function chestReady() {
    var ds = dungeonState;
    if (!ds || ds.opened) return false;
    var needsDone = { hive: 1, gauntlet: 1, bastion: 1, raceway: 1, convoy: 1, crucible: 1 };
    if (needsDone[ds.arch]) return ds.done;
    return true; // labyrinth / fluxways / halls: reaching the chest IS the feat
  }

  function openChest() {
    var ds = dungeonState;
    var lay = worldH.layout;
    ds.opened = true;
    var loot = Math.round(60 * zoneNow.danger * ds.tier * (1 + ds.mods.length * 0.15) * (player.stats.salvageMult || 1));
    GH.meta.data.salvage += loot;
    awardCards(3);
    GH.factions.deed(curZone, 'dungeon', 6);
    coinsRun += 20 * ds.tier;
    grantMats(12 * ds.tier + zoneNow.danger * 4, 1 + (ds.firstClear ? 1 : 0), false);
    lifeEvent('caches', 1);
    spawnPickup('gem:' + GH.pick(GH.gems.typeIds), lay.chest.x + 1.5, lay.chest.z + 1.5);
    queueAnnounce('CACHE OPENED — +' + loot + ' SALVAGE BANKED', 26);
    GH.audio.win();
    if (ds.firstClear) {
      spawnPickup('cache', lay.chest.x - 1.5, lay.chest.z + 1.5);
      queueAnnounce('FIRST CLEAR — BONUS CACHE', 22);
    }
    GH.meta.data.world.dungeons[curZone] = true;
    GH.meta.save();
    if (worldH.chestMesh && worldH.chestMesh.userData.core) {
      worldH.chestMesh.userData.core.material.opacity = 0.12;
    }
    ascendDungeon();
    saveExpedition();
  }

  // (tier ascension replaced in-run deeper gates: the overworld gate
  // itself climbs one tier per clear, with fresh modifiers stacking)

  // solid geometry in the loaded zone: maze cells, hall walls, barriers.
  // carrying=true adds the matter screens (they refuse carried cargo).
  function zoneBlockedAt(x, z, carrying) {
    if (!worldH || !zoneNow) return false;
    if (GH.terrain.solidAt(x, z)) return true;
    if (worldH.layout.maze &&
      GH.dungeons.mazeBlocked(worldH.layout.maze, zoneNow.size, x, z)) return true;
    if (worldH.layout.halls &&
      GH.dungeons.hallsBlocked(worldH.layout.halls,
        dungeonState && dungeonState.barrierOpen, x, z, 0.6, !!carrying)) return true;
    return false;
  }

  function dungeonStatusText() {
    var ds = dungeonState;
    if (!ds) return null;
    if (ds.opened) return 'CLEARED';
    if (ds.arch === 'hive') return ds.done ? 'CACHE UNSEALED' : 'EXTERMINATE — ' + ds.remaining + ' LEFT';
    if (ds.arch === 'gauntlet') {
      return ds.done ? 'CACHE UNSEALED'
        : 'RUSH ' + GH.fmt1(Math.max(0, ds.timer)) + 's · RING ' + (ds.cp + 1) + '/' + worldH.layout.checkpoints.length;
    }
    if (ds.arch === 'bastion') {
      if (ds.done) return 'CACHE UNSEALED';
      if (ds.failed) return 'RELIC LOST — AWAKEN IT AGAIN';
      if (ds.defenseActive) return 'WAVE ' + ds.wave + '/4 · RELIC ' + Math.max(0, Math.round(ds.objHp / ds.objMax * 100)) + '%';
      return 'AWAKEN THE RELIC';
    }
    if (ds.arch === 'labyrinth') return 'FIND THE HEART';
    if (ds.arch === 'fluxways') return 'CROSS ON THE SAFE LANES';
    if (ds.arch === 'raceway') {
      if (ds.done) return 'CACHE UNSEALED';
      if (!ds.race) return 'START AT THE GOLD PYLONS';
      if (ds.race.countdown > 0) return Math.ceil(ds.race.countdown) + '…';
      return 'LAP ' + Math.min(ds.race.lap, ds.race.laps) + '/' + ds.race.laps +
        ' · POS ' + ds.race.pos + '/4';
    }
    if (ds.arch === 'halls') {
      if (ds.carrying) {
        var ck = hallsItemKind(ds.carrying);
        return 'CARRYING THE ' + (HALLS_ITEM_NAMES[ck] || 'CARGO') + ' [E SETS IT DOWN]';
      }
      for (var swk in ds.switchT) {
        if (ds.switchT[swk] > 0) return 'TIMED SEAL — ' + GH.fmt1(ds.switchT[swk]) + 's';
      }
      return worldH.layout.halls.variant === 'master'
        ? 'THE ARCHIVE TESTS EVERYTHING AT ONCE'
        : 'ROUTE POWER — OPEN THE SEALS';
    }
    if (ds.arch === 'convoy') {
      if (ds.done) return 'CACHE UNSEALED';
      if (ds.failed) return 'HAULER DESTROYED — IT REBUILDS AT THE START';
      return ds.hauler ? 'HAULER ' + Math.max(0, Math.round(ds.hauler.hp / ds.hauler.max * 100)) + '%' : '';
    }
    if (ds.arch === 'crucible') {
      return ds.done ? 'CACHE UNSEALED' : 'CHALLENGER ' + Math.min(ds.cruIdx + 1, 3) + '/3';
    }
    if (ds.arch === 'heist') {
      if (ds.done) return 'ESCAPED — PAID IN FULL';
      return ds.heistCarrying ? 'ESCAPE — ' + GH.fmt1(Math.max(0, ds.heistT)) + 's' : 'SEIZE THE RELIC';
    }
    return null; // depths reads like the wilds
  }

  function updateDungeon(dt) {
    var ds = dungeonState;
    if (!ds) return;
    var lay = worldH.layout;
    if (worldH.chestMesh && worldH.chestMesh.userData.core && !ds.opened) {
      worldH.chestMesh.userData.core.material.opacity = 0.6 + Math.sin(runTime * 5) * 0.3;
    }

    if (ds.arch === 'hive' && !ds.done) {
      var alive = 0;
      for (var i = 0; i < enemies.length; i++) {
        if (!enemies[i].dead && !enemies[i].nestId && !enemies[i].def.boss) alive++;
      }
      ds.remaining = alive;
      if (ds.spawned && alive === 0) {
        ds.done = true;
        announce('HIVE EXTERMINATED — THE CACHE UNSEALS', 28);
        GH.audio.win();
      }
    } else if (ds.arch === 'gauntlet' && !ds.done) {
      ds.timer -= dt;
      var cps = lay.checkpoints;
      var cur = cps[ds.cp];
      if (worldH.cpMeshes && worldH.cpMeshes[ds.cp]) {
        worldH.cpMeshes[ds.cp].rotation.z += dt * 3; // the live ring spins
        worldH.cpMeshes[ds.cp].scale.setScalar(1 + Math.sin(runTime * 6) * 0.12);
      }
      if (cur && GH.dist2(player.x, player.z, cur.x, cur.z) < 4.2 * 4.2) {
        if (worldH.cpMeshes[ds.cp]) worldH.cpMeshes[ds.cp].material.opacity = 0.15;
        ds.cp++;
        ds.timer += 11;
        GH.audio.coin();
        if (ds.cp >= cps.length) {
          ds.done = true;
          announce('GAUNTLET CLEARED — THE CACHE UNSEALS', 28);
          GH.audio.win();
        } else {
          announce('RING ' + ds.cp + '/' + cps.length, 18);
        }
      }
      if (!ds.done && ds.timer <= 0) {
        ds.cp = 0;
        ds.timer = 26;
        worldH.cpMeshes.forEach(function (m) { m.material.opacity = 0.8; });
        player.x = 0;
        player.z = GH.world.BOUNDS.z - 26;
        announce('OUT OF TIME — RUN IT AGAIN', 24);
        GH.audio.hit();
      }
    } else if (ds.arch === 'fluxways') {
      var lf = lay.flux;
      // recolor the shifting tiles from the same truth the damage uses
      if (worldH.fluxTiles) {
        for (var ti = 0; ti < worldH.fluxTiles.length; ti++) {
          var tile = worldH.fluxTiles[ti];
          var safe = GH.dungeons.fluxSafe(lf, runTime, tile.userData.fx, tile.userData.fz, zoneNow.size);
          tile.material.color.setHex(safe ? 0x2a8a4a : 0x992211);
          tile.material.opacity = safe ? 0.22 : 0.4 + Math.sin(runTime * 8) * 0.06;
        }
      }
      if (!GH.dungeons.fluxSafe(lf, runTime, player.x, player.z, zoneNow.size)) {
        ds.fluxTick -= dt;
        if (ds.fluxTick <= 0) {
          ds.fluxTick = 0.5;
          playerDamage(8 + zoneNow.danger * 4 + player.stats.armor, null, 'arc');
        }
      } else {
        ds.fluxTick = 0.25;
      }
    } else if (ds.arch === 'bastion' && ds.defenseActive) {
      updateDefense(dt);
    } else if (ds.arch === 'raceway' && ds.race && !ds.done) {
      updateRaceway(dt);
    } else if (ds.arch === 'halls') {
      updateHalls(dt, lay);
    } else if (ds.arch === 'convoy' && ds.hauler && !ds.done) {
      updateConvoy(dt, lay);
    } else if (ds.arch === 'crucible' && !ds.done) {
      updateCrucible(dt, lay);
    } else if (ds.arch === 'heist' && ds.heistCarrying && !ds.done) {
      ds.heistT -= dt;
      if (worldH.relicMesh) worldH.relicMesh.visible = false;
      // the alarm floods the halls
      ds.heistSpawnT = (ds.heistSpawnT || 0) - dt;
      if (ds.heistSpawnT <= 0) {
        ds.heistSpawnT = 5;
        for (var hs = 0; hs < 2 + Math.floor(zoneNow.danger / 2); hs++) {
          var ha = Math.random() * Math.PI * 2;
          var he = spawnEnemy(GH.weightedPick(wavePlan.types).id,
            player.x + Math.cos(ha) * GH.rand(18, 26), player.z + Math.sin(ha) * GH.rand(18, 26));
          if (he) { he.aggro = true; he.event = true; }
        }
      }
      if (ds.heistT <= 0) {
        ds.heistCarrying = false;
        if (worldH.relicMesh) worldH.relicMesh.visible = true;
        announce('THE RELIC PHASES BACK TO ITS PLINTH — SEIZE IT AGAIN', 26);
        GH.audio.die();
      }
    }
  }

  // ---------------- RACEWAY: a combat race ----------------
  function startRaceway() {
    var ds = dungeonState;
    var rw = worldH.layout.raceway;
    // clear the field, summon three rivals to the grid
    for (var i = enemies.length - 1; i >= 0; i--) {
      if (!enemies[i].nestId) { scene.remove(enemies[i].mesh); enemies.splice(i, 1); }
    }
    ds.race = {
      lap: 1, gate: 1, laps: rw.laps, pos: 1, countdown: 3.9,
      rivals: [], respawns: [], style: 0, lightStep: -1,
      throttleAt: null, launched: false
    };
    for (var rv = 0; rv < 3; rv++) {
      var gridPt = rw.path[2 + rv * 2];
      var rr = spawnEnemy('racer', gridPt.x, gridPt.z);
      if (rr) {
        rr.aggro = true;
        rr.event = true;
        rr.racer = true;
        rr.racePi = 2 + rv * 2;
        rr.raceLap = 1;
        rr.raceGate = 1;
        rr.raceSkill = 13 + rv * 1.0;
        ds.race.rivals.push(rr);
      }
    }
    if (!player.speederOn) toggleSpeeder(); // the race runs in vehicle form
    if (player.drive) { player.drive.spd = 0; player.drive.nitro = 0; }
    announce('THREE LAPS — LIVE FIRE PERMITTED. THROTTLE ON THE GREEN.', 30);
    GH.audio.boss();
  }

  function racewayProgress(lap, gateIdx) { return lap * 100 + gateIdx; }

  function updateRaceway(dt) {
    var ds = dungeonState;
    var rw = worldH.layout.raceway;
    var race = ds.race;
    if (race.countdown > 0) {
      race.countdown -= dt;
      // NFSU launch window: first throttle inside the last 0.7s primes nitro
      var throttling = player.moveX !== 0 || player.moveZ !== 0;
      if (throttling && race.throttleAt === null) race.throttleAt = race.countdown;
      if (!throttling) race.throttleAt = null;
      // hold the grid: no rolling starts
      if (player.drive) { player.drive.spd = Math.min(player.drive.spd, 2); }
      // gantry lamps: red, red, red ... green
      var step = race.countdown > 2.6 ? 0 : race.countdown > 1.3 ? 1 : 2;
      if (step !== race.lightStep) {
        race.lightStep = step;
        GH.audio.coin();
        if (worldH.raceLights) {
          worldH.raceLights.forEach(function (lamp, li) {
            lamp.material.color.setHex(li <= step ? 0xff4040 : 0x552222);
            lamp.material.opacity = li <= step ? 0.95 : 0.5;
          });
        }
      }
      if (race.countdown <= 0) {
        if (worldH.raceLights) {
          worldH.raceLights.forEach(function (lamp) {
            lamp.material.color.setHex(0x40ff70);
            lamp.material.opacity = 0.95;
          });
        }
        GH.audio.dash();
        if (race.throttleAt !== null && race.throttleAt <= 0.7 && player.drive) {
          player.drive.nitro = Math.min(1, player.drive.nitro + 0.6);
          announce('PERFECT LAUNCH — NITRO PRIMED', 22);
        } else {
          announce('GO', 26);
        }
      }
      return;
    }
    var gateEvery = Math.floor(rw.path.length / rw.gates);
    // player gates
    var pg = rw.path[(race.gate % rw.gates) * gateEvery];
    if (GH.dist2(player.x, player.z, pg.x, pg.z) < 7 * 7) {
      race.gate++;
      GH.audio.coin();
      if (race.gate > rw.gates) {
        race.gate = 1;
        race.lap++;
        if (race.lap > race.laps) {
          ds.done = true;
          announce('CHECKERED — THE CACHE UNSEALS', 30);
          // a podium in a house's series counts with the house; their own pledges race for more
          var owner = GH.factions.byZone(curZone);
          GH.factions.deed(curZone, 'podium', race.pos === 1 ? 10 : 4);
          var series = owner && GH.factions.state().pledge === owner.id ? 1.25 : 1;
          // the drift ledger pays out as style salvage
          var styleBonus = Math.min(150, Math.round((race.style || 0) / 4 * series));
          if (styleBonus >= 10) {
            GH.meta.data.salvage += styleBonus;
            GH.meta.save();
            queueAnnounce('STYLE BONUS — +' + styleBonus + ' SALVAGE FOR THE SLIDES', 24);
          }
          GH.audio.win();
          return;
        }
        announce('LAP ' + race.lap + '/' + race.laps, 24);
      }
    }
    // rivals ride the centerline; destroyed ones regrid after a beat
    var playerProg = racewayProgress(race.lap, race.gate);
    var bestRivalProg = 0;
    race.rivals.forEach(function (rr) {
      if (rr.dead) return;
      var tp = rw.path[rr.racePi % rw.path.length];
      if (GH.dist2(rr.x, rr.z, tp.x, tp.z) < 25) rr.racePi++;
      // rubber-band around the player's progress
      var band = playerProg - racewayProgress(rr.raceLap, rr.raceGate);
      rr.raceSpeed = rr.raceSkill * (band > 2 ? 1.35 : band < -2 ? 0.8 : 1);
      // gate bookkeeping
      var rg = rw.path[(rr.raceGate % rw.gates) * gateEvery];
      if (GH.dist2(rr.x, rr.z, rg.x, rg.z) < 8 * 8) {
        rr.raceGate++;
        if (rr.raceGate > rw.gates) {
          rr.raceGate = 1;
          rr.raceLap++;
          if (rr.raceLap > race.laps) {
            // a rival takes it — reset to try again
            announce('A RIVAL TAKES THE FLAG — RESTART AT THE PYLONS', 28);
            GH.audio.die();
            race.rivals.forEach(function (r2) {
              if (!r2.dead) { r2.dead = true; scene.remove(r2.mesh); }
            });
            ds.race = null;
            return;
          }
        }
      }
      bestRivalProg = Math.max(bestRivalProg, racewayProgress(rr.raceLap, rr.raceGate));
    });
    if (!ds.race) return; // the reset above
    // respawn destroyed rivals at their last gate, two gates back
    race.rivals.forEach(function (rr) {
      if (rr.dead && !rr.regridT) rr.regridT = 3;
    });
    race.rivals.forEach(function (rr, idx) {
      if (!rr.dead || !rr.regridT) return;
      rr.regridT -= dt;
      if (rr.regridT <= 0) {
        var backGate = Math.max(1, rr.raceGate - 2);
        var np = rw.path[(backGate % rw.gates) * gateEvery];
        var nr = spawnEnemy('racer', np.x, np.z);
        if (nr) {
          nr.aggro = true; nr.event = true; nr.racer = true;
          nr.racePi = (backGate % rw.gates) * gateEvery + 1;
          nr.raceLap = rr.raceLap;
          nr.raceGate = backGate;
          nr.raceSkill = rr.raceSkill;
          race.rivals[idx] = nr;
          queueAnnounce('A RIVAL REGRIDS', 14);
        }
      }
    });
    race.pos = 1 + race.rivals.filter(function (rr) {
      return !rr.dead && racewayProgress(rr.raceLap, rr.raceGate) > playerProg;
    }).length;
  }

  // ---------------- CIPHER HALLS: the full cipher circuit ----------------
  // plates + weights, beam emitters/relays/receptors, the one jammer,
  // timed switches, matter screens. All truth lives in GH.dungeons.hallsSolve;
  // this just gathers inputs and paints the answer.
  function hallsItemKind(id) {
    var items = worldH.layout.halls.items;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i].kind;
    return 'core';
  }
  var HALLS_ITEM_NAMES = { core: 'POWER CORE', relay: 'BEAM RELAY', jammer: 'SIGNAL JAMMER' };

  function updateHalls(dt, lay) {
    var ds = dungeonState;
    var halls = lay.halls;
    // carried cargo rides on the frame's back
    if (ds.carrying && worldH.coreMeshes[ds.carrying]) {
      worldH.coreMeshes[ds.carrying].position.set(player.x, 2.6 + gy(player.x, player.z), player.z);
      worldH.coreMeshes[ds.carrying].rotation.y += dt * 2;
    }
    // timed switch windows tick down
    for (var swId in ds.switchT) {
      if (ds.switchT[swId] > 0) {
        ds.switchT[swId] -= dt;
        if (ds.switchT[swId] <= 0) {
          ds.switchT[swId] = 0;
          announce('THE TIMED SEAL SLAMS SHUT', 18);
          GH.audio.hit();
        } else if (ds.switchT[swId] < 3 && Math.floor(ds.switchT[swId] * 2) !== Math.floor((ds.switchT[swId] + dt) * 2)) {
          GH.audio.tick ? GH.audio.tick() : GH.audio.coin();
        }
      }
    }
    // plate state: pilot, wingmate, or any grounded object with mass
    var pressed = {};
    halls.plates.forEach(function (pl) {
      var pr = pl.r || 2.4;
      var held = GH.dist2(player.x, player.z, pl.x, pl.z) < pr * pr;
      if (!held && mate && !mate.down) {
        held = GH.dist2(mate.x, mate.z, pl.x, pl.z) < pr * pr;
      }
      if (!held) {
        for (var cid in ds.corePos) {
          if (ds.carrying === cid) continue;
          var cp = ds.corePos[cid];
          var wr = Math.max(2.2, pr - 0.2);
          if (GH.dist2(cp.x, cp.z, pl.x, pl.z) < wr * wr) { held = true; break; }
        }
      }
      pressed[pl.id] = held;
      var pm = worldH.plateMeshes[pl.id];
      if (pm && pm.userData.glow) {
        pm.userData.glow.material.opacity = held ? 0.95 : 0.35 + Math.sin(runTime * 4) * 0.15;
      }
    });
    // switch-opened seals
    var switchOpen = {};
    (halls.switches || []).forEach(function (sw) {
      if (ds.switchT[sw.id] > 0) switchOpen[sw.opens] = true;
      var swm = worldH.switchMeshes && worldH.switchMeshes[sw.id];
      if (swm) {
        var live = ds.switchT[sw.id] > 0;
        swm.userData.arm.rotation.z = GH.lerp(swm.userData.arm.rotation.z, live ? -0.5 : 0.5, dt * 8);
        swm.userData.lamp.material.opacity = live
          ? 0.6 + Math.sin(runTime * 10) * 0.35 : 0.35;
      }
    });
    // once the cache is open every seal releases — the hall stands solved
    if (ds.opened) {
      halls.barriers.forEach(function (br) { ds.barrierOpen[br.id] = true; });
    } else {
      var solved = GH.dungeons.hallsSolve(halls, ds.barrierOpen, ds.corePos, ds.carrying, pressed, switchOpen);
      ds.barrierOpen = solved.open;
      ds.litR = solved.lit;
      ds.jammedB = solved.jammed;
      ds.beamLinks = solved.links.slice();
      if (solved.jamRay) ds.beamLinks.push({ x1: solved.jamRay.x1, z1: solved.jamRay.z1, x2: solved.jamRay.x2, z2: solved.jamRay.z2, jam: true });
    }
    // paint: seals
    halls.barriers.forEach(function (br) {
      var bm = worldH.barrierMeshes[br.id];
      if (!bm) return;
      var open = ds.barrierOpen[br.id];
      bm.visible = !open;
      if (!open) bm.material.opacity = 0.3 + Math.sin(runTime * 6) * 0.12;
    });
    // receptors light when fed
    (halls.receptors || []).forEach(function (rc) {
      var rm = worldH.receptorMeshes && worldH.receptorMeshes[rc.id];
      if (rm && rm.userData.eye) {
        var lit = !!ds.litR[rc.id];
        rm.userData.eye.material.opacity = lit ? 0.85 + Math.sin(runTime * 8) * 0.15 : 0.22;
        rm.userData.eye.rotation.y += dt * (lit ? 4 : 0.6);
      }
    });
    // matter screens shimmer harder at a laden pilot
    if (worldH.screenMeshes) {
      for (var scId in worldH.screenMeshes) {
        worldH.screenMeshes[scId].material.opacity = ds.carrying
          ? 0.4 + Math.sin(runTime * 9) * 0.12 : 0.15;
      }
    }
    // beams: stretch pool segments along the live links
    if (worldH.beamPool) {
      for (var bi = 0; bi < worldH.beamPool.length; bi++) {
        var beam = worldH.beamPool[bi];
        var link = ds.beamLinks[bi];
        if (!link) { beam.visible = false; continue; }
        var bdx = link.x2 - link.x1, bdz = link.z2 - link.z1;
        var blen = Math.sqrt(bdx * bdx + bdz * bdz);
        beam.visible = true;
        beam.scale.set(0.22, 0.22, Math.max(0.1, blen));
        beam.position.set((link.x1 + link.x2) / 2, link.jam ? 1.2 : 2.2, (link.z1 + link.z2) / 2);
        beam.rotation.y = Math.atan2(bdx, bdz);
        beam.material.color.setHex(link.jam ? 0xe080ff : 0x8ae8ff);
        beam.material.opacity = (link.jam ? 0.5 : 0.45) + Math.sin(runTime * 10 + bi) * 0.12;
      }
    }
  }

  function hallsCoreInteract(input) {
    var ds = dungeonState;
    if (!ds || ds.arch !== 'halls' || !input.interactPressed) return false;
    var halls = worldH.layout.halls;
    // timed switches first: pull one within reach
    var sws = halls.switches || [];
    for (var si = 0; si < sws.length; si++) {
      var sw = sws[si];
      if (GH.dist2(player.x, player.z, sw.x, sw.z) < 3 * 3) {
        ds.switchT[sw.id] = sw.window;
        input.interactPressed = false;
        GH.audio.card();
        announce('TIMED SEAL OPEN — ' + sw.window + ' SECONDS. MOVE.', 20);
        return true;
      }
    }
    if (player.speederOn) {
      // cargo handling wants hands, not thrusters
      var nearAny = false;
      for (var scd in ds.corePos) {
        if (GH.dist2(player.x, player.z, ds.corePos[scd].x, ds.corePos[scd].z) < 3 * 3) { nearAny = true; break; }
      }
      if (nearAny || ds.carrying) {
        input.interactPressed = false;
        announce('DISMOUNT TO HANDLE CARGO [T]', 18);
        return true;
      }
      return false;
    }
    if (ds.carrying) {
      // set it down here — unless a matter screen owns this ground
      if (GH.dungeons.inScreen(halls, player.x, player.z)) {
        input.interactPressed = false;
        announce('THE SCREEN REJECTS CARRIED MATTER', 18);
        GH.audio.hit();
        return true;
      }
      ds.corePos[ds.carrying] = { x: player.x, z: player.z };
      if (worldH.coreMeshes[ds.carrying]) {
        worldH.coreMeshes[ds.carrying].position.set(
          player.x, hallsItemKind(ds.carrying) === 'core' ? 0.8 : 0, player.z);
      }
      ds.carrying = null;
      input.interactPressed = false;
      GH.audio.card();
      return true;
    }
    // pick up the nearest portable
    var bestId = null, bestD = 2.6 * 2.6;
    for (var cid in ds.corePos) {
      var cp = ds.corePos[cid];
      var d2 = GH.dist2(player.x, player.z, cp.x, cp.z);
      if (d2 < bestD) { bestD = d2; bestId = cid; }
    }
    if (bestId) {
      if (GH.dungeons.inScreen(halls, player.x, player.z)) {
        input.interactPressed = false;
        announce('THE SCREEN REJECTS CARRIED MATTER', 18);
        GH.audio.hit();
        return true;
      }
      ds.carrying = bestId;
      input.interactPressed = false;
      GH.audio.card();
      var kind = hallsItemKind(bestId);
      announce((HALLS_ITEM_NAMES[kind] || 'CARGO') + ' LIFTED — IT WEIGHS ON THE SERVOS', 18);
      return true;
    }
    return false;
  }

  // ---------------- CONVOY: walk the hauler home ----------------
  function updateConvoy(dt, lay) {
    var ds = dungeonState;
    var h = ds.hauler;
    var path = lay.convoyPath;
    if (ds.failed) {
      // it rebuilds at the start after a breath
      ds.rebuildT = (ds.rebuildT || 6) - dt;
      if (ds.rebuildT <= 0) {
        ds.failed = false;
        ds.rebuildT = null;
        h.hp = h.max;
        h.wp = 1;
        h.x = path[0].x; h.z = path[0].z;
        h.fired = {};
        ds.haulerMesh.visible = true;
        announce('THE HAULER ROLLS AGAIN', 24);
      }
      return;
    }
    var wp = path[h.wp];
    if (!wp) return;
    // ambush trips as the hauler arrives
    var wd2 = GH.dist2(h.x, h.z, wp.x, wp.z);
    if (wd2 < 9 && wp.ambush && !h.fired[h.wp]) {
      h.fired[h.wp] = true;
      announce('AMBUSH!', 26);
      GH.audio.boss();
      for (var am = 0; am < 4 + zoneNow.danger; am++) {
        var aa = Math.random() * Math.PI * 2;
        var ae = spawnEnemy(GH.weightedPick(wavePlan.types).id,
          h.x + Math.cos(aa) * GH.rand(12, 18), h.z + Math.sin(aa) * GH.rand(12, 18));
        if (ae) { ae.aggro = true; ae.event = true; ae.huntHauler = true; }
      }
    }
    if (wd2 < 9) {
      h.wp++;
      if (h.wp >= path.length) {
        ds.done = true;
        announce('THE HAULER DOCKS — THE CACHE UNSEALS', 30);
        GH.audio.win();
        return;
      }
    }
    // it rolls while the pilot is close and the road is quiet enough
    var hunters = 0;
    for (var hu = 0; hu < enemies.length; hu++) {
      var hue = enemies[hu];
      if (!hue.dead && hue.huntHauler && GH.dist2(hue.x, hue.z, h.x, h.z) < 8 * 8) hunters++;
    }
    var escortNear = GH.dist2(player.x, player.z, h.x, h.z) < 26 * 26;
    if (hunters === 0 && escortNear) {
      var wa = GH.angleTo(h.x, h.z, wp.x, wp.z);
      h.x += Math.sin(wa) * 3.4 * dt;
      h.z += Math.cos(wa) * 3.4 * dt;
      ds.haulerMesh.rotation.y = wa;
    }
    // hunters chew the hauler
    if (hunters > 0) h.hp -= Math.min(hunters, 6) * (2 + zoneNow.danger * 0.8) * dt;
    ds.haulerMesh.position.set(h.x, 0 + gy(h.x, h.z), h.z);
    if (ds.haulerMesh.userData.core) {
      ds.haulerMesh.userData.core.scale.setScalar(1 + Math.sin(runTime * 6) * 0.2);
    }
    if (h.hp <= 0) {
      ds.failed = true;
      ds.haulerMesh.visible = false;
      spawnBurst(h.x, 2, h.z, 0xffa040, 26);
      GH.audio.explode();
      announce('THE HAULER IS DESTROYED', 28);
      // its hunters disperse
      for (var dh = enemies.length - 1; dh >= 0; dh--) {
        if (enemies[dh].huntHauler) { scene.remove(enemies[dh].mesh); enemies.splice(dh, 1); }
      }
    }
  }

  // ---------------- CRUCIBLE: revenant frames, one by one ----------------
  var CRUCIBLE_ROSTER = ['fang', 'hexen', 'viper', 'morrow', 'strix', 'titan'];
  function updateCrucible(dt, lay) {
    var ds = dungeonState;
    var bossAlive = false;
    for (var i = 0; i < enemies.length; i++) {
      if (!enemies[i].dead && enemies[i].def.boss) { bossAlive = true; break; }
    }
    if (bossAlive) return;
    if (ds.cruIdx >= lay.crucible.bosses) {
      ds.done = true;
      announce('THE CRUCIBLE IS COLD — THE CACHE UNSEALS', 30);
      GH.audio.win();
      return;
    }
    ds.cruWaitT -= dt;
    if (ds.cruWaitT <= 0) {
      ds.cruWaitT = 3;
      var rnd = GH.dungeons.rng('cru:' + curZone + ':' + ds.cruIdx);
      var pick = CRUCIBLE_ROSTER[Math.floor(rnd() * CRUCIBLE_ROSTER.length)];
      var cb = spawnEnemy(pick, lay.crucible.x, lay.crucible.z);
      if (cb) {
        // no lairZone: a crucible kill is a bout, not a territory scar
        cb.hp *= 0.55;
        cb.maxHp *= 0.55;
        cb.event = true;
        ds.cruIdx++;
      }
    }
  }

  function startDefense() {
    var ds = dungeonState;
    ds.defenseActive = true;
    ds.failed = false;
    ds.objHp = ds.objMax;
    ds.wave = 0;
    ds.waveT = 4;
    announce('DEFEND ' + worldH.layout.objective.def.name, 30);
    GH.music.setBoss(true);
    GH.audio.boss();
  }

  function updateDefense(dt) {
    var ds = dungeonState;
    var lay = worldH.layout;
    ds.waveT -= dt;
    if (ds.waveT <= 0 && ds.wave < 4) {
      ds.wave++;
      ds.waveT = 20;
      var n = 5 + zoneNow.danger * 2 + ds.wave;
      for (var i = 0; i < n; i++) {
        var br = lay.breaches[i % lay.breaches.length];
        var de = spawnEnemy(GH.weightedPick(wavePlan.types).id,
          br.x + GH.rand(-4, 4), br.z + GH.rand(-4, 4));
        if (de) { de.aggro = true; de.event = true; de.defendObj = true; }
      }
      announce('WAVE ' + ds.wave + '/4', 22);
    }
    // attackers grind the relic down when they reach it — but only so
    // many can crowd the pedestal at once
    var chewing = 0;
    for (var ci = 0; ci < enemies.length; ci++) {
      var ce = enemies[ci];
      if (ce.dead || !ce.defendObj) continue;
      if (GH.dist2(ce.x, ce.z, lay.objective.x, lay.objective.z) < 5.5 * 5.5) chewing++;
    }
    chewing = Math.min(chewing, 8);
    if (chewing > 0) ds.objHp -= chewing * (1.5 + zoneNow.danger * 0.8) * dt;
    // objective mesh groans as it wears
    if (worldH.objectiveMesh && worldH.objectiveMesh.userData.core) {
      worldH.objectiveMesh.userData.core.rotation.y += dt * 0.6;
      worldH.objectiveMesh.position.y = ds.objHp < ds.objMax * 0.35 ? Math.sin(runTime * 20) * 0.05 : 0;
    }
    if (ds.objHp <= 0) {
      ds.defenseActive = false;
      ds.failed = true;
      GH.music.setBoss(false);
      announce('THE RELIC IS LOST — AWAKEN IT TO TRY AGAIN', 28);
      GH.audio.die();
      return;
    }
    // survived every wave and cleaned the field?
    if (ds.wave >= 4) {
      var living = 0;
      for (var li = 0; li < enemies.length; li++) {
        if (!enemies[li].dead && enemies[li].defendObj) living++;
      }
      if (living === 0) {
        ds.defenseActive = false;
        ds.done = true;
        GH.music.setBoss(false);
        announce('THE RELIC SURVIVES — THE CACHE UNSEALS', 30);
        GH.audio.win();
      }
    }
  }

  // =================================================================
  // ZERO HOUR — the guided first ten minutes. A scripted ladder on top
  // of the outpost: walk, look, fight, cast, ward, transform, drive,
  // drift, mine, chase a signal, drop a warden, build a frame. Each step
  // has one sentence, one check, and a beacon where it matters.
  // =================================================================
  var tutorial = null, tutMarker = null;
  var TUT_STEPS = [
    { id: 'move', text: function () { var L = GH.controls.label; return 'Walk 12 m: ' + L('forward') + '/' + L('back') + ' walk, ' + L('turnLeft') + '/' + L('turnRight') + ' turn, ' + L('strafeLeft') + '/' + L('strafeRight') + ' strafe.'; },
      prog: function (t) { return Math.min(12, t.walked) + '/12 m'; }, done: function (t) { return t.walked >= 12; } },
    { id: 'look', text: function () { return 'Hold RIGHT MOUSE and drag to look around. The mouse wheel zooms.'; },
      prog: function (t) { return Math.min(100, Math.round(t.lookAcc / 3)) + '%'; }, done: function (t) { return t.lookAcc >= 300; } },
    { id: 'fight', text: function () { return 'Hostiles ahead. LEFT CLICK one to target and attack it; hold to keep swinging.'; },
      enter: function (t) { t.kills = 0; spawnTutorialPack(3, 12); }, prog: function (t) { return t.kills + '/3 destroyed'; }, done: function (t) { return t.kills >= 3; } },
    { id: 'ability', text: function () { return 'Press ' + GH.controls.label('ability1') + ' to cast RUPTURE on your target. Abilities spend the blue ENERGY bar.'; },
      enter: function (t) { t.casts = 0; player.energy = player.stats.energyMax; spawnTutorialPack(2, 10); }, prog: function (t) { return t.casts + '/1 cast'; }, done: function (t) { return t.casts >= 1; } },
    { id: 'ward', text: function () { var L = GH.controls.label; return 'Raise a WARD with ' + L('ward1') + ' / ' + L('ward2') + ' / ' + L('ward3') + '. A ward matching the incoming damage cuts it by 75%.'; },
      enter: function (t) { t.wards = 0; }, prog: function (t) { return t.wards + '/1 raised'; }, done: function (t) { return t.wards >= 1; } },
    { id: 'transform', text: function () { return 'Press ' + GH.controls.label('transform') + ' to fold into your vehicle.'; },
      enter: function (t) { t.transforms = 0; }, prog: function () { return ''; }, done: function (t) { return t.transforms >= 1; } },
    { id: 'drive', text: function () { var L = GH.controls.label; return 'Drive 60 m: ' + L('forward') + ' throttle, ' + L('back') + ' brake, ' + L('turnLeft') + '/' + L('turnRight') + ' steer. ' + L('special') + ' burns nitro.'; },
      enter: function (t) { t.driven = 0; }, prog: function (t) { return Math.min(60, Math.round(t.driven)) + '/60 m'; }, done: function (t) { return t.driven >= 60; } },
    { id: 'drift', text: function () { return 'Hold ' + GH.controls.label('boost') + ' while steering at speed to DRIFT, then let go for a TURBO. Pay out one turbo.'; },
      enter: function (t) { t.turbos = 0; }, prog: function (t) { return t.turbos + '/1 turbo'; }, done: function (t) { return t.turbos >= 1; } },
    { id: 'vein', text: function () { return 'Alloy builds new frames. Follow the beacon to the vein and press ' + GH.controls.label('interact') + ' to mine it (any form).'; },
      enter: function (t) { t.veins = 0; t.beacon = nearestVein(); }, prog: function (t) { return beaconDist(t) + ' m'; }, done: function (t) { return t.veins >= 1; } },
    { id: 'signal', text: function () { return 'A CACHE SIGNAL. Treasure sites ping every few minutes and show gold on the minimap. Follow the beacon and pick it up.'; },
      enter: function (t) { t.signals = 0; t.beacon = spawnTutorialSignal(); }, prog: function (t) { return beaconDist(t) + ' m'; }, done: function (t) { return t.signals >= 1; } },
    { id: 'boss', text: function () { return 'A RUST WARDEN is hunting you. Bosses drop FRAME CORES. Target it, ward against it, and bring it down.'; },
      enter: function (t) { t.bosses = 0; t.beacon = spawnTutorialBoss(); }, prog: function (t) { return t.bosses ? 'DOWN' : 'hunt it'; }, done: function (t) { return t.bosses >= 1; } },
    { id: 'build', text: function () { return 'Return to camp, use the CONSOLE (' + GH.controls.label('interact') + ') → FRAME WORKSHOP → build your first frame. The bill is covered.'; },
      enter: function (t) {
        t.builds = 0; t.beacon = { x: GH.world.CAMP.x - 5, z: GH.world.CAMP.z + 4 };
        var m = GH.meta.data.mats;
        if (m.alloy < 60) m.alloy = 60;
        if (GH.meta.data.salvage < 80) GH.meta.data.salvage = 80;
        GH.meta.save();
      }, prog: function (t) { return beaconDist(t) + ' m to camp'; }, done: function (t) { return t.builds >= 1; } }
  ];
  function nearestVein() {
    var best = null, bd = 1e9;
    for (var i = 0; i < veins.length; i++) {
      if (veins[i].mined) continue;
      var d2 = GH.dist2(player.x, player.z, veins[i].x, veins[i].z);
      if (d2 < bd) { bd = d2; best = veins[i]; }
    }
    return best ? { x: best.x, z: best.z } : null;
  }
  function beaconDist(t) { return t.beacon ? Math.round(Math.sqrt(GH.dist2(player.x, player.z, t.beacon.x, t.beacon.z))) : 0; }
  function aheadSpot(dist) {
    var a = player.facing || 0;
    var x = player.x + Math.sin(a) * dist, z = player.z + Math.cos(a) * dist;
    var sp = openSpot(x, z, 1.0);
    return sp ? sp : { x: x, z: z };
  }
  function spawnTutorialPack(n, dist) {
    for (var i = 0; i < n; i++) {
      var sp = aheadSpot(dist + i * 2);
      var e = spawnEnemy('husk', sp.x + (i - 1) * 2.2, sp.z);
      if (e) { e.tut = true; e.aggro = true; e.hp = e.maxHp = Math.round(e.maxHp * 0.7); }
    }
  }
  function spawnTutorialSignal() {
    var sp = aheadSpot(40);
    spawnPickup('cache', sp.x, sp.z);
    var pk = pickups[pickups.length - 1];
    pk.signal = true; pk.vx = 0; pk.vz = 0;
    signalSpot = { x: sp.x, z: sp.z, t: 0 };
    GH.audio.signal();
    return { x: sp.x, z: sp.z };
  }
  function spawnTutorialBoss() {
    var sp = aheadSpot(22);
    var e = spawnEnemy('warden', sp.x, sp.z);
    if (e) { e.tutBoss = true; e.aggro = true; e.hp = e.maxHp = Math.round(e.maxHp * 0.45); }
    GH.audio.boss();
    return e ? { x: sp.x, z: sp.z, e: e } : { x: sp.x, z: sp.z };
  }
  function tutorialEvent(kind, n) {
    if (!tutorial) return;
    var t = tutorial;
    var map = { kill: 'kills', ability: 'casts', ward: 'wards', transform: 'transforms', drift: 'turbos', vein: 'veins', signal: 'signals', boss: 'bosses', build: 'builds' };
    var key = map[kind];
    if (key) t[key] = (t[key] || 0) + (n || 1);
  }
  G.tutorialEvent = tutorialEvent;
  G.tutorialActive = function () { return !!tutorial; };

  function startTutorial() {
    tutorial = { step: -1, walked: 0, lookAcc: 0, driven: 0, lastX: player.x, lastZ: player.z, doneT: 0, beacon: null, stepT: 0 };
    if (!tutMarker) {
      tutMarker = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 14, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffd050, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    }
    scene.add(tutMarker);
    tutMarker.visible = false;
    nextTutorialStep();
    var ob = document.getElementById('objective');
    if (ob) ob.classList.remove('hidden');
  }
  function nextTutorialStep() {
    var t = tutorial;
    t.step++;
    t.stepT = 0;
    if (t.step >= TUT_STEPS.length) { finishTutorial(false); return; }
    var st = TUT_STEPS[t.step];
    t.beacon = null;
    if (st.enter) st.enter(t);
    queueAnnounce('ZERO HOUR ' + (t.step + 1) + '/' + TUT_STEPS.length, 22);
    GH.audio.step();
  }
  function finishTutorial(skipped) {
    var ob = document.getElementById('objective');
    if (ob) ob.classList.add('hidden');
    if (tutMarker) scene.remove(tutMarker);
    if (!skipped) {
      grantMats(100, 2, true);
      GH.meta.data.salvage += 200;
      GH.meta.data.skillPoints += 1;
      GH.meta.data.attrPts = (GH.meta.data.attrPts || 0) + 1;
      queueAnnounce('ZERO HOUR COMPLETE — +100 ALLOY · +2 CORES · +200 SALVAGE · +1 SKILL POINT · +1 ATTRIBUTE POINT', 26);
      GH.audio.win();
    }
    GH.meta.data.tutorial = { done: true, when: new Date().toISOString().slice(0, 10), skipped: !!skipped };
    GH.meta.save();
    tutorial = null;
    lastDom['objective-text'] = null;
  }
  G.skipTutorial = function () { if (tutorial) finishTutorial(true); };

  function updateTutorial(dt, input) {
    var t = tutorial;
    if (!t) return;
    t.stepT += dt;
    // distance on foot / on skids
    var dx = player.x - t.lastX, dz = player.z - t.lastZ;
    var moved = Math.sqrt(dx * dx + dz * dz);
    if (moved < 5) { if (player.speederOn) t.driven += moved; else t.walked += moved; }
    t.lastX = player.x; t.lastZ = player.z;
    if (t.step < 0 || t.step >= TUT_STEPS.length) return;
    var st = TUT_STEPS[t.step];
    // the beacon: a tall light where the step wants you
    if (t.beacon && t.beacon.e && !t.beacon.e.dead) { t.beacon.x = t.beacon.e.x; t.beacon.z = t.beacon.e.z; }
    if (tutMarker) {
      tutMarker.visible = !!t.beacon;
      if (t.beacon) tutMarker.position.set(t.beacon.x, gy(t.beacon.x, t.beacon.z) + 7, t.beacon.z);
      tutMarker.rotation.y += dt;
    }
    if (st.id === 'fight' || st.id === 'ability') {
      // the pack always finds you: respawn a straggler that wandered off
      var alive = enemies.filter(function (e) { return e.tut && !e.dead; }).length;
      if (alive === 0 && !st.done(t)) spawnTutorialPack(1, 8);
    }
    if (st.id === 'boss' && t.beacon && t.beacon.e && t.beacon.e.dead && !t.bosses) t.bosses = 1;
    setText(document.getElementById('objective-title'), 'ZERO HOUR · ' + (t.step + 1) + '/' + TUT_STEPS.length + (st.prog(t) ? ' · ' + st.prog(t) : ''));
    setText(document.getElementById('objective-text'), st.text(t));
    if (st.done(t)) {
      if (t.doneT === 0) { GH.audio.levelup(); }
      t.doneT += dt;
      if (t.doneT > 0.8) { t.doneT = 0; nextTutorialStep(); }
    }
  }

  G.playtime = function () { return runTime; };
  G.startExpedition = function (mechIndex, opts) {
    opts = opts || {};
    clearWorld();
    weekly = null;
    G.mode = 'expedition';
    expActive = true;
    stageIndex = 0;
    kills = 0; coinsRun = 0; runTime = 0; hitCount = 0; sparksRun = 0;
    elitesSpawned = 0;
    announceQueue.length = 0;
    document.getElementById('hint-line').classList.add('hidden');

    var w = GH.meta.data.world;
    weatherToday = GH.world.weatherToday();
    weatherNow = null;
    weatherT = 0;
    harrowUp = false;
    harrowSpot = w.harrowDay !== GH.world.dayStamp() ? GH.world.harrowToday() : null;

    if (w.exp) {
      restoreCharacter(w.exp);
      curZone = w.exp.zone || 'wreck';
    } else {
      player = makePlayer(GH.mechs[mechIndex]);
      curZone = 'wreck';
      player.x = GH.world.CAMP.x;
      player.z = GH.world.CAMP.z + 4;
      var mb2 = GH.progress.masteryBonus(player.def.id);
      player.stats.damageMult += mb2.damageMult;
      player.stats.maxHP += mb2.maxHP;
      player.hp = player.stats.maxHP;
      player.stats.boostRegen += mb2.boostRegen;
      if (mb2.energyBonus) player.stats.energyRegen *= 1.1;
      saveExpedition();
    }

    mate = null;
    if (G.coop) spawnWingmate(mechIndex);
    wallRing.visible = false;
    floor.visible = false; // each zone brings its own ground
    loadZone(curZone, null);
    // an old save's position may not fit this map — keep it in bounds
    player.x = GH.clamp(player.x, -GH.world.BOUNDS.x + 3, GH.world.BOUNDS.x - 3);
    player.z = GH.clamp(player.z, -GH.world.BOUNDS.z + 3, GH.world.BOUNDS.z - 3);
    // a save standing where a wall, rock or sky now is steps to open ground
    var sp0 = openSpot(player.x, player.z, 0.8);
    if (sp0) { player.x = sp0.x; player.z = sp0.z; }
    camGround = gy(player.x, player.z);
    camYaw = player.facing || Math.PI;
    travelCd = 2;
    waveNum = 0;
    G.state = 'play';
    updateHUDStatic();
    document.getElementById('hud').classList.remove('hidden');
    var mm = document.getElementById('minimap');
    if (mm) mm.classList.remove('hidden');
    var cl = cleanseCount();
    announce('THE SHATTERED REACH' + (GH.worldlife.band().id !== 'bronze' && !opts.tutorial ? ' — ' + GH.worldlife.band().name + ' BAND' : ''), 34);
    queueAnnounce(zoneNow.name + ' — DANGER ' + ['I', 'II', 'III', 'IV'][zoneNow.danger - 1], 24);
    queueAnnounce('NESTS CLEANSED ' + cl.dead + '/' + cl.total, 20);
    if (harrowSpot) {
      queueAnnounce('THE HARROW STALKS ' + GH.world.stageFor(harrowSpot.zone).name, 22);
    }
    if (huntSpot) queueAnnounce('HUNT: ' + huntSpot.name + ' — MARKED ON THE MAP', 22);
    tutorial = null;
    if (opts.tutorial) startTutorial();
    else { var ob0 = document.getElementById('objective'); if (ob0) ob0.classList.add('hidden'); }
  };

  function nestById(id) {
    for (var i = 0; i < worldH.layout.nests.length; i++) {
      if (worldH.layout.nests[i].id === id) return worldH.layout.nests[i];
    }
    return null;
  }

  // spawn a nest into the live enemy list as an attackable structure
  function activateNest(n) {
    if (n.live) return;
    n.live = true;
    var zone = zoneNow;
    var e = {
      id: 'nest', nestId: n.id, def: {
        name: 'Husk Nest', hp: n.hp, speed: 0, damage: 0,
        radius: 1.7, xp: 8, mass: 99, behavior: 'static'
      },
      mesh: worldH.nestMeshes[n.id],
      x: n.x, z: n.z, vx: 0, vz: 0,
      hp: n.hp, maxHp: n.hp, damage: 0,
      attackCd: 99, shootCd: 0, dashCd: 0, dashing: 0, telegraphing: 0,
      abilityT: 99, summonT: 99,
      burn: null, stun: 0, slowT: 0, burnAcc: 0, burnNumT: 0,
      popT: 0, baseScale: 1, anim: 0,
      lastOrbitHit: 0, lastDashId: -1, dead: false,
      spawnT: GH.rand(1, 3), spawnZone: zone
    };
    enemies.push(e);
  }

  function cleanseCount() {
    var dead = 0;
    for (var k in GH.meta.data.world.nests) dead++;
    return { dead: dead, total: GH.world.totalNests() };
  }

  function updateExpedition(dt, input) {
    var w = GH.meta.data.world;

    // dropped gems and recovered parts open the reward screen (pauses the sim)
    if (player.pendingGems.length > 0 || (player.pendingCards && player.pendingCards.length > 0)) {
      if (!(dungeonState && dungeonState.race) && !siege && !zoneEvent) {
        showExpeditionRewards();
        return;
      }
    }

    updateTutorial(dt, input);
    updateWeather(dt);
    updateHarrow(dt);
    if (huntSpot && !huntUp) {
      if (huntTotem && huntTotem.userData.core) huntTotem.userData.core.rotation.y += dt * 2;
      if (GH.dist2(player.x, player.z, huntSpot.x, huntSpot.z) < 22 * 22) {
        huntUp = true;
        wavePlan = expeditionPlan(zoneNow);
        var he = spawnEnemy(huntSpot.id, huntSpot.x, huntSpot.z);
        if (he) { he.aggro = true; if (GH.worldlife.band().id === 'platinum') he.hp = Math.round(he.maxHp * 0.64); }
        if (huntTotem) { worldH.group.remove(huntTotem); huntTotem = null; }
        shake = Math.min(0.5, shake + 0.3);
        queueAnnounce(GH.enemyDefs[huntSpot.id].epithet.toUpperCase(), 20);
        GH.music.play('battle');
      }
    }
    updateDungeon(dt);
    updateZoneEvent(dt);
    updateItemPads(dt);
    if (hazards.length) updateHazards(dt);

    // travel gates: walk into the veil and you're through
    if (travelCd > 0) travelCd -= dt;
    for (var gi = 0; gi < worldH.layout.gates.length; gi++) {
      var gt = worldH.layout.gates[gi];
      if (gt.mesh && gt.mesh.userData.veil) {
        gt.mesh.userData.veil.material.opacity = 0.24 + Math.sin(runTime * 3 + gi) * 0.1;
      }
      if (travelCd <= 0 && GH.dist2(player.x, player.z, gt.x, gt.z) < 3.6 * 3.6) {
        // a HEIST pays out the moment you make the exit with the relic
        if (gt.exit && dungeonState && dungeonState.arch === 'heist' &&
          dungeonState.heistCarrying && !dungeonState.done) {
          dungeonState.done = true;
          var heistLoot = Math.round(90 * zoneNow.danger * dungeonState.tier *
            (1 + dungeonState.mods.length * 0.15));
          GH.meta.data.salvage += heistLoot;
          coinsRun += 25 * dungeonState.tier;
          GH.meta.data.world.dungeons[curZone] = true;
          GH.music.setBoss(false);
          GH.factions.deed(curZone, 'heist', 6);
          queueAnnounce('CLEAN GETAWAY — +' + heistLoot + ' SALVAGE BANKED', 28);
          GH.audio.win();
          ascendDungeon();
        }
        travelZone(gt);
        return; // the world just changed under our feet
      }
    }

    // camp: safety, banking, healing (the hub territory only)
    var inCamp = curZone === 'wreck' &&
      GH.dist2(player.x, player.z, GH.world.CAMP.x, GH.world.CAMP.z) < GH.world.CAMP.r * GH.world.CAMP.r;
    if (inCamp) {
      if (coinsRun > 0) {
        GH.meta.data.world.expBankT = (GH.meta.data.world.expBankT || 0);
        coinsRun = Math.round(coinsRun * GH.worldlife.band().salvage);
        GH.meta.data.salvage += coinsRun;
        queueAnnounce('BANKED ' + coinsRun + ' SALVAGE', 18);
        coinsRun = 0;
        saveExpedition();
      }
      player.heal(player.stats.maxHP * 0.1 * dt);
      // enemies never press into the camp
      for (var ci = enemies.length - 1; ci >= 0; ci--) {
        var ce = enemies[ci];
        if (ce.nestId) continue;
        if (GH.dist2(ce.x, ce.z, GH.world.CAMP.x, GH.world.CAMP.z) < (GH.world.CAMP.r - 2) * (GH.world.CAMP.r - 2)) {
          ce.dead = true;
          scene.remove(ce.mesh);
        }
      }
    }

    // wreck recovery (only where you actually fell)
    if (w.wreck && (w.wreck.zone || 'wreck') === curZone &&
      GH.dist2(player.x, player.z, w.wreck.x, w.wreck.z) < 4) {
      coinsRun += w.wreck.salvage;
      queueAnnounce('WRECK RECOVERED — +' + w.wreck.salvage + ' SALVAGE', 22);
      GH.audio.win();
      w.wreck = null;
      GH.meta.save();
      if (wreckMesh) { scene.remove(wreckMesh); wreckMesh = null; }
    }

    // roaming packs: wake each pack once as the pilot draws near, so
    // the ground between nests is contested instead of empty
    if (!zoneNow.dungeon) {
      for (var rp = 0; rp < worldH.layout.packs.length; rp++) {
        var pk = worldH.layout.packs[rp];
        if (!pk.roam || pk.spawned) continue;
        if (GH.dist2(player.x, player.z, pk.x, pk.z) < GH.PACE.packWake * GH.PACE.packWake) {
          pk.spawned = true;
          for (var pm = 0; pm < pk.n; pm++) {
            var ppick = GH.weightedPick(expeditionPlan(zoneNow).types);
            var pang = Math.random() * Math.PI * 2;
            spawnEnemy(ppick.id,
              pk.x + Math.cos(pang) * GH.rand(1, 5),
              pk.z + Math.sin(pang) * GH.rand(1, 5));
          }
        }
      }
    }

    // nests: activate near, spawn from live ones
    worldH.layout.nests.forEach(function (n) {
      if (w.nests[n.id]) return;
      var d2 = GH.dist2(player.x, player.z, n.x, n.z);
      if (d2 < 80 * 80) activateNest(n);
    });
    var localCount = 0;
    for (var li = 0; li < enemies.length; li++) {
      if (!enemies[li].nestId && !enemies[li].def.boss) localCount++;
    }
    for (var ni = 0; ni < enemies.length; ni++) {
      var ne = enemies[ni];
      if (!ne.nestId || ne.dead) continue;
      ne.spawnT -= dt;
      var nd2 = GH.dist2(player.x, player.z, ne.x, ne.z);
      if (ne.spawnT <= 0 && nd2 < 60 * 60 && localCount < GH.PACE.localCap) {
        ne.spawnT = Math.max(1.3, 4.6 - ne.spawnZone.danger * 0.8);
        var pick = GH.weightedPick(expeditionPlan(ne.spawnZone).types);
        var sa = Math.random() * Math.PI * 2;
        spawnEnemy(pick.id, ne.x + Math.cos(sa) * 4, ne.z + Math.sin(sa) * 4);
        localCount++;
      }
      // core pulse
      if (ne.mesh.userData.core) {
        ne.mesh.userData.core.rotation.y += dt;
        ne.mesh.userData.core.scale.setScalar(1 + Math.sin(runTime * 4) * 0.12);
      }
    }

    // the dungeon lair: crossing the threshold wakes the revenant
    // (tier-2 rematches wake regardless of the surface scar)
    var lair = worldH.layout.lair;
    if (lair && (lair.rematch || !w.lairsDown[lair.zone]) && !lair.woke &&
      GH.dist2(player.x, player.z, lair.x, lair.z) < 14 * 14) {
      lair.woke = true;
      var lboss = spawnEnemy(lair.boss, lair.x, lair.z + 3);
      if (lboss) lboss.lairZone = lair.zone;
    }

    // siege state machine
    if (siege) updateSiege(dt);

    // interact prompt
    nearInteract = null;
    for (var ii = 0; ii < interactables.length; ii++) {
      var it = interactables[ii];
      if (it.kind === 'relay' && w.relaysHeld[it.id]) continue;
      if (it.kind === 'vault' && (w.vaults[it.id] || cipherRun)) continue;
      if (it.kind === 'chest' && (!dungeonState || dungeonState.opened)) continue;
      if (it.kind === 'objective' && (!dungeonState || dungeonState.defenseActive || dungeonState.done)) continue;
      if (it.kind === 'racestart' && (!dungeonState || dungeonState.race || dungeonState.done)) continue;
      if (it.kind === 'relic' && (!dungeonState || dungeonState.heistCarrying || dungeonState.done)) continue;
      if (it.kind === 'vein' && it.vein.mined) continue;
      var iR = it.kind === 'objective' || it.kind === 'racestart' || it.kind === 'relic' ? 5.5 : 3.2;
      if (GH.dist2(player.x, player.z, it.x, it.z) < iR * iR) { nearInteract = it; break; }
    }
    var promptEl = document.getElementById('interact-line');
    if (nearInteract && !siege) {
      promptEl.textContent = '[' + GH.controls.label('interact') + '] ' + nearInteract.label;
      promptEl.classList.remove('hidden');
    } else {
      // approaching a travel gate: name where it leads
      var gateNear = null;
      for (var gn = 0; gn < worldH.layout.gates.length; gn++) {
        if (GH.dist2(player.x, player.z, worldH.layout.gates[gn].x, worldH.layout.gates[gn].z) < 15 * 15) {
          gateNear = worldH.layout.gates[gn];
          break;
        }
      }
      if (gateNear && !siege) {
        var gInfo = GH.world.zoneInfo(gateNear.to);
        var gCr = gateNear.corner ? GH.world.CORNERS[gateNear.corner] : null;
        promptEl.textContent = gCr
          ? gCr.arrow + ' ' + gCr.name + ' PORTAL: ' + gInfo.name + ' — DANGER ' + ['I', 'II', 'III', 'IV'][gInfo.danger - 1]
          : (gateNear.exit ? '⇧ EXIT: ' : '⇒ GATE: ') + gInfo.name;
        promptEl.classList.remove('hidden');
      } else {
        promptEl.classList.add('hidden');
      }
    }
    // CIPHER HALLS cores claim E first (pick up / set down)
    if (input.interactPressed) hallsCoreInteract(input);
    if (input.interactPressed) {
      input.interactPressed = false;
      if (nearInteract && !siege) {
        if (nearInteract.kind === 'relay') startSiege(nearInteract);
        else if (nearInteract.kind === 'vault') startVaultTrial(nearInteract);
        else if (nearInteract.kind === 'objective') startDefense();
        else if (nearInteract.kind === 'racestart') {
          if (!dungeonState.done && !dungeonState.race) startRaceway();
        }
        else if (nearInteract.kind === 'relic') {
          if (!dungeonState.heistCarrying && !dungeonState.done) {
            dungeonState.heistCarrying = true;
            dungeonState.heistT = 40 + zoneNow.danger * 5;
            announce('RELIC SEIZED — THE ALARM HOWLS. RUN.', 30);
            GH.music.setBoss(true);
            GH.audio.boss();
          }
        }
        else if (nearInteract.kind === 'vein') mineVein(nearInteract);
        else if (nearInteract.kind === 'chest') {
          if (chestReady()) openChest();
          else {
            announce('SEALED — FINISH THE ' + GH.dungeons.ARCHETYPES[zoneNow.arch].name, 22);
            GH.audio.hit();
          }
        }
        else if (nearInteract.kind === 'duel' || nearInteract.kind === 'circuit') {
          saveExpedition();
          G.startRace(nearInteract.kind);
        }
        else if (G.onInteract) { saveExpedition(); G.onInteract(nearInteract.kind); }
      }
    }

    // cache signals (Albion treasure sites): a ping, a marker, a detour
    if (!zoneNow.dungeon && !siege && !zoneEvent) {
      signalT -= dt;
      if (signalT <= 0 && !signalSpot) {
        var sgx = (Math.random() * 2 - 1) * GH.world.BOUNDS.x * 0.8, sgz = (Math.random() * 2 - 1) * GH.world.BOUNDS.z * 0.8;
        var sgs = openSpot(sgx, sgz, 1.2);
        if (sgs) { sgx = sgs.x; sgz = sgs.z; }
        spawnPickup('cache', sgx, sgz);
        pickups[pickups.length - 1].signal = true;
        pickups[pickups.length - 1].vx = 0; pickups[pickups.length - 1].vz = 0;
        signalSpot = { x: sgx, z: sgz, t: 0 };
        var dm = Math.round(Math.sqrt(GH.dist2(player.x, player.z, sgx, sgz)));
        queueAnnounce('CACHE SIGNAL DETECTED — ' + dm + ' M · MARKED ON THE MAP', 24);
        GH.audio.levelup();
        signalT = GH.worldlife.signalInterval(zoneNow.danger);
      }
      if (signalSpot) signalSpot.t += dt;
    }

    // periodic autosave
    G._expSaveT = (G._expSaveT || 0) - dt;
    if (G._expSaveT <= 0) { G._expSaveT = 10; saveExpedition(); }

    drawMinimap();
  }

  // parts recovered in the field: a hand of weapon cards to choose from
  function awardCards(n) {
    if (!expActive || !player) return;
    var cards = GH.rollRewards(player, 6, (n || 3) + 1).filter(function (c) { return c.kind === 'weapon'; }).slice(0, n || 3);
    if (!cards.length) return;
    player.pendingCards = player.pendingCards || [];
    player.pendingCards.push(cards);
    queueAnnounce('PARTS RECOVERED — CHOOSE AT THE NEXT LULL', 20);
  }

  function showExpeditionRewards() {
    G.state = 'reward';
    rewardQueue = [];
    var hasCards = player.pendingCards && player.pendingCards.length;
    document.getElementById('reward-heading').innerHTML = hasCards ? 'FIELD&nbsp;SALVAGE' : 'SOCKET&nbsp;GEM';
    (player.pendingCards || []).forEach(function (cs) { rewardQueue.push({ cards: cs }); });
    player.pendingCards = [];
    player.pendingGems.forEach(function (t) { rewardQueue.push({ gemType: t }); });
    player.pendingGems = [];
    document.getElementById('reward-screen').classList.remove('hidden');
    nextRewardStep();
  }

  // -------------------------------------------------------------
  // Minimap: the whole continent on a small canvas — zones tinted,
  // camp/circuit rings, nests (live vs broken), lairs, relays, you.
  // -------------------------------------------------------------
  var mmT = 0;
  function drawMinimap() {
    mmT -= 1;
    if (mmT > 0) return; // every few frames is plenty
    mmT = 5;
    var cv = document.getElementById('minimap');
    if (!cv || !worldH) return;
    var ctx = cv.getContext('2d');
    var W2 = cv.width, H2 = cv.height;
    var w = GH.meta.data.world;
    var sx = function (x) { return (x + GH.world.BOUNDS.x) / (GH.world.BOUNDS.x * 2) * W2; };
    var sz = function (z) { return (z + GH.world.BOUNDS.z) / (GH.world.BOUNDS.z * 2) * H2; };
    ctx.clearRect(0, 0, W2, H2);
    // this zone's map, tinted by biome (dungeons run near-black)
    var tints = { glacier: '#1c3346', wreck: '#33301f', cloister: '#20321f', ember: '#3a2117', storm: '#211f38', null: '#2c1733',
      hive: '#262832', ruins: '#26321f', keep: '#2a2c36', warrens: '#1a1220', sky: '#2a3a5a' };
    ctx.fillStyle = zoneNow && zoneNow.dungeon ? '#0b0b12' : (tints[zoneNow ? zoneNow.parent : 'wreck'] || '#222');
    ctx.fillRect(0, 0, W2, H2);
    // built territories: caverns, islands, streets, walls
    var fld = GH.terrain.active, unit = W2 / (GH.world.BOUNDS.x * 2);
    if (fld && fld.macro) {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      (fld.macro.caverns || []).concat(fld.macro.islands || []).forEach(function (c) {
        ctx.beginPath(); ctx.arc(sx(c.x), sz(c.z), c.r * unit, 0, Math.PI * 2); ctx.fill();
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2;
      (fld.macro.tunnels || []).concat(fld.macro.bridges || []).forEach(function (t) {
        ctx.beginPath(); ctx.moveTo(sx(t.x1), sz(t.z1)); ctx.lineTo(sx(t.x2), sz(t.z2)); ctx.stroke();
      });
      ctx.lineWidth = 1;
    }
    var strs = worldH.layout.structures;
    if (strs && strs.items) {
      ctx.fillStyle = 'rgba(210,210,230,0.30)';
      strs.items.forEach(function (it) {
        if (it.kind === 'hab' || it.kind === 'barracks' || it.kind === 'habcave') {
          ctx.fillRect(sx(it.x) - it.w * unit / 2, sz(it.z) - it.d * unit / 2, Math.max(1, it.w * unit), Math.max(1, it.d * unit));
        } else if (it.kind === 'wall') {
          ctx.fillRect(sx(it.x) - 1, sz(it.z) - 1, 2, 2);
        } else if (it.kind === 'spire' || it.kind === 'donjon' || it.kind === 'court') {
          ctx.beginPath(); ctx.arc(sx(it.x), sz(it.z), (it.r || 16) * unit, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillRect(sx(it.x) - 1.5, sz(it.z) - 1.5, 3, 3);
        }
      });
    }
    // faint quarter grid: gives the dots a sense of distance
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (var gl = 1; gl < 4; gl++) {
      ctx.beginPath();
      ctx.moveTo(gl * W2 / 4 + 0.5, 0); ctx.lineTo(gl * W2 / 4 + 0.5, H2);
      ctx.moveTo(0, gl * H2 / 4 + 0.5); ctx.lineTo(W2, gl * H2 / 4 + 0.5);
      ctx.stroke();
    }
    // hub landmarks
    if (curZone === 'wreck') {
      ctx.strokeStyle = '#ffd050';
      ctx.beginPath();
      ctx.arc(sx(GH.world.CAMP.x), sz(GH.world.CAMP.z), 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#60c8ff';
      ctx.beginPath();
      ctx.arc(sx(GH.world.CIRCUIT.x), sz(GH.world.CIRCUIT.z), 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    // portals: bright doorways in the corners, named for where they lead
    worldH.layout.gates.forEach(function (gt) {
      var dungeonGate = gt.to.indexOf('dungeon_') === 0;
      ctx.fillStyle = gt.exit ? '#ffd050' : dungeonGate ? '#c050ff' : '#60c8ff';
      ctx.fillRect(sx(gt.x) - 2.5, sz(gt.z) - 2.5, 5, 5);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.strokeRect(sx(gt.x) - 4.5, sz(gt.z) - 4.5, 9, 9);
      if (gt.corner) {
        var cr = GH.world.CORNERS[gt.corner];
        var nm = GH.world.stageFor(gt.to).name.split(' ')[0];
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = cr.sx < 0 ? 'left' : 'right';
        ctx.fillStyle = '#bfe8ff';
        ctx.fillText(nm, sx(gt.x) + (cr.sx < 0 ? 7 : -7), sz(gt.z) + (cr.sz < 0 ? 12 : -10));
        ctx.textAlign = 'left';
      }
    });
    worldH.layout.nests.forEach(function (n) {
      ctx.fillStyle = w.nests[n.id] ? '#4a5a4a' : '#ff5040';
      ctx.fillRect(sx(n.x) - 2, sz(n.z) - 2, 4, 4);
    });
    if (worldH.layout.lair) {
      var l = worldH.layout.lair;
      ctx.fillStyle = w.lairsDown[l.zone] ? '#4a5a4a' : '#c050ff';
      ctx.beginPath();
      ctx.moveTo(sx(l.x), sz(l.z) - 3);
      ctx.lineTo(sx(l.x) + 3, sz(l.z) + 2);
      ctx.lineTo(sx(l.x) - 3, sz(l.z) + 2);
      ctx.fill();
    }
    if (worldH.layout.relay) {
      var r = worldH.layout.relay;
      ctx.fillStyle = w.relaysHeld[r.id] ? '#60ff90' : '#f0f0f0';
      ctx.fillRect(sx(r.x) - 2, sz(r.z) - 2, 4, 4);
    }
    if (worldH.layout.vault) {
      var v = worldH.layout.vault;
      ctx.fillStyle = w.vaults[v.id] ? '#4a5a4a' : '#c050ff';
      ctx.save();
      ctx.translate(sx(v.x), sz(v.z));
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-2, -2, 4, 4);
      ctx.restore();
    }
    if (worldH.layout.chest) {
      ctx.fillStyle = dungeonState && dungeonState.opened ? '#4a5a4a' : '#ffd050';
      ctx.fillRect(sx(worldH.layout.chest.x) - 2, sz(worldH.layout.chest.z) - 2, 4, 4);
    }
    if (worldH.layout.objective) {
      ctx.strokeStyle = '#80d8ff';
      ctx.beginPath();
      ctx.arc(sx(worldH.layout.objective.x), sz(worldH.layout.objective.z), 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (worldH.layout.checkpoints && dungeonState) {
      worldH.layout.checkpoints.forEach(function (cp, ci) {
        ctx.fillStyle = ci < dungeonState.cp ? '#4a5a4a' : ci === dungeonState.cp ? '#60c8ff' : '#2a4a5a';
        ctx.fillRect(sx(cp.x) - 1.5, sz(cp.z) - 1.5, 3, 3);
      });
    }
    if (harrowSpot && harrowSpot.zone === curZone) {
      // the roamer's roost pulses red
      ctx.strokeStyle = '#ff3020';
      ctx.lineWidth = 1.5;
      var hx = sx(harrowSpot.x), hz = sz(harrowSpot.z);
      ctx.beginPath();
      ctx.moveTo(hx - 3, hz - 3); ctx.lineTo(hx + 3, hz + 3);
      ctx.moveTo(hx + 3, hz - 3); ctx.lineTo(hx - 3, hz + 3);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    if (w.wreck && (w.wreck.zone || 'wreck') === curZone) {
      ctx.fillStyle = '#ffb040';
      ctx.fillRect(sx(w.wreck.x) - 2, sz(w.wreck.z) - 2, 4, 4);
    }
    // live hostiles: small hot dots so a fight reads at a glance
    ctx.fillStyle = '#ff8860';
    for (var mi = 0; mi < enemies.length; mi++) {
      var me2 = enemies[mi];
      if (me2.dead || me2.nestId) continue;
      ctx.fillRect(sx(me2.x) - 1, sz(me2.z) - 1, 2, 2);
    }
    // alloy veins (grey), and a live cache signal (pulsing gold ring)
    for (var vi = 0; vi < veins.length; vi++) {
      if (veins[vi].mined) continue;
      ctx.fillStyle = veins[vi].rich ? '#d8e8ff' : '#a0a8b8';
      ctx.fillRect(sx(veins[vi].x) - 1.5, sz(veins[vi].z) - 1.5, 3, 3);
    }
    if (huntSpot && !huntUp) {
      ctx.fillStyle = '#ffb060';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('☠', sx(huntSpot.x) - 4, sz(huntSpot.z) + 4);
    }
    if (signalSpot) {
      ctx.strokeStyle = '#ffd050';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx(signalSpot.x), sz(signalSpot.z), 4 + Math.sin(signalSpot.t * 5) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    // you: a facing arrow, outlined so it pops on any biome tint
    ctx.save();
    ctx.translate(sx(player.x), sz(player.z));
    ctx.rotate(Math.PI - player.facing);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(3.5, 4);
    ctx.lineTo(0, 2);
    ctx.lineTo(-3.5, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // compass + zone name band
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 9px monospace';
    ctx.fillText('N', W2 / 2 - 3, 9);
    if (zoneNow) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, H2 - 12, W2, 12);
      ctx.fillStyle = '#f0d888';
      ctx.font = 'bold 8px monospace';
      ctx.fillText(zoneNow.name.toUpperCase(), 4, H2 - 3);
    }
  }

  // ------------------------------------------------------------
  // Races: hand control to GH.race, take it back when it reports
  // ------------------------------------------------------------
  var preRacePos = null;

  G.startRace = function (kind) {
    if (!expActive || !player) return;
    preRacePos = { x: player.x, z: player.z };
    if (!player.speederMesh) {
      player.speederMesh = GH.models.buildSpeeder(player.def.model, player.vec.kind, player.vec.shape);
      scene.add(player.speederMesh);
    }
    player.mesh.visible = false;
    player.speederMesh.visible = true;
    player.speederOn = true;
    // clear combatants: the race sites are neutral ground
    for (var i = enemies.length - 1; i >= 0; i--) {
      if (!enemies[i].nestId) { scene.remove(enemies[i].mesh); enemies.splice(i, 1); }
    }
    for (i = enemyShots.length - 1; i >= 0; i--) scene.remove(enemyShots[i].mesh);
    enemyShots.length = 0;
    document.getElementById('interact-line').classList.add('hidden');
    G.state = 'race';
    GH.music.play('race');
    announce(kind === 'duel' ? 'TRACE DUEL' : 'SUNSPIRE CIRCUIT', 30);
    GH.race.start(kind, {
      scene: scene, player: player, speeder: player.speederMesh, model: player.def.model,
      onDone: function (res) { finishRace(kind, res); }
    });
  };

  function finishRace(kind, res) {
    G.state = 'play';
    GH.music.play(zoneNow ? GH.worldlife.rootZone(curZone) : 'wreck');
    player.speederOn = false;
    player.mesh.visible = true;
    player.speederMesh.visible = false;
    player.x = preRacePos.x;
    player.z = preRacePos.z;
    var w = GH.meta.data.world;
    if (kind === 'duel') {
      if (res.win) {
        w.duelWins = (w.duelWins || 0) + 1;
        coinsRun += 60;
        queueAnnounce('TRACE DUEL WON — ' + res.label, 26);
        if (GH.progress.grantArtifact('trace_emblem')) queueAnnounce('ARTIFACT — TRACE EMBLEM', 28);
      } else {
        queueAnnounce('DEREZZED — THE PIT KEEPS ITS PRIZE', 24);
      }
    } else {
      if (res.time && (!w.raceBest || res.time * 1000 < w.raceBest)) {
        w.raceBest = Math.round(res.time * 1000);
        queueAnnounce('CIRCUIT RECORD — ' + GH.fmt1(res.time) + 's', 22);
      }
      if (res.win) {
        coinsRun += 60;
        queueAnnounce('SUNSPIRE CIRCUIT WON — ' + res.label, 26);
        if (GH.progress.grantArtifact('circuit_laurel')) queueAnnounce('ARTIFACT — CIRCUIT LAUREL', 28);
      } else {
        queueAnnounce('FINISHED ' + res.label, 24);
      }
    }
    if (res.win) GH.audio.win();
    lifeEvent('races', 1);
    saveExpedition();
    GH.meta.save();
  }

  G.raceBurst = function (x, z, color) { spawnBurst(x, 1, z, color, 20); };

  // ESC during a race walks away from it (no reward, no penalty)
  G.abortRace = function () {
    if (G.state !== 'race') return;
    GH.race.cleanup();
    G.state = 'play';
    player.speederOn = false;
    player.mesh.visible = true;
    if (player.speederMesh) player.speederMesh.visible = false;
    if (preRacePos) { player.x = preRacePos.x; player.z = preRacePos.z; }
    queueAnnounce('RACE ABANDONED', 20);
  };

  function toggleSpeeder() {
    if (!player.speederMesh) {
      player.speederMesh = GH.models.buildSpeeder(player.def.model, player.vec.kind, player.vec.shape);
      scene.add(player.speederMesh);
    }
    player.speederOn = !player.speederOn;
    if (player.speederOn) tutorialEvent('transform', 1);
    player.mesh.visible = !player.speederOn;
    player.speederMesh.visible = player.speederOn;
    if (player.speederOn) {
      player.drive = freshDrive();
    } else {
      player.velX = 0;
      player.velZ = 0;
    }
    GH.audio.dash();
    spawnBurst(player.x, 1, player.z, 0x70c0ff, 14);
    announce(player.speederOn
      ? player.vec.name + ' — ' + GH.controls.label('boost') + ' DRIFTS, ' + GH.controls.label('special') + ' BURNS NITRO' : 'FRAME FORM', 22);
  }

  function startSiege(relay) {
    siege = { relay: relay, phase: 1, timer: 8, done: false };
    announce('SIEGE — HOLD THE RELAY', 30);
    GH.music.setBoss(true);
    GH.audio.boss();
  }

  function updateSiege(dt) {
    var zone = zoneNow;
    siege.timer -= dt;
    // fail the siege by leaving the relay behind
    if (GH.dist2(player.x, player.z, siege.relay.x, siege.relay.z) > 40 * 40) {
      announce('SIEGE ABANDONED', 24);
      GH.music.setBoss(false);
      siege = null;
      return;
    }
    if (siege.timer <= 0) {
      if (siege.phase <= 3) {
        wavePlan = expeditionPlan(zone);
        var n = 5 + zone.danger * 2 + siege.phase * 2;
        for (var i = 0; i < n; i++) {
          var pick = GH.weightedPick(wavePlan.types);
          var a = Math.random() * Math.PI * 2;
          var sgE = spawnEnemy(pick.id,
            siege.relay.x + Math.cos(a) * GH.rand(16, 22),
            siege.relay.z + Math.sin(a) * GH.rand(16, 22));
          if (sgE) { sgE.aggro = true; sgE.event = true; } // siege attackers press the relay
        }
        announce('SIEGE WAVE ' + siege.phase + '/3', 24);
        siege.phase++;
        siege.timer = 20;
      } else {
        // survived every burst: hold until the field is quiet
        var living = 0;
        for (var j = 0; j < enemies.length; j++) {
          if (!enemies[j].dead && !enemies[j].nestId) living++;
        }
        if (living === 0) {
          GH.meta.data.world.relaysHeld[siege.relay.id] = true;
          GH.meta.data.salvage += 120;
          GH.meta.save();
          queueAnnounce('RELAY HELD — +120 SALVAGE BANKED', 26);
          GH.audio.win();
          spawnPickup('gem:' + GH.pick(GH.gems.typeIds), siege.relay.x, siege.relay.z);
          GH.music.setBoss(false);
          siege = null;
        } else {
          siege.timer = 1;
        }
      }
    }
  }

  // -------------------------------------------------------------
  // WEATHER FRONTS — two territories a day, seeded by the real date
  // -------------------------------------------------------------
  function clearNullEddies() {
    for (var i = hazards.length - 1; i >= 0; i--) {
      if (hazards[i].weather) {
        if (hazards[i].mesh) scene.remove(hazards[i].mesh);
        hazards.splice(i, 1);
      }
    }
  }

  function spawnNullEddies() {
    for (var i = 0; i < 2; i++) {
      var a = Math.random() * Math.PI * 2;
      var x = player.x + Math.cos(a) * GH.rand(8, 14);
      var z = player.z + Math.sin(a) * GH.rand(8, 14);
      hazards.push({
        kind: 'rifts', weather: true, x: x, z: z, r: 3,
        vx: GH.rand(-1.2, 1.2), vz: GH.rand(-1.2, 1.2),
        mesh: groundDisc(x, z, 3, 0x9040d0, 0.25)
      });
    }
  }

  // applied on zone load: dungeons sit below the weather entirely
  function applyWeatherFor(zoneId) {
    clearNullEddies();
    var wz = weatherToday && zoneNow && !zoneNow.dungeon ? weatherToday[zoneId] : null;
    weatherNow = wz || null;
    weatherT = 2.5;
    if (weatherNow) {
      queueAnnounce('WEATHER FRONT — ' + weatherNow.name, 22);
      if (weatherNow.id === 'whiteout' || weatherNow.id === 'blackout' || weatherNow.id === 'duststorm' || weatherNow.id === 'siegefog') {
        scene.fog.near = 7; scene.fog.far = 30;
      }
      if (weatherNow.id === 'nullwind') spawnNullEddies();
    }
  }

  function updateWeather(dt) {
    if (!weatherNow) return;
    weatherT -= dt;
    if (weatherNow.id === 'ashfall' || weatherNow.id === 'gasleak') {
      if (weatherT <= 0) {
        weatherT = GH.rand(2.0, 3.2);
        var ax = player.x + GH.rand(-9, 9), az = player.z + GH.rand(-9, 9);
        spawnTelegraph(ax, az, 2.0, 1.0, 12 * wavePlan.dmgMult);
        effects.push({
          kind: 'ventEnemies', mesh: groundDisc(ax, az, 0.1, 0x000000, 0),
          t: 1.0, x: ax, z: az, r: 2.0, dmg: 30
        });
      }
    } else if (weatherNow.id === 'stormsurge') {
      if (weatherT <= 0) {
        weatherT = GH.rand(3.2, 5.0);
        var sx = player.x + GH.rand(-6, 6), sz = player.z + GH.rand(-6, 6);
        spawnTelegraph(sx, sz, 2.2, 0.8, 16 * wavePlan.dmgMult);
        effects.push({
          kind: 'boltStrike', mesh: groundDisc(sx, sz, 0.1, 0x000000, 0),
          t: 0.8, x: sx, z: sz, r: 2.2, dmg: 70
        });
      }
    } else if (weatherNow.id === 'nullwind') {
      // eddies drift and stay in the fight
      for (var i = 0; i < hazards.length; i++) {
        var h = hazards[i];
        if (!h.weather) continue;
        h.x += h.vx * dt;
        h.z += h.vz * dt;
        if (GH.dist2(h.x, h.z, player.x, player.z) > 30 * 30) {
          var a = Math.random() * Math.PI * 2;
          h.x = player.x + Math.cos(a) * 14;
          h.z = player.z + Math.sin(a) * 14;
          h.vx = GH.rand(-1.2, 1.2); h.vz = GH.rand(-1.2, 1.2);
        }
        h.mesh.position.set(h.x, 0.04 + gy(h.x, h.z), h.z);
        h.mesh.material.opacity = 0.2 + Math.sin(runTime * 4 + i * 2) * 0.08;
      }
    }
  }

  // -------------------------------------------------------------
  // THE HARROW — the world boss that migrates daily
  // -------------------------------------------------------------
  function updateHarrow(dt) {
    // it only stands in its roost territory — elsewhere there's nothing to wake
    if (!harrowSpot || harrowUp || harrowSpot.zone !== curZone) {
      if (harrowTotem && harrowTotem.userData.core) {
        harrowTotem.userData.core.rotation.y += dt * 2;
      }
      return;
    }
    if (harrowTotem && harrowTotem.userData.core) {
      harrowTotem.userData.core.rotation.y += dt * 2;
      harrowTotem.userData.core.scale.setScalar(1 + Math.sin(runTime * 5) * 0.2);
    }
    if (GH.dist2(player.x, player.z, harrowSpot.x, harrowSpot.z) < 24 * 24) {
      harrowUp = true;
      wavePlan = expeditionPlan(zoneNow);
      spawnEnemy('harrow', harrowSpot.x, harrowSpot.z);
      if (harrowTotem) { scene.remove(harrowTotem); harrowTotem = null; }
      shake = Math.min(0.5, shake + 0.35);
    }
  }

  // -------------------------------------------------------------
  // HIDDEN VAULTS — breach a sealed door by passing a field trial
  // -------------------------------------------------------------
  function startVaultTrial(v) {
    if (cipherRun) return;
    cipherRun = {
      steps: GH.progress.makeCipher(), idx: 0, t: 0, prog: 0, marker: null,
      killsAt: kills, boosts: 0, vault: v.id, vx: v.x, vz: v.z
    };
    announce('VAULT TRIAL — PROVE YOURSELF', 26);
    GH.audio.boss();
    // the vault wakes its guardians so every step has teeth (and targets)
    var plan = expeditionPlan(zoneNow);
    for (var i = 0; i < 7; i++) {
      var a = Math.random() * Math.PI * 2;
      var vgE = spawnEnemy(GH.weightedPick(plan.types).id,
        v.x + Math.cos(a) * GH.rand(9, 14), v.z + Math.sin(a) * GH.rand(9, 14));
      if (vgE) { vgE.aggro = true; vgE.event = true; } // the guardians wake hostile
    }
    beginCipherStep();
  }

  function openVault(vaultId, vx, vz) {
    GH.meta.data.world.vaults[vaultId] = true;
    GH.meta.data.salvage += 150;
    GH.meta.save();
    // swap the sealed door for a breached one
    var oldMesh = worldH.vaultMeshes[vaultId];
    if (oldMesh) worldH.group.remove(oldMesh);
    var openMesh = GH.models.buildVault(true);
    openMesh.position.set(vx, 0 + gy(vx, vz), vz);
    worldH.group.add(openMesh);
    worldH.vaultMeshes[vaultId] = openMesh;
    queueAnnounce('VAULT BREACHED — +150 SALVAGE BANKED', 28);
    GH.audio.win();
    spawnPickup('gem:' + GH.pick(GH.gems.typeIds), vx + 1, vz + 2);
    spawnPickup('cache', vx - 1, vz + 2);
    saveExpedition();
  }

  // lighter look-switch for zone crossings (no prop rescatter)
  function applyStageLookLite(st) {
    var tex = GH.assets.stageTex[st.id];
    scene.background = tex.sky;
    scene.fog.color.setHex(st.fog);
    hemi.color.setHex(st.hemiSky);
    hemi.groundColor.setHex(st.hemiGround);
    sun.color.setHex(st.sun);
  }

  // =================================================================
  // STAGE HAZARDS — each arena past the first has an environmental
  // mechanic: ice sheets, snare vines, eruption vents, sky lightning,
  // and null rifts that suppress your weapons.
  // =================================================================
  var hazards = [];

  function clearHazards() {
    hazards.forEach(function (h) {
      if (h.mesh) scene.remove(h.mesh);
      if (h.warn) scene.remove(h.warn);
    });
    hazards.length = 0;
  }

  function fieldR() { return expActive ? GH.world.BOUNDS.x - 6 : ARENA_R; }
  function hazardSpot(minR) {
    for (var t = 0; t < 10; t++) {
      var x = GH.rand(-fieldR() + 5, fieldR() - 5);
      var z = GH.rand(-fieldR() + 5, fieldR() - 5);
      if (GH.dist2(x, z, player.x, player.z) > (minR || 8) * (minR || 8)) return { x: x, z: z };
    }
    return { x: 0, z: 0 };
  }

  function spawnStageHazards(wave) {
    clearHazards();
    var kind = stage.hazard;
    if (!kind) return;
    if (kind === 'lightning') {
      hazards.push({ kind: 'lightning', t: GH.rand(3, 6) });
      return;
    }
    var n = Math.min(3, 1 + Math.floor(wave / 6));
    for (var i = 0; i < n; i++) {
      var p = hazardSpot(9);
      var h = { kind: kind, x: p.x, z: p.z, t: GH.rand(2, 5) };
      if (kind === 'ice') {
        h.r = GH.rand(4, 5.5);
        h.mesh = groundDisc(p.x, p.z, h.r, 0xa0e0ff, 0.22);
      } else if (kind === 'vines') {
        h.r = GH.rand(3, 4);
        h.mesh = groundDisc(p.x, p.z, h.r, 0x3aa040, 0.3);
      } else if (kind === 'vents') {
        h.r = 2.4;
        h.mesh = groundDisc(p.x, p.z, 0.9, 0x803020, 0.5);
        h.t = GH.rand(3, 7);
      } else if (kind === 'rifts') {
        h.r = 3;
        h.mesh = groundDisc(p.x, p.z, h.r, 0x9040d0, 0.25);
        h.vx = GH.rand(-1, 1); h.vz = GH.rand(-1, 1);
      }
      hazards.push(h);
    }
  }

  function inHazard(kind, x, z) {
    for (var i = 0; i < hazards.length; i++) {
      var h = hazards[i];
      if (h.kind !== kind || !h.r) continue;
      if (GH.dist2(x, z, h.x, h.z) < h.r * h.r) return h;
    }
    return null;
  }

  function updateHazards(dt) {
    for (var i = 0; i < hazards.length; i++) {
      var h = hazards[i];
      if (h.kind === 'ice') {
        h.mesh.material.opacity = 0.18 + Math.sin(runTime * 2 + i) * 0.06;
      } else if (h.kind === 'vines') {
        h.mesh.material.opacity = 0.26 + Math.sin(runTime * 3 + i) * 0.06;
      } else if (h.kind === 'vents') {
        h.t -= dt;
        h.mesh.material.opacity = 0.4 + Math.sin(runTime * 8) * 0.15;
        if (h.t <= 0) {
          h.t = GH.rand(4, 8);
          // telegraphed eruption that scalds both sides
          var hx = h.x, hz = h.z, hr = h.r;
          spawnTelegraph(hx, hz, hr, 0.9, 14 * wavePlan.dmgMult);
          effects.push({
            kind: 'ventEnemies', mesh: groundDisc(hx, hz, 0.1, 0x000000, 0),
            t: 0.9, x: hx, z: hz, r: hr, dmg: 40 + waveNum * 3
          });
        }
      } else if (h.kind === 'lightning') {
        h.t -= dt;
        if (h.t <= 0) {
          h.t = GH.rand(3.5, 6.5);
          // strikes bias toward the player but threaten everything
          var sx, sz;
          if (Math.random() < 0.6) {
            sx = GH.clamp(player.x + GH.rand(-5, 5), -fieldR(), fieldR());
            sz = GH.clamp(player.z + GH.rand(-5, 5), -fieldR(), fieldR());
          } else {
            var sp = hazardSpot(0);
            sx = sp.x; sz = sp.z;
          }
          spawnTelegraph(sx, sz, 2.2, 0.8, 16 * wavePlan.dmgMult);
          effects.push({
            kind: 'boltStrike', mesh: groundDisc(sx, sz, 0.1, 0x000000, 0),
            t: 0.8, x: sx, z: sz, r: 2.2, dmg: 60 + waveNum * 4
          });
        }
      } else if (h.kind === 'rifts') {
        h.x += h.vx * dt;
        h.z += h.vz * dt;
        if (Math.abs(h.x) > fieldR() - 4) h.vx *= -1;
        if (Math.abs(h.z) > fieldR() - 4) h.vz *= -1;
        h.mesh.position.set(h.x, 0.04 + gy(h.x, h.z), h.z);
        h.mesh.material.opacity = 0.2 + Math.sin(runTime * 4 + i * 2) * 0.08;
      }
    }
  }

  // =================================================================
  // WARD STANCES — typed defensive shells. The right ward cuts its
  // damage type by 75% and feeds COUNTER damage stacks; the wrong ward
  // does nothing. Running a ward drains energy; empty = collapse.
  // =================================================================
  var WARDS = {
    kinetic: { name: 'KINETIC', color: 0xf0a030, desc: 'contact & rams' },
    ballistic: { name: 'BALLISTIC', color: 0x50c8f0, desc: 'enemy projectiles' },
    arc: { name: 'ARC', color: 0xb060f0, desc: 'blasts, beams & burning ground' }
  };
  var WARD_ORDER = ['kinetic', 'ballistic', 'arc'];
  var wardDome = null;

  function setWard(kind) {
    if (!player || player.wardCd > 0) return;
    if (player.ward === kind || kind === null) {
      player.ward = null;
    } else {
      player.ward = kind;
      GH.audio.block();
      tutorialEvent('ward', 1);
    }
    updateWardDome();
  }

  function cycleWard() {
    if (!player || player.wardCd > 0) return;
    var i = player.ward ? WARD_ORDER.indexOf(player.ward) : -1;
    player.ward = i >= WARD_ORDER.length - 1 ? null : WARD_ORDER[i + 1];
    if (player.ward) GH.audio.block();
    updateWardDome();
  }

  function updateWardDome() {
    if (!wardDome) {
      wardDome = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.55, 1),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.16,
          wireframe: true, depthWrite: false
        })
      );
      wardDome.position.y = 1.3;
    }
    if (player && player.ward) {
      wardDome.material.color.setHex(WARDS[player.ward].color);
      if (wardDome.parent !== player.mesh) player.mesh.add(wardDome);
      wardDome.visible = true;
    } else if (wardDome.parent) {
      wardDome.visible = false;
    }
  }

  function updateWard(dt, input) {
    if (input.wardPressed) {
      setWard(input.wardPressed === 1 ? 'kinetic' : input.wardPressed === 2 ? 'ballistic' : 'arc');
      input.wardPressed = 0;
    }
    if (input.wardCycle) {
      cycleWard();
      input.wardCycle = false;
    }
    player.wardCd = Math.max(0, player.wardCd - dt);
    if (player.ward) {
      player.wardEnergy -= dt * 0.2 * player.skillBon.wardDrainMult;
      if (player.wardEnergy <= 0) {
        player.wardEnergy = 0;
        player.ward = null;
        player.wardCd = 2;
        announce('WARD COLLAPSE', 20);
        GH.audio.hit();
        updateWardDome();
        // BULWARK FRAGMENT: the collapse detonates outward
        if (artOn('bulwark_fragment')) {
          GH.audio.explode();
          spawnBurst(player.x, 1.2, player.z, 0x80b0ff, 20);
          for (var bi = 0; bi < enemies.length; bi++) {
            var be = enemies[bi];
            if (be.dead) continue;
            if (GH.dist2(player.x, player.z, be.x, be.z) < 49) {
              var ba = GH.angleTo(player.x, player.z, be.x, be.z);
              be.vx += Math.sin(ba) * 18 / be.def.mass;
              be.vz += Math.cos(ba) * 18 / be.def.mass;
              damageEnemy(be, 18 * player.stats.damageMult, { canCrit: false, noRes: true });
            }
          }
        }
      }
    } else {
      player.wardEnergy = Math.min(1, player.wardEnergy + dt * 0.16);
    }
    for (var i = player.counter.length - 1; i >= 0; i--) {
      player.counter[i] -= dt;
      if (player.counter[i] <= 0) player.counter.splice(i, 1);
    }
    if (wardDome && wardDome.visible) {
      wardDome.material.opacity = 0.12 + Math.sin(runTime * 5) * 0.05;
      wardDome.rotation.y += dt * 0.8;
    }
  }

  // =================================================================
  // COSMETICS — repaint accents / recolor thruster flames on a mech
  // =================================================================
  function repaintMech(mesh, color) {
    var parts = mesh.userData.parts;
    if (!parts) return;
    // repaint the accent material instances on this mech only
    var accentHex = null;
    if (parts.visor && parts.visor.material) accentHex = parts.visor.material.color.getHex();
    if (accentHex === null) return;
    var repainted = GH.assets.lambert({ color: color, flatShading: true });
    mesh.traverse(function (m) {
      if (m.isMesh && m.material && m.material.color &&
        m.material.color.getHex() === accentHex && !m.material.map) {
        m.material = repainted;
      }
    });
  }

  function setFlameColor(mesh, color) {
    var parts = mesh.userData.parts;
    if (parts && parts.flames) {
      parts.flames.forEach(function (fl) {
        fl.material = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.85 });
      });
    }
  }

  // =================================================================
  // SIGNAL CIPHERS — mid-run field riddles ending in a loot cache
  // =================================================================
  function startCipher() {
    if (cipherRun) return;
    cipherRun = { steps: GH.progress.makeCipher(), idx: 0, t: 0, prog: 0, marker: null, killsAt: kills, boosts: 0 };
    announce('SIGNAL CIPHER INTERCEPTED', 26);
    beginCipherStep();
  }

  function beginCipherStep() {
    var step = cipherRun.steps[cipherRun.idx];
    cipherRun.t = 0;
    cipherRun.prog = 0;
    cipherRun.killsAt = kills;
    cipherRun.boosts = 0;
    if (cipherRun.marker) { scene.remove(cipherRun.marker); cipherRun.marker = null; }
    if (step.id === 'stand') {
      var a = Math.random() * Math.PI * 2;
      var r = GH.rand(7, 13);
      var mx, mz;
      if (expActive) {
        mx = GH.clamp(player.x + Math.cos(a) * r, -GH.world.BOUNDS.x + 3, GH.world.BOUNDS.x - 3);
        mz = GH.clamp(player.z + Math.sin(a) * r, -GH.world.BOUNDS.z + 3, GH.world.BOUNDS.z - 3);
      } else {
        mx = GH.clamp(player.x + Math.cos(a) * r, -ARENA_R + 3, ARENA_R - 3);
        mz = GH.clamp(player.z + Math.sin(a) * r, -ARENA_R + 3, ARENA_R - 3);
      }
      cipherRun.marker = groundDisc(mx, mz, 2.0, 0x60e8ff, 0.3);
      cipherRun.mx = mx; cipherRun.mz = mz;
    }
  }

  function cipherStepDone() {
    GH.audio.levelup();
    cipherRun.idx++;
    if (cipherRun.idx >= cipherRun.steps.length) {
      if (cipherRun.marker) scene.remove(cipherRun.marker);
      var vaultDone = cipherRun.vault;
      var vdx = cipherRun.vx, vdz = cipherRun.vz;
      cipherRun = null;
      if (vaultDone) {
        openVault(vaultDone, vdx, vdz);
        return;
      }
      queueAnnounce('CIPHER SOLVED — CACHE INBOUND', 26);
      spawnPickup('cache', player.x + GH.rand(-1, 1), player.z + GH.rand(-1, 1));
    } else {
      queueAnnounce('CIPHER ' + (cipherRun.idx + 1) + '/' + cipherRun.steps.length, 20);
      beginCipherStep();
    }
  }

  function updateCipher(dt) {
    if (!cipherRun) return;
    var step = cipherRun.steps[cipherRun.idx];
    cipherRun.t += dt;
    if (step.id === 'stand') {
      cipherRun.marker.material.opacity = 0.25 + Math.sin(runTime * 6) * 0.1;
      if (GH.dist2(player.x, player.z, cipherRun.mx, cipherRun.mz) < 4) {
        cipherRun.prog += dt;
        if (cipherRun.prog >= 2.5) cipherStepDone();
      } else {
        cipherRun.prog = Math.max(0, cipherRun.prog - dt * 0.5);
      }
    } else if (step.id === 'burst') {
      if (kills - cipherRun.killsAt >= 4) cipherStepDone();
      else if (cipherRun.t > 14) { cipherRun.t = 0; cipherRun.killsAt = kills; } // retry window
    } else if (step.id === 'sprint') {
      if (cipherRun.boosts >= 3) cipherStepDone();
      else if (cipherRun.t > 10) { cipherRun.t = 0; cipherRun.boosts = 0; }
    } else if (step.id === 'hold') {
      if (cipherRun.t >= 10) cipherStepDone();
    }
  }

  function cipherHudText() {
    if (!cipherRun) return '';
    var step = cipherRun.steps[cipherRun.idx];
    var extra = '';
    if (step.id === 'stand') extra = ' (' + GH.fmt1(Math.max(0, 2.5 - cipherRun.prog)) + 's)';
    else if (step.id === 'burst') extra = ' (' + (kills - cipherRun.killsAt) + '/4, ' + GH.fmt1(Math.max(0, 14 - cipherRun.t)) + 's)';
    else if (step.id === 'sprint') extra = ' (' + cipherRun.boosts + '/3)';
    else if (step.id === 'hold') extra = ' (' + GH.fmt1(Math.max(0, 10 - cipherRun.t)) + 's)';
    return (cipherRun.vault ? 'VAULT TRIAL: ' : 'CIPHER: ') + step.desc + extra;
  }

  // =================================================================
  // CO-OP WINGMATE (player 2 — mirror frame, IJKL or gamepad)
  // =================================================================
  function spawnWingmate(mechIndex) {
    var def = GH.mechs[mechIndex];
    var cfg = {};
    for (var k in def.model) cfg[k] = def.model[k];
    cfg.accent = 0x60c8ff; // P2 tell: cool-blue accents
    mate = {
      def: def,
      mesh: GH.models.buildMech(cfg),
      x: (player ? player.x : 0) + 2.2, z: (player ? player.z : 0) + 1.5,
      facing: 0, moveX: 0, moveZ: 0,
      hp: 0, boost: 1, dashTime: 0, dashX: 0, dashZ: 0, dashKind: 'boost', dashId: 0,
      down: false, reviveT: 0, hurtCd: 0,
      blocking: false,
      special: { cd: 0, active: 0 },
      frenzy: [], edgeT: 0,
      weapons: [makeWeaponInst('primary', def.weapon, false)]
    };
    mate.hp = player.stats.maxHP;
    mate.mesh.position.set(mate.x, 0 + gy(mate.x, mate.z), mate.z);
    scene.add(mate.mesh);
  }

  function wingmateDamage(raw) {
    if (!mate || mate.down || mate.dashTime > 0.12 || GH.devGod) return;
    var dmg = Math.max(1, Math.round(raw - player.stats.armor -
      (mate.special.active > 0 && mate.def.special === 'bulwark' ? 12 : 0)));
    if (mate.blocking) {
      dmg = Math.max(1, Math.round(dmg * 0.3));
      mate.hp = Math.min(player.stats.maxHP, mate.hp + 3);
      GH.audio.block();
    }
    mate.hp -= dmg;
    mate.hurtCd = 0.25;
    G.dmg.spawn(mate.x, 2.6, mate.z, dmg, 'player', 17);
    GH.audio.hurt();
    if (mate.hp <= 0) {
      mate.hp = 0;
      mate.down = true;
      mate.reviveT = 0;
      spawnBurst(mate.x, 1, mate.z, 0x60c8ff, 18);
      announce('WINGMATE DOWN', 26);
    }
  }

  function mateSpecial() {
    var sp = mate.special;
    var kind = mate.def.special;
    if (kind === 'block') return; // handled as a hold
    if (sp.cd > 0) return;
    if (kind === 'overdrive') { sp.cd = 9; sp.active = 3; announce('P2 OVERDRIVE', 18); }
    else if (kind === 'frenzy') { sp.cd = 9; sp.active = 4; announce('P2 FRENZY', 18); }
    else if (kind === 'bulwark') { sp.cd = 10; sp.active = 4; announce('P2 BULWARK', 18); GH.audio.block(); }
    else if (kind === 'nova') {
      sp.cd = 7;
      var elem = currentElement(mate.weapons[0]);
      var color = elem && GH.elements[elem] ? GH.elements[elem].color : 0x50e8d8;
      GH.audio.explode();
      spawnBurst(mate.x, 1, mate.z, color, 16);
      var m = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.9, 24),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(mate.x, 0.3 + gy(mate.x, mate.z), mate.z);
      scene.add(m);
      effects.push({ kind: 'boom', mesh: m, t: 0.3, total: 0.3, grow: 6 });
      for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (e.dead) continue;
        if (GH.dist2(mate.x, mate.z, e.x, e.z) < 49) {
          var a = GH.angleTo(mate.x, mate.z, e.x, e.z);
          e.vx += Math.sin(a) * 16 / e.def.mass;
          e.vz += Math.cos(a) * 16 / e.def.mass;
          damageEnemy(e, 10 * player.stats.damageMult, { canCrit: false, elem: elem });
        }
      }
    }
    else if (kind === 'lunge' || kind === 'blink') {
      sp.cd = kind === 'lunge' ? 3.5 : 4;
      var mx = mate.moveX, mz = mate.moveZ;
      if (mx === 0 && mz === 0) { mx = Math.sin(mate.facing); mz = Math.cos(mate.facing); }
      var len = Math.sqrt(mx * mx + mz * mz);
      if (kind === 'blink') {
        spawnBurst(mate.x, 1, mate.z, 0xf05060, 8);
        mate.x = GH.clamp(mate.x + mx / len * 6.5, -ARENA_R, ARENA_R);
        mate.z = GH.clamp(mate.z + mz / len * 6.5, -ARENA_R, ARENA_R);
        mate.dashTime = 0.15;
        spawnBurst(mate.x, 1, mate.z, 0xf05060, 8);
        if (mate.def.passive === 'edge') mate.edgeT = 2;
      } else {
        mate.dashX = mx / len; mate.dashZ = mz / len;
        mate.dashTime = 0.2;
        mate.dashId++;
        mate.dashKind = 'lunge';
        if (mate.def.passive === 'frenzy') {
          mate.frenzy.push(4);
          if (mate.frenzy.length > 5) mate.frenzy.shift();
        }
      }
      GH.audio.dash();
    }
  }

  function reviveWingmate(frac) {
    mate.down = false;
    mate.hp = Math.max(1, Math.round(player.stats.maxHP * frac));
    spawnBurst(mate.x, 1, mate.z, 0x80ffb0, 12);
    announce('WINGMATE UP', 20);
    GH.audio.levelup();
  }

  function updateWingmate(dt, input) {
    if (!mate) return;
    var s = player.stats;

    if (mate.down) {
      mate.mesh.rotation.z = GH.lerp(mate.mesh.rotation.z, 1.35, dt * 4);
      // P1 revives by standing close
      if (GH.dist2(player.x, player.z, mate.x, mate.z) < 6.25) {
        mate.reviveT += dt;
        if (mate.reviveT >= 2.5) reviveWingmate(0.4);
      } else {
        mate.reviveT = Math.max(0, mate.reviveT - dt);
      }
      return;
    }
    mate.mesh.rotation.z = 0;

    // movement (IJKL or gamepad stick)
    var mx = input.p2x || 0, mz = input.p2y || 0;
    var len = Math.sqrt(mx * mx + mz * mz);
    if (len > 1) { mx /= len; mz /= len; }
    mate.moveX = mx; mate.moveZ = mz;

    if (mate.dashTime > 0) {
      mate.dashTime -= dt;
      mate.x += mate.dashX * 26 * dt;
      mate.z += mate.dashZ * 26 * dt;
    } else {
      var mspd = s.speed * (mate.blocking ? 0.55 : 1);
      mate.x += mx * mspd * dt;
      mate.z += mz * mspd * dt;
    }
    mate.x = GH.clamp(mate.x, -ARENA_R, ARENA_R);
    mate.z = GH.clamp(mate.z, -ARENA_R, ARENA_R);

    // shared-screen tether: P2 can't wander further than the camera can show
    var sepX = mate.x - player.x, sepZ = mate.z - player.z;
    var sep = Math.sqrt(sepX * sepX + sepZ * sepZ);
    var MAX_SEP = 19;
    if (sep > MAX_SEP) {
      mate.x = player.x + (sepX / sep) * MAX_SEP;
      mate.z = player.z + (sepZ / sep) * MAX_SEP;
    }

    mate.boost = Math.min(1, mate.boost + s.boostRegen * dt);
    if (input.p2Boost) {
      input.p2Boost = false;
      if (mate.boost >= s.boostCost) {
        mate.boost -= s.boostCost;
        var bx = mx, bz = mz;
        if (bx === 0 && bz === 0) { bx = Math.sin(mate.facing); bz = Math.cos(mate.facing); }
        var bl = Math.sqrt(bx * bx + bz * bz);
        mate.dashX = bx / bl; mate.dashZ = bz / bl;
        mate.dashTime = 0.22;
        mate.dashId++;
        mate.dashKind = 'boost';
        GH.audio.dash();
        spawnBurst(mate.x, 0.6, mate.z, 0x60c8ff, 6);
        if (mate.def.passive === 'frenzy') {
          mate.frenzy.push(4);
          if (mate.frenzy.length > 5) mate.frenzy.shift();
        }
        if (mate.def.passive === 'edge') mate.edgeT = 2;
      }
    }
    // special (press for actives, hold for AEGIS block)
    mate.blocking = mate.def.special === 'block' && input.p2Special;
    if (input.p2SpecialPressed) {
      input.p2SpecialPressed = false;
      mateSpecial();
    }
    mate.special.cd = Math.max(0, mate.special.cd - dt);
    mate.special.active = Math.max(0, mate.special.active - dt);
    mate.edgeT = Math.max(0, mate.edgeT - dt);
    for (var fz = mate.frenzy.length - 1; fz >= 0; fz--) {
      mate.frenzy[fz] -= dt;
      if (mate.frenzy[fz] <= 0) mate.frenzy.splice(fz, 1);
    }
    mate.hurtCd = Math.max(0, mate.hurtCd - dt);

    // ram/lunge damage during dash (AEGIS boost-ram and FANG lunge parity)
    if (mate.dashTime > 0 && (mate.def.special === 'block' || mate.dashKind === 'lunge')) {
      for (var di = 0; di < enemies.length; di++) {
        var de = enemies[di];
        if (de.dead || de.lastDashId === 1000 + mate.dashId) continue;
        var drr = 1.3 + de.def.radius;
        if (GH.dist2(mate.x, mate.z, de.x, de.z) <= drr * drr) {
          de.lastDashId = 1000 + mate.dashId;
          var ddmg = mate.dashKind === 'lunge'
            ? (12 + s.flatDamage * 2) * s.damageMult
            : (10 + s.armor + s.block) * s.damageMult;
          damageEnemy(de, ddmg, {});
          var da = GH.angleTo(mate.x, mate.z, de.x, de.z);
          de.vx += Math.sin(da) * 14 / de.def.mass;
          de.vz += Math.cos(da) * 14 / de.def.mass;
        }
      }
    }

    // auto-aim at the nearest enemy
    var tgt = nearestEnemy(mate.x, mate.z, 26);
    if (tgt) mate.facing = GH.angleTo(mate.x, mate.z, tgt.x, tgt.z);

    // fire primary (shares P1's stat pool; own clip/reload and passives)
    var inst = mate.weapons[0];
    var w = inst.w;
    var spdMult = s.atkSpdMult * inst.mods.atkSpdMult * frenzyMult(mate) *
      (mate.special.active > 0 && mate.def.special === 'overdrive' ? 2 : 1);
    if (inst.reloading > 0) {
      inst.reloading -= dt * spdMult;
      if (inst.reloading <= 0) { inst.clip = w.clip; onReload(inst); }
    } else if (tgt) {
      inst.timer -= dt * spdMult;
      if (inst.timer <= 0) {
        inst.timer = w.interval;
        var aim = mate.facing;
        if (w.type === 'shot') {
          fireShot(inst, mate.x + Math.sin(aim) * 0.8, mate.z + Math.cos(aim) * 0.8, aim, mate);
        } else if (w.type === 'melee') {
          meleeSwing(inst, aim, mate);
        } else if (w.type === 'aura') {
          auraTick(inst, mate);
        } else if (w.type === 'mortar') {
          fireMortar(inst, aim, mate);
        }
        if (w.clip) {
          inst.clip--;
          if (inst.clip <= 0) inst.reloading = w.reload;
        }
      }
    }

    // pose
    if (expActive && GH.terrain.colliderCount()) {
      var mrs = GH.terrain.resolve(mate.x, mate.z, 0.6);
      if (mrs.hit) { mate.x = mrs.x; mate.z = mrs.z; }
    }
    mate.mesh.position.set(mate.x, 0 + gy(mate.x, mate.z), mate.z);
    mate.mesh.rotation.y = mate.facing;
    var parts = mate.mesh.userData.parts;
    var moving = mx !== 0 || mz !== 0;
    var t = runTime * (moving ? 9 : 2);
    var sw = moving ? Math.sin(t) * 0.55 : 0;
    parts.legL.rotation.x = sw;
    parts.legR.rotation.x = -sw;
    if (!poseMeleeSwing(mate, parts, dt)) {
      var aimingM = mate.def.weapon.type !== 'melee';
      if (parts.armR && aimingM) parts.armR.rotation.x = -1.35;
      else if (parts.armR) parts.armR.rotation.x = GH.lerp(parts.armR.rotation.x, -0.2, dt * 6);
      GH.models.aimMounts(parts, aimingM);
      if (parts.torso) parts.torso.rotation.y = GH.lerp(parts.torso.rotation.y, 0, dt * 8);
    }
    if (parts.flames) {
      parts.flames.forEach(function (fl) { fl.visible = mate.dashTime > 0; });
    }
    if (mate.def.weapon.type === 'aura' && parts.weapon) parts.weapon.rotation.y += dt * 10;
    mate.mesh.visible = !(mate.hurtCd > 0 && Math.floor(runTime * 24) % 2 === 0);
  }

  // =================================================================
  // MELEE SWING POSE — a fast windup then a full cut, with torso
  // torque. Driven by swingT/swingDur set in meleeSwing(); returns
  // true while the animation owns the arms.
  // =================================================================
  function poseMeleeSwing(actor, parts, dt) {
    if (!actor.swingT || actor.swingT <= 0) return false;
    actor.swingT = Math.max(0, actor.swingT - dt);
    var p = 1 - actor.swingT / actor.swingDur;  // 0 → 1 over the swing
    // raise fast (first 30%), then slash through the rest
    var ang = p < 0.3
      ? GH.lerp(-0.2, -2.5, p / 0.3)
      : GH.lerp(-2.5, 0.7, (p - 0.3) / 0.7);
    var left = actor.swingArm === 'L';
    var arm = left ? (parts.armL || parts.armR) : parts.armR;
    if (arm) arm.rotation.x = ang;
    if (parts.torso) {
      parts.torso.rotation.y = Math.sin(p * Math.PI) * (left ? 0.3 : -0.3);
    }
    return true;
  }

  // =================================================================
  // CAMERA
  // =================================================================
  var camZoom = 1;
  function updateCamera(dt) {
    var tx = player ? player.x : 0;
    var tz = player ? player.z : 0;
    var zoomTarget = 1;
    if (mate && !mate.down) {
      tx = (tx + mate.x) / 2;
      tz = (tz + mate.z) / 2;
      // pull back as the pilots spread out
      var sep = Math.sqrt(GH.dist2(player.x, player.z, mate.x, mate.z));
      zoomTarget = 1 + GH.clamp((sep - 6) / 14, 0, 0.65);
    }
    // skimmer form and races see farther — and the camera itself sells
    // the speed: it pulls back with velocity, the FOV blooms open, and
    // a top-speed hull rides on a faint constant tremor
    var speedFrac = 0;
    if (player && player.speederOn && player.drive) {
      speedFrac = GH.clamp(player.drive.fwd / Math.max(0.01, player.drive.top), 0, 1);
      zoomTarget *= 1.12 + speedFrac * 0.5 + (player.drive.nitroT > 0 ? 0.1 : 0);
      if (speedFrac > 0.8) shake = Math.min(0.16, shake + dt * 0.25);
      if (player.drive.nitroT > 0) shake = Math.min(0.28, shake + dt * 0.9);
    } else if (player && player.speederOn) {
      zoomTarget *= 1.35;
    }
    if (G.state === 'race') zoomTarget = Math.max(zoomTarget, 1.3);
    camZoom = GH.lerp(camZoom, zoomTarget, dt * 3);
    var chase = camMode === 'chase';
    var fovTarget = (chase ? 60 : 48) + speedFrac * 13 +
      (player && player.speederOn && player.drive && player.drive.nitroT > 0 ? 7 : 0);
    if (Math.abs(camera.fov - fovTarget) > 0.05) {
      camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();
    }
    var sx = (Math.random() - 0.5) * shake;
    var sz = (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 1.4);
    // higher and farther back, with the pilot sitting low in frame so
    // the world ahead gets the screen space
    var pgy = player ? gy(tx, tz) + (player.speederOn && player.drive ? player.drive.hgt * 0.6 : 0) : 0;
    camGround += (pgy - camGround) * Math.min(1, dt * 5);
    var xh = document.getElementById('crosshair');
    if (chase && player) {
      var veh = player.speederOn && player.drive;
      if (veh) camYaw = GH.lerpAngle(camYaw, player.drive.heading, Math.min(1, dt * 4));
      else if (G.state === 'race') {
        var mvx = tx - camPrevX, mvz = tz - camPrevZ;
        if (mvx * mvx + mvz * mvz > 0.002) camYaw = GH.lerpAngle(camYaw, Math.atan2(mvx, mvz), Math.min(1, dt * 4));
      }
      camPrevX = tx; camPrevZ = tz;
      var driving = veh || G.state === 'race';
      var back = (driving ? 13 + speedFrac * 7 : 10) * (mate && !mate.down ? camZoom : 1) * camDist;
      var up = (driving ? 6.2 + speedFrac * 1.5 : 5.4) * camDist;
      // pitch: drag up to look down on the fight, drag down to look ahead
      up += Math.sin(camPitch) * back * 0.9;
      back *= Math.cos(camPitch) * 0.85 + 0.15;
      var fx = Math.sin(camYaw), fz = Math.cos(camYaw);
      var cx = tx - fx * back, cz = tz - fz * back;
      var cy = camGround + up;
      var groundAtCam = gy(cx, cz) + 2.4;
      if (cy < groundAtCam) cy = groundAtCam;
      var hgt = veh ? player.drive.hgt : 0;
      camera.position.set(cx + sx, cy, cz + sz);
      camera.lookAt(tx + fx * 5 + sx, camGround + 1.8 + hgt * 0.4, tz + fz * 5 + sz);
      if (xh) xh.classList.toggle('hidden', !!veh || G.state !== 'play');
      return;
    }
    if (xh) xh.classList.add('hidden');
    camera.position.set(tx + sx, camGround + 18 * camZoom, tz + 14.5 * camZoom + sz);
    camera.lookAt(tx + sx, camGround, tz - 1.6 + sz);
  }

  // =================================================================
  // HUD
  // =================================================================
  var el = {};
  // DOM writes only when the string actually changed (the HUD runs every frame)
  var lastDom = {};
  function setHTML(node, html) {
    if (!node) return;
    var k = node.id || node;
    if (lastDom[k] === html) return;
    lastDom[k] = html; node.innerHTML = html;
  }
  function setText(node, text) {
    if (!node) return;
    var k = node.id || node;
    if (lastDom[k] === text) return;
    lastDom[k] = text; node.textContent = text;
  }
  function cacheEls() {
    ['hp-fill', 'hp-text', 'xp-fill', 'lvl-text', 'wave-label', 'wave-timer',
      'coin-count', 'boost-fill', 'stat-icons', 'boss-bar-wrap', 'boss-name',
      'boss-fill', 'announce', 'buff-line', 'reload-line',
      'drive-hud', 'dh-speed', 'dh-nitro-fill', 'dh-drift'].forEach(function (id) {
        el[id] = document.getElementById(id);
      });
  }

  function updateHUDStatic() {
    el['wave-label'].textContent =
      expActive ? 'THE REACH' :
      G.mode === 'arena' ? 'Wave ' + waveNum : 'Wave ' + waveNum + '/' + GH.WAVES;
    var s = player.stats;
    var vals = {
      block: Math.round(s.block) + '%', armor: Math.round(s.armor),
      crit: Math.round(s.crit) + '%', atkSpd: Math.round(s.atkSpdMult * 100) + '%',
      damage: '+' + Math.round(s.flatDamage), magnet: GH.fmt1(s.magnet),
      lifesteal: Math.round(s.lifesteal) + '%', speed: GH.fmt1(s.speed / 0.42)
    };
    var html = '';
    player.def.hudStats.forEach(function (k) {
      html += '<div class="stat-icon" title="' + GH.statLabel[k] + '"><div class="si-g">' +
        GH.statGlyphs[k] + '</div><div class="si-v">' + vals[k] + '</div></div>';
    });
    el['stat-icons'].innerHTML = html;
  }

  function updateHUD() {
    var s = player.stats;
    el['hp-fill'].style.width = GH.clamp(player.hp / s.maxHP * 100, 0, 100) + '%';
    setText(el['hp-text'], Math.ceil(player.hp) + '/' + Math.round(s.maxHP));
    el['xp-fill'].style.width = GH.clamp(player.xp / player.xpNeed * 100, 0, 100) + '%';
    setText(el['lvl-text'], 'LVL ' + player.level);
    if (expActive) {
      var dst = dungeonStatusText();
      setText(el['wave-timer'], dst ||
        (zoneNow ? 'DANGER ' + ['I', 'II', 'III', 'IV'][zoneNow.danger - 1] + (GH.worldlife.band().id !== 'bronze' ? ' · ' + GH.worldlife.band().name : '') : ''));
    } else {
      setText(el['wave-timer'], GH.fmt1(Math.max(0, waveTimer)));
    }
    setText(el['coin-count'], '×' + coinsRun + '   ⬡ ' + GH.meta.data.mats.alloy + ' ALLOY · ◈ ' + GH.meta.data.mats.cores + ' CORES');
    el['boost-fill'].style.width = (player.boost * 100) + '%';
    // skimmer drive cluster: velocity readout, the bottle, the drift call
    if (el['drive-hud']) {
      var driving = !!(player.speederOn && player.drive);
      el['drive-hud'].classList.toggle('hidden', !driving);
      if (driving) {
        var dvd = player.drive;
        setText(el['dh-speed'], Math.round(Math.max(0, dvd.fwd) * 11));
        el['dh-nitro-fill'].style.width = Math.round(dvd.nitro * 100) + '%';
        el['dh-nitro-fill'].classList.toggle('dh-burning', dvd.nitroT > 0);
        // one status word under the speedo: what the ground is doing to you
        var dstat = dvd.bog > 0.5 ? (player.speederOn && GH.terrain.surface(player.x, player.z) === 'snow' ? 'SNOWBOUND — REVERSE' : 'BOGGED — REVERSE')
          : dvd.turboT > 0 ? 'TURBO' : dvd.boostT > 0 ? 'BOOST' : dvd.air ? (dvd.nitroJump > 0 ? 'NITRO AIR' : 'AIR')
          : dvd.offTrack ? 'OFF TRACK' : dvd.driftHeat > 0.5 ? 'SKIDS HOT' : dvd.drift
            ? (dvd.driftTier >= 3 ? 'DRIFT ●●● RELEASE!' : dvd.driftTier === 2 ? 'DRIFT ●●' : dvd.driftTier === 1 ? 'DRIFT ●' : 'DRIFT') : '';
        if (!dstat && player.item) dstat = ITEM_NAMES[player.item] + ' [G]';
        setText(el['dh-drift'], dstat);
        el['dh-drift'].classList.toggle('hidden', !dstat);
      }
    }
    // energy capacitor + ability hotbar
    var enEl = document.getElementById('energy-fill');
    if (enEl) enEl.style.width = GH.clamp(player.energy / player.stats.energyMax * 100, 0, 100) + '%';
    var hb = document.getElementById('hotbar');
    if (hb) {
      var hh = '';
      for (var hn = 1; hn <= 5; hn++) {
        var ab = hn === 5 ? player.sig : GH.skills.ABILITIES[hn];
        var known = hn === 5 ? true : player.skillBon.slots[hn];
        var cd = Math.max(0, player.abilityCds[hn]);
        var ready = known && cd <= 0 && player.energy >= ab.cost;
        hh += '<div class="hb-slot' + (hn === 5 ? ' sig' : '') + (known ? '' : ' locked') + (ready ? ' ready' : '') + '" title="' +
          ab.name + ' — ' + ab.desc + ' (' + ab.cost + ' energy)">' +
          '<div class="hb-glyph">' + (known ? ab.glyph : '✕') + '</div>' +
          '<div class="hb-key">' + GH.controls.label('ability' + hn) + '</div>' +
          (known && cd > 0 ? '<div class="hb-cd">' + Math.ceil(cd) + '</div>' : '') +
          '</div>';
      }
      setHTML(hb, hh);
    }
    // target readout
    var tp = document.getElementById('target-panel');
    if (tp) {
      if (target && !target.dead) {
        tp.classList.remove('hidden');
        setText(document.getElementById('target-name'), target.def.name);
        document.getElementById('target-fill').style.width =
          GH.clamp(target.hp / target.maxHp * 100, 0, 100) + '%';
      } else {
        tp.classList.add('hidden');
      }
    }
    if (bossRef && !bossRef.dead) {
      el['boss-fill'].style.width = GH.clamp(bossRef.hp / bossRef.maxHp * 100, 0, 100) + '%';
    }
    // buff line: element / frenzy / wrath / special state
    // ward row: three stances + energy
    var wardEl = document.getElementById('ward-row');
    var wh = '';
    var wardKeys = [GH.controls.label('ward1'), GH.controls.label('ward2'), GH.controls.label('ward3')];
    WARD_ORDER.forEach(function (w, i) {
      var on = player.ward === w;
      wh += '<span class="ward-chip' + (on ? ' on' : '') + '" style="' +
        (on ? 'border-color:#' + WARDS[w].color.toString(16) + ';color:#fff' : '') + '">' +
        wardKeys[i] + ' ' + WARDS[w].name + '</span>';
    });
    wh += '<span class="ward-energy"><span class="ward-energy-fill" style="width:' +
      Math.round(player.wardEnergy * 100) + '%"></span></span>';
    if (player.counter.length) wh += '<span class="ward-counter">COUNTER ×' + player.counter.length + '</span>';
    if (player.wardCd > 0) wh += '<span class="ward-counter" style="color:#ff8080">COLLAPSED</span>';
    setHTML(wardEl, wh);

    var buffs = [];
    if (player.speederOn) {
      buffs.push('<span style="color:#70c0ff">SKIMMER — STRAFE CANNONS · +25% DMG TAKEN</span>');
    }
    var prim = player.weapons[0];
    if (prim.w.cycle) {
      var elx = currentElement(prim);
      buffs.push('<span style="color:' + GH.elements[elx].css + '">' + GH.elements[elx].name.toUpperCase() + '</span>');
    }
    if (player.frenzy.length) buffs.push('FRENZY ×' + player.frenzy.length);
    if (player.def.passive === 'wrath') {
      var wr = Math.round(Math.min(0.6, (1 - player.hp / s.maxHP) * 0.75) * 100);
      if (wr > 0) buffs.push('WRATH +' + wr + '%');
    }
    if (player.edgeT > 0) buffs.push('EDGE');
    if (player.special.active > 0) buffs.push(player.def.special.toUpperCase());
    setHTML(el['buff-line'], buffs.join(' · '));
    el['reload-line'].textContent = player.suppressed ? 'SIGNAL LOST — LEAVE THE RIFT' :
      (prim.reloading > 0 ? 'RELOADING' :
        (prim.w.clip ? prim.clip + '/' + prim.w.clip : ''));
    var p2wrap = document.getElementById('p2-row');
    if (mate) {
      p2wrap.classList.remove('hidden');
      document.getElementById('p2-fill').style.width =
        GH.clamp(mate.hp / s.maxHP * 100, 0, 100) + '%';
      document.getElementById('p2-text').textContent =
        mate.down ? 'DOWN — stand close to revive' : 'P2 ' + Math.ceil(mate.hp);
    } else {
      p2wrap.classList.add('hidden');
    }
    if (announceTimer > 0) {
      announceTimer -= 1 / 60;
      if (announceTimer <= 0) el['announce'].classList.add('hidden');
    }
    pumpAnnounceQueue();
    // active contract progress
    var contractEl = document.getElementById('contract-line');
    if (cipherRun) {
      contractEl.textContent = cipherHudText();
    } else {
      var ac = GH.meta.data.broker.active;
      if (ac && (!ac.stage || ac.stage === stage.id)) {
        contractEl.textContent = 'CONTRACT: ' + GH.enemyDefs[ac.target].name +
          ' ' + ac.have + '/' + ac.need;
      } else if (ac) {
        contractEl.textContent = 'CONTRACT: ' + GH.progress.stageName(ac.stage) + ' only';
      } else {
        contractEl.textContent = '';
      }
    }
  }

  function announce(text, size) {
    el['announce'].textContent = text;
    el['announce'].style.fontSize = (size || 40) + 'px';
    el['announce'].classList.remove('hidden');
    el['announce'].style.animation = 'none';
    void el['announce'].offsetWidth;
    el['announce'].style.animation = '';
    announceTimer = 1.4;
  }

  // queued announcements wait for the current one to fade
  function queueAnnounce(text, size) {
    announceQueue.push([text, size]);
  }
  function pumpAnnounceQueue() {
    if (announceTimer <= 0 && announceQueue.length) {
      var a = announceQueue.shift();
      announce(a[0], a[1]);
    }
  }

  function showBossBar(name) {
    el['boss-name'].textContent = name;
    el['boss-bar-wrap'].classList.remove('hidden');
  }
  function hideBossBar() { el['boss-bar-wrap'].classList.add('hidden'); }

  // =================================================================
  // RUN LIFECYCLE
  // =================================================================
  function clearWorld() {
    if (expActive && player) saveExpedition(); // leaving the Reach: flush the character
    [enemies, projectiles, enemyShots, pickups, mines].forEach(function (list) {
      for (var i = 0; i < list.length; i++) scene.remove(list[i].mesh);
      list.length = 0;
    });
    for (var i = 0; i < effects.length; i++) {
      scene.remove(effects[i].mesh);
      if (effects[i].disc) scene.remove(effects[i].disc);
    }
    effects.length = 0;
    clearHazards();
    while (orbitGroup.children.length) orbitGroup.remove(orbitGroup.children[0]);
    if (droneMesh) { scene.remove(droneMesh); droneMesh = null; }
    if (picoDrone) { scene.remove(picoDrone); picoDrone = null; }
    if (cipherRun) {
      if (cipherRun.marker) scene.remove(cipherRun.marker);
      cipherRun = null;
    }
    if (player) {
      if (wardDome && wardDome.parent === player.mesh) player.mesh.remove(wardDome);
      if (player.speederMesh) scene.remove(player.speederMesh);
      scene.remove(player.mesh);
      player = null;
    }
    if (mate) { scene.remove(mate.mesh); mate = null; }
    if (selPreview) { scene.remove(selPreview); selPreview = null; }
    target = null;
    if (reticle) reticle.visible = false;
    bossRef = null;
    hideBossBar();
    // expedition teardown: the continent, camp, and its UI
    if (worldH) { scene.remove(worldH.group); worldH = null; }
    GH.terrain.clear();
    GH.atmos.clear(scene);
    GH.audio.ambient(null);
    zoneEvent = null;
    camGround = 0;
    if (wreckMesh) { scene.remove(wreckMesh); wreckMesh = null; }
    if (harrowTotem) { scene.remove(harrowTotem); harrowTotem = null; }
    scene.fog.near = 18; scene.fog.far = 52; // undo whiteout/dungeon gloom
    if (dungeonState && dungeonState.haulerMesh) scene.remove(dungeonState.haulerMesh);
    dungeonState = null;
    weatherNow = null;
    weatherToday = null;
    harrowSpot = null;
    harrowUp = false;
    expActive = false;
    siege = null;
    zoneNow = null;
    nearInteract = null;
    interactables = [];
    veins = [];
    signalSpot = null;
    huntSpot = null; huntUp = false;
    if (huntTotem) { scene.remove(huntTotem); huntTotem = null; }
    if (tutorial) { tutorial = null; if (tutMarker) scene.remove(tutMarker); var obx = document.getElementById('objective'); if (obx) obx.classList.add('hidden'); }
    wallRing.visible = true;
    floor.visible = true;
    var il = document.getElementById('interact-line');
    if (il) il.classList.add('hidden');
    var mm = document.getElementById('minimap');
    if (mm) mm.classList.add('hidden');
    var zc = document.getElementById('zone-compass');
    if (zc) zc.classList.add('hidden');
  }

  G.startRun = function (mechIndex, stageIdx, startAt, opts) {
    clearWorld();
    opts = opts || {};
    weekly = opts.weekly || null;
    stageIndex = GH.clamp(stageIdx || 0, 0, GH.stages.length - 1);
    stage = GH.stages[stageIndex];
    applyStageLook(stage);
    var resume = opts.resume || null;
    if (resume) {
      // EXIT RUN left this character mid-climb: rebuild it from the save
      restoreCharacter(resume.char);
      player.x = 0; player.z = 0;
    } else {
      player = makePlayer(GH.mechs[mechIndex]);
      // pilot mastery bonuses for this frame
      var mb = GH.progress.masteryBonus(player.def.id);
      player.stats.damageMult += mb.damageMult;
      player.stats.maxHP += mb.maxHP;
      player.hp = player.stats.maxHP;
      player.stats.boostRegen += mb.boostRegen;
      if (mb.energyBonus) player.stats.energyRegen *= 1.1;
    }
    GH.meta.data.suspended = null; // whatever was parked is now live (or replaced)

    // chase cosmetics: paint, trail, pico-drone
    var style = GH.meta.data.style;
    if (style.paint) {
      var pc = GH.progress.cosmeticById(style.paint);
      if (pc) repaintMech(player.mesh, pc.color);
    }
    if (style.trail) {
      var tc = GH.progress.cosmeticById(style.trail);
      if (tc) {
        player.trailColor = tc.color;
        setFlameColor(player.mesh, tc.color);
      }
    }
    if (picoDrone) { scene.remove(picoDrone); picoDrone = null; }
    if (style.drone) {
      var dc = GH.progress.cosmeticById(style.drone);
      if (dc) {
        picoDrone = GH.models.buildPico(dc.shape);
        scene.add(picoDrone);
      }
    }

    // season relics warp every non-weekly run
    var relicOn = function (id) {
      return G.mode !== 'weekly' && GH.progress.hasRelic(id);
    };
    var st2 = player.stats;
    if (relicOn('vamp')) { st2.lifesteal += 8; st2.maxHP = Math.round(st2.maxHP * 0.85); }
    if (relicOn('overclock')) { st2.atkSpdMult += 0.2; st2.armor -= 2; }
    if (relicOn('gravity')) { st2.magnet *= 2; }
    if (relicOn('juggernaut')) { st2.armor += 4; st2.speed *= 0.9; }
    if (relicOn('glass')) { st2.damageMult += 0.3; st2.maxHP = Math.round(st2.maxHP * 0.75); }
    if (relicOn('phase')) { st2.boostCost = 0; st2.boostRegen *= 0.65; }
    if (relicOn('salvager')) { st2.xpGain = Math.max(0.5, st2.xpGain - 0.1); }
    if (relicOn('twin')) { st2.bonusProj += 1; st2.damageMult -= 0.15; }
    player.hp = Math.min(player.hp, st2.maxHP);
    cipherRun = null;
    if (weekly && weekly.mods.php !== 1) {
      player.stats.maxHP = Math.round(player.stats.maxHP * weekly.mods.php);
      player.hp = resume ? Math.min(player.hp, player.stats.maxHP) : player.stats.maxHP;
    }
    if (weekly && weekly.mods.crit) player.stats.crit += weekly.mods.crit;
    mate = null;
    if (G.coop) {
      var p2Idx = (opts.p2Mech !== undefined && opts.p2Mech >= 0) ? opts.p2Mech : mechIndex;
      spawnWingmate(p2Idx);
    }
    if (opts.preset && !GH.meta.isIron() && !resume) applyPreset(opts.preset);
    if (GH.devGrant && !resume) applyPreset({ weapons: GH.devGrant });
    // stage-trial perks (permanent, stage-scoped)
    var trialTier = GH.progress.trialTier(stage.id);
    if (trialTier >= 2) player.stats.xpGain += 0.10;
    if (trialTier >= 3) player.stats.damageMult += 0.05;
    kills = 0; coinsRun = 0; runTime = 0; hitCount = 0; sparksRun = 0;
    alloyRun = 0; coresRun = 0; runesRun = 0;
    elitesSpawned = 0;
    if (resume) {
      kills = resume.kills || 0; coinsRun = resume.coinsRun || 0; runTime = resume.runTime || 0;
      sparksRun = resume.sparksRun || 0;
    }
    announceQueue.length = 0;
    activeHint = null;
    hintTimer = 0;
    document.getElementById('hint-line').classList.add('hidden');
    G.state = 'play';
    GH.music.play(stage.id);
    GH.music.setBoss(false);
    startAt = GH.clamp(startAt || 1, 1, 20);
    if (startAt > 1 && !resume) devCatchUp(startAt);
    if (resume) wavePlan = GH.wavePlan(stage, 1, false);
    startWave(startAt);
    updateHUDStatic();
    document.getElementById('hud').classList.remove('hidden');
    if (resume) queueAnnounce('RUN RESUMED — WAVE ' + startAt, 24);
  };

  // ---------------------------------------------------------------
  // Leaving a run. EXIT keeps it (the Reach saves its character, an
  // arena climb is parked at the start of its current wave); ABANDON
  // deletes it for good.
  // ---------------------------------------------------------------
  G.suspendRun = function () {
    if (!player) return false;
    if (expActive) { saveExpedition(); return true; }
    if (G.state !== 'play' && G.state !== 'pause') return false;
    GH.meta.data.suspended = {
      mode: G.mode, stage: stageIndex, wave: Math.max(1, waveNum),
      char: serializeCharacter(),
      kills: kills, coinsRun: coinsRun, runTime: runTime, sparksRun: sparksRun,
      weekly: weekly, coop: !!mate, mateMech: mate ? mate.def.id : null,
      when: new Date().toISOString().slice(0, 10)
    };
    GH.meta.save();
    return true;
  };
  G.hasSuspended = function () { return !!GH.meta.data.suspended; };
  G.suspendedLabel = function () {
    var sv = GH.meta.data.suspended;
    if (!sv) return '';
    var def = sv.char && sv.char.mechId ? GH.mechById(sv.char.mechId) : GH.mechs[sv.char ? sv.char.mech : 0];
    return (sv.mode === 'arena' ? 'ARENA' : sv.mode === 'weekly' ? 'WEEKLY' : 'GAUNTLET') + ' · ' +
      GH.stages[sv.stage].name + ' · WAVE ' + sv.wave + ' · ' + (def ? def.name : '?');
  };
  G.resumeRun = function () {
    var sv = GH.meta.data.suspended;
    if (!sv) return false;
    G.mode = sv.mode || 'classic';
    G.coop = !!sv.coop;
    var idx = sv.char && sv.char.mechId ? GH.mechs.indexOf(GH.mechById(sv.char.mechId)) : (sv.char ? sv.char.mech : 0);
    var p2 = sv.mateMech ? GH.mechs.indexOf(GH.mechById(sv.mateMech)) : -1;
    G.startRun(Math.max(0, idx), sv.stage, sv.wave, { resume: sv, weekly: sv.weekly, p2Mech: p2 });
    return true;
  };
  G.abandonRun = function () {
    // the Reach: the character and its wreck are gone; the world's scars stay
    if (expActive) {
      expActive = false; // clearWorld() must not re-save the character we're deleting
      GH.meta.data.world.exp = null;
      GH.meta.data.world.wreck = null;
    }
    GH.meta.data.suspended = null;
    GH.meta.save();
  };
  G.isExpedition = function () { return expActive; };
  // tear the arena / world down and go home (EXIT and ABANDON both end here)
  G.leaveRun = function () {
    clearWorld();
    G.state = 'title';
    GH.music.play('title');
    GH.music.setBoss(false);
    document.getElementById('hud').classList.add('hidden');
  };

  // Arena loadout preset: grant starting weapons/traits/gems by card id
  function applyPreset(ps) {
    var findCard = function (id) {
      for (var i = 0; i < GH.upgrades.length; i++) {
        if (GH.upgrades[i].id === id) return GH.upgrades[i];
      }
      return null;
    };
    (ps.weapons || []).forEach(function (wid) {
      var card = findCard(wid);
      if (card && !player.weaponLevels[wid]) {
        player.weapons.push(makeWeaponInst(wid, card.weapon));
        player.weaponLevels[wid] = 1;
      }
    });
    (ps.traits || []).forEach(function (tid) {
      var card = findCard(tid);
      if (card) card.apply(player);
    });
    (ps.gems || []).forEach(function (g) {
      var prim = player.weapons[0];
      if (prim.sockets.length < 4) {
        prim.sockets.push(g);
        GH.gems.applySocketBonuses(prim);
      }
    });
  }

  function devCatchUp(startAt) {
    // dev skip (?wave=N): rough catch-up — levels plus a few sockets,
    // matching the post-card-system progression model
    wavePlan = GH.wavePlan(stage, 1, false);
    var prim = player.weapons[0];
    for (var i = 1; i < startAt; i++) {
      gainXP(6 + player.level * 3);
      if (i % 5 === 0 && prim.sockets.length < 4) {
        prim.sockets.push(GH.pick(GH.gems.typeIds));
        GH.gems.applySocketBonuses(prim);
      }
    }
  }

  function gameOver(won) {
    // expedition deaths are ARPG deaths: drop a wreck, wake at camp
    // (IRON CORE keeps its one-death rule even out in the Reach)
    if (expActive && !won && !GH.meta.isHardcore()) {
      GH.audio.die();
      spawnBurst(player.x, 1.2, player.z, 0xff6030, 30);
      var lost = Math.round(coinsRun * 0.6);
      if (lost > 0) {
        GH.meta.data.world.wreck = { zone: curZone, x: player.x, z: player.z, salvage: lost };
        if (wreckMesh) scene.remove(wreckMesh);
        wreckMesh = GH.models.buildWreckSite();
        wreckMesh.position.set(player.x, 0 + gy(player.x, player.z), player.z);
        scene.add(wreckMesh);
      }
      coinsRun = 0;
      if (player.speederOn) toggleSpeeder(); // wake up back in frame form
      // dragged back to the outpost — wherever you fell
      if (curZone !== 'wreck') loadZone('wreck', null);
      player.x = GH.world.CAMP.x;
      player.z = GH.world.CAMP.z + 4;
      player.hp = Math.round(player.stats.maxHP * 0.6);
      player.hurtCd = 1.2;
      travelCd = 2;
      siege = null;
      GH.music.setBoss(false);
      queueAnnounce('FRAME DOWN — RECOVERED AT CAMP' + (lost ? ' · WRECK HOLDS ' + lost + ' SALVAGE' : ''), 24);
      saveExpedition();
      return;
    }
    G.state = won ? 'win' : 'over';
    if (won) GH.audio.win(); else GH.audio.die();
    if (!won) spawnBurst(player.x, 1.2, player.z, 0xff6030, 30);
    GH.music.play('title');
    if (won) GH.music.sting('victory', 7);
    GH.music.setBoss(false);

    var meta = GH.meta;
    var banked = weekly ? Math.round(coinsRun * weekly.mods.salvage) : coinsRun;
    if (GH.progress.trialTier(stage.id) >= 1) banked = Math.round(banked * 1.15);
    if (G.mode !== 'weekly' && GH.progress.hasRelic('salvager')) banked = Math.round(banked * 1.4);
    var unlockMsg = '';

    // IRON CORE: a death erases the profile and engraves the pilot
    if (!won && meta.isHardcore()) {
      expActive = false; // the Reach save died with the pilot — never re-save it
      var mem = meta.hardcoreWipe(player.def.name, stage.name, waveNum);
      document.getElementById('end-title').innerHTML = 'CORE&nbsp;EXTINGUISHED';
      document.getElementById('end-stats').innerHTML =
        '<b>IRON CORE — progression erased.</b>\n' +
        mem.frame + ' fell on ' + mem.stage + ', wave ' + mem.wave + '.\n' +
        'The pilot is engraved on the memorial.';
      document.getElementById('hud').classList.add('hidden');
      document.getElementById('end-screen').classList.remove('hidden');
      return;
    }

    meta.data.salvage += banked;
    meta.data.suspended = null; // a finished run can't be continued
    meta.data.collection.totalRuns++;
    if (won) meta.data.collection.totalWins++;
    // workshop materials for the run: alloy by depth, cores for a clear
    var endAlloy = Math.round(waveNum * 1.5 + kills / 10) + (won ? 30 : 0);
    grantMats(endAlloy, won ? 2 : 0, true);
    var matsMsg = 'Workshop: <b>+' + (alloyRun) + ' alloy</b>' + (coresRun ? ' · <b>+' + coresRun + ' frame cores</b>' : '') + (runesRun ? ' · <b>+' + runesRun + ' art rune' + (runesRun > 1 ? 's' : '') + '</b>' : '') + '\n';
    if (won && G.mode === 'classic') awardTrial('clear');

    // pilot mastery XP: kills + depth, with a victory bonus
    var mXP = kills + waveNum * 5 + (won ? 120 : 0);
    var mUps = GH.progress.masteryGain(player.def.id, mXP);
    var mLvl = GH.progress.masteryLevel(player.def.id);
    var masteryMsg = 'Mastery <b>+' + mXP + ' XP</b>' +
      (mUps > 0 ? ' → <b>' + player.def.name + ' Lv ' + mLvl + '</b>' : ' (Lv ' + mLvl + ')') + '\n';

    // season task evaluation from this run
    var s6 = GH.progress.seasonCheck();
    if (waveNum >= 10) seasonTaskNotify('w10');
    if (waveNum >= 14) seasonTaskNotify('w15');
    if (G.mode === 'arena' && waveNum >= 25) seasonTaskNotify('arena25');
    if (won && G.mode === 'classic') {
      seasonTaskNotify('clear1');
      s6.stagesCleared[stage.id] = true;
      if (Object.keys(s6.stagesCleared).length >= 3) seasonTaskNotify('clear3');
      s6.framesWon[player.def.id] = true;
      if (Object.keys(s6.framesWon).length >= 3) seasonTaskNotify('frames3');
      if (mate) seasonTaskNotify('coopwin');
    }
    if (G.mode === 'weekly') {
      var wk = meta.data.weekly || {};
      if (wk.week !== weekly.week || waveNum > (wk.best || 0)) {
        if (wk.week !== weekly.week) wk = { week: weekly.week, best: 0 };
        if (waveNum > wk.best) wk.best = waveNum;
        meta.data.weekly = wk;
      }
      unlockMsg = 'WEEKLY ' + weekly.week + ' — best wave ' + meta.data.weekly.best + '\n';
    } else if (G.mode === 'classic') {
      var best = meta.data.bestWave[stage.id] || 0;
      if (waveNum > best) meta.data.bestWave[stage.id] = waveNum;
      if (won) {
        meta.data.victories[stage.id] = true;
        unlockMsg = frameReward(stage.unlocks);
        meta.unlockStage(stageIndex + 2);
      }
    } else {
      if (waveNum > meta.data.bestArena) meta.data.bestArena = waveNum;
    }
    meta.save();

    document.getElementById('end-title').innerHTML = won ? 'GAUNTLET&nbsp;CLEARED' : 'FRAME&nbsp;DESTROYED';
    document.getElementById('end-stats').innerHTML = unlockMsg + masteryMsg + matsMsg +
      stage.name + (G.mode === 'arena' ? ' · ARENA' : (G.mode === 'weekly' ? ' · WEEKLY' : '')) +
      ' — reached <b>Wave ' + waveNum + '</b> as <b>' + player.def.name + '</b>' +
      (mate ? ' <i>(co-op)</i>' : '') + '\n' +
      'Level <b>' + player.level + '</b> · Kills <b>' + kills + '</b> · Salvage <b>+' + banked + '</b>\n' +
      'Time <b>' + Math.floor(runTime / 60) + ':' + ('0' + Math.floor(runTime % 60)).slice(-2) + '</b>';
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('end-screen').classList.remove('hidden');
  }

  G.pauseInfo = function () {
    if (!player) return '';
    var txt = player.def.name + ' · ' + stage.name + ' · Wave ' + waveNum + ' · LVL ' + player.level + '\n\nWeapons:';
    player.weapons.forEach(function (inst) {
      var res = inst.resonance ? '  [' + GH.gems.resonanceLabel(inst.resonance) + ']' : '';
      var gems = inst.sockets.length ? ' ◆' + inst.sockets.length : '';
      txt += '\n· ' + weaponDisplayName(inst) +
        (player.weaponLevels[inst.id] > 1 ? ' LVL ' + player.weaponLevels[inst.id] : '') + gems + res;
    });
    return txt;
  };

  // =================================================================
  // SELECT SCREEN
  // =================================================================
  G.enterSelect = function () {
    clearWorld();
    G.state = 'select';
    GH.music.play('title');
    scene.background = GH.assets.selectSky;
    scene.fog.color.setHex(0x060a2a);
    floor.material.map = GH.assets.gridTex;
    floor.material.needsUpdate = true;
    wallRing.visible = false;
    while (arenaProps.children.length) arenaProps.remove(arenaProps.children[0]);
    if (!GH.meta.data.shells[GH.mechs[selMechIndex].id]) selMechIndex = 0;
    G.selectMech(selMechIndex);
    buildSelectIcons();
  };

  G.selectMech = function (i) {
    selMechIndex = i;
    var def = GH.mechs[i];
    var unlocked = !!GH.meta.data.shells[def.id];
    if (selPreview) scene.remove(selPreview);
    var cfg = {};
    for (var k in def.model) cfg[k] = def.model[k];
    if (!unlocked) cfg.corrupt = true;
    selPreview = GH.models.buildMech(cfg);
    selPreview.position.set(0, 0.2, 0);
    selPreview.scale.setScalar(1.0);
    scene.add(selPreview);
    document.getElementById('select-name').textContent = def.name + (unlocked ? '' : ' — LOCKED');
    document.getElementById('select-role').textContent = def.role;
    if (unlocked) {
      document.getElementById('select-desc').textContent = def.desc;
      document.getElementById('select-stats').innerHTML =
        '<b>Base Stats</b>\n' + def.baseText +
        '\n\n<b>On Level Up</b>\n' + def.levelText +
        '\n\n<b>Primary</b>\n' + def.weapon.name + ' (' + (def.weapon.cls || '') + ')' +
        '\n\n<b>Special</b>\n' + def.specialText +
        '\n\n<b>Signature [' + GH.controls.label('ability5') + ']</b>\n' + GH.skills.signatureFor(def).name + ' — ' + GH.skills.signatureFor(def).desc;
    } else {
      var rst = GH.roster.status(def.id);
      document.getElementById('select-desc').textContent = def.desc;
      document.getElementById('select-stats').innerHTML =
        '<b>To unlock</b>\n' + rst.text + (rst.recipe
          ? '\n\n<b>Workshop bill</b>\n' + rst.recipe.alloy + ' alloy · ' + rst.recipe.cores + ' frame cores · ' + rst.recipe.salvage + ' salvage' +
            '\n\nOpen HANGAR → FRAME WORKSHOP to build it.'
          : '');
    }
    buildSelectIcons();
    document.getElementById('btn-launch').textContent = unlocked ? 'SELECT STAGE' : 'LOCKED';
    if (G.onSelectChange) G.onSelectChange();
  };

  // the hangar rack: every frame you own (135 exist — the locked ones live
  // in the WORKSHOP, so the rack never becomes a wall of padlocks)
  function buildSelectIcons() {
    var wrap = document.getElementById('select-icons');
    wrap.innerHTML = '';
    var shown = 0;
    GH.mechs.forEach(function (def, i) {
      var owned = !!GH.meta.data.shells[def.id];
      if (!owned && def.kind !== 'feat') return;
      shown++;
      var d = document.createElement('div');
      d.className = 'mech-icon' + (i === selMechIndex ? ' sel' : '') + (owned ? '' : ' locked');
      var pk = def.pack ? GH.roster.packById(def.pack) : null;
      if (pk) d.style.borderColor = pk.css;
      if (def.kind === 'relic') d.style.borderColor = '#ffd050';
      d.textContent = def.icon;
      d.title = def.name + (owned ? '' : ' — ' + GH.roster.status(def.id).text);
      d.onclick = function () { GH.audio.card(); G.selectMech(i); };
      wrap.appendChild(d);
    });
    var more = document.createElement('div');
    more.className = 'mech-icon build-more';
    more.textContent = '+';
    more.title = 'Build more frames in the WORKSHOP (' + GH.roster.owned() + '/' + GH.roster.TOTAL + ' owned)';
    more.onclick = function () { if (G.onOpenWorkshop) G.onOpenWorkshop(); };
    wrap.appendChild(more);
    var cnt = document.getElementById('select-count');
    if (cnt) cnt.textContent = 'FRAMES OWNED ' + GH.roster.owned() + ' / ' + GH.roster.TOTAL + ' — build more in the WORKSHOP';
  }

  G.getSelectedMech = function () { return selMechIndex; };
  G.selectedUnlocked = function () { return !!GH.meta.data.shells[GH.mechs[selMechIndex].id]; };

  // =================================================================
  // MAIN UPDATE
  // =================================================================
  G.update = function (dt, input, viewW, viewH) {
    if (G.state === 'select' || G.state === 'stageselect' || G.state === 'hangar' || G.state === 'title') {
      selSpin += dt;
      if (selPreview) selPreview.rotation.y = selSpin * 0.8;
      camera.position.set(Math.sin(selSpin * 0.1) * 1.5, 3.4, 7.5);
      camera.lookAt(0, 1.8, 0);
      return;
    }
    if (G.state === 'race') {
      GH.race.update(dt, input);
      GH.race.tick(dt);
      GH.terrain.update(dt);
      if (player) GH.atmos.update(dt, player.x, gy(player.x, player.z), player.z);
      updateCamera(dt);
      updateHUD();
      G.dmg.update(dt, viewW, viewH);
      return;
    }
    if (G.state !== 'play') {
      G.dmg.update(dt, viewW, viewH);
      return;
    }
    if (hitStopT > 0) {   // frame-freeze for impact
      hitStopT -= dt;
      G.dmg.update(dt, viewW, viewH);
      return;
    }
    runTime += dt;
    updatePlayer(dt, input);
    updateWingmate(dt, input);
    if (expActive) {
      updateExpedition(dt, input);
    } else {
      updateWave(dt);
      updateHazards(dt);
    }
    updateEnemies(dt);
    updateWeapons(dt, input);
    updateOrbit(dt);
    updateDrone(dt);
    updateProjectiles(dt);
    updateMines(dt);
    updatePickups(dt);
    updateEffects(dt);
    updateCipher(dt);
    if (picoDrone) {
      picoAngle += dt * 2.2;
      picoDrone.position.set(
        player.x + Math.sin(picoAngle) * 1.7,
        2.4 + Math.sin(runTime * 3) * 0.15,
        player.z + Math.cos(picoAngle) * 1.7);
      picoDrone.rotation.y += dt * 4;
    }
    updateCamera(dt);
    updateHints(dt);
    updateHUD();
    G.dmg.update(dt, viewW, viewH);
  };

  G.debugInfo = function () {
    return {
      state: G.state, mode: G.mode, stage: stage ? stage.id : null,
      wave: waveNum, kills: kills, hits: hitCount,
      enemies: enemies.length, projectiles: projectiles.length, pickups: pickups.length,
      hp: player ? Math.round(player.hp) : 0,
      level: player ? player.level : 0,
      weapons: player ? player.weapons.map(function (w2) {
        return w2.id + ':' + w2.sockets.join('');
      }) : [],
      boss: bossRef ? bossRef.def.name + ' ' + Math.round(bossRef.hp) +
        (bossRef.phase3 ? ' [TERMINAL]' : (bossRef.phase2 ? ' [UNBOUND]' : '')) : null,
      hazards: hazards.length,
      hazardKind: stage ? stage.hazard : null,
      elites: elitesSpawned,
      suppressed: player ? !!player.suppressed : false,
      salvage: GH.meta.data.salvage,
      shells: Object.keys(GH.meta.data.shells).length,
      music: GH.music.mode(),
      weekly: weekly ? weekly.week : null,
      profile: GH.meta.profile,
      broker: GH.meta.data.broker.active
        ? GH.meta.data.broker.active.target + ' ' + GH.meta.data.broker.active.have + '/' + GH.meta.data.broker.active.need
        : 'none',
      brokerPts: GH.meta.data.broker.points,
      trialTier: stage ? GH.progress.trialTier(stage.id) : 0,
      collection: GH.progress.completion(),
      sparksRun: sparksRun,
      mastery: player ? GH.progress.masteryLevel(player.def.id) : 0,
      masteryTotal: GH.progress.masteryTotal(),
      seasonPts: GH.meta.data.season.pts,
      seasonRelics: GH.meta.data.season.relics.slice(),
      cipher: cipherRun ? cipherRun.steps[cipherRun.idx].id + ' ' + cipherRun.idx + '/' + cipherRun.steps.length : null,
      cipherMark: cipherRun && cipherRun.mx !== undefined ? { x: Math.round(cipherRun.mx), z: Math.round(cipherRun.mz) } : null,
      ward: player ? player.ward : null,
      wardEnergy: player ? Math.round(player.wardEnergy * 100) / 100 : 0,
      counterStacks: player ? player.counter.length : 0,
      cipherDry: GH.meta.data.cipher.dry,
      caches: GH.meta.data.cipher.caches,
      cosmetics: Object.keys(GH.meta.data.style.owned).length,
      mate: mate ? { hp: Math.round(mate.hp), down: mate.down, x: Math.round(mate.x * 10) / 10, z: Math.round(mate.z * 10) / 10 } : null,
      exp: expActive,
      zone: zoneNow ? zoneNow.id : null,
      gates: expActive && worldH ? worldH.layout.gates.map(function (g2) { return { to: g2.to, x: Math.round(g2.x), z: Math.round(g2.z) }; }) : null,
      dungeon: zoneNow ? !!zoneNow.dungeon : false,
      dgState: dungeonState ? {
        arch: dungeonState.arch, tier: dungeonState.tier, done: dungeonState.done,
        opened: dungeonState.opened, remaining: dungeonState.remaining,
        cp: dungeonState.cp, timer: Math.round(dungeonState.timer * 10) / 10,
        wave: dungeonState.wave, objHp: Math.round(dungeonState.objHp), objMax: dungeonState.objMax,
        defenseActive: dungeonState.defenseActive, failed: dungeonState.failed,
        mods: dungeonState.mods.map(function (m) { return m.id; }),
        race: dungeonState.race ? {
          lap: dungeonState.race.lap, gate: dungeonState.race.gate, pos: dungeonState.race.pos,
          countdown: Math.round(dungeonState.race.countdown * 10) / 10,
          style: Math.round(dungeonState.race.style || 0),
          rivals: dungeonState.race.rivals.map(function (rr) {
            return { dead: !!rr.dead, lap: rr.raceLap, gate: rr.raceGate, hp: Math.round(rr.hp) };
          })
        } : null,
        carrying: dungeonState.carrying,
        barrierOpen: dungeonState.barrierOpen,
        lit: dungeonState.litR || null,
        jammed: dungeonState.jammedB || null,
        switches: dungeonState.switchT || null,
        beamLinks: dungeonState.beamLinks ? dungeonState.beamLinks.length : 0,
        items: dungeonState.corePos ? (function () {
          var out = {};
          for (var ik in dungeonState.corePos) {
            out[ik] = {
              x: Math.round(dungeonState.corePos[ik].x * 10) / 10,
              z: Math.round(dungeonState.corePos[ik].z * 10) / 10
            };
          }
          return out;
        })() : null,
        hauler: dungeonState.hauler ? {
          hp: Math.round(dungeonState.hauler.hp), wp: dungeonState.hauler.wp,
          x: Math.round(dungeonState.hauler.x * 10) / 10, z: Math.round(dungeonState.hauler.z * 10) / 10
        } : null,
        cruIdx: dungeonState.cruIdx,
        heistCarrying: dungeonState.heistCarrying,
        heistT: Math.round(dungeonState.heistT * 10) / 10
      } : null,
      dgTier: GH.meta.data.world.dgTier || {},
      dungeonsCleared: Object.keys(GH.meta.data.world.dungeons || {}),
      px: player ? Math.round(player.x * 10) / 10 : 0,
      pz: player ? Math.round(player.z * 10) / 10 : 0,
      nests: expActive && worldH ? cleanseCount() : null,
      lairsDown: Object.keys(GH.meta.data.world.lairsDown).length,
      relaysHeld: Object.keys(GH.meta.data.world.relaysHeld).length,
      siege: siege ? siege.phase : 0,
      near: nearInteract ? nearInteract.kind : null,
      veins: veins.filter(function (v) { return !v.mined; }).length, signal: !!signalSpot,
      wreck: GH.meta.data.world.wreck,
      artifacts: Object.keys(GH.meta.data.world.artifacts),
      artifactOn: GH.meta.data.world.equipped,
      coinsRun: coinsRun,
      transformed: player ? !!player.speederOn : false,
      drive: player && player.speederOn && player.drive ? {
        spd: Math.round(player.drive.fwd * 10) / 10,
        cap: Math.round(player.drive.top * 10) / 10,
        nitro: Math.round(player.drive.nitro * 100) / 100,
        nitroOn: player.drive.nitroT > 0,
        slip: Math.round(player.drive.slip * 10) / 10,
        drift: !!player.drive.drift,
        heading: Math.round(player.drive.heading * 100) / 100,
        score: Math.round(player.drive.score)
      } : null,
      race: G.state === 'race' ? { mode: GH.race.mode(), t: Math.round(GH.race.time() * 10) / 10, riders: GH.race.debug() } : null,
      duelWins: GH.meta.data.world.duelWins,
      raceBest: GH.meta.data.world.raceBest,
      weather: weatherNow ? weatherNow.id : null,
      weatherToday: weatherToday ? Object.keys(weatherToday) : null,
      harrow: harrowSpot ? { zone: harrowSpot.zone, x: Math.round(harrowSpot.x), z: Math.round(harrowSpot.z), up: harrowUp } : null,
      harrowDay: GH.meta.data.world.harrowDay,
      vaultsOpen: Object.keys(GH.meta.data.world.vaults),
      strafe: player && player.strafeInst ? Math.round(player.strafeInst.timer * 1000) : null,
      target: target ? { id: target.id, hp: Math.round(target.hp), x: Math.round(target.x * 10) / 10, z: Math.round(target.z * 10) / 10 } : null,
      aggroed: enemies.filter(function (e2) { return !e2.dead && e2.aggro && !e2.nestId; }).length,
      energy: player ? Math.round(player.energy) : 0,
      cds: player ? [1, 2, 3, 4].map(function (n) { return Math.round(Math.max(0, player.abilityCds[n]) * 10) / 10; }) : null,
      skillPoints: GH.meta.data.skillPoints,
      pilot: GH.skills.pilotProgress().lvl,
      skillRanks: GH.skills.spentTotal()
    };
  };

  // dev/test helper: jump the pilot somewhere (harmless outside dev use)
  // dev: jump the expedition to any zone id (e.g. 'glacier', 'wreck:raceway:1')
  G.devZone = function (zoneId) {
    if (!expActive) return false;
    loadZone(zoneId, curZone);
    player.x = 0; player.z = 0;
    if (zoneNow && zoneNow.dungeon) { player.z = GH.world.BOUNDS.z - 30; }
    else if (worldH && worldH.layout.gates.length) {
      // arrive as a traveller would: just inside the first travel gate
      var g0 = worldH.layout.gates[0];
      var ina = Math.atan2(-g0.x, -g0.z);
      player.x = g0.x + Math.sin(ina) * 10; player.z = g0.z + Math.cos(ina) * 10;
      player.facing = ina; camYaw = ina;
    }
    var sp0 = openSpot(player.x, player.z, 0.8);
    if (sp0) { player.x = sp0.x; player.z = sp0.z; }
    camGround = gy(player.x, player.z);
    return true;
  };
  G.devEventNow = function () { zoneEventT = 0.01; return !!ZONE_EVENTS[curZone]; };
  // dev/test: put the pilot at (x, z) facing `facing` radians; where am I
  G.devPlace = function (x, z, facing) {
    if (!player) return false;
    player.x = x; player.z = z;
    if (facing !== undefined) { player.facing = facing; camYaw = facing; }
    camGround = gy(player.x, player.z);
    return true;
  };
  G.devInfo = function () {
    if (!player) return null;
    return { zone: curZone, x: Math.round(player.x), z: Math.round(player.z), facing: player.facing,
      gates: worldH ? worldH.layout.gates.filter(function (g) { return !g.arch; }).map(function (g) { return { to: g.to, x: Math.round(g.x), z: Math.round(g.z), corner: g.corner || g.side }; }) : [] };
  };
  // dev/test: spawn any enemy beside the pilot; kill the live boss; today's hunt spot
  G.devSpawn = function (id, dx, dz) { if (!player || !GH.enemyDefs[id]) return null; var e = spawnEnemy(id, player.x + (dx || 8), player.z + (dz || 0)); if (e) e.aggro = true; return !!e; };
  G.devKillBoss = function () { if (bossRef && !bossRef.dead) { bossRef.shieldUp = false; damageEnemy(bossRef, 1e9, { canCrit: false }); if (bossRef && bossRef.hp <= 0) killEnemy(bossRef); return true; } return false; };
  G.devHunt = function () { return huntSpot ? { id: huntSpot.id, x: huntSpot.x, z: huntSpot.z, up: huntUp } : null; };
  G.devBoss = function () { return bossRef && !bossRef.dead ? { id: bossRef.id, hp: Math.round(bossRef.hp), max: Math.round(bossRef.maxHp), mech: bossRef.mech, phase: bossRef.phase, shield: !!bossRef.shieldUp } : null; };
  G.devSig = function () { return { name: player && player.sig ? player.sig.name : null, cd: player ? player.abilityCds[5] : 0, kind: player ? player.sigKind : null, energy: player ? Math.round(player.energy) : 0 }; };
  G.devGiveItem = function (kind) { if (player) player.item = kind; };
  G.devUseItem = function () { useItem(); };
  G.devCards = function () { awardCards(3); };
  G.devSpeeder = function (on) {
    if (!player) return;
    if (!!player.speederOn !== !!on) toggleSpeeder();
  };
  G.devState = function () {
    return {
      state: G.state, zone: curZone, x: player ? player.x : 0, z: player ? player.z : 0,
      y: player ? gy(player.x, player.z) : 0, enemies: enemies.length,
      speeder: !!(player && player.speederOn), drive: player ? player.drive : null,
      terrain: !!GH.terrain.active,
      race: dungeonState && dungeonState.race ? {
        lap: dungeonState.race.lap, gate: dungeonState.race.gate, pos: dungeonState.race.pos,
        countdown: dungeonState.race.countdown, style: dungeonState.race.style,
        rivals: dungeonState.race.rivals.map(function (r) { return { x: Math.round(r.x), z: Math.round(r.z), lap: r.raceLap, gate: r.raceGate, dead: !!r.dead }; })
      } : null,
      dungeonDone: !!(dungeonState && dungeonState.done),
      camMode: camMode, camYaw: camYaw, item: player ? player.item : null, weapons: player ? player.weapons.length : 0,
      cards: player && player.pendingCards ? player.pendingCards.length : 0,
      zoneEvent: zoneEvent ? { name: zoneEvent.def.name, wave: zoneEvent.wave, done: zoneEvent.done, t: zoneEvent.t } : null, zoneEventT: zoneEventT,
      shieldT: player ? player.shieldT : 0,
      surface: player ? GH.terrain.surface(player.x, player.z) : null
    };
  };
  G.teleport = function (x, z) {
    if (player) { player.x = x; player.z = z; }
  };

  G.scene = function () { return scene; };
  G.camera = function () { return camera; };
  G.cacheEls = cacheEls;

  return G;
})();
