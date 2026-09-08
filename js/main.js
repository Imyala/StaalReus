// STAALREUS — boot, renderer, input, screen wiring
(function () {
  var renderer, canvas;
  var PIXEL_SCALE = 2;   // render at half resolution: chunky, but the frames keep their edges (was 1/3)
  var input = {
    keys: {},
    mouseNDC: new THREE.Vector2(0, 0),
    special: false,
    attackPressed: false,
    attackHeld: false,
    boostPressed: false,
    boostHeld: false,
    specialPressed: false,
    // MMO camera: right-mouse drag deltas (pixels) and wheel zoom
    lookDX: 0, lookDY: 0, zoomDelta: 0, looking: false,
    p2x: 0, p2y: 0, p2Boost: false,
    p2Special: false, p2SpecialPressed: false,
    wardPressed: 0, wardCycle: false,
    padMoveX: 0, padMoveY: 0, padAimX: 0, padAimY: 0, padAimActive: false,
    touchMoveX: 0, touchMoveY: 0, touchAimX: 0, touchAimY: 0, touchAimActive: false
  };
  var chosenStage = 0;
  var p2keys = {};
  var p2MechIndex = -1;   // -1 = mirror P1

  function boot() {
    canvas = document.getElementById('game-canvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false });
    renderer.setPixelRatio(1);

    GH.game.init();
    GH.game.cacheEls();
    resize();
    window.addEventListener('resize', resize);

    GH.crt.onFail = applySettings;
    applySettings();
    bindInput();
    bindUI();
    bindTouch();
    refreshTitle();
    requestAnimationFrame(loop);
  }

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    var rw = Math.max(2, Math.floor(w / PIXEL_SCALE)), rh = Math.max(2, Math.floor(h / PIXEL_SCALE));
    if (GH.crt.active()) {
      // the scene renders into a low-res texture; the CRT pass draws it at
      // true device resolution so scanlines and the phosphor mask land on real
      // screen pixels. Sizing in CSS pixels on a scaled display (125%, retina)
      // made the browser resample the 1px patterns: moire bands and a doubled
      // dark row across the middle. Bilinear CSS scaling covers any remainder.
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var dw = Math.max(2, Math.round(w * dpr)), dh = Math.max(2, Math.round(h * dpr));
      renderer.setSize(dw, dh, false);
      GH.crt.resize(rw, rh, dw, dh);
      canvas.style.imageRendering = 'auto';
      // CSS size chosen so it maps 1:1 onto device pixels (may be fractional
      // CSS px); any mismatch would make the browser resample and blur it
      canvas.style.width = (dw / dpr) + 'px';
      canvas.style.height = (dh / dpr) + 'px';
    } else {
      renderer.setSize(rw, rh, false);
      canvas.style.imageRendering = '';
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    GH.assets.setSnap(rw, rh);
    var cam = GH.game.camera();
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }

  // settings that live outside the pilot profile (CRT filter, camera)
  function applySettings() {
    var st = GH.controls.settings;
    GH.crt.setLevel(st.crtLevel || 'film');
    var shader = GH.crt.setEnabled(!!st.crt);
    // the CSS scanline overlay only stands in for a failed TUBE shader; the
    // film grade has no fallback worth drawing
    document.getElementById('crt-overlay').classList.toggle('off', !st.crt || shader || (st.crtLevel || 'film') === 'film');
    resize();
    GH.music.setVolume(0.12 * (st.music === undefined ? 1 : st.music));
    GH.audio.setVolume(0.25 * (st.sfx === undefined ? 1 : st.sfx));
  }

  // ----------------------------------------------------------------
  // Keyboard: every key resolves to actions through the binding table
  // (CONTROLS screen). Movement actions map onto input.keys w/a/s/d/q/e
  // which the sim and the racers read: w/s walk or throttle, a/d turn or
  // steer, q/e sidestep.
  var MOVE_KEYS = { forward: 'w', back: 's', turnLeft: 'a', turnRight: 'd', strafeLeft: 'q', strafeRight: 'e' };
  var P2KEYMAP = { KeyI: 'w', KeyJ: 'a', KeyK: 's', KeyL: 'd' };

  // Gamepad routing: with co-op ON the first pad is Player 2; solo, it
  // drives Player 1 (left stick move, right stick turn, A boost, B special).
  function pollPads() {
    var x = (p2keys.d ? 1 : 0) - (p2keys.a ? 1 : 0);
    var y = (p2keys.s ? 1 : 0) - (p2keys.w ? 1 : 0);
    input.padMoveX = 0; input.padMoveY = 0; input.padAimActive = false;
    try {
      var pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (var i = 0; i < pads.length; i++) {
        var gp = pads[i];
        if (!gp || !gp.connected) continue;
        var ax = Math.abs(gp.axes[0]) > 0.25 ? gp.axes[0] : 0;
        var ay = Math.abs(gp.axes[1]) > 0.25 ? gp.axes[1] : 0;
        var btn = function (n) { return gp.buttons[n] && gp.buttons[n].pressed; };
        if (GH.game.coop) {
          // pad = P2
          x += ax; y += ay;
          if (btn(0) && !input._gpHeld) { input.p2Boost = true; input._gpHeld = true; }
          else if (!btn(0)) input._gpHeld = false;
          if (btn(1) || btn(2)) {
            if (!input._gpSpHeld) { input.p2SpecialPressed = true; input._gpSpHeld = true; }
            input.p2Special = true;
          } else { input._gpSpHeld = false; input.p2Special = p2keys.sp || false; }
        } else {
          // pad = P1
          input.padMoveX = ax; input.padMoveY = ay;
          var rx = Math.abs(gp.axes[2] || 0) > 0.3 ? gp.axes[2] : 0;
          var ry = Math.abs(gp.axes[3] || 0) > 0.3 ? gp.axes[3] : 0;
          if (rx || ry) { input.padAimX = rx; input.padAimY = ry; input.padAimActive = true; }
          if (btn(0) && !input._gpHeld) {
            if (GH.game.state === 'play') input.boostPressed = true;
            input._gpHeld = true;
          } else if (!btn(0)) input._gpHeld = false;
          if (btn(1) || btn(2)) {
            if (!input._gpSpHeld) {
              if (GH.game.state === 'play') input.specialPressed = true;
              input._gpSpHeld = true;
            }
            input.special = true;
          } else if (input._gpSpHeld) { input._gpSpHeld = false; input.special = false; }
          if (btn(4) || btn(5)) {
            if (!input._gpWardHeld) {
              if (GH.game.state === 'play') input.wardCycle = true;
              input._gpWardHeld = true;
            }
          } else input._gpWardHeld = false;
          if (btn(3)) { // Y: transform
            if (!input._gpTHeld) {
              if (GH.game.state === 'play') input.transformPressed = true;
              input._gpTHeld = true;
            }
          } else input._gpTHeld = false;
          if (btn(9)) { // start: pause
            if (!input._gpStart) { input._gpStart = true; onEscape(); }
          } else input._gpStart = false;
        }
        break;
      }
    } catch (e) { /* gamepad API unavailable */ }
    input.p2x = GH.clamp(x, -1, 1);
    input.p2y = GH.clamp(y, -1, 1);
  }

  var rebindWait = null;   // action id waiting for a key on the CONTROLS screen

  function typingInField(e) {
    var t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  }

  function bindInput() {
    window.addEventListener('keydown', function (e) {
      GH.audio.unlock();
      if (!GH.music.mode()) GH.music.play('title');
      if (e.code === 'Escape') { onEscape(); e.preventDefault(); return; }
      if (typingInField(e)) return;
      // the CONTROLS screen is listening for a new key
      if (rebindWait) {
        if (GH.controls.rebind(rebindWait, e.code)) GH.audio.card();
        rebindWait = null;
        renderControls();
        e.preventDefault();
        return;
      }
      var acts = GH.controls.actionsFor(e.code);
      var playing = GH.game.state === 'play';
      for (var ai = 0; ai < acts.length; ai++) {
        var a = acts[ai];
        if (MOVE_KEYS[a]) { input.keys[MOVE_KEYS[a]] = true; e.preventDefault(); continue; }
        if (a === 'boost') {
          if (playing) input.boostPressed = true;
          input.boostHeld = true; // skimmer drift hold
          e.preventDefault();
        } else if (a === 'special') {
          input.special = true;
          if (playing) input.specialPressed = true;
        } else if (a.indexOf('ability') === 0 && playing) {
          if (!input.abilityPressed) input.abilityPressed = {};
          input.abilityPressed[parseInt(a.slice(7), 10)] = true;
        } else if (a.indexOf('ward') === 0 && a !== 'wardCycle' && playing) {
          input.wardPressed = parseInt(a.slice(4), 10);
        } else if (a === 'wardCycle' && playing) input.wardCycle = true;
        else if (a === 'interact' && playing) input.interactPressed = true;
        else if (a === 'transform' && playing) input.transformPressed = true;
        else if (a === 'item' && playing) input.itemPressed = true;
        else if (a === 'target' && playing) { GH.game.tabTarget(); e.preventDefault(); }
        else if (a === 'camera' && (playing || GH.game.state === 'race')) GH.game.toggleCamera();
        else if (a === 'skills' && (playing || GH.game.state === 'title')) openSkills(playing);
        else if (a === 'map' && (playing || GH.game.state === 'title')) openWorldMap(playing);
        else if (a === 'pilot' && (playing || GH.game.state === 'title')) openPilot(playing, 'title');
        else if (a === 'journal' && (playing || GH.game.state === 'title')) openJournal(playing);
        else if (a === 'pause') onEscape();
        else if (a === 'crt') {
          GH.controls.settings.crt = !GH.controls.settings.crt;
          GH.controls.save();
          applySettings();
        }
      }
      if (e.code === 'Tab') e.preventDefault();
      // co-op P2 keys (arena modes)
      var pk = P2KEYMAP[e.code];
      if (pk) p2keys[pk] = true;
      if (e.code === 'KeyO' && playing) input.p2Boost = true;
      if (e.code === 'KeyU') {
        p2keys.sp = true;
        input.p2Special = true;
        if (playing) input.p2SpecialPressed = true;
      }
      // co-op reward votes: P2 picks with J/K/L
      if (GH.game.coop && GH.game.state === 'reward') {
        var vn = { KeyJ: 0, KeyK: 1, KeyL: 2 }[e.code];
        if (vn !== undefined) GH.game.pickRewardIndex(vn);
      }
      if (GH.game.state === 'reward') {
        var n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5 }[e.code];
        if (n !== undefined) GH.game.pickRewardIndex(n);
      }
      if (e.code === 'Enter') {
        if (GH.game.state === 'title') enterSelect('classic');
        else if (GH.game.state === 'select') openStageSelect();
        else if (GH.game.state === 'stageselect' && curScreen === 'stage-screen') launch(chosenStage);
      }
    });
    window.addEventListener('keyup', function (e) {
      var acts = GH.controls.actionsFor(e.code);
      for (var ai = 0; ai < acts.length; ai++) {
        var a = acts[ai];
        if (MOVE_KEYS[a]) input.keys[MOVE_KEYS[a]] = false;
        else if (a === 'special') input.special = false;
        else if (a === 'boost') input.boostHeld = false;
      }
      var pk = P2KEYMAP[e.code];
      if (pk) p2keys[pk] = false;
      if (e.code === 'KeyU') { p2keys.sp = false; input.p2Special = false; }
    });

    // Mouse: LEFT attacks / picks a target, RIGHT (held) drags the camera,
    // the WHEEL zooms — the MMO scheme
    window.addEventListener('mousemove', function (e) {
      input.mouseNDC.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      );
      if (input.looking) {
        input.lookDX += e.movementX || 0;
        input.lookDY += e.movementY || 0;
      }
    });
    window.addEventListener('mousedown', function (e) {
      GH.audio.unlock();
      if (!GH.music.mode()) GH.music.play('title');
      var st = GH.game.state;
      if (e.button === 0 && st === 'play') {
        // left click attacks with the equipped weapon; clicking a
        // hostile also marks it as the target (pick your fight)
        input.mouseNDC.set(
          (e.clientX / window.innerWidth) * 2 - 1,
          -(e.clientY / window.innerHeight) * 2 + 1);
        GH.game.clickTarget(input.mouseNDC);
        input.attackPressed = true;
        input.attackHeld = true;
      }
      if (e.button === 2 && (st === 'play' || st === 'race')) {
        input.looking = true;
        document.body.classList.add('looking');
        e.preventDefault();
      }
    });
    window.addEventListener('mouseup', function (e) {
      if (e.button === 0) input.attackHeld = false;
      if (e.button === 2) { input.looking = false; input.lookDX = 0; input.lookDY = 0; document.body.classList.remove('looking'); }
    });
    window.addEventListener('wheel', function (e) {
      if (GH.game.state === 'play' || GH.game.state === 'race') {
        input.zoomDelta += e.deltaY > 0 ? 1 : -1;
        e.preventDefault();
      }
    }, { passive: false });
    window.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('blur', function () {
      input.keys = {};
      input.special = false;
      input.attackHeld = false;
      input.looking = false;
      document.body.classList.remove('looking');
      if (GH.game.state === 'play') togglePause();
    });
  }

  // ----------------------------------------------------------------
  // Touch controls: left half = move stick, right half = turn/aim stick,
  // plus BOOST / SPEC buttons. Shown only on coarse-pointer devices.
  var touchCapable = false;
  function bindTouch() {
    try {
      touchCapable = ('ontouchstart' in window) ||
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    } catch (e) { touchCapable = false; }
    if (!touchCapable) return;
    var ui = document.getElementById('touch-ui');
    ui.classList.remove('gone');

    function stick(zoneId, nubId, onMove, onEnd) {
      var zone = document.getElementById(zoneId);
      var nub = document.getElementById(nubId);
      var pid = null, ox = 0, oy = 0;
      zone.addEventListener('pointerdown', function (e) {
        pid = e.pointerId; ox = e.clientX; oy = e.clientY;
        zone.setPointerCapture(pid);
        e.preventDefault();
      });
      zone.addEventListener('pointermove', function (e) {
        if (e.pointerId !== pid) return;
        var dx = GH.clamp((e.clientX - ox) / 45, -1, 1);
        var dy = GH.clamp((e.clientY - oy) / 45, -1, 1);
        nub.style.transform = 'translate(' + dx * 22 + 'px,' + dy * 22 + 'px)';
        onMove(dx, dy);
      });
      var end = function (e) {
        if (e.pointerId !== pid) return;
        pid = null;
        nub.style.transform = '';
        onEnd();
      };
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
    }

    stick('touch-move', 'touch-move-nub', function (dx, dy) {
      input.touchMoveX = dx; input.touchMoveY = dy;
    }, function () { input.touchMoveX = 0; input.touchMoveY = 0; });

    stick('touch-aim', 'touch-aim-nub', function (dx, dy) {
      if (dx * dx + dy * dy > 0.04) {
        input.touchAimX = dx; input.touchAimY = dy; input.touchAimActive = true;
      }
    }, function () { input.touchAimActive = false; });

    document.getElementById('touch-boost').addEventListener('pointerdown', function (e) {
      e.preventDefault();
      GH.audio.unlock();
      if (GH.game.state === 'play') input.boostPressed = true;
    });
    document.getElementById('touch-ward').addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (GH.game.state === 'play') input.wardCycle = true;
    });
    document.getElementById('touch-trans').addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (GH.game.state === 'play') input.transformPressed = true;
    });
    var specBtn = document.getElementById('touch-special');
    specBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      input.special = true;
      if (GH.game.state === 'play') input.specialPressed = true;
    });
    specBtn.addEventListener('pointerup', function () { input.special = false; });
    specBtn.addEventListener('pointercancel', function () { input.special = false; });
    // tapping the interact prompt works like pressing the interact key
    document.getElementById('interact-line').addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (GH.game.state === 'play') input.interactPressed = true;
    });
  }

  // ----------------------------------------------------------------
  // Screens. show(id) swaps the visible overlay; every meta screen has a
  // BACK handler, and ESC always calls the one for the screen on top.
  var SCREENS = ['title-screen', 'select-screen', 'stage-screen', 'hangar-screen',
    'weekly-screen', 'preset-screen', 'broker-screen', 'collection-screen',
    'trials-screen', 'season-screen', 'hub-screen', 'save-screen', 'factions-screen',
    'reward-screen', 'pause-screen', 'end-screen', 'skills-screen', 'map-screen',
    'workshop-screen', 'pilot-screen', 'controls-screen', 'help-screen', 'journal-screen'];
  var curScreen = null;
  var backHandlers = {};

  var MENU_MUSIC = { 'title-screen': 'title', 'pause-screen': null, 'reward-screen': null, 'end-screen': null };
  function show(id) {
    curScreen = id;
    if (id && GH.music.mode()) {
      var want = MENU_MUSIC[id] === undefined ? 'hangar' : MENU_MUSIC[id];
      if (want && GH.game.state !== 'play' && GH.game.state !== 'pause') GH.music.play(want);
    }
    SCREENS.forEach(function (s) {
      document.getElementById(s).classList.toggle('hidden', s !== id);
    });
    // the HUD sits behind every menu — hide it so nothing overlaps
    document.body.classList.toggle('menu-open', !!id && id !== 'reward-screen');
    if (id !== 'controls-screen') rebindWait = null;
  }

  // ESC: close what's on top. Pause → resume; a menu → its BACK; play → pause.
  function onEscape() {
    var st = GH.game.state;
    if (confirmOpen) { closeConfirm(); return; }
    if (rebindWait) { rebindWait = null; renderControls(); return; }
    if (st === 'reward') return; // a choice has to be made
    if (curScreen && backHandlers[curScreen]) { GH.audio.card(); backHandlers[curScreen](); return; }
    if (st === 'pause') { togglePause(); return; }
    if (st === 'race') { GH.game.abortRace(); return; }
    if (st === 'play') togglePause();
  }

  // a small in-page confirm box for destructive choices
  var confirmOpen = false, confirmYes = null;
  function confirmBox(title, text, yesLabel, onYes) {
    confirmOpen = true;
    confirmYes = onYes;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-text').textContent = text;
    document.getElementById('btn-confirm-yes').textContent = yesLabel || 'CONFIRM';
    document.getElementById('confirm-screen').classList.remove('hidden');
  }
  function closeConfirm() {
    confirmOpen = false; confirmYes = null;
    document.getElementById('confirm-screen').classList.add('hidden');
  }

  function refreshTitle() {
    var comp = GH.progress.completion();
    var s = GH.progress.seasonCheck();
    var m = GH.meta.data.mats || { alloy: 0, cores: 0 };
    document.getElementById('title-salvage').textContent =
      'SALVAGE ' + GH.meta.data.salvage + '  ·  ALLOY ' + m.alloy + '  ·  CORES ' + m.cores +
      '  ·  FRAMES ' + GH.roster.owned() + '/' + GH.roster.TOTAL +
      '  ·  LOG ' + comp.pct + '%' +
      '  ·  PILOT LV ' + GH.skills.pilotProgress().lvl +
      '  ·  SEASON ' + s.pts + ' PTS';
    var prof = GH.meta.PROFILES[GH.meta.profile];
    document.getElementById('btn-profile').textContent = 'PROFILE: ' + prof.name;
    document.getElementById('btn-profile').title = prof.desc + ' — click to switch profile';
    // expedition button reflects the persistent world
    var w = GH.meta.data.world;
    var nestsDead = Object.keys(w.nests).length;
    var lairsDown = Object.keys(w.lairsDown).length;
    document.getElementById('btn-expedition').textContent =
      w.exp ? 'CONTINUE THE SHATTERED REACH' : 'THE SHATTERED REACH';
    document.getElementById('exp-desc').textContent = w.exp
      ? 'Open world · your pilot is saved at ' + (w.exp.zone ? GH.world.stageFor(w.exp.zone).name : 'camp') +
        ' · Lv ' + w.exp.level + ' ' + (w.exp.mechId ? GH.mechById(w.exp.mechId).name : '')
      : 'Open world campaign — explore, race, raid dungeons. Your pilot persists between sessions.' +
        ((nestsDead || lairsDown) ? ' (' + nestsDead + ' nests broken · ' + lairsDown + ' lairs down)' : '');
    document.getElementById('btn-new-exp').classList.toggle('hidden', !w.exp);
    renderBandButton();
    var tutDone = !!(GH.meta.data.tutorial && GH.meta.data.tutorial.done);
    document.getElementById('btn-play-first').classList.toggle('hidden', tutDone);
    document.getElementById('first-desc').classList.toggle('hidden', tutDone);
    document.getElementById('btn-tutorial').classList.toggle('hidden', !tutDone);
    var nudge = document.getElementById('backup-nudge');
    if (GH.meta.wantsBackup()) {
      nudge.classList.remove('hidden');
      nudge.innerHTML = '⚠ ' + Math.round(GH.meta.data.playtimeMin / 60) + ' h played and no backup in a while — <a href="#" id="nudge-save">HANGAR → SAVE: download your save file</a>.';
      document.getElementById('nudge-save').onclick = function (e) { e.preventDefault(); openSave(); };
    } else nudge.classList.add('hidden');
    document.getElementById('title-version').innerHTML = 'STAALREUS v' + GH.meta.VERSION +
      (touchCapable ? ' · best played on a desktop with a mouse' : '') +
      ' · <a href="https://github.com/Imyala/StaalReus/issues" target="_blank" rel="noopener">report a bug / feedback</a>';
    // a parked arena run
    var cont = document.getElementById('btn-continue');
    var has = GH.game.hasSuspended();
    cont.classList.toggle('hidden', !has);
    if (has) cont.textContent = 'CONTINUE RUN — ' + GH.game.suspendedLabel();
    document.getElementById('title-foot').textContent = GH.controls.summary();
    renderChronicle();
    var memEl = document.getElementById('title-memorial');
    var mem = GH.meta.memorial();
    if (GH.meta.isHardcore() && mem.length) {
      memEl.textContent = 'MEMORIAL: ' + mem.slice(0, 3).map(function (mm) {
        return mm.frame + ' — ' + mm.stage + ' w' + mm.wave;
      }).join('  ·  ');
    } else {
      memEl.textContent = '';
    }
  }

  // the Reach's difficulty band: cycle through unlocked bands; locked ones say why
  function renderBandButton() {
    var b = GH.worldlife.band();
    var btn = document.getElementById('btn-band');
    btn.textContent = 'REACH BAND: ' + b.name;
    btn.style.borderColor = b.css; btn.style.color = b.css;
    var next = nextBand();
    var ns = GH.worldlife.bandStatus(next.id);
    document.getElementById('band-desc').innerHTML =
      '<span style="color:' + b.css + '">' + b.name + '</span> — ' + b.desc +
      (next.id !== b.id ? '<br>' + (ns.unlocked ? 'Click to switch. ' : 'Next, ' + next.name + ': ' + ns.missing.join(' · ') + '.') : '');
  }
  function nextBand() {
    var list = GH.worldlife.BANDS, cur = GH.worldlife.band();
    var i = 0; for (var k = 0; k < list.length; k++) if (list[k].id === cur.id) i = k;
    for (var n = 1; n <= list.length; n++) {
      var cand = list[(i + n) % list.length];
      if (GH.worldlife.bandStatus(cand.id).unlocked) return cand;
    }
    return cur;
  }
  function cycleBand() {
    var next = nextBand();
    if (next.id === GH.worldlife.band().id) { GH.audio.hit(); return; }
    GH.worldlife.setBand(next.id);
    GH.audio.card();
    refreshTitle();
  }

  var PROFILE_ORDER = ['standard', 'iron', 'hardcore'];
  function cycleProfile() {
    var i = PROFILE_ORDER.indexOf(GH.meta.profile);
    var next = PROFILE_ORDER[(i + 1) % PROFILE_ORDER.length];
    GH.meta.load(next);
    GH.meta.applyDevParams(location.search);
    GH.audio.card();
    refreshTitle();
  }

  function enterSelect(mode) {
    GH.audio.card();
    GH.game.mode = mode;
    show('select-screen');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('btn-launch').textContent =
      mode === 'expedition' ? 'DEPLOY TO THE REACH' : 'SELECT STAGE';
    document.getElementById('select-mode').textContent =
      mode === 'expedition' ? 'THE SHATTERED REACH — pick the frame your pilot will fly' :
      mode === 'arena' ? 'ARENA — ENDLESS — pick a frame, then a stage' :
      'THE GAUNTLET — ' + GH.WAVES + ' ASSAULTS — pick a frame, then a stage';
    GH.game.onSelectChange = renderSelectExtras;
    GH.game.onOpenWorkshop = function () { workshopReturn = 'select'; openWorkshop(); };
    GH.game.enterSelect();
    renderP2Row();
    renderSelectExtras();
  }

  // mastery readout + style pickers on the select screen
  function renderSelectExtras() {
    var def = GH.mechs[GH.game.getSelectedMech()];
    var mp = GH.progress.masteryProgress(def.id);
    var pips = '';
    GH.progress.masteryMilestones.forEach(function (ms) {
      pips += '<span class="' + (mp.lvl >= ms.lvl ? 'ms-on' : 'ms-off') + '" title="' +
        ms.desc + '">L' + ms.lvl + '</span>';
    });
    document.getElementById('select-mastery').innerHTML =
      'MASTERY <b>Lv ' + mp.lvl + (mp.lvl >= GH.progress.MASTERY_CAP ? ' ★ MASTER' : '') + '</b>' +
      '<span class="ms-bar"><span class="ms-fill" style="width:' + Math.round(mp.frac * 100) + '%"></span></span>' +
      pips;

    // style cyclers (owned cosmetics only)
    var style = GH.meta.data.style;
    var wrap = document.getElementById('style-row');
    var owned = function (kind) {
      return GH.progress.cosmetics.filter(function (c) { return c.kind === kind && style.owned[c.id]; });
    };
    var mkCycler = function (kind, label, current) {
      var opts = owned(kind);
      if (!opts.length) return '';
      var curName = 'Default';
      if (current) {
        var cc = GH.progress.cosmeticById(current);
        if (cc) curName = cc.name;
      }
      return '<button class="style-btn" data-kind="' + kind + '">' + label + ': ' + curName + '</button>';
    };
    var vec = GH.vehicles.activeFor(def);
    var vecOwned = GH.vehicles.forLineage(GH.vehicles.lineageOf(def)).filter(function (d) { return GH.vehicles.owned(d.id); }).length;
    var vecAll = GH.vehicles.forLineage(GH.vehicles.lineageOf(def)).length;
    wrap.innerHTML =
      '<button class="style-btn vec-btn" id="vec-cycle" title="' + (vec.desc || '') + '">VECTOR: ' + vec.name + ' (' + (GH.VECTORS[vec.kind] || GH.VECTORS.bike).name + ')' +
      (vecAll > vecOwned ? ' · build the 2nd in the WORKSHOP' : vecOwned > 1 ? ' · click to swap' : '') + '</button>' +
      mkCycler('trail', 'TRAIL', style.trail) +
      mkCycler('paint', 'PAINT', style.paint) +
      mkCycler('drone', 'DRONE', style.drone);
    document.getElementById('vec-cycle').onclick = function () {
      GH.vehicles.cycle(def);
      GH.audio.card();
      renderSelectExtras();
    };
    wrap.querySelectorAll('.style-btn:not(.vec-btn)').forEach(function (btn) {
      btn.onclick = function () {
        var kind = btn.getAttribute('data-kind');
        var opts = owned(kind).map(function (c) { return c.id; });
        opts.unshift(null); // "default / none"
        var cur = opts.indexOf(style[kind]);
        style[kind] = opts[(cur + 1) % opts.length];
        GH.meta.save();
        GH.audio.card();
        renderSelectExtras();
      };
    });
  }

  // P2's own frame picker (visible when co-op is on)
  function renderP2Row() {
    var wrap = document.getElementById('p2-select-row');
    wrap.classList.toggle('hidden', !GH.game.coop);
    if (!GH.game.coop) return;
    wrap.innerHTML = '<span class="p2-row-label">P2 FRAME:</span>';
    var mirror = document.createElement('div');
    mirror.className = 'mech-icon p2-icon' + (p2MechIndex === -1 ? ' sel' : '');
    mirror.textContent = '⇔';
    mirror.title = 'Mirror P1';
    mirror.onclick = function () { p2MechIndex = -1; GH.audio.card(); renderP2Row(); };
    wrap.appendChild(mirror);
    GH.mechs.forEach(function (def, i) {
      if (!GH.meta.data.shells[def.id]) return;
      var d = document.createElement('div');
      d.className = 'mech-icon p2-icon' + (i === p2MechIndex ? ' sel' : '');
      d.textContent = def.icon;
      d.title = def.name;
      d.onclick = function () { p2MechIndex = i; GH.audio.card(); renderP2Row(); };
      wrap.appendChild(d);
    });
  }

  function openStageSelect() {
    if (!GH.game.selectedUnlocked()) return;
    if (GH.game.mode === 'expedition') {
      // no stage picker: the Reach is one place
      GH.audio.wave();
      show(null);
      GH.game.startExpedition(GH.game.getSelectedMech());
      return;
    }
    GH.audio.card();
    GH.game.state = 'stageselect';
    renderStageList();
    show('stage-screen');
  }

  function renderStageList() {
    var wrap = document.getElementById('stage-list');
    wrap.innerHTML = '';
    var arena = GH.game.mode === 'arena';
    GH.stages.forEach(function (st, i) {
      var unlocked = (i + 1) <= GH.meta.data.stages;
      var div = document.createElement('div');
      div.className = 'stage-card' + (unlocked ? '' : ' locked');
      var best = GH.meta.data.bestWave[st.id] || 0;
      var won = GH.meta.data.victories[st.id];
      var reward = GH.mechById(st.unlocks);
      var tier = GH.progress.trialTier(st.id);
      var tierBadge = tier ? '<span class="sc-trial">TRIAL ' + ['I', 'II', 'III', 'IV'][tier - 1] + '</span>' : '';
      var rewardLine = GH.meta.data.shells[st.unlocks] ? ''
        : (reward.kind === 'feat' ? '<br>— bring it down to recover the frame' : '<br>— bring it down for blueprint data + 3 cores');
      div.innerHTML =
        '<div class="sc-band" style="background:linear-gradient(' +
        st.sky[0] + ',' + st.sky[1] + ')"></div>' +
        '<div class="sc-sub">' + st.sub.toUpperCase() + (arena ? ' · ARENA' : '') + '</div>' +
        '<div class="sc-name">' + st.name + '</div>' +
        '<div class="sc-info">' + (unlocked
          ? (arena ? 'Endless waves.<br>How deep can you go?'
            : 'Final assault (' + GH.WAVES + '):<br>REVENANT ' + reward.name + rewardLine)
          : 'Clear the previous stage<br>to unlock') + '</div>' +
        '<div class="sc-best">' + (won ? '★ CLEARED · ' : '') +
        (best ? 'best wave ' + best : '') + ' ' + tierBadge + '</div>';
      if (unlocked) {
        div.onclick = function () {
          chosenStage = i;
          // loadout kits retired with the card system — deploy directly
          launch(i);
        };
      }
      wrap.appendChild(div);
    });
  }

  var lastLaunch = null;

  // Arena loadout presets: a starting kit instead of a bare frame.
  var PRESETS = [
    { id: 'bare', name: 'Standard Issue', glyph: '—', desc: 'No starting kit. The classic climb.' },
    { id: 'gunplatform', name: 'Gun Platform', glyph: '⋔',
      desc: 'Start with a Flak Fan and a Missile Rack.',
      weapons: ['flakfan', 'missiles'] },
    { id: 'stormcell', name: 'Storm Cell', glyph: '϶',
      desc: 'Start with an Arc Coil and Orbit Blades, plus a Keen gem in your primary.',
      weapons: ['tesla', 'blades'], gems: ['keen'] },
    { id: 'sapper', name: 'Sapper', glyph: '☒',
      desc: 'Start with a Mine Layer and a Mortar Pod, plus +2 armor.',
      weapons: ['mines', 'mortarpod'], traits: ['t_arm'] },
    { id: 'pyrecult', name: 'Pyre Cult', glyph: '♨',
      desc: 'Start with a Flame Projector, +25% elemental damage, and a Pyre gem.',
      weapons: ['flamer'], traits: ['t_elem'], gems: ['pyre'] }
  ];

  function openPresetPicker(stageIdx) {
    if (GH.meta.isIron()) {
      // Iron rules: no loadout kits — straight into the arena
      launch(stageIdx, PRESETS[0]);
      return;
    }
    GH.game.state = 'stageselect';
    var wrap = document.getElementById('preset-list');
    wrap.innerHTML = '';
    PRESETS.forEach(function (ps) {
      var div = document.createElement('div');
      div.className = 'reward-card';
      div.innerHTML =
        '<div class="rc-kind">LOADOUT</div>' +
        '<div class="rc-glyph">' + ps.glyph + '</div>' +
        '<div class="rc-name">' + ps.name + '</div>' +
        '<div class="rc-desc">' + ps.desc + '</div>';
      div.onclick = function () { launch(stageIdx, ps); };
      wrap.appendChild(div);
    });
    show('preset-screen');
  }

  function launch(stageIdx, preset) {
    GH.audio.wave();
    show(null);
    var devWave = 1;
    try {
      devWave = parseInt(new URLSearchParams(location.search).get('wave') || '1', 10) || 1;
    } catch (e) { /* older browsers */ }
    var doLaunch = function () {
      show(null);
      GH.game.startRun(GH.game.getSelectedMech(), stageIdx, devWave,
        { p2Mech: p2MechIndex, preset: preset });
    };
    lastLaunch = doLaunch;
    doLaunch();
  }

  // ----------------------------------------------------------------
  // Weekly challenge: everyone gets the same frame/stage/modifiers for the
  // ISO week, derived from a deterministic seed.
  function isoWeek(d) {
    d = d || new Date();
    var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dayNum = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - dayNum + 3);
    var firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    var week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return date.getUTCFullYear() + '-W' + ('0' + week).slice(-2);
  }

  function seededRng(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    var s = h >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  var WEEKLY_MODS = [
    { id: 'swarm', label: 'SWARM — +40% enemy spawns', apply: function (m) { m.rate *= 1.4; } },
    { id: 'ironclad', label: 'IRONCLAD — enemies +30% hull', apply: function (m) { m.ehp *= 1.3; } },
    { id: 'glass', label: 'GLASS FRAME — your hull -25%', apply: function (m) { m.php *= 0.75; } },
    { id: 'haste', label: 'HASTE — enemies +15% speed', apply: function (m) { m.espd *= 1.15; } },
    { id: 'feral', label: 'FERAL — a warden hunts every 5 waves', apply: function (m) { m.midbossEvery = 5; } }
  ];
  var WEEKLY_BOONS = [
    { id: 'bounty', label: 'BOUNTY — +50% salvage', apply: function (m) { m.salvage *= 1.5; } },
    { id: 'keeneyes', label: 'KEEN EYES — +10% crit', apply: function (m) { m.crit += 10; } }
  ];

  function buildWeekly() {
    var week = isoWeek();
    var rnd = seededRng('heroframe:' + week);
    var mechIdx = Math.floor(rnd() * GH.mechs.length);
    var stageIdx = Math.floor(rnd() * GH.stages.length);
    var mods = { rate: 1, ehp: 1, espd: 1, php: 1, salvage: 1, crit: 0, midbossEvery: 0 };
    var picks = [];
    var pool = WEEKLY_MODS.slice();
    for (var i = 0; i < 2; i++) {
      var m = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      m.apply(mods);
      picks.push(m.label);
    }
    var boon = WEEKLY_BOONS[Math.floor(rnd() * WEEKLY_BOONS.length)];
    boon.apply(mods);
    picks.push(boon.label);
    return { week: week, mechIdx: mechIdx, stageIdx: stageIdx, mods: mods, labels: picks };
  }

  function openWeekly() {
    GH.audio.card();
    var wk = buildWeekly();
    var best = (GH.meta.data.weekly && GH.meta.data.weekly.week === wk.week)
      ? GH.meta.data.weekly.best : 0;
    document.getElementById('weekly-brief').innerHTML =
      '<div class="wk-week">' + wk.week + '</div>' +
      '<div class="wk-line">Frame: <b>' + GH.mechs[wk.mechIdx].name + '</b> (issued for the week)</div>' +
      '<div class="wk-line">Stage: <b>' + GH.stages[wk.stageIdx].name + '</b> · endless</div>' +
      '<div class="wk-mods">' + wk.labels.map(function (l) { return '· ' + l; }).join('<br>') + '</div>' +
      (best ? '<div class="wk-best">Your best this week: WAVE ' + best + '</div>' : '');
    GH.game.state = 'stageselect';
    show('weekly-screen');
    document.getElementById('btn-weekly-go').onclick = function () {
      GH.audio.wave();
      GH.game.mode = 'weekly';
      lastLaunch = function () {
        show(null);
        GH.game.mode = 'weekly';
        GH.game.startRun(wk.mechIdx, wk.stageIdx, 1, { weekly: wk });
      };
      lastLaunch();
    };
  }

  // ----------------------------------------------------------------
  // HANGAR HUB — one door to every meta screen
  function openHub() {
    GH.audio.card();
    GH.game.state = 'hangar';
    var s = GH.progress.seasonCheck();
    var comp = GH.progress.completion();
    var b = GH.meta.data.broker;
    var cards = [
      { id: 'hub-workshop', glyph: '⚒', name: 'FRAME WORKSHOP',
        sub: GH.roster.owned() + '/' + GH.roster.TOTAL + ' frames · build new frames from alloy + cores',
        open: function () { workshopReturn = 'hub'; openWorkshop(); } },
      { id: 'hub-pilot', glyph: '☺', name: 'PILOT SHEET',
        sub: 'character, inventory, materials', open: function () { openPilot(false, 'hub'); } },
      { id: 'hub-map', glyph: '🗺', name: 'WORLD MAP & DIARIES',
        sub: 'diaries ' + GH.worldlife.diaryTotal().done + '/' + GH.worldlife.diaryTotal().total + ' · ' + Object.keys(GH.meta.data.world.dgTier || {}).length + '/24 dungeons ascended',
        open: function () { openWorldMap(false); } },
      { id: 'hub-skills', glyph: '❈', name: 'PILOT TRAINING',
        sub: 'Pilot Lv ' + GH.skills.pilotProgress().lvl +
          (GH.meta.data.skillPoints > 0 ? ' · ' + GH.meta.data.skillPoints + ' POINTS READY' : ' · skill tree'),
        open: function () { openSkills(false); } },
      { id: 'hub-season', glyph: '☄', name: 'RELIC SEASON',
        sub: GH.progress.seasonName(s.id) + ' · ' + s.pts + ' pts' +
          (GH.progress.relicPicksAvailable() > 0 ? ' · RELIC READY' : ''),
        open: openSeason },
      { id: 'hub-broker', glyph: '☰', name: 'BROKER & DAILY TASKS',
        sub: (GH.worldlife.dailyUnclaimed() ? GH.worldlife.dailyUnclaimed() + ' DAILY REWARD' + (GH.worldlife.dailyUnclaimed() > 1 ? 'S' : '') + ' TO CLAIM · ' : '') +
          (b.active ? GH.progress.contractLabel(b.active) + ' (' + b.active.have + '/' + b.active.need + ')'
          : b.points + ' pts banked · no active contract'),
        open: openBroker },
      { id: 'hub-trials', glyph: '⛨', name: 'STAGE TRIALS',
        sub: 'permanent stage perks', open: openTrials },
      { id: 'hub-log', glyph: '📖', name: 'COLLECTION LOG',
        sub: comp.pct + '% complete', open: openCollection },
      { id: 'hub-attrs', glyph: '⚖', name: 'ATTRIBUTES & ARTS',
        sub: (GH.attrs.free() > 0 ? '<b class="pl-hot">' + GH.attrs.free() + ' ATTRIBUTE POINT' + (GH.attrs.free() > 1 ? 'S' : '') + ' READY</b> · ' : 'six attributes · ') +
          (GH.attrs.runeStock() > 0 ? '<b class="pl-hot">' + GH.attrs.runeStock() + ' RUNE' + (GH.attrs.runeStock() > 1 ? 'S' : '') + ' TO READ</b>' : 'combat art runes'),
        open: openHangar },
      { id: 'hub-journal', glyph: '✎', name: 'QUEST JOURNAL',
        sub: 'every open task in one ledger', open: function () { openJournal(false); } },
      { id: 'hub-save', glyph: '⛃', name: 'SAVE CODE',
        sub: 'back up or restore progress', open: openSave },
      { id: 'hub-factions', glyph: '⚑', name: 'THE HOUSES',
        sub: factionsSub(), open: openFactions },
      { id: 'hub-controls', glyph: '⌨', name: 'CONTROLS',
        sub: 'rebind keys · camera · CRT filter', open: function () { pilotReturn = false; openControls(); } },
      { id: 'hub-help', glyph: '?', name: 'HOW TO PLAY',
        sub: 'controls, modes, how frames unlock', open: function () { pilotReturn = false; openHelp(); } }
    ];
    var wrap = document.getElementById('hub-cards');
    wrap.innerHTML = '';
    cards.forEach(function (c) {
      var div = document.createElement('div');
      div.className = 'hub-card';
      div.innerHTML = '<div class="hc-glyph">' + c.glyph + '</div>' +
        '<div class="hc-name">' + c.name + '</div>' +
        '<div class="hc-sub">' + c.sub + '</div>';
      div.onclick = c.open;
      wrap.appendChild(div);
    });
    show('hub-screen');
  }

  // ----------------------------------------------------------------
  // THE HOUSES — reputation, pledges, your own banner
  function factionsSub() {
    var f = GH.factions.state();
    if (f.banner) return f.seated ? 'THE ' + f.banner.name + ' — SEATED' : 'your banner: THE ' + f.banner.name;
    if (f.pledge) return 'pledged to the ' + GH.factions.byId(f.pledge).name;
    var best = null;
    GH.factions.LIST.forEach(function (h) { if (!best || GH.factions.rep(h.id) > GH.factions.rep(best.id)) best = h; });
    return best ? best.name + ' ' + Math.round(GH.factions.rep(best.id)) : 'no standing yet';
  }
  function openFactions() {
    GH.audio.card();
    GH.game.state = 'hangar';
    renderFactions();
    show('factions-screen');
  }
  function renderFactions() {
    var F = GH.factions, st = F.state();
    var head = st.banner
      ? 'YOUR BANNER: <b>THE ' + st.banner.name + '</b> · doctrine ' + (F.activeDoctrine() ? F.activeDoctrine().name : '—') + (st.seated ? ' · <b>SEATED</b>' : '')
      : st.pledge ? 'PLEDGED TO THE <b>' + F.byId(st.pledge).name + '</b> · doctrine ' + F.byId(st.pledge).doctrine.name
        : 'Unpledged. Contracts, dungeon clears and podiums in a house\'s lands raise its regard; killing its troops lowers it. Pledge at 40.';
    document.getElementById('fac-head').innerHTML = head;
    var wrap = document.getElementById('fac-cards');
    wrap.innerHTML = '';
    F.LIST.forEach(function (h) {
      var rep = F.rep(h.id), stain = F.stain(h.id), standing = F.standing(h.id);
      var card = document.createElement('div');
      card.className = 'fac-card ' + standing;
      var pct = Math.abs(rep) / 2;
      var bar = '<div class="fac-bar"><div class="fb-zero"></div><div class="fb-fill' + (rep < 0 ? ' neg' : '') + '" style="' +
        (rep < 0 ? 'right:50%;width:' + pct + '%' : 'left:50%;width:' + pct + '%') + '"></div></div>';
      var seat = GH.world.stageFor(h.seat).name;
      var parts = h.parts.map(function (pid) {
        for (var i = 0; i < GH.upgrades.length; i++) if (GH.upgrades[i].id === pid) return GH.upgrades[i].name;
        return pid;
      }).join(', ');
      var btn = '';
      if (standing === 'pledged') btn = '<span class="fac-btn" data-act="renounce">RENOUNCE</span>';
      else if (F.canPledge(h.id)) btn = '<span class="fac-btn" data-act="pledge" data-id="' + h.id + '">PLEDGE</span>';
      else if (!st.banner) btn = '<span class="fac-btn off">PLEDGE AT 40</span>';
      card.innerHTML =
        '<div class="fac-name">' + h.glyph + ' ' + h.name + '</div>' +
        '<div class="fac-creed">' + h.creed + '</div>' +
        '<div class="fac-line">seat: <b>' + seat + '</b></div>' +
        bar +
        '<div class="fac-line">regard <b>' + Math.round(rep) + '</b> · <b>' + F.standingLabel(h.id) + '</b>' +
        (stain > 0 ? ' · stain ' + Math.round(stain) : '') + '</div>' +
        '<div class="fac-line">doctrine: <b>' + h.doctrine.name + '</b> — ' + h.doctrine.desc + '</div>' +
        '<div class="fac-line">parts favoured: ' + parts + '</div>' +
        '<div class="fac-line">circuit: ' + GH.world.stageFor(h.circuit).name + '</div>' +
        btn;
      wrap.appendChild(card);
    });
    wrap.querySelectorAll('.fac-btn[data-act]').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.act === 'pledge') F.pledge(b.dataset.id);
        else F.renounce();
        GH.audio.card();
        if (GH.game.refreshPilot) GH.game.refreshPilot();
        renderFactions();
      };
    });
    // the banner
    var bw = document.getElementById('fac-banner');
    if (st.banner) {
      var sp = F.seatProgress();
      bw.innerHTML = '<b>THE ' + st.banner.name + '</b> — raised ' + st.banner.raised + '. ' +
        (st.seated ? 'Seated: the camp is your court, and every house treats you by your regard.' :
          'A seat needs three territories held (every nest broken) and two houses at 60, or three at −60. ' +
          'Held <b>' + sp.held + '/3</b> · friends <b>' + sp.friends + '</b> · foes <b>' + sp.foes + '</b>.');
    } else if (F.canRaiseBanner()) {
      var opts = F.DOCTRINES.map(function (d) { return '<option value="' + d.id + '">' + d.name + ' — ' + d.desc + '</option>'; }).join('');
      var paints = GH.progress.cosmetics.filter(function (c) { return c.kind === 'paint' && GH.meta.data.style.owned[c.id]; })
        .map(function (c) { return '<option value="' + c.id + '">' + c.name + '</option>'; }).join('');
      bw.innerHTML = '<b>RAISE YOUR OWN BANNER.</b> Leaving a pledge this way is not betrayal, but the house will mark it. ' +
        '<div><input id="fac-name" maxlength="24" placeholder="house name"> <select id="fac-doc">' + opts + '</select> ' +
        '<select id="fac-paint"><option value="">standard paint</option>' + paints + '</select> ' +
        '<span class="fac-btn" id="fac-raise">RAISE</span></div>';
      document.getElementById('fac-raise').onclick = function () {
        var nm = document.getElementById('fac-name').value.trim();
        if (!nm) { document.getElementById('fac-name').focus(); return; }
        F.raiseBanner(nm, document.getElementById('fac-doc').value, document.getElementById('fac-paint').value || null);
        GH.audio.win();
        if (GH.game.refreshPilot) GH.game.refreshPilot();
        renderFactions();
      };
    } else {
      bw.innerHTML = F.bannerRequirement();
    }
  }

  // ----------------------------------------------------------------
  // SAVE CODE — export/import all profiles
  function openSave() {
    GH.audio.card();
    GH.game.state = 'hangar';
    document.getElementById('save-export').value = GH.meta.exportCode();
    document.getElementById('save-import').value = '';
    document.getElementById('save-feedback').textContent = '';
    renderBackups();
    show('save-screen');
  }
  function renderBackups() {
    var wrap = document.getElementById('save-backups');
    var list = GH.meta.backups();
    var html = '<div class="bk-label">AUTOMATIC BACKUPS (' + GH.meta.PROFILES[GH.meta.profile].name + ')</div>';
    if (!list.length) html += '<div class="menu-desc">None yet — one is written every five minutes of play and whenever you exit a run.</div>';
    list.forEach(function (b) {
      html += '<div class="bk-row"><span>' + b.when.replace('T', ' ').slice(0, 16) + ' · ' + b.label + ' · ' + b.salvage + ' salvage · ' + b.frames + ' frames · ' + b.pilotXP + ' pilot XP</span>' +
        '<button class="dv-buy bk-restore" data-slot="' + b.slot + '">RESTORE</button></div>';
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('.bk-restore').forEach(function (btn) {
      btn.onclick = function () {
        var slot = parseInt(btn.getAttribute('data-slot'), 10);
        confirmBox('RESTORE THIS BACKUP?', 'Your current progress is itself backed up first, so this can be undone.', 'RESTORE', function () {
          if (GH.meta.restoreBackup(slot)) { GH.audio.win(); document.getElementById('save-feedback').textContent = 'Backup restored.'; refreshTitle(); }
          else { GH.audio.hit(); document.getElementById('save-feedback').textContent = 'Could not restore that backup.'; }
          openSave();
        });
      };
    });
  }

  // ----------------------------------------------------------------
  // RELIC SEASON
  function openSeason() {
    GH.audio.card();
    GH.game.state = 'hangar';
    renderSeason();
    show('season-screen');
  }

  function renderSeason() {
    var s = GH.progress.seasonCheck();
    document.getElementById('season-head').innerHTML =
      '<span class="sn-name">SEASON OF THE ' + GH.progress.seasonName(s.id) + '</span> · ' +
      s.id + ' · <b>' + s.pts + ' PTS</b>';
    // threshold meter
    var thr = GH.progress.seasonThresholds;
    var meter = 'Relic thresholds: ' + thr.map(function (t) {
      return '<span class="' + (s.pts >= t ? 'sn-hit' : 'sn-miss') + '">' + t + '</span>';
    }).join(' → ');
    document.getElementById('season-meter').innerHTML = meter;

    // relic area
    var relicWrap = document.getElementById('season-relics');
    relicWrap.innerHTML = '';
    if (s.relics.length) {
      var activeDiv = document.createElement('div');
      activeDiv.className = 'sn-active';
      activeDiv.innerHTML = 'ACTIVE RELICS: ' + s.relics.map(function (id) {
        var r = null;
        GH.progress.relics.forEach(function (x) { if (x.id === id) r = x; });
        return '<b title="' + r.desc + '">' + r.name + '</b>';
      }).join(' · ');
      relicWrap.appendChild(activeDiv);
    }
    if (GH.progress.relicPicksAvailable() > 0) {
      var offer = GH.progress.relicOffer();
      var offerWrap = document.createElement('div');
      offerWrap.className = 'sn-offer';
      offerWrap.innerHTML = '<div class="bk-label">CHOOSE A RELIC</div>';
      var row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '12px';
      offer.forEach(function (r) {
        var card = document.createElement('div');
        card.className = 'reward-card relic-card';
        card.innerHTML = '<div class="rc-kind">RELIC</div>' +
          '<div class="rc-name">' + r.name + '</div>' +
          '<div class="rc-desc">' + r.desc + '</div>';
        card.onclick = function () {
          if (GH.progress.claimRelic(r.id)) {
            GH.audio.levelup();
            renderSeason();
          }
        };
        row.appendChild(card);
      });
      offerWrap.appendChild(row);
      relicWrap.appendChild(offerWrap);
    }

    // task board
    var body = document.getElementById('season-tasks');
    var html = '';
    GH.progress.seasonTasks.forEach(function (t) {
      var done = !!s.done[t.id];
      html += '<div class="sn-task' + (done ? ' done' : '') + '">' +
        (done ? '☑' : '☐') + ' ' + t.desc +
        '<span class="sn-pts">+' + t.pts + '</span></div>';
    });
    body.innerHTML = html;
    var c = s.counters;
    document.getElementById('season-counters').textContent =
      'Season counters — kills: ' + c.kills + ' · sparks: ' + Math.round(c.sparks) +
      ' · resonances: ' + c.resonances + ' · contracts: ' + c.contracts;
  }

  // ----------------------------------------------------------------
  // BROKER — hunt contracts
  function openBroker() {
    GH.audio.card();
    GH.game.state = 'hangar';
    renderBroker();
    show('broker-screen');
  }

  function renderDaily(wrapId) {
    var wrap = document.getElementById(wrapId);
    if (!wrap) return;
    var dl = GH.worldlife.daily();
    var html = '<div class="bk-label">DAILY TASK BOARD — ' + dl.day + ' · STREAK ' + dl.streak + (dl.sweptToday ? ' · SWEPT TODAY' : '') + '</div>';
    dl.tasks.forEach(function (t) {
      var rw = [];
      if (t.reward.alloy) rw.push('+' + t.reward.alloy + ' alloy');
      if (t.reward.cores) rw.push('+' + t.reward.cores + ' core');
      if (t.reward.salvage) rw.push('+' + t.reward.salvage + ' salvage');
      html += '<div class="dl-task' + (t.claimed ? ' claimed' : t.done ? ' ready' : '') + '">' +
        '<span class="dl-desc">' + (t.claimed ? '☑' : t.done ? '★' : '☐') + ' ' + t.desc + '</span>' +
        '<span class="dl-prog">' + t.have + '/' + t.need + '</span>' +
        '<span class="dl-reward">' + rw.join(' · ') + '</span>' +
        (t.done && !t.claimed ? '<button class="dv-buy dl-claim" data-id="' + t.id + '">CLAIM</button>' : '') + '</div>';
    });
    html += '<div class="menu-desc">Claim all three for a bonus core and ' + GH.worldlife.SWEEP_BONUS.alloyPerStreakDay + ' alloy per streak day. New board every day; a streak survives one missed day.</div>';
    wrap.innerHTML = html;
    wrap.querySelectorAll('.dl-claim').forEach(function (btn) {
      btn.onclick = function () {
        var r = GH.worldlife.claimDaily(btn.getAttribute('data-id'));
        if (r) { GH.audio.win(); if (r.sweep) GH.audio.levelup(); }
        renderDaily(wrapId);
        if (wrapId === 'broker-daily') renderBroker();
      };
    });
  }

  function renderBroker() {
    renderDaily('broker-daily');
    var b = GH.meta.data.broker;
    document.getElementById('broker-status').innerHTML =
      'BROKER POINTS: <b>' + b.points + '</b> · CONTRACTS FILLED: <b>' + b.completed +
      '</b> · SALVAGE: <b>' + GH.meta.data.salvage + '</b>';
    var wrap = document.getElementById('broker-contract');
    if (b.active) {
      var c = b.active;
      wrap.innerHTML =
        '<div class="bk-label">ACTIVE CONTRACT</div>' +
        '<div class="bk-task">' + GH.progress.contractLabel(c) + '</div>' +
        '<div class="bk-progress">' + c.have + ' / ' + c.need +
        '  —  pays ' + c.salvage + ' salvage + ' + c.pts + ' pts</div>' +
        '<button class="dv-buy" id="bk-reroll">REROLL · ' + GH.progress.rerollCost() + '</button> ' +
        '<button class="dv-buy" id="bk-abandon">ABANDON</button>';
      document.getElementById('bk-reroll').onclick = function () {
        var cost = GH.progress.rerollCost();
        if (GH.meta.data.salvage < cost) return;
        GH.meta.data.salvage -= cost;
        GH.meta.data.broker.active = GH.progress.generateContract();
        GH.meta.save();
        GH.audio.card();
        renderBroker();
      };
      document.getElementById('bk-abandon').onclick = function () {
        GH.meta.data.broker.active = null;
        GH.meta.save();
        GH.audio.hit();
        renderBroker();
      };
    } else {
      wrap.innerHTML =
        '<div class="bk-label">NO ACTIVE CONTRACT</div>' +
        '<button class="menu-btn small" id="bk-accept">TAKE A CONTRACT</button>';
      document.getElementById('bk-accept').onclick = function () {
        GH.meta.data.broker.active = GH.progress.generateContract();
        GH.meta.save();
        GH.audio.wave();
        renderBroker();
      };
    }
    // unlock shop
    var shop = document.getElementById('broker-shop');
    shop.innerHTML = '';
    GH.progress.brokerUnlocks.forEach(function (u) {
      var owned = !!b.unlocks[u.id];
      var gated = u.requires && !b.unlocks[u.requires];
      var div = document.createElement('div');
      div.className = 'devotion-card' + (owned ? ' active' : '');
      div.innerHTML =
        '<div class="dv-name">' + u.name + '</div>' +
        '<div class="dv-desc">' + u.desc + '</div>' +
        '<button class="dv-buy" ' + (owned || gated || b.points < u.cost ? 'disabled' : '') + '>' +
        (owned ? 'OWNED' : (gated ? 'LOCKED' : u.cost + ' PTS')) + '</button>';
      div.querySelector('.dv-buy').onclick = function () {
        if (owned || gated || b.points < u.cost) return;
        b.points -= u.cost;
        b.unlocks[u.id] = true;
        GH.meta.save();
        GH.audio.levelup();
        renderBroker();
      };
      shop.appendChild(div);
    });
  }

  // ----------------------------------------------------------------
  // COLLECTION LOG
  function openCollection() {
    GH.audio.card();
    GH.game.state = 'hangar';
    var c = GH.meta.data.collection;
    var comp = GH.progress.completion();
    document.getElementById('log-head').innerHTML =
      'COMPLETION: <b>' + comp.pct + '%</b> (' + comp.have + '/' + comp.total + ')' +
      ' · RUNS: <b>' + c.totalRuns + '</b> · WINS: <b>' + c.totalWins +
      '</b> · TOTAL KILLS: <b>' + c.totalKills + '</b>';
    var body = document.getElementById('log-body');
    var html = '<div class="log-section">HOSTILES</div><div class="log-grid">';
    Object.keys(GH.enemyDefs).forEach(function (id) {
      var n = c.kills[id] || 0;
      html += '<div class="log-cell' + (n ? ' seen' : '') + '">' +
        '<div class="lc-name">' + (n ? GH.enemyDefs[id].name : '???') + '</div>' +
        '<div class="lc-count">' + (n ? '×' + n : '—') + '</div></div>';
    });
    html += '</div><div class="log-section">WEAPONS</div><div class="log-grid">';
    GH.upgrades.forEach(function (u) {
      if (u.kind !== 'weapon') return;
      var got = !!c.weapons[u.id];
      html += '<div class="log-cell' + (got ? ' seen' : '') + '">' +
        '<div class="lc-glyph">' + u.glyph + '</div>' +
        '<div class="lc-name">' + (got ? u.name : '???') + '</div></div>';
    });
    html += '</div><div class="log-section">RESONANCES</div><div class="log-grid">';
    var resNames = Object.keys(c.resonances);
    ['SANCTITY', 'IMMOLATE', 'FRAGMENT', 'SPOREBLOOM', 'DETONATE', 'PRISM'].forEach(function (r) {
      var got = false;
      for (var i = 0; i < resNames.length; i++) {
        if (resNames[i].indexOf(r) === 0 && resNames[i].indexOf('+') === -1) got = true;
      }
      html += '<div class="log-cell' + (got ? ' seen' : '') + '">' +
        '<div class="lc-name">' + (got ? r : '???') + '</div></div>';
    });
    html += '</div><div class="log-section">GEMS SOCKETED</div><div class="log-grid">';
    GH.gems.typeIds.forEach(function (t) {
      var n = c.gems[t] || 0;
      html += '<div class="log-cell' + (n ? ' seen' : '') + '">' +
        '<div class="lc-glyph">' + GH.gems.types[t].glyph + '</div>' +
        '<div class="lc-name">' + GH.gems.types[t].name + '</div>' +
        '<div class="lc-count">' + (n ? '×' + n : '—') + '</div></div>';
    });
    html += '</div><div class="log-section">CACHE FINDS (' +
      GH.meta.data.cipher.caches + ' caches opened)</div><div class="log-grid">';
    GH.progress.cosmetics.forEach(function (cs) {
      var got = !!GH.meta.data.style.owned[cs.id];
      html += '<div class="log-cell' + (got ? ' seen' : '') + '">' +
        '<div class="lc-name">' + (got ? cs.name : '???') + '</div>' +
        '<div class="lc-count">' + cs.kind.toUpperCase() + '</div></div>';
    });
    html += '</div><div class="log-section">PILOT MASTERY (total ' +
      GH.progress.masteryTotal() + ')</div><div class="log-grid">';
    GH.mechs.forEach(function (m) {
      var lvl = GH.progress.masteryLevel(m.id);
      if (!lvl && !GH.meta.data.shells[m.id]) return; // 135 exist; only list yours
      html += '<div class="log-cell' + (lvl ? ' seen' : '') + '">' +
        '<div class="lc-glyph">' + m.icon + '</div>' +
        '<div class="lc-name">' + m.name + '</div>' +
        '<div class="lc-count">Lv ' + lvl + (lvl >= 50 ? ' ★' : '') + '</div></div>';
    });
    var bst = GH.meta.data.bestiary || {};
    html += '</div><div class="log-section">BESTIARY — HUNTS (' + GH.bosses.slainCount() + '/' + GH.bosses.LIST.length + ')</div><div class="log-grid">';
    GH.bosses.LIST.forEach(function (b) {
      var n = bst[b.id] || 0;
      html += '<div class="log-cell hunt' + (n ? ' seen' : '') + '" title="' + (n ? b.epithet + ' · ' + b.mech.join(', ') : GH.world.stageFor(b.zone).name + ' · tier ' + b.tier) + '">' +
        '<div class="lc-name">' + (n ? b.name : '???') + '</div>' +
        '<div class="lc-count">' + (n ? '×' + n : GH.world.stageFor(b.zone).name.split(' ')[0]) + ' · T' + b.tier + '</div></div>';
    });
    var wArt = GH.meta.data.world;
    var artHave = Object.keys(wArt.artifacts).length;
    html += '</div><div class="log-section">NAMED ARTIFACTS (' + artHave + '/' +
      GH.progress.artifacts.length + ' · one equipped at a time)</div><div class="log-grid">';
    GH.progress.artifacts.forEach(function (a) {
      var got = !!wArt.artifacts[a.id];
      var on = wArt.equipped === a.id;
      html += '<div class="log-cell' + (got ? ' seen art-cell' : '') + (on ? ' art-on' : '') + '"' +
        (got ? ' data-art="' + a.id + '" title="' + a.desc + '"' : '') + '>' +
        '<div class="lc-name">' + (got ? a.name : '???') + '</div>' +
        '<div class="lc-count">' + (got ? (on ? '◆ EQUIPPED' : 'equip') : a.source) + '</div></div>';
    });
    html += '</div>';
    body.innerHTML = html;
    // artifact cells equip on click (click again to unequip)
    body.querySelectorAll('[data-art]').forEach(function (cell) {
      cell.onclick = function () {
        var id = cell.getAttribute('data-art');
        wArt.equipped = wArt.equipped === id ? null : id;
        GH.meta.save();
        GH.audio.card();
        openCollection();
      };
    });
    show('collection-screen');
  }

  // ----------------------------------------------------------------
  // STAGE TRIALS
  function openTrials() {
    GH.audio.card();
    GH.game.state = 'hangar';
    var body = document.getElementById('trials-body');
    var html = '';
    GH.stages.forEach(function (st, si) {
      var unlocked = (si + 1) <= GH.meta.data.stages;
      var tier = GH.progress.trialTier(st.id);
      html += '<div class="trial-stage' + (unlocked ? '' : ' locked') + '">' +
        '<div class="ts-name">' + st.name +
        ' <span class="ts-tier">' + (tier ? 'TIER ' + ['I', 'II', 'III', 'IV'][tier - 1] : '') + '</span></div>';
      if (unlocked) {
        GH.progress.trialTiers.forEach(function (tr, ti) {
          html += '<div class="ts-row"><span class="ts-tiername">' + tr.name + '</span>';
          tr.tasks.forEach(function (task) {
            var done = GH.progress.trialDone(st.id, task.id);
            html += '<span class="ts-task' + (done ? ' done' : '') + '">' +
              (done ? '☑ ' : '☐ ') + task.desc + '</span>';
          });
          html += '<span class="ts-perk' + (tier > ti ? ' on' : '') + '">' + tr.perk + '</span></div>';
        });
      } else {
        html += '<div class="ts-row">Reach this stage to open its trials.</div>';
      }
      html += '</div>';
    });
    body.innerHTML = html;
    show('trials-screen');
  }

  // ----------------------------------------------------------------
  function openHangar() {
    GH.audio.card();
    GH.game.state = 'hangar';
    renderHangar();
    show('hangar-screen');
  }

  // ----------------------------------------------------------------
  // ATTRIBUTES & ARTS — the character under the frame. Six attributes
  // grow on their own each pilot level and take one free point per
  // level; runes read into Combat Arts trade recharge for power.
  function chronicleFrame() {
    var exp = GH.meta.data.world.exp;
    if (exp && exp.mechId && GH.mechById(exp.mechId)) return GH.mechById(exp.mechId);
    var idx = GH.game.getSelectedMech ? GH.game.getSelectedMech() : 0;
    return GH.mechs[idx] || GH.mechs[0];
  }

  function renderHangar() {
    var A = GH.attrs, def = chronicleFrame(), pp = GH.skills.pilotProgress();
    document.getElementById('attr-head').innerHTML =
      'PILOT LEVEL <b>' + pp.lvl + '</b> · FREE POINTS <b class="' + (A.free() ? 'pl-hot' : '') + '">' + A.free() + '</b>' +
      ' · RUNES HELD <b class="' + (A.runeStock() ? 'pl-hot' : '') + '">' + A.runeStock() + '</b>' +
      ' · SALVAGE <b>' + GH.meta.data.salvage + '</b>' +
      ' · auto-growth shown for <b>' + def.name + '</b> (' + (def.lineage || def.id).toUpperCase() + ' lineage)';
    var wrap = document.getElementById('attr-list');
    wrap.innerHTML = '';
    var maxTotal = 1;
    A.LIST.forEach(function (a) { maxTotal = Math.max(maxTotal, A.total(a.id, def)); });
    A.LIST.forEach(function (a) {
      var auto = A.auto(a.id, def), spent = A.spent(a.id), total = auto + spent;
      var row = document.createElement('div');
      row.className = 'attr-row';
      row.innerHTML =
        '<div class="attr-glyph" style="color:' + a.css + '">' + a.glyph + '</div>' +
        '<div class="attr-main"><div class="attr-name" style="color:' + a.css + '">' + a.name +
        ' <span class="attr-total">' + Math.round(total) + '</span></div>' +
        '<div class="attr-bar"><span class="attr-fill" style="width:' + Math.round(total / maxTotal * 100) + '%;background:' + a.css + '"></span></div>' +
        '<div class="attr-desc">' + a.desc + '</div>' +
        '<div class="attr-sub">lineage ' + auto.toFixed(1) + ' · placed <b>' + spent + '</b></div></div>' +
        '<button class="attr-plus" ' + (A.free() ? '' : 'disabled') + ' title="place one free point">+</button>';
      row.querySelector('.attr-plus').onclick = function () {
        if (A.spend(a.id)) { GH.audio.levelup(); renderHangar(); if (GH.game.refreshPilot) GH.game.refreshPilot(); }
        else GH.audio.hit();
      };
      wrap.appendChild(row);
    });
    // what those numbers do, as one derived block
    var b = A.bonus(def);
    var pct = function (v) { return (v >= 0 ? '+' : '') + Math.round(v * 100) + '%'; };
    document.getElementById('attr-derived').innerHTML =
      '<div class="bk-label">DERIVED FROM YOUR ATTRIBUTES</div>' +
      '<span>weapon damage <b>' + pct(b.damageMult) + '</b></span>' +
      '<span>max hull <b>+' + Math.round(b.maxHP) + '</b></span>' +
      '<span>armor <b>+' + b.armor.toFixed(1) + '</b></span>' +
      '<span>attack speed <b>' + pct(b.atkSpdMult) + '</b></span>' +
      '<span>block <b>+' + b.block.toFixed(1) + '%</b></span>' +
      '<span>crit <b>+' + b.crit.toFixed(1) + '%</b></span>' +
      '<span>hull regen <b>' + b.regen.toFixed(2) + '/s</b></span>' +
      '<span>boost regen <b>' + pct(b.boostRegen) + '</b></span>' +
      '<span>magnet <b>' + pct(b.magnet) + '</b></span>' +
      '<span>XP <b>' + pct(b.xpGain) + '</b></span>' +
      '<span>loot find <b>+' + Math.round(b.lootFind) + '%</b></span>' +
      '<span>art power <b>×' + b.artMult.toFixed(2) + '</b></span>' +
      '<span>art recharge <b>×' + b.artCd.toFixed(2) + '</b></span>';
    document.getElementById('btn-attr-reset').textContent = 'RECALIBRATE · ' + A.RESET_COST + ' SALVAGE';
    document.getElementById('btn-attr-reset').disabled = A.spentTotal() === 0;

    // combat arts and runes
    var arts = document.getElementById('arts-list');
    arts.innerHTML = '';
    var skl = GH.skills.bonuses();
    A.ART_SLOTS.forEach(function (slot) {
      var ab = A.artLabel(slot, def), rank = A.artRank(slot);
      var locked = slot !== 'sig' && !skl.slots[slot];
      var cd = ab.cd * skl.cdMult * b.artCd * A.artRecharge(slot);
      var card = document.createElement('div');
      card.className = 'art-card' + (rank >= A.MAX_RANK ? ' maxed' : '') + (locked ? ' locked' : '');
      var pips = '';
      for (var i = 0; i < A.MAX_RANK; i++) pips += '<span class="sk-pip' + (i < rank ? ' on' : '') + '"></span>';
      card.innerHTML =
        '<div class="art-glyph">' + ab.glyph + '</div>' +
        '<div class="art-name">' + ab.name + (slot === 'sig' ? ' <i>signature · ' + def.name + '</i>' : ' <i>slot ' + slot + '</i>') + '</div>' +
        '<div class="art-desc">' + ab.desc + '</div>' +
        '<div class="art-stats">rank <b>' + rank + '</b>/' + A.MAX_RANK + ' · power <b>×' + (A.artPower(slot) * b.artMult).toFixed(2) + '</b> · recharge <b>' + cd.toFixed(1) + ' s</b> (base ' + ab.cd + ')' + (locked ? ' · <span class="ws-short">not yet trained (PILOT TRAINING)</span>' : '') + '</div>' +
        '<div class="sk-pips">' + pips + '</div>' +
        '<button class="dv-buy art-read" ' + (A.runeStock() > 0 && rank < A.MAX_RANK ? '' : 'disabled') + '>' +
        (rank >= A.MAX_RANK ? 'MASTERED' : 'READ A RUNE · +12% power · +8% recharge') + '</button>';
      card.querySelector('.art-read').onclick = function () {
        if (A.readRune(slot)) { GH.audio.levelup(); renderHangar(); }
        else GH.audio.hit();
      };
      arts.appendChild(card);
    });
  }

  // ----------------------------------------------------------------
  // PILOT CHRONICLE — the title screen's standing record of who you are
  function renderChronicle() {
    var el = document.getElementById('title-chronicle');
    if (!el) return;
    var A = GH.attrs, d = GH.meta.data, def = chronicleFrame(), pp = GH.skills.pilotProgress();
    var prof = GH.meta.PROFILES[GH.meta.profile];
    var comp = GH.progress.completion();
    var s = GH.progress.seasonCheck();
    var b = d.broker.active;
    var band = GH.worldlife.band();
    var maxT = 1;
    A.LIST.forEach(function (a) { maxT = Math.max(maxT, A.total(a.id, def)); });
    var attrs = A.LIST.map(function (a) {
      var t = A.total(a.id, def);
      return '<div class="ch-attr"><span class="ch-attr-n" style="color:' + a.css + '">' + a.glyph + ' ' + a.name + '</span>' +
        '<span class="ch-attr-bar"><span style="width:' + Math.round(t / maxT * 100) + '%;background:' + a.css + '"></span></span>' +
        '<span class="ch-attr-v">' + Math.round(t) + '</span></div>';
    }).join('');
    var exp = d.world.exp;
    el.innerHTML =
      '<div class="ch-head">PILOT CHRONICLE</div>' +
      '<div class="ch-row"><b>' + prof.name + '</b> · ' + (exp && exp.mechId ? 'flying <b>' + def.name + '</b>' : 'last frame <b>' + def.name + '</b>') + '</div>' +
      '<div class="ch-row">PILOT LEVEL <b class="ch-big">' + pp.lvl + '</b><span class="ch-xp"><span style="width:' + Math.round(pp.into / pp.need * 100) + '%"></span></span></div>' +
      (A.free() || d.skillPoints || A.runeStock() ? '<div class="ch-row ch-hot">' +
        (A.free() ? A.free() + ' attribute point' + (A.free() > 1 ? 's' : '') + ' to place' : '') +
        (d.skillPoints ? (A.free() ? ' · ' : '') + d.skillPoints + ' skill point' + (d.skillPoints > 1 ? 's' : '') : '') +
        (A.runeStock() ? ((A.free() || d.skillPoints) ? ' · ' : '') + A.runeStock() + ' rune' + (A.runeStock() > 1 ? 's' : '') + ' to read' : '') + '</div>' : '') +
      '<div class="ch-attrs">' + attrs + '</div>' +
      '<div class="ch-grid">' +
      '<span>$ salvage <b>' + d.salvage + '</b></span><span>⬡ alloy <b>' + d.mats.alloy + '</b></span>' +
      '<span>◈ cores <b>' + d.mats.cores + '</b></span><span>✦ runes <b>' + A.runeStock() + '</b></span>' +
      '<span>frames <b>' + GH.roster.owned() + '/' + GH.roster.TOTAL + '</b></span><span>log <b>' + comp.pct + '%</b></span>' +
      '<span>season <b>' + s.pts + ' pts</b></span><span>band <b style="color:' + band.css + '">' + band.name + '</b></span>' +
      '</div>' +
      '<div class="ch-row ch-quest">' + (b ? '✎ ' + GH.progress.contractLabel(b) + ' <b>' + b.have + '/' + b.need + '</b>' : '✎ no contract — the BROKER has work') + '</div>' +
      (exp ? '<div class="ch-row">saved in the Reach at <b>' + (exp.zone ? GH.world.stageFor(exp.zone).name : 'the outpost') + '</b> · Lv ' + exp.level + '</div>' : '');
  }

  // ----------------------------------------------------------------
  // QUEST JOURNAL — every open task, one ledger (J in the field, the
  // hub, the pilot sheet, or the title)
  var journalFrom = 'hub';
  function openJournal(fromPlay) {
    GH.audio.card();
    if (fromPlay) expEntry = 'journal';
    journalFrom = GH.game.state === 'title' ? 'title' : 'hub';
    if (GH.game.state !== 'play' || fromPlay) GH.game.state = 'hangar';
    renderJournal();
    show('journal-screen');
  }

  function renderJournal() {
    var d = GH.meta.data;
    var box = function (title, body, cls) { return '<div class="jn-block' + (cls ? ' ' + cls : '') + '"><div class="jn-h">' + title + '</div>' + body + '</div>'; };
    var line = function (done, text, right) {
      return '<div class="jn-task' + (done ? ' done' : '') + '"><span class="jn-tick">' + (done ? '☑' : '☐') + '</span><span class="jn-text">' + text + '</span>' + (right ? '<span class="jn-right">' + right + '</span>' : '') + '</div>';
    };
    var left = '', right = '';

    // the guided first sortie, if it is running
    if (GH.game.tutorialActive && GH.game.tutorialActive()) {
      var ot = document.getElementById('objective-text');
      left += box('ZERO HOUR — CURRENT OBJECTIVE', '<div class="jn-task"><span class="jn-tick">➤</span><span class="jn-text">' + (ot ? ot.textContent : '') + '</span></div>', 'jn-main');
    }
    // contract
    var c = d.broker.active;
    left += box('BROKER CONTRACT', c
      ? line(false, GH.progress.contractLabel(c), c.have + '/' + c.need + ' · ' + c.salvage + ' salvage + ' + c.pts + ' pts')
      : '<div class="jn-empty">No contract taken. The BROKER always has one.</div>', 'jn-main');
    // daily board
    var dl = GH.worldlife.daily();
    var dhtml = '';
    dl.tasks.forEach(function (t) {
      var rw = [];
      if (t.reward.alloy) rw.push('+' + t.reward.alloy + ' alloy');
      if (t.reward.cores) rw.push('+' + t.reward.cores + ' core');
      if (t.reward.salvage) rw.push('+' + t.reward.salvage + ' salvage');
      dhtml += line(t.claimed, t.desc + (t.done && !t.claimed ? ' <b class="pl-hot">— CLAIM AT THE BROKER</b>' : ''), t.have + '/' + t.need + ' · ' + rw.join(', '));
    });
    left += box('DAILY BOARD — ' + dl.day + ' · streak ' + dl.streak, dhtml);
    // this territory's diary (or the nearest unfinished ones)
    var here = GH.game.debugInfo ? GH.game.debugInfo().zone : null;
    var zones = GH.world.ZONES.slice();
    if (here) zones.sort(function (a, b2) { return (a.id === here ? -1 : 0) - (b2.id === here ? -1 : 0); });
    var dcount = 0, dhtml2 = '';
    zones.forEach(function (zn) {
      if (dcount >= 3) return;
      var dp = GH.worldlife.diaryProgress(zn.id);
      var next = null;
      dp.tiers.forEach(function (t) { if (!next && !t.done) next = t; });
      if (!next) return;
      dcount++;
      dhtml2 += '<div class="jn-sub">' + GH.world.stageFor(zn.id).name + (zn.id === here ? ' <b>(here)</b>' : '') + ' — ' + next.name +
        ' <span class="jn-right">+' + next.reward.alloy + ' alloy' + (next.reward.cores ? ', +' + next.reward.cores + ' cores' : '') + (next.perk ? ', ' + next.perk.label : '') + '</span></div>';
      next.tasks.forEach(function (t) { dhtml2 += line(t.done, t.desc, t.have + '/' + t.need); });
    });
    left += box('ZONE DIARIES', dhtml2 || '<div class="jn-empty">Every diary tier is complete.</div>');

    // stage trials: the next tier per unlocked stage
    var thtml = '';
    GH.stages.forEach(function (st, si) {
      if ((si + 1) > d.stages) return;
      var tier = GH.progress.trialTier(st.id);
      if (tier >= GH.progress.trialTiers.length) return;
      var tr = GH.progress.trialTiers[tier];
      thtml += '<div class="jn-sub">' + st.name + ' — ' + tr.name + ' <span class="jn-right">' + tr.perk + '</span></div>';
      tr.tasks.forEach(function (task) { thtml += line(GH.progress.trialDone(st.id, task.id), task.desc); });
    });
    right += box('GAUNTLET TRIALS', thtml || '<div class="jn-empty">Every trial tier is complete.</div>');
    // season tasks left
    var s = GH.progress.seasonCheck();
    var shtml = '', sn = 0;
    GH.progress.seasonTasks.forEach(function (t) {
      if (s.done[t.id] || sn >= 8) return;
      sn++;
      shtml += line(false, t.desc, '+' + t.pts + ' pts');
    });
    right += box('SEASON OF THE ' + GH.progress.seasonName(s.id) + ' — ' + s.pts + ' PTS', shtml || '<div class="jn-empty">Every season task is done.</div>');
    // feats: frames still to earn
    var fhtml = '';
    Object.keys(GH.roster.FEATS).forEach(function (id) {
      if (d.shells[id]) return;
      fhtml += line(false, '<b>' + GH.mechById(id).name + '</b> — ' + GH.roster.FEATS[id].desc);
    });
    GH.roster.relics.forEach(function (m) {
      if (d.shells[m.id]) return;
      var rc = GH.roster.recipes[m.id];
      var fp = GH.roster.featProgress(rc.feat);
      fhtml += line(fp.done, '<b>' + m.name + '</b> (relic) — ' + rc.feat.desc, fp.have + '/' + fp.need);
    });
    right += box('FEATS — FRAMES STILL TO EARN', fhtml || '<div class="jn-empty">Every feat frame is yours.</div>');
    // next band
    var nb = nextBand();
    var ns = GH.worldlife.bandStatus(nb.id);
    if (nb.id !== GH.worldlife.band().id && !ns.unlocked) {
      right += box('NEXT REACH BAND — ' + nb.name, ns.missing.map(function (m) { return line(false, m); }).join(''));
    }
    document.getElementById('journal-body').innerHTML = '<div class="jn-col">' + left + '</div><div class="jn-col">' + right + '</div>';
  }

  // ----------------------------------------------------------------
  // WORLD MAP — every territory, its dungeons, tiers, and today's
  // phenomena, on one screen (M in the field, or from the hub).
  function openWorldMap(fromPlay) {
    GH.audio.card();
    if (fromPlay) expEntry = 'map';
    if (GH.game.state !== 'play' || fromPlay) GH.game.state = 'hangar';
    renderWorldMap();
    show('map-screen');
  }

  function renderWorldMap() {
    var w = GH.meta.data.world;
    var weather = GH.world.weatherToday();
    var harrow = w.harrowDay !== GH.world.dayStamp() ? GH.world.harrowToday() : null;
    var cleared = 0, totalTiers = 0;
    for (var k in (w.dgTier || {})) { cleared++; totalTiers += w.dgTier[k]; }
    var dtot = GH.worldlife.diaryTotal();
    document.getElementById('map-head').innerHTML =
      'BAND <b style="color:' + GH.worldlife.band().css + '">' + GH.worldlife.band().name + '</b> · HUNTS SLAIN <b>' + GH.bosses.slainCount() + '/' + GH.bosses.LIST.length + '</b> · DIARIES <b>' + dtot.done + '/' + dtot.total + '</b> · ' +
      'NESTS CLEANSED <b>' + Object.keys(w.nests).length + '/' + GH.world.totalNests() + '</b>' +
      ' · DUNGEONS ASCENDED <b>' + cleared + '/' + (GH.world.ZONES.length * 4) + '</b>' +
      ' · TOTAL TIERS CLIMBED <b>' + totalTiers + '</b>' +
      (harrow ? ' · <span class="mp-harrow">THE HARROW: ' + GH.world.stageFor(harrow.zone).name + '</span>' : '');
    renderMapGrid();
    var wrap = document.getElementById('map-zones');
    wrap.innerHTML = '';
    GH.world.ZONES.forEach(function (zn) {
      var st = GH.world.stageFor(zn.id);
      var card = document.createElement('div');
      card.className = 'mp-zone';
      var head = '<div class="mp-name">' + st.name +
        ' <span class="mp-danger">DANGER ' + ['I', 'II', 'III', 'IV'][zn.danger - 1] + '</span></div>';
      if (weather[zn.id]) {
        head += '<div class="mp-weather">☁ ' + weather[zn.id].name + ' — ' + weather[zn.id].desc + '</div>';
      }
      if (harrow && harrow.zone === zn.id) {
        head += '<div class="mp-harrow">☠ THE HARROW ROOSTS HERE TODAY</div>';
      }
      var dp = GH.worldlife.diaryProgress(zn.id);
      var nextTier = null;
      dp.tiers.forEach(function (t) { if (!nextTier && !t.done) nextTier = t; });
      var pk = GH.worldlife.zonePerk(zn.id);
      head += '<div class="mp-diary">DIARY <b>' + dp.doneTiers + '/' + dp.total + '</b>' + (pk.labels.length ? ' · ' + pk.labels.join(' · ') : '') +
        (nextTier ? '<div class="mp-diary-tasks">' + nextTier.name + ': ' + nextTier.tasks.map(function (t) {
          return '<span class="' + (t.done ? 'dt-done' : '') + '">' + (t.done ? '☑' : '☐') + ' ' + t.desc.replace(' here', '') + ' ' + t.have + '/' + t.need + '</span>';
        }).join(' ') + ' → +' + nextTier.reward.alloy + ' alloy' + (nextTier.reward.cores ? ', +' + nextTier.reward.cores + ' cores' : '') + (nextTier.perk ? ', ' + nextTier.perk.label : '') + '</div>' : '<div class="mp-diary-tasks dt-done">ALL TIERS COMPLETE</div>') + '</div>';
      var hd = GH.meta.data.huntsToday || { day: null, slain: {} };
      var todaySlain = hd.day === GH.world.dayStamp() ? hd.slain : {};
      var hunt = GH.bosses.todayFor(zn.id, GH.world.dayStamp(), todaySlain);
      var zoneHunts = GH.bosses.forZone(zn.id);
      var bst2 = GH.meta.data.bestiary || {};
      var seenHere = zoneHunts.filter(function (b) { return bst2[b.id]; }).length;
      head += '<div class="mp-hunt' + (hunt ? '' : ' slain') + '">☠ HUNT: ' + (hunt ? '<b>' + hunt.name + '</b> — ' + hunt.epithet + ' (tier ' + hunt.tier + ')' : 'every hunt here is down for today') +
        ' · bestiary ' + seenHere + '/' + zoneHunts.length + '</div>';
      var rows = '';
      var archList = ['depths'].concat(GH.dungeons.ZONE_SETS[zn.id] || []);
      archList.forEach(function (arch) {
        var tier = (w.dgTier || {})[GH.dungeons.baseId(zn.id, arch)] || 0;
        var next = tier + 1;
        var mods = GH.dungeons.modsFor(GH.dungeons.baseId(zn.id, arch), next);
        rows += '<div class="mp-dg' + (tier > 0 ? ' cleared' : '') + '">' +
          '<span class="mp-arch">' + GH.dungeons.ARCHETYPES[arch].name + '</span>' +
          '<span class="mp-tier">' + (tier > 0 ? 'CLIMBED T' + tier + ' · NEXT T' + next : 'UNCONQUERED') + '</span>' +
          (mods.length ? '<span class="mp-mods">' + mods.map(function (m) { return m.name; }).join(' · ') + '</span>' : '') +
          '</div>';
      });
      card.innerHTML = head + rows;
      wrap.appendChild(card);
    });
  }

  // the Reach as a map: territories on their grid, corner touching corner,
  // the loaded one lit and its four neighbours marked (see GH.world.GRID)
  function renderMapGrid() {
    var host = document.getElementById('map-grid');
    if (!host) {
      host = document.createElement('div');
      host.id = 'map-grid';
      var zonesEl = document.getElementById('map-zones');
      zonesEl.parentNode.insertBefore(host, zonesEl);
    }
    host.innerHTML = '';
    var cur = GH.game.currentZone ? GH.game.currentZone() : null;
    var curParent = cur ? GH.world.zoneInfo(cur).parent : null;
    var nbs = curParent ? GH.world.neighbours(curParent) : {};
    var nextSet = {};
    for (var c in nbs) if (nbs[c]) nextSet[nbs[c]] = GH.world.CORNERS[c];
    var hd = GH.meta.data.huntsToday || { day: null, slain: {} };
    var todaySlain = hd.day === GH.world.dayStamp() ? hd.slain : {};
    for (var row = -2; row <= 2; row++) {
      for (var col = -2; col <= 2; col++) {
        var id = null;
        for (var z in GH.world.GRID) if (GH.world.GRID[z][0] === col && GH.world.GRID[z][1] === row) id = z;
        var tile = document.createElement('div');
        if (!id) { tile.className = 'mg-empty'; host.appendChild(tile); continue; }
        var st = GH.world.stageFor(id);
        var zn = GH.world.zoneById(id);
        tile.className = 'mg-tile' + (id === 'wreck' ? ' hub' : '') + (id === curParent ? ' here' : '') + (nextSet[id] ? ' next' : '');
        var hunt = GH.bosses.todayFor(id, GH.world.dayStamp(), todaySlain);
        tile.innerHTML = '<div>' + (nextSet[id] ? '<span style="color:#60c8ff">' + nextSet[id].arrow + '</span> ' : '') + st.name + '</div>' +
          '<div class="mg-danger">DANGER ' + ['I', 'II', 'III', 'IV'][zn.danger - 1] + '</div>' +
          (hunt ? '<span class="mg-hunt" title="' + hunt.name + '">☠</span>' : '');
        tile.title = st.biome || st.name;
        host.appendChild(tile);
      }
    }
    var note = document.createElement('div');
    note.className = 'mg-note';
    note.textContent = 'Portals stand in the four corners of every territory. Leave through a corner and you arrive in the opposite corner of the next map, still travelling the same way.';
    host.appendChild(note);
  }

  // ----------------------------------------------------------------
  // PILOT TRAINING — the skill tree. Reached from play (K), the hub,
  // or the title; backing out of an in-play open resumes the run.
  function openSkills(fromPlay) {
    GH.audio.card();
    if (fromPlay) expEntry = 'skills';
    if (GH.game.state !== 'play' || fromPlay) GH.game.state = 'hangar';
    renderSkills();
    show('skills-screen');
  }

  function renderSkills() {
    var pp = GH.skills.pilotProgress();
    document.getElementById('skills-head').innerHTML =
      'PILOT LEVEL <b>' + pp.lvl + '</b> · ' +
      Math.floor(pp.into) + '/' + Math.ceil(pp.need) + ' XP · ' +
      'POINTS TO SPEND: <b class="sk-pts">' + GH.meta.data.skillPoints + '</b> · ' +
      'SALVAGE: ' + GH.meta.data.salvage;
    var wrap = document.getElementById('skills-tree');
    wrap.innerHTML = '';
    GH.skills.BRANCHES.forEach(function (br) {
      var col = document.createElement('div');
      col.className = 'sk-branch';
      var spent = GH.skills.spentIn(br.id);
      col.innerHTML = '<div class="sk-branch-name" style="color:' + br.css + '">' +
        br.name + ' <span class="sk-spent">(' + spent + ' spent)</span></div>';
      GH.skills.TREE.forEach(function (node) {
        if (node.branch !== br.id) return;
        var rank = GH.skills.rank(node.id);
        var can = GH.skills.canSpend(node.id);
        var gated = spent < node.req;
        var div = document.createElement('div');
        div.className = 'sk-node' + (rank >= node.max ? ' maxed' : '') +
          (can ? ' can' : '') + (gated ? ' gated' : '');
        var pips = '';
        for (var i = 0; i < node.max; i++) {
          pips += '<span class="sk-pip' + (i < rank ? ' on' : '') + '"></span>';
        }
        div.innerHTML =
          '<div class="sk-name">' + node.name +
          (node.req > 0 ? ' <span class="sk-req">req ' + node.req + '</span>' : '') + '</div>' +
          '<div class="sk-desc">' + node.desc + '</div>' +
          '<div class="sk-pips">' + pips + '</div>';
        div.onclick = function () {
          if (GH.skills.spend(node.id)) {
            GH.audio.levelup();
            renderSkills();
          } else {
            GH.audio.hit();
          }
        };
        col.appendChild(div);
      });
      wrap.appendChild(col);
    });
  }


  // ----------------------------------------------------------------
  // PAUSE — resume, controls, exit (keeps the run), abandon (deletes it)
  function togglePause() {
    if (GH.game.state === 'race') { GH.game.abortRace(); return; }
    if (GH.game.state === 'play') {
      GH.game.state = 'pause';
      document.getElementById('pause-stats').textContent = GH.game.pauseInfo();
      var exp = GH.game.isExpedition();
      document.getElementById('btn-exit-run').textContent = exp ? 'EXIT — SAVE & RETURN TO MENU' : 'EXIT RUN — SAVE & RETURN TO MENU';
      document.getElementById('btn-skip-tutorial').classList.toggle('hidden', !GH.game.tutorialActive());
      document.getElementById('pause-exit-note').textContent = exp
        ? 'Exit keeps your pilot exactly where they stand. Abandon deletes this pilot; the world\'s scars stay.'
        : 'Exit parks this run at the start of wave ' + Math.max(1, GH.game.debugInfo().wave) + ' — CONTINUE RUN on the title brings you back. Abandon deletes it.';
      show('pause-screen');
    } else if (GH.game.state === 'pause') {
      GH.game.state = 'play';
      show(null);
    }
  }

  function toTitle() {
    var d = GH.meta.data;
    if (d.tutorialParked && d.tutorial && d.tutorial.done && !GH.game.tutorialActive()) {
      d.world.exp = d.tutorialParked; d.tutorialParked = null;
    }
    GH.meta.save();
    expEntry = null;
    GH.game.state = 'title';
    document.getElementById('hud').classList.add('hidden');
    refreshTitle();
    show('title-screen');
  }

  // EXIT RUN: save whatever we're flying and go home
  function exitRun() {
    GH.game.suspendRun();
    GH.meta.backup('exit');
    GH.game.leaveRun();
    GH.audio.card();
    toTitle();
  }

  // ABANDON RUN: delete it, after a confirm
  function abandonRun(thenSelect) {
    var exp = GH.game.isExpedition();
    confirmBox(exp ? 'ABANDON THIS PILOT?' : 'ABANDON THIS RUN?',
      exp ? 'The saved pilot, their level and their gear are deleted. Nests you broke and lairs you cleared stay cleared.'
        : 'This run is deleted. Salvage, alloy and cores already banked are kept.',
      'ABANDON', function () {
        var mode = GH.game.mode;
        GH.game.abandonRun();
        GH.game.leaveRun();
        GH.audio.hit();
        if (thenSelect) enterSelect(mode === 'weekly' ? 'classic' : mode);
        else toTitle();
      });
  }

  // ----------------------------------------------------------------
  // Expedition camp stations open the meta screens in place; backing
  // out drops you straight back into the world, not the title.
  var expEntry = null; // which screen the camp station / hotkey opened

  function resumeExpedition() {
    expEntry = null;
    GH.game.state = 'play';
    show(null);
    GH.audio.card();
    // camp training/purchases land on the live character immediately
    if (GH.game.refreshPilot) GH.game.refreshPilot();
  }

  function metaBack(entryKind, fallback) {
    return function () {
      if (expEntry === entryKind) resumeExpedition();
      else fallback();
    };
  }

  // ZERO HOUR: the guided first sortie (fresh pilot in the Reach, tutorial flag on)
  function startTutorial() {
    GH.audio.wave();
    var go = function () {
      GH.game.mode = 'expedition';
      show(null);
      GH.game.startExpedition(0, { tutorial: true });
    };
    if (GH.meta.data.world.exp) {
      confirmBox('REPLAY ZERO HOUR?', 'Zero Hour starts a fresh pilot in the Reach. Your saved pilot is kept aside and restored when you finish or skip it.', 'START', function () {
        GH.meta.data.tutorialParked = GH.meta.data.world.exp;
        GH.meta.data.world.exp = null;
        GH.meta.save();
        go();
      });
    } else go();
  }

  function startOrResumeExpedition() {
    GH.audio.card();
    if (GH.meta.data.world.exp) {
      show(null);
      GH.game.startExpedition(0); // saved character carries its own frame
    } else {
      enterSelect('expedition');
    }
  }

  function newExpedition() {
    if (!GH.meta.data.world.exp) { enterSelect('expedition'); return; }
    confirmBox('START A NEW EXPEDITION?',
      'Your saved pilot in the Reach is deleted (level, gear, position). The world\'s scars — broken nests, fallen lairs, ascended dungeons — stay.',
      'NEW EXPEDITION', function () {
        GH.meta.data.world.exp = null;
        GH.meta.data.world.wreck = null;
        GH.meta.save();
        enterSelect('expedition');
      });
  }

  // ----------------------------------------------------------------
  // FRAME WORKSHOP — the 135. Browse by lineage, see exactly what a
  // frame costs or which feat earns it, and build it.
  var workshopReturn = 'hub';
  var wsLineage = 'aegis';
  var wsPick = null;

  function openWorkshop() {
    GH.audio.card();
    if (GH.game.state === 'play') expEntry = 'workshop';
    GH.game.state = 'hangar';
    renderWorkshop();
    show('workshop-screen');
  }

  function matsLine() {
    var m = GH.meta.data.mats;
    return '<span class="ws-mat">⬡ ALLOY <b>' + m.alloy + '</b></span> <span class="ws-mat">◈ CORES <b>' + m.cores +
      '</b></span> <span class="ws-mat">$ SALVAGE <b>' + GH.meta.data.salvage + '</b></span>';
  }

  function renderWorkshop() {
    document.getElementById('ws-head').innerHTML =
      'FRAMES OWNED <b>' + GH.roster.owned() + ' / ' + GH.roster.TOTAL + '</b> · ' + matsLine();
    // lineage tabs
    var tabs = document.getElementById('ws-tabs');
    tabs.innerHTML = '';
    var lineages = GH.roster.BASE.map(function (b) { return { id: b.id, name: b.name, icon: b.icon }; });
    lineages.push({ id: 'relic', name: 'RELICS', icon: '★' });
    lineages.push({ id: 'vectors', name: 'VECTORS', icon: '⛟' });
    lineages.forEach(function (ln) {
      var owned = 0, total = 0;
      if (ln.id === 'vectors') { total = GH.vehicles.DESIGNS.length; owned = GH.vehicles.ownedCount(); }
      else GH.mechs.forEach(function (m) {
        if ((m.lineage || m.id) !== ln.id) return;
        total++; if (GH.meta.data.shells[m.id]) owned++;
      });
      var t = document.createElement('div');
      t.className = 'ws-tab' + (wsLineage === ln.id ? ' on' : '');
      t.innerHTML = '<span class="ws-tab-icon">' + ln.icon + '</span>' + ln.name + '<span class="ws-tab-n">' + owned + '/' + total + '</span>';
      t.onclick = function () { wsLineage = ln.id; wsPick = null; GH.audio.card(); renderWorkshop(); };
      tabs.appendChild(t);
    });
    // grid
    var grid = document.getElementById('ws-grid');
    grid.innerHTML = '';
    var first = null;
    if (wsLineage === 'vectors') { renderVectorGrid(grid); return; }
    GH.mechs.forEach(function (m) {
      if ((m.lineage || m.id) !== wsLineage) return;
      var st = GH.roster.status(m.id);
      var pk = m.pack ? GH.roster.packById(m.pack) : null;
      var mk = m.mark ? GH.roster.markById(m.mark) : null;
      var cell = document.createElement('div');
      cell.className = 'ws-cell' + (st.owned ? ' owned' : (st.canBuild ? ' ready' : (st.feat ? ' feat' : ' locked'))) +
        (wsPick === m.id ? ' pick' : '');
      cell.innerHTML =
        '<div class="ws-icon"' + (pk ? ' style="color:' + pk.css + '"' : '') + '>' + m.icon + '</div>' +
        '<div class="ws-name">' + m.name + '</div>' +
        '<div class="ws-sub">' + (pk ? pk.name + ' · ' + mk.name : (m.kind === 'relic' ? 'RELIC' : m.kind === 'starter' ? 'STARTER' : m.kind === 'feat' ? 'FEAT FRAME' : 'BASE FRAME')) + '</div>' +
        '<div class="ws-state">' + (st.owned ? '✓ OWNED' : st.canBuild ? '⚒ READY TO BUILD' : st.feat ? '★ FEAT' : st.blockers && st.blockers.length ? '🔒 LOCKED' : '⬡ NEED MATERIALS') + '</div>';
      cell.onclick = function () { wsPick = m.id; GH.audio.card(); renderWorkshop(); };
      grid.appendChild(cell);
      if (!first) first = m.id;
    });
    if (!wsPick) wsPick = first;
    renderWorkshopDetail();
  }

  // the VECTORS tab: every vehicle design, by lineage
  function renderVectorGrid(grid) {
    var first = null;
    GH.vehicles.DESIGNS.forEach(function (d) {
      var owned = GH.vehicles.owned(d.id);
      var can = GH.vehicles.canBuild(d.id);
      var base = GH.mechById(d.lineage);
      var cell = document.createElement('div');
      cell.className = 'ws-cell' + (owned ? ' owned' : (can ? ' ready' : ' locked')) + (wsPick === d.id ? ' pick' : '');
      cell.innerHTML = '<div class="ws-icon">' + base.icon + '</div><div class="ws-name">' + d.name + '</div>' +
        '<div class="ws-sub">' + base.name + ' · ' + (GH.VECTORS[d.kind] || GH.VECTORS.bike).name + '</div>' +
        '<div class="ws-state">' + (owned ? (d.free ? '✓ STANDARD' : '✓ BUILT') : can ? '⚒ READY TO BUILD' : GH.meta.data.shells[d.lineage] ? '⬡ NEED MATERIALS' : '🔒 NEEDS ' + base.name) + '</div>';
      cell.onclick = function () { wsPick = d.id; GH.audio.card(); renderWorkshop(); };
      grid.appendChild(cell);
      if (!first) first = d.id;
    });
    if (!wsPick || !GH.vehicles.byId(wsPick)) wsPick = first;
    var box = document.getElementById('ws-detail');
    var d = GH.vehicles.byId(wsPick);
    if (!d) { box.innerHTML = ''; return; }
    var base = GH.mechById(d.lineage), K = GH.VECTORS[d.kind] || GH.VECTORS.bike;
    wsPreview([function () { return GH.models.buildSpeeder(base.model, d.kind, d.shape); }]);
    var owned = GH.vehicles.owned(d.id), can = GH.vehicles.canBuild(d.id), c = GH.vehicles.BUILD_COST, m = GH.meta.data.mats;
    var need = function (have, want, label) { return '<span class="' + (have >= want ? 'ws-ok' : 'ws-short') + '">' + label + ' ' + have + '/' + want + '</span>'; };
    box.innerHTML = '<div class="ws-d-name">' + base.icon + ' ' + d.name + '</div>' +
      '<div class="ws-d-role">' + base.name + ' lineage · ' + K.name + '</div>' +
      '<div class="ws-d-desc">' + d.desc + '</div>' +
      '<div class="ws-d-stats">Top speed ×' + K.top + ' · accel ×' + K.accel + ' · grip ×' + K.grip + ' · drift grip ×' + K.driftGrip + ' · jump ×' + K.jump + ' · ram ×' + K.ram + (K.hover ? ' · hovers over water and mud' : '') + (K.glide ? ' · glides' : '') + '</div>' +
      (owned ? '<div class="ws-d-status owned">' + (d.free ? 'STANDARD ISSUE' : 'BUILT') + ' — pick it with the VECTOR button on the frame select screen.</div>'
        : '<div class="ws-d-bill">BILL: ' + need(m.alloy, c.alloy, '⬡ ALLOY') + ' · ' + need(m.cores, c.cores, '◈ CORES') + ' · ' + need(GH.meta.data.salvage, c.salvage, '$ SALVAGE') + '</div>' +
          (GH.meta.data.shells[d.lineage] ? '' : '<div class="ws-d-req ws-short">REQUIRES: ' + base.name + ' (own the frame first)</div>') +
          '<button class="menu-btn small" id="ws-build" ' + (can ? '' : 'disabled') + '>' + (can ? '⚒ BUILD ' + d.name : 'NOT YET') + '</button>');
    var bb = document.getElementById('ws-build');
    if (bb) bb.onclick = function () {
      if (GH.vehicles.build(d.id)) { GH.audio.build(); GH.game.lifeEvent('build', 1); GH.game.tutorialEvent('build', 1); renderWorkshop(); }
      else GH.audio.hit();
    };
  }

  // the hangar viewer: the picked frame (and its vehicle) turning on a plinth
  var wsView = null;
  function wsPreview(buildFns) {
    var cv = document.getElementById('ws-view');
    if (!cv) return;
    try {
      if (!wsView) {
        var r = new THREE.WebGLRenderer({ canvas: cv, antialias: false });
        r.setPixelRatio(1); r.setSize(cv.width, cv.height, false);
        var sc = new THREE.Scene();
        sc.background = new THREE.Color(0x1a1410);
        sc.add(new THREE.HemisphereLight(0xdfe8ff, 0x303848, 1.0));
        var sun = new THREE.DirectionalLight(0xfff0d0, 0.9); sun.position.set(3, 6, 4); sc.add(sun);
        var cam = new THREE.PerspectiveCamera(38, cv.width / cv.height, 0.1, 60);
        var floor = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.2, 24), new THREE.MeshLambertMaterial({ color: 0x4a3620 }));
        floor.position.y = -0.1; sc.add(floor);
        wsView = { r: r, sc: sc, cam: cam, group: null, t: 0 };
      }
      if (wsView.group) wsView.sc.remove(wsView.group);
      var g = new THREE.Group();
      var models = buildFns.map(function (f) { return f(); });
      models.forEach(function (m, i) { m.position.x = models.length > 1 ? (i === 0 ? -1.5 : 1.7) : 0; g.add(m); });
      wsView.sc.add(g);
      wsView.group = g;
      wsView.two = models.length > 1;
    } catch (e) { /* no second context — the panel still works */ }
  }
  function wsTick(dt) {
    if (!wsView || !wsView.group || curScreen !== 'workshop-screen') return;
    wsView.t += dt;
    wsView.group.rotation.y = wsView.t * 0.7;
    var d = wsView.two ? 7.8 : 6.2;
    wsView.cam.position.set(0, 2.6, d); wsView.cam.lookAt(0, 1.3, 0);
    wsView.r.render(wsView.sc, wsView.cam);
  }

  function renderWorkshopDetail() {
    var box = document.getElementById('ws-detail');
    var m = wsPick ? GH.mechById(wsPick) : null;
    if (!m) { box.innerHTML = ''; return; }
    var vec = GH.vehicles.activeFor(m);
    wsPreview([function () { var cfg = {}; for (var k in m.model) cfg[k] = m.model[k]; return GH.models.buildMech(cfg); },
      function () { var sp = GH.models.buildSpeeder(m.model, vec.kind, vec.shape); sp.scale.setScalar(0.85); return sp; }]);
    var st = GH.roster.status(m.id);
    var pk = m.pack ? GH.roster.packById(m.pack) : null;
    var html = '<div class="ws-d-name">' + m.icon + ' ' + m.name + '</div>' +
      '<div class="ws-d-role">' + m.role + '</div>' +
      '<div class="ws-d-desc">' + m.desc + '</div>' +
      '<div class="ws-d-stats">' + m.baseText.replace(/\n/g, ' · ') + '</div>' +
      '<div class="ws-d-stats">Primary: <b>' + m.weapon.name + '</b> · ' + m.specialText + '</div>' +
      (function () { var sg = GH.skills.signatureFor(m); return '<div class="ws-d-stats">Signature [' + GH.controls.label('ability5') + ']: <b>' + sg.glyph + ' ' + sg.name + '</b> — ' + sg.desc + (m.kind === 'relic' ? ' (relic: ×1.25)' : '') + '</div>'; })();
    if (pk) html += '<div class="ws-d-pack" style="color:' + pk.css + '">' + pk.glyph + ' ' + pk.name + ' PACK — ' + pk.desc + '</div>';
    if (st.owned) {
      html += '<div class="ws-d-status owned">OWNED — pick it on the frame select screen.</div>';
    } else if (st.feat) {
      html += '<div class="ws-d-status feat">FEAT FRAME — ' + GH.roster.FEATS[m.id].desc + '</div>';
    } else if (st.recipe) {
      var rc = st.recipe, mats = GH.meta.data.mats;
      var need = function (have, want, label) {
        return '<span class="' + (have >= want ? 'ws-ok' : 'ws-short') + '">' + label + ' ' + have + '/' + want + '</span>';
      };
      html += '<div class="ws-d-bill">BILL: ' + need(mats.alloy, rc.alloy, '⬡ ALLOY') + ' · ' +
        need(mats.cores, rc.cores, '◈ CORES') + ' · ' + need(GH.meta.data.salvage, rc.salvage, '$ SALVAGE') + '</div>';
      if (rc.requires) html += '<div class="ws-d-req' + (GH.meta.data.shells[rc.requires] ? ' ws-ok' : ' ws-short') + '">REQUIRES: ' + GH.mechById(rc.requires).name + (GH.meta.data.shells[rc.requires] ? ' ✓' : ' (build it first)') + '</div>';
      if (rc.feat) {
        var fp = GH.roster.featProgress(rc.feat);
        html += '<div class="ws-d-req' + (fp.done ? ' ws-ok' : ' ws-short') + '">FEAT: ' + rc.feat.desc + ' (' + fp.have + '/' + fp.need + ')' + (fp.done ? ' ✓' : '') + '</div>';
      }
      html += '<button class="menu-btn small" id="ws-build" ' + (st.canBuild ? '' : 'disabled') + '>' +
        (st.canBuild ? '⚒ BUILD ' + m.name : st.blockers.length ? 'LOCKED' : 'NOT ENOUGH MATERIALS') + '</button>';
    }
    box.innerHTML = html;
    var bb = document.getElementById('ws-build');
    if (bb) bb.onclick = function () {
      if (GH.roster.build(m.id)) {
        GH.audio.build();
        GH.game.lifeEvent('build', 1);
        GH.game.tutorialEvent('build', 1);
        renderWorkshop();
        if (GH.game.refreshPilot) GH.game.refreshPilot();
      } else GH.audio.hit();
    };
  }

  // ----------------------------------------------------------------
  // PILOT SHEET — the character screen: who you are, what you carry,
  // and doors to everything that changes it.
  function openPilot(fromPlay, from) {
    GH.audio.card();
    if (from) pilotFrom = from;
    if (fromPlay) expEntry = 'pilot';
    if (GH.game.state !== 'play' || fromPlay) GH.game.state = 'hangar';
    renderPilot();
    show('pilot-screen');
  }

  function renderPilot() {
    var d = GH.meta.data;
    var pp = GH.skills.pilotProgress();
    var prof = GH.meta.PROFILES[GH.meta.profile];
    var f = GH.factions.state();
    var art = d.world.equipped ? GH.progress.artifactById(d.world.equipped) : null;
    var frameDef = chronicleFrame();
    var attrLine = GH.attrs.LIST.map(function (a) {
      return '<span class="pl-attr" style="color:' + a.css + '" title="' + a.desc + '">' + a.glyph + ' ' + a.name + ' <b>' + Math.round(GH.attrs.total(a.id, frameDef)) + '</b></span>';
    }).join(' ');
    var live = GH.game.state === 'hangar' && expEntry === 'pilot' && GH.game.debugInfo().hp > 0
      ? GH.game.pauseInfo() : null;
    var frames = [];
    GH.mechs.forEach(function (m) { if (d.shells[m.id]) frames.push(m); });
    var html =
      '<div class="pl-col">' +
      '<div class="pl-block"><div class="pl-h">PILOT</div>' +
      '<div class="pl-row">Profile <b>' + prof.name + '</b> — ' + prof.desc + '</div>' +
      '<div class="pl-row">Pilot level <b>' + pp.lvl + '</b> · ' + Math.floor(pp.into) + '/' + Math.ceil(pp.need) + ' XP to next</div>' +
      '<div class="pl-row">Skill points ready <b class="' + (d.skillPoints ? 'pl-hot' : '') + '">' + d.skillPoints + '</b> · trained ranks <b>' + GH.skills.spentTotal() + '</b> · attribute points ready <b class="' + (GH.attrs.free() ? 'pl-hot' : '') + '">' + GH.attrs.free() + '</b></div>' +
      '<div class="pl-row pl-attrs">' + attrLine + ' <i>(as ' + frameDef.name + ')</i></div>' +
      '<div class="pl-row">Combat Arts ' + GH.attrs.ART_SLOTS.map(function (sl) { var ab = GH.attrs.artLabel(sl, frameDef); return ab.glyph + ' <b>' + GH.attrs.artRank(sl) + '</b>'; }).join(' · ') + ' · runes to read <b class="' + (GH.attrs.runeStock() ? 'pl-hot' : '') + '">' + GH.attrs.runeStock() + '</b></div>' +
      '<div class="pl-row">Mastery total <b>' + GH.progress.masteryTotal() + '</b> · runs <b>' + d.collection.totalRuns + '</b> · wins <b>' + d.collection.totalWins + '</b> · kills <b>' + d.collection.totalKills + '</b></div>' +
      '</div>' +
      '<div class="pl-block"><div class="pl-h">INVENTORY</div>' +
      '<div class="pl-row">$ Salvage <b>' + d.salvage + '</b></div>' +
      '<div class="pl-row">⬡ Alloy <b>' + d.mats.alloy + '</b> · ◈ Frame cores <b>' + d.mats.cores + '</b></div>' +
      '<div class="pl-row">Artifact equipped <b>' + (art ? art.name : 'none') + '</b> (' + Object.keys(d.world.artifacts).length + '/' + GH.progress.artifacts.length + ' found — equip in COLLECTION LOG)</div>' +
      '<div class="pl-row">Cosmetics owned <b>' + Object.keys(d.style.owned).length + '</b> — set on the frame select screen</div>' +
      '<div class="pl-row">Broker points <b>' + d.broker.points + '</b></div>' +
      '<div class="pl-row">House: <b>' + factionsSub() + '</b></div>' +
      '<div class="pl-row">Reach band <b style="color:' + GH.worldlife.band().css + '">' + GH.worldlife.band().name + '</b> · <span class="band-row">' + GH.worldlife.BANDS.map(function (bb) {
        var st = GH.worldlife.bandStatus(bb.id);
        return '<span class="band-chip' + (bb.id === GH.worldlife.band().id ? ' on' : '') + (st.unlocked ? '' : ' locked') + '" data-band="' + bb.id + '" style="border-color:' + bb.css + '" title="' + (st.unlocked ? bb.desc : 'Locked: ' + st.missing.join(', ')) + '">' + bb.name + '</span>';
      }).join('') + '</span></div>' +
      '<div class="pl-row">Vehicles <b>' + GH.vehicles.ownedCount() + '/' + GH.vehicles.DESIGNS.length + '</b> · zone diaries <b>' + GH.worldlife.diaryTotal().done + '/' + GH.worldlife.diaryTotal().total + '</b> · daily streak <b>' + GH.worldlife.daily().streak + '</b>' + (GH.worldlife.dailyUnclaimed() ? ' · <b class="pl-hot">' + GH.worldlife.dailyUnclaimed() + ' daily reward(s) to claim at the BROKER</b>' : '') + '</div>' +
      '</div>' +
      '<div class="pl-block" id="pilot-daily"></div>' +
      (live ? '<div class="pl-block"><div class="pl-h">CURRENT RUN</div><div class="pl-row pl-pre">' + live + '</div></div>' : '') +
      '</div>' +
      '<div class="pl-col">' +
      '<div class="pl-block"><div class="pl-h">FRAMES OWNED — ' + frames.length + ' / ' + GH.roster.TOTAL + '</div><div class="pl-frames">' +
      frames.map(function (m) {
        var pk = m.pack ? GH.roster.packById(m.pack) : null;
        return '<span class="pl-frame" title="' + m.role + '"' + (pk ? ' style="border-color:' + pk.css + '"' : '') + '>' + m.icon + ' ' + m.name + ' <i>Lv' + GH.progress.masteryLevel(m.id) + '</i></span>';
      }).join('') + '</div></div>' +
      '<div class="pl-block"><div class="pl-h">GO TO</div><div class="pl-links">' +
      '<button class="menu-btn tiny" data-go="skills">PILOT TRAINING</button>' +
      '<button class="menu-btn tiny" data-go="workshop">FRAME WORKSHOP</button>' +
      '<button class="menu-btn tiny" data-go="collection">COLLECTION LOG</button>' +
      '<button class="menu-btn tiny" data-go="hangar">ATTRIBUTES &amp; ARTS</button>' +
      '<button class="menu-btn tiny" data-go="journal">QUEST JOURNAL</button>' +
      '<button class="menu-btn tiny" data-go="controls">CONTROLS</button>' +
      '<button class="menu-btn tiny" data-go="help">HOW TO PLAY</button>' +
      '</div></div></div>';
    var body = document.getElementById('pilot-body');
    body.innerHTML = html;
    renderDaily('pilot-daily');
    body.querySelectorAll('[data-band]').forEach(function (chip) {
      chip.onclick = function () {
        if (GH.worldlife.setBand(chip.getAttribute('data-band'))) { GH.audio.card(); renderPilot(); } else GH.audio.hit();
      };
    });
    body.querySelectorAll('[data-go]').forEach(function (b) {
      b.onclick = function () {
        var g = b.getAttribute('data-go');
        pilotReturn = true;
        if (g === 'skills') openSkills(false);
        else if (g === 'workshop') { workshopReturn = 'pilot'; openWorkshop(); }
        else if (g === 'collection') openCollection();
        else if (g === 'hangar') openHangar();
        else if (g === 'journal') openJournal(false);
        else if (g === 'controls') openControls();
        else if (g === 'help') openHelp();
      };
    });
  }
  var pilotReturn = false;

  // ----------------------------------------------------------------
  // CONTROLS — rebind any key, tune the camera
  function openControls() {
    GH.audio.card();
    if (GH.game.state === 'play') expEntry = 'controls';
    if (GH.game.state !== 'pause') GH.game.state = 'hangar';
    controlsFromPause = GH.game.state === 'pause';
    renderControls();
    show('controls-screen');
  }
  var controlsFromPause = false;

  function renderControls() {
    var C = GH.controls;
    var list = document.getElementById('controls-list');
    var html = '';
    var lastGroup = null;
    C.ACTIONS.forEach(function (a) {
      if (a.group !== lastGroup) {
        lastGroup = a.group;
        html += '<div class="ct-group">' + a.group + '</div>';
      }
      var waiting = rebindWait === a.id;
      html += '<div class="ct-row"><span class="ct-name">' + a.name + '</span>' +
        '<span class="ct-key' + (waiting ? ' waiting' : '') + (!C.binds[a.id] ? ' unbound' : '') + '" data-act="' + a.id + '">' +
        (waiting ? 'PRESS A KEY…' : C.label(a.id)) + '</span></div>';
    });
    html += '<div class="ct-group">MOUSE (fixed)</div>' +
      '<div class="ct-row"><span class="ct-name">Attack / pick target</span><span class="ct-key fixed">LEFT CLICK</span></div>' +
      '<div class="ct-row"><span class="ct-name">Look around (hold and drag)</span><span class="ct-key fixed">RIGHT MOUSE</span></div>' +
      '<div class="ct-row"><span class="ct-name">Zoom camera</span><span class="ct-key fixed">WHEEL</span></div>' +
      '<div class="ct-row"><span class="ct-name">Pause / close menu</span><span class="ct-key fixed">ESC</span></div>';
    list.innerHTML = html;
    list.querySelectorAll('.ct-key[data-act]').forEach(function (k) {
      k.onclick = function () {
        rebindWait = k.getAttribute('data-act');
        GH.audio.card();
        renderControls();
      };
    });
    // settings
    var st = C.settings;
    document.getElementById('set-sens').value = Math.round(st.sens * 100);
    document.getElementById('set-sens-val').textContent = Math.round(st.sens * 100) + '%';
    document.getElementById('set-invert').checked = !!st.invertY;
    document.getElementById('set-crt').checked = !!st.crt;
    document.getElementById('set-crt-level').value = st.crtLevel || 'film';
    document.getElementById('set-cam').value = GH.game.camMode();
    document.getElementById('set-mute').checked = GH.audio.isMuted();
    document.getElementById('set-music').value = Math.round((st.music === undefined ? 1 : st.music) * 100);
    document.getElementById('set-music-val').textContent = Math.round((st.music === undefined ? 1 : st.music) * 100) + '%';
    document.getElementById('set-sfx').value = Math.round((st.sfx === undefined ? 1 : st.sfx) * 100);
    document.getElementById('set-sfx-val').textContent = Math.round((st.sfx === undefined ? 1 : st.sfx) * 100) + '%';
  }

  // ----------------------------------------------------------------
  // HELP — how to play, where everything is, how frames are earned
  function openHelp() {
    GH.audio.card();
    if (GH.game.state === 'play') expEntry = 'help';
    if (GH.game.state !== 'pause') GH.game.state = 'hangar';
    renderHelp();
    show('help-screen');
  }

  function renderHelp() {
    var L = GH.controls.label;
    var feats = Object.keys(GH.roster.FEATS).map(function (id) {
      var own = GH.meta.data.shells[id];
      return '<li>' + (own ? '☑ ' : '☐ ') + '<b>' + GH.mechById(id).name + '</b> — ' + GH.roster.FEATS[id].desc + '</li>';
    }).join('');
    var relics = GH.roster.relics.map(function (m) {
      var rc = GH.roster.recipes[m.id];
      var fp = GH.roster.featProgress(rc.feat);
      return '<li>' + (GH.meta.data.shells[m.id] ? '☑ ' : (fp.done ? '☑ ' : '☐ ')) + '<b>' + m.name + '</b> — ' + rc.feat.desc + ' (' + fp.have + '/' + fp.need + ')</li>';
    }).join('');
    document.getElementById('help-body').innerHTML =
      '<div class="hp-col">' +
      '<div class="hp-h">CONTROLS</div>' +
      '<ul><li><b>' + L('forward') + ' / ' + L('back') + '</b> walk forward / back · <b>' + L('turnLeft') + ' / ' + L('turnRight') + '</b> turn · <b>' + L('strafeLeft') + ' / ' + L('strafeRight') + '</b> strafe</li>' +
      '<li><b>Hold RIGHT MOUSE</b> and drag to look around; <b>WHEEL</b> zooms. <b>' + L('camera') + '</b> switches to the tactical top-down camera (mouse aims there).</li>' +
      '<li><b>LEFT CLICK</b> attacks and marks the hostile under the cursor as your target. <b>' + L('target') + '</b> cycles targets.</li>' +
      '<li><b>' + L('ability5') + '</b> casts your frame\'s SIGNATURE — one per lineage (SHIELD WALL, BARRAGE, POUNCE, SPELLSTORM, SHADOW STEP, HARVEST, RAIL CHARGE, SIEGE STANCE).</li>' +
      '<li><b>' + L('ability1') + '–' + L('ability4') + '</b> cast abilities (spend ENERGY). <b>' + L('ward1') + ' ' + L('ward2') + ' ' + L('ward3') + '</b> raise a ward matching the incoming damage.</li>' +
      '<li><b>' + L('boost') + '</b> dashes (hold to drift in skimmer form). <b>' + L('special') + '</b> fires your frame\'s special, or nitro when driving.</li>' +
      '<li><b>' + L('transform') + '</b> folds into the skimmer: ' + L('forward') + ' throttle, ' + L('back') + ' brake, ' + L('turnLeft') + '/' + L('turnRight') + ' steer.</li>' +
      '<li><b>' + L('interact') + '</b> uses gates, chests, camp stations. <b>ESC</b> pauses or closes any menu. Rebind everything under CONTROLS.</li></ul>' +
      '<div class="hp-h">GAME MODES</div>' +
      '<ul><li><b>THE SHATTERED REACH</b> — the open world. Your pilot, level and gear are saved automatically; EXIT keeps them, ABANDON deletes them.</li>' +
      '<li><b>THE GAUNTLET</b> — ' + GH.WAVES + ' assaults on one stage: a warden on the 8th, an OVERRUN on the 12th, and a REVENANT frame on the last. Bring it down to recover that frame (or its blueprint data) and open the next stage.</li>' +
      '<li><b>ARENA</b> — endless waves. <b>WEEKLY</b> — a fixed frame and modifiers shared by everyone that week.</li>' +
      '<li>EXIT RUN from the pause menu parks a GAUNTLET/ARENA run; CONTINUE RUN on the title resumes it at that wave.</li></ul>' +
      '<div class="hp-h">YOUR PILOT (ATTRIBUTES, ARTS, RUNES)</div>' +
      '<ul><li><b>Six attributes</b> — MIGHT, REACTOR, HULL, SERVO, COOLANT, UPLINK. They grow on their own every pilot level (a tenth of your lineage\'s starting spread), and every level also pays <b>one free point</b> to place where you like. RECALIBRATE in the hangar refunds them for salvage.</li>' +
      '<li><b>Combat Arts</b> — your four abilities and your signature. <b>ART RUNES</b> drop from every boss and sometimes from elites; reading one into an art raises its rank: +12% power, but +8% recharge. REACTOR shortens recharges again, so a rune-heavy build wants REACTOR.</li>' +
      '<li><b>UPLINK</b> raises loot find: more alloy, coin and rune drops.</li>' +
      '<li><b>QUEST JOURNAL</b> (' + L('journal') + ') — every open contract, daily task, diary tier, trial, season task and feat in one ledger.</li></ul>' +
      '<div class="hp-h">WHERE THINGS ARE</div>' +
      '<ul><li><b>HANGAR</b> — every progression screen: FRAME WORKSHOP (build frames), PILOT TRAINING (skill tree), ATTRIBUTES &amp; ARTS, QUEST JOURNAL, BROKER, COLLECTION LOG (artifacts), TRIALS, SEASON, HOUSES, SAVE CODE.</li>' +
      '<li><b>PILOT</b> — your character sheet and inventory: materials, artifact, cosmetics, frames owned.</li>' +
      '<li>In the Reach, the outpost stations (console, shrine, memorial, broker) open the same screens without leaving the world.</li></ul>' +
      '</div><div class="hp-col">' +
      '<div class="hp-h">UNLOCKING FRAMES (' + GH.roster.owned() + ' / ' + GH.roster.TOTAL + ')</div>' +
      '<ul><li><b>Starters</b>: AEGIS and VULCAN are yours from the first sortie.</li>' +
      '<li><b>Feat frames</b> (earned, never bought):<ul>' + feats + '</ul></li>' +
      '<li><b>Built frames</b>: the other ' + (GH.roster.TOTAL - 6) + ' are assembled in the FRAME WORKSHOP from ⬡ ALLOY, ◈ FRAME CORES and $ SALVAGE. Each lineage has five packs (AILE, SWORD, LAUNCHER, STORM, PHANTOM) in three marks — build MK.II before CUSTOM before PROTOTYPE.</li>' +
      '<li><b>Relic frames</b> need a feat first:<ul>' + relics + '</ul></li></ul>' +
      '<div class="hp-h">MATERIALS</div><ul>' +
      GH.roster.SOURCES.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' +
      '<div class="hp-h">LIVING IN THE REACH</div>' +
      '<ul><li><b>Zone diaries</b> (WORLD MAP): four task tiers per territory. Each tier pays alloy and cores; HARD and ELITE add a permanent perk in that zone.</li>' +
      '<li><b>Daily task board</b> (BROKER or PILOT): three tasks a day, claim each, sweep all three for a bonus core and a growing streak.</li>' +
      '<li><b>Alloy veins</b>: grey crystal clusters in every territory. Press ' + L('interact') + ' to mine. Danger III–IV veins can hold a frame core. They regrow daily.</li>' +
      '<li><b>Cache signals</b>: every few minutes a treasure site pings and is marked gold on the minimap. Worth the detour.</li>' +
      '<li><b>Hunts</b>: fifty named bosses, four or five per territory. One roams each territory per day at a skull totem (☠ on the minimap, listed on the WORLD MAP). Each has its own mechanics — WEAK POINT bosses take 2.5× from behind, SHIELDED ones drop their shield when their adds die, BURROWERS erupt under you. They pay cores and fill the BESTIARY in the COLLECTION LOG. ARENA and GAUNTLET midboss waves draw from the same pool.</li>' +
      '<li>Higher DANGER zones pay more alloy per drop, richer veins, and richer signals — Albion rules: risk buys reward.</li>' +
      '<li><b>Reach bands</b> (title screen or PILOT sheet): BRONZE → SILVER → GOLD → PLATINUM. Each band scales enemy hull and damage, spawns elites in the open world, and pays more alloy, salvage and cores per hunt. Bands unlock by slaying hunts, finishing diary tiers, pilot level and GAUNTLET clears — never bought.</li></ul>' +
      '<div class="hp-h">TIPS</div>' +
      '<ul><li>Elites always drop alloy. Farm ARENA for alloy; run the GAUNTLET to its last assault for cores and runes.</li>' +
      '<li>Sparks feed your persistent PILOT LEVEL — every level is a skill point for PILOT TRAINING and an attribute point for ATTRIBUTES &amp; ARTS.</li>' +
      '<li>Wards cut matched damage by 75%. Watch the colour of what is hitting you.</li>' +
      '<li>Your save lives in this browser. HANGAR → SAVE CODE exports it; paste it on another machine to restore.</li></ul>' +
      '</div>';
  }

  function bindUI() {
    var byId = function (id) { return document.getElementById(id); };
    // back buttons: the click AND the ESC key share one handler per screen
    var back = function (screen, btnId, fn) {
      backHandlers[screen] = fn;
      if (btnId && byId(btnId)) byId(btnId).onclick = function () { GH.audio.card(); fn(); };
    };

    GH.game.onInteract = function (kind) {
      if (kind === 'broker') { expEntry = 'broker'; openBroker(); }
      else if (kind === 'shrine') { expEntry = 'hangar'; openHangar(); }
      else if (kind === 'memorial') { expEntry = 'collection'; openCollection(); }
      else { expEntry = 'hub'; openHub(); }
    };
    byId('btn-expedition').onclick = startOrResumeExpedition;
    byId('btn-play-first').onclick = startTutorial;
    byId('btn-tutorial').onclick = startTutorial;
    byId('btn-skip-tutorial').onclick = function () {
      GH.game.skipTutorial();
      togglePause();
    };
    byId('btn-new-exp').onclick = newExpedition;
    byId('btn-band').onclick = cycleBand;
    byId('btn-continue').onclick = function () {
      GH.audio.wave();
      show(null);
      lastLaunch = null;
      if (!GH.game.resumeRun()) toTitle();
    };
    byId('btn-start').onclick = function () { enterSelect('classic'); };
    byId('btn-arena').onclick = function () { enterSelect('arena'); };
    byId('btn-weekly').onclick = openWeekly;
    byId('btn-hub').onclick = openHub;
    byId('btn-title-pilot').onclick = function () { openPilot(false, 'title'); };
    byId('btn-title-controls').onclick = openControls;
    byId('btn-title-help').onclick = openHelp;
    byId('btn-title-journal').onclick = function () { openJournal(false); };
    byId('btn-profile').onclick = cycleProfile;

    back('hub-screen', 'btn-hub-back', metaBack('hub', toTitle));
    back('season-screen', 'btn-season-back', openHub);
    back('map-screen', 'btn-map-back', metaBack('map', openHub));
    back('factions-screen', 'btn-fac-back', metaBack('factions', openHub));
    back('skills-screen', 'btn-skills-back', function () {
      if (expEntry === 'skills') resumeExpedition();
      else if (pilotReturn) { pilotReturn = false; openPilot(false); }
      else openHub();
    });
    byId('btn-respec').onclick = function () {
      if (GH.skills.respec()) {
        GH.audio.win();
        renderSkills();
      } else {
        GH.audio.hit();
      }
    };
    back('broker-screen', 'btn-broker-back', metaBack('broker', openHub));
    back('collection-screen', 'btn-collection-back', function () {
      if (expEntry === 'collection') resumeExpedition();
      else if (pilotReturn) { pilotReturn = false; openPilot(false); }
      else openHub();
    });
    back('trials-screen', 'btn-trials-back', openHub);
    back('hangar-screen', 'btn-hangar-back', function () {
      if (expEntry === 'hangar') resumeExpedition();
      else if (pilotReturn) { pilotReturn = false; openPilot(false); }
      else openHub();
    });
    back('save-screen', 'btn-save-back', openHub);
    back('journal-screen', 'btn-journal-back', function () {
      if (expEntry === 'journal') resumeExpedition();
      else if (pilotReturn) { pilotReturn = false; openPilot(false); }
      else if (journalFrom === 'title') toTitle();
      else openHub();
    });
    byId('btn-attr-reset').onclick = function () {
      confirmBox('RECALIBRATE ATTRIBUTES?', 'Every point you placed is refunded for ' + GH.attrs.RESET_COST + ' salvage. Auto-grown values are untouched.', 'RECALIBRATE', function () {
        if (GH.attrs.reset()) { GH.audio.win(); renderHangar(); if (GH.game.refreshPilot) GH.game.refreshPilot(); }
        else GH.audio.hit();
      });
    };
    back('workshop-screen', 'btn-ws-back', function () {
      if (expEntry === 'workshop') resumeExpedition();
      else if (workshopReturn === 'select') { workshopReturn = 'hub'; enterSelect(GH.game.mode); }
      else if (workshopReturn === 'pilot') { workshopReturn = 'hub'; openPilot(false); }
      else openHub();
    });
    back('pilot-screen', 'btn-pilot-back', function () {
      if (expEntry === 'pilot') resumeExpedition();
      else if (pilotFrom === 'hub') openHub();
      else toTitle();
    });
    back('controls-screen', 'btn-controls-back', function () {
      rebindWait = null;
      if (controlsFromPause) { controlsFromPause = false; show('pause-screen'); return; }
      if (expEntry === 'controls') resumeExpedition();
      else if (pilotReturn) { pilotReturn = false; openPilot(false); }
      else toTitle();
    });
    back('help-screen', 'btn-help-back', function () {
      if (GH.game.state === 'pause') { show('pause-screen'); return; }
      if (expEntry === 'help') resumeExpedition();
      else if (pilotReturn) { pilotReturn = false; openPilot(false); }
      else toTitle();
    });
    byId('btn-controls-reset').onclick = function () {
      GH.controls.reset();
      applySettings();
      GH.audio.card();
      renderControls();
    };
    byId('set-sens').oninput = function () {
      GH.controls.settings.sens = parseInt(this.value, 10) / 100;
      byId('set-sens-val').textContent = this.value + '%';
      GH.controls.save();
    };
    byId('set-invert').onchange = function () { GH.controls.settings.invertY = this.checked; GH.controls.save(); };
    byId('set-crt').onchange = function () { GH.controls.settings.crt = this.checked; GH.controls.save(); applySettings(); };
    byId('set-crt-level').onchange = function () { GH.controls.settings.crtLevel = this.value; GH.controls.save(); applySettings(); };
    byId('set-cam').onchange = function () { GH.game.setCamMode(this.value); };
    byId('set-music').oninput = function () {
      GH.controls.settings.music = parseInt(this.value, 10) / 100;
      byId('set-music-val').textContent = this.value + '%';
      GH.controls.save(); applySettings();
    };
    byId('set-sfx').oninput = function () {
      GH.controls.settings.sfx = parseInt(this.value, 10) / 100;
      byId('set-sfx-val').textContent = this.value + '%';
      GH.controls.save(); applySettings(); GH.audio.card();
    };
    byId('set-mute').onchange = function () {
      GH.audio.unlock();
      GH.audio.setMuted(this.checked);
      byId('mute-btn').classList.toggle('off', this.checked);
    };

    byId('btn-save-copy').onclick = function () {
      var ta = byId('save-export');
      ta.select();
      var ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ta.value);
          ok = true;
        } else {
          ok = document.execCommand('copy');
        }
      } catch (e) { /* fall through */ }
      byId('save-feedback').textContent =
        ok ? 'Copied — keep it somewhere safe.' : 'Select the code and copy it manually.';
      GH.audio.card();
    };
    byId('btn-save-file').onclick = function () {
      var text = GH.meta.exportBlob();
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'staalreus-save-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      byId('save-feedback').textContent = 'Save file downloaded — keep it somewhere safe.';
      GH.audio.card();
      refreshTitle();
    };
    byId('btn-load-file').onclick = function () { byId('save-file-input').click(); };
    byId('save-file-input').onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var res = GH.meta.importBlob(String(reader.result || ''));
        var fb = byId('save-feedback');
        if (res.ok) { GH.audio.win(); refreshTitle(); openSave(); byId('save-feedback').textContent = 'Restored ' + res.profiles + ' profile(s) from ' + (res.saved || 'file') + '.'; }
        else { fb.textContent = res.error; GH.audio.hit(); }
      };
      reader.readAsText(f);
      this.value = '';
    };
    byId('btn-save-import').onclick = function () {
      var res = GH.meta.importCode(byId('save-import').value);
      var fb = byId('save-feedback');
      if (res.ok) {
        fb.textContent = 'Restored ' + res.profiles + ' profile(s) from ' + (res.saved || 'save') + '.';
        GH.audio.win();
        refreshTitle();
        byId('save-export').value = GH.meta.exportCode();
      } else {
        fb.textContent = res.error;
        GH.audio.hit();
      }
    };
    back('weekly-screen', 'btn-weekly-back', toTitle);
    back('preset-screen', 'btn-preset-back', function () {
      GH.game.state = 'stageselect';
      renderStageList();
      show('stage-screen');
    });
    byId('btn-coop').onclick = function () {
      GH.game.coop = !GH.game.coop;
      GH.audio.card();
      byId('btn-coop').textContent =
        'CO-OP P2: ' + (GH.game.coop ? 'ON (IJKL + O boost + U special)' : 'OFF');
      renderP2Row();
    };
    byId('btn-launch').onclick = openStageSelect;
    byId('btn-select-workshop').onclick = function () { workshopReturn = 'select'; openWorkshop(); };
    back('select-screen', 'btn-select-back', toTitle);
    back('stage-screen', 'btn-stage-back', function () { enterSelect(GH.game.mode); });

    // pause menu
    byId('btn-resume').onclick = togglePause;
    byId('btn-pause-controls').onclick = openControls;
    byId('btn-pause-help').onclick = openHelp;
    byId('btn-exit-run').onclick = exitRun;
    byId('btn-new-run').onclick = function () { abandonRun(true); };
    byId('btn-quit').onclick = function () { abandonRun(false); };
    backHandlers['pause-screen'] = togglePause;

    // confirm box
    byId('btn-confirm-yes').onclick = function () { var fn = confirmYes; closeConfirm(); if (fn) fn(); };
    byId('btn-confirm-no').onclick = closeConfirm;

    byId('btn-retry').onclick = function () {
      if (lastLaunch) lastLaunch();
      else { show(null); launch(chosenStage); }
    };
    byId('btn-menu').onclick = toTitle;
    var muteBtn = byId('mute-btn');
    muteBtn.onclick = function () {
      GH.audio.unlock();
      GH.audio.setMuted(!GH.audio.isMuted());
      muteBtn.classList.toggle('off', GH.audio.isMuted());
    };
  }
  var pilotFrom = 'title';

  // ----------------------------------------------------------------
  var last = 0, playAcc = 0, backupAcc = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    if (GH.game.state === 'play' || GH.game.state === 'race') {
      playAcc += dt; backupAcc += dt;
      if (playAcc >= 60) { playAcc -= 60; GH.meta.data.playtimeMin = (GH.meta.data.playtimeMin || 0) + 1; }
      if (backupAcc >= 300) { backupAcc = 0; GH.meta.save(); GH.meta.backup('auto'); }
    }
    pollPads();
    if (touchCapable) {
      document.getElementById('touch-ui').classList.toggle('hidden',
        GH.game.state !== 'play' && GH.game.state !== 'race');
    }
    GH.game.update(dt, input, window.innerWidth, window.innerHeight);
    GH.crt.render(renderer, GH.game.scene(), GH.game.camera());
    wsTick(dt);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot);
  } else {
    boot(); // scripts injected after parse (e.g. single-file bundle hosts)
  }
})();
