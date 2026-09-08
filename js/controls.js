// STAALREUS — key bindings and control settings.
// MMO-style defaults: W/S walk, A/D turn, Q/E strafe, hold RIGHT MOUSE to
// look around, wheel to zoom. Every action can be rebound on the
// CONTROLS screen; bindings persist in localStorage independent of the
// pilot profile.
GH.controls = (function () {
  var C = {};

  C.ACTIONS = [
    { id: 'forward', name: 'Move forward', def: 'KeyW', group: 'MOVEMENT' },
    { id: 'back', name: 'Move backward', def: 'KeyS', group: 'MOVEMENT' },
    { id: 'turnLeft', name: 'Turn left', def: 'KeyA', group: 'MOVEMENT' },
    { id: 'turnRight', name: 'Turn right', def: 'KeyD', group: 'MOVEMENT' },
    { id: 'strafeLeft', name: 'Strafe left', def: 'KeyQ', group: 'MOVEMENT' },
    { id: 'strafeRight', name: 'Strafe right', def: 'KeyE', group: 'MOVEMENT' },
    { id: 'boost', name: 'Boost dash / drift (hold)', def: 'Space', group: 'MOVEMENT' },
    { id: 'transform', name: 'Transform (frame ⇄ skimmer)', def: 'KeyT', group: 'MOVEMENT' },
    { id: 'special', name: 'Frame special / nitro', def: 'ShiftLeft', group: 'COMBAT' },
    { id: 'target', name: 'Cycle target', def: 'Tab', group: 'COMBAT' },
    { id: 'ability1', name: 'Ability 1 — RUPTURE', def: 'Digit1', group: 'COMBAT' },
    { id: 'ability2', name: 'Ability 2 — SWEEP', def: 'Digit2', group: 'COMBAT' },
    { id: 'ability3', name: 'Ability 3 — SHACKLE', def: 'Digit3', group: 'COMBAT' },
    { id: 'ability4', name: 'Ability 4 — OVERLOAD', def: 'Digit4', group: 'COMBAT' },
    { id: 'ability5', name: 'Signature ability (per frame)', def: 'Digit5', group: 'COMBAT' },
    { id: 'ward1', name: 'Ward — KINETIC', def: 'KeyZ', group: 'COMBAT' },
    { id: 'ward2', name: 'Ward — BALLISTIC', def: 'KeyX', group: 'COMBAT' },
    { id: 'ward3', name: 'Ward — ARC', def: 'KeyC', group: 'COMBAT' },
    { id: 'wardCycle', name: 'Cycle ward', def: 'KeyR', group: 'COMBAT' },
    { id: 'interact', name: 'Interact / use', def: 'KeyF', group: 'WORLD' },
    { id: 'item', name: 'Use race item', def: 'KeyG', group: 'WORLD' },
    { id: 'camera', name: 'Toggle camera (chase / tactical)', def: 'KeyV', group: 'WORLD' },
    { id: 'skills', name: 'Pilot training (skill tree)', def: 'KeyK', group: 'MENUS' },
    { id: 'map', name: 'World map', def: 'KeyM', group: 'MENUS' },
    { id: 'pilot', name: 'Pilot sheet (character)', def: 'KeyP', group: 'MENUS' },
    { id: 'journal', name: 'Quest journal', def: 'KeyJ', group: 'MENUS' },
    { id: 'pause', name: 'Pause (ESC always works)', def: 'Backquote', group: 'MENUS' },
    { id: 'crt', name: 'Toggle CRT filter', def: 'KeyH', group: 'MENUS' }
  ];

  // arrow keys always mirror the four walk/turn actions unless the
  // player has bound them to something else
  var ARROW_ALIASES = { ArrowUp: 'forward', ArrowDown: 'back', ArrowLeft: 'turnLeft', ArrowRight: 'turnRight' };

  C.binds = {};
  // look: the post-process default. 2 = the FILM grade (glow, vignette,
  // colour grade, no scanlines) that replaced the CRT-by-default look.
  C.settings = { sens: 1.0, invertY: false, crt: true, crtLevel: 'film', mouseTurn: true, music: 1.0, sfx: 1.0, look: 2 };

  var STORE_KEY = 'hf_controls_v1';

  C.load = function () {
    C.ACTIONS.forEach(function (a) { C.binds[a.id] = a.def; });
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d.binds) for (var k in d.binds) if (C.binds[k] !== undefined) C.binds[k] = d.binds[k];
        if (d.settings) for (var s in d.settings) if (C.settings[s] !== undefined) C.settings[s] = d.settings[s];
        // profiles saved before the FILM look move onto it once; anyone who
        // wants the tube back picks Subtle or Strong under CONTROLS
        if (!d.settings || !d.settings.look || d.settings.look < 2) {
          C.settings.crt = true; C.settings.crtLevel = 'film'; C.settings.look = 2;
        }
      }
    } catch (e) { /* storage unavailable */ }
  };

  C.save = function () {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ binds: C.binds, settings: C.settings })); }
    catch (e) { /* ignore */ }
  };

  C.reset = function () {
    C.ACTIONS.forEach(function (a) { C.binds[a.id] = a.def; });
    C.settings = { sens: 1.0, invertY: false, crt: true, crtLevel: 'film', mouseTurn: true, music: 1.0, sfx: 1.0, look: 2 };
    C.save();
  };

  C.code = function (id) { return C.binds[id]; };

  // every action a physical key currently triggers
  C.actionsFor = function (code) {
    var out = [];
    for (var id in C.binds) if (C.binds[id] === code) out.push(id);
    if (!out.length && ARROW_ALIASES[code]) out.push(ARROW_ALIASES[code]);
    return out;
  };

  C.is = function (code, id) { return C.actionsFor(code).indexOf(id) !== -1; };

  // rebinding: a key already used elsewhere is taken from that action
  // (the old action falls back to unbound) so no key ever fires twice
  C.rebind = function (id, code) {
    if (!code || code === 'Escape') return false;
    for (var k in C.binds) if (k !== id && C.binds[k] === code) C.binds[k] = null;
    C.binds[id] = code;
    C.save();
    return true;
  };

  var NAMES = {
    Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT', AltRight: 'R-ALT', Tab: 'TAB', Escape: 'ESC', Enter: 'ENTER', Backquote: '`',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'BKSP', CapsLock: 'CAPS',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',',
    Period: '.', Slash: '/', Backslash: '\\', Delete: 'DEL', Insert: 'INS', Home: 'HOME', End: 'END',
    PageUp: 'PGUP', PageDown: 'PGDN', Mouse1: 'MOUSE 3', Mouse3: 'MOUSE 4', Mouse4: 'MOUSE 5'
  };

  C.keyLabel = function (code) {
    if (!code) return '—';
    if (NAMES[code]) return NAMES[code];
    if (code.indexOf('Key') === 0 && code.length === 4) return code.slice(3);
    if (code.indexOf('Digit') === 0) return code.slice(5);
    if (code.indexOf('Numpad') === 0) return 'NUM ' + code.slice(6);
    if (code.indexOf('F') === 0 && code.length <= 3) return code;
    return code.toUpperCase();
  };

  C.label = function (id) { return C.keyLabel(C.binds[id]); };

  // one-line control summary for the title / help screens
  C.summary = function () {
    var L = C.label;
    return L('forward') + '/' + L('back') + ' walk · ' + L('turnLeft') + '/' + L('turnRight') + ' turn · ' +
      L('strafeLeft') + '/' + L('strafeRight') + ' strafe · RIGHT-MOUSE drag looks · WHEEL zooms · ' +
      'LEFT-CLICK attack / target · ' + L('target') + ' cycle target · ' +
      L('ability1') + '–' + L('ability4') + ' abilities · ' + L('ward1') + ' ' + L('ward2') + ' ' + L('ward3') + ' wards · ' +
      L('boost') + ' boost / drift · ' + L('special') + ' special / nitro · ' + L('transform') + ' transform · ' +
      L('interact') + ' interact · ' + L('camera') + ' camera · ' + L('skills') + ' training · ' + L('map') + ' map · ' + L('journal') + ' journal · ESC menu';
  };

  C.load();
  return C;
})();
