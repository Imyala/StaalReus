// STAALREUS — CRT post-process pass.
// The scene still renders at 1/3 resolution (PIXEL_SCALE), but into a texture
// instead of the canvas. A full-resolution quad then draws that texture through
// a CRT shader: gaussian scanlines whose beam fattens on bright pixels, an
// aperture-grille phosphor mask, a touch of halation glow, corner chromatic
// aberration, gentle barrel curvature and a vignette. Tuned after the
// "CRT Vibe" idea — sell the tube without wrecking colours or readability.
// If the shader can't compile the game falls back to the old CSS overlay.
GH.crt = (function () {
  var M = {};
  var enabled = false, failed = false, checked = false;
  var target = null, quadScene = null, quadCam = null, mat = null;

  var LEVELS = {
    // maskType 0: two-phase magenta/green grille (soft), 1: full RGB aperture grille
    // film: no tube at all — a soft halation glow, a colour grade (lifted
    // contrast, richer saturation, warm lights / cool shadows) and a vignette
    film: { curve: 0, scan: 0, mask: 0, maskType: 0, glow: 0.16, aberr: 0, vig: 0.26, grade: 1 },
    subtle: { curve: 0.025, scan: 0.40, mask: 0.12, maskType: 0, glow: 0.05, aberr: 0.10, vig: 0.08 },
    strong: { curve: 0.06, scan: 0.80, mask: 0.35, maskType: 1, glow: 0.20, aberr: 0.60, vig: 0.16 }
  };
  var level = 'film';

  var uniforms = {
    tDiffuse: { value: null },
    uSrc: { value: new THREE.Vector2(320, 180) },   // low-res scene texture size
    uOut: { value: new THREE.Vector2(960, 540) },   // canvas size
    uCurve: { value: 0 }, uScan: { value: 0 }, uMask: { value: 0 },
    uGlow: { value: 0 }, uAberr: { value: 0 }, uVig: { value: 0 },
    uMaskType: { value: 0 }, uGain: { value: 1 }, uGrade: { value: 0 }
  };

  var VERT = [
    'varying vec2 vUv;',
    'void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
  ].join('\n');

  var FRAG = [
    'uniform sampler2D tDiffuse;',
    'uniform vec2 uSrc;',
    'uniform vec2 uOut;',
    'uniform float uCurve, uScan, uMask, uGlow, uAberr, uVig, uMaskType, uGain, uGrade;',
    'varying vec2 vUv;',
    '',
    // barrel distortion: the picture bows outward the way glass tubes do
    'vec2 warp(vec2 uv) {',
    '  uv = uv * 2.0 - 1.0;',
    '  vec2 o = abs(uv.yx) * vec2(uCurve, uCurve * 1.3);',
    '  uv += uv * o * o;',
    '  return uv * 0.5 + 0.5;',
    '}',
    '',
    // one source texel, point-sampled: the low-res pixels stay razor sharp
    'vec3 tap(float x, float rowV) {',
    '  return texture2D(tDiffuse, vec2((floor(x) + 0.5) / uSrc.x, rowV)).rgb;',
    '}',
    '',
    // colour fringing that grows toward the edges of the tube
    'vec3 rowRGB(float x, float row, float ab) {',
    '  float rowV = (row + 0.5) / uSrc.y;',
    '  vec3 c = tap(x, rowV);',
    '  if (ab != 0.0) {',
    '    c.r = tap(x - ab, rowV).r;',
    '    c.b = tap(x + ab, rowV).b;',
    '  }',
    '  return c;',
    '}',
    '',
    'float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }',
    '',
    // beam profile: gaussian falloff from the row centre (d = 0) to the row
    // boundary (d = 0.5), fatter for bright pixels so highlights stay bright
    // and dark areas get the deepest gaps. Only the nearest row is drawn, so
    // vertical edges stay as hard as the horizontal ones.
    'float beam(float d, float l) {',
    '  float w = mix(0.24, 0.36, l);',
    '  float g = exp(-d * d / (2.0 * w * w));',
    '  return mix(1.0, g, uScan);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = warp(vUv);',
    '  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));',
    '  if (inside.x * inside.y < 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }',
    '',
    '  float px = uv.x * uSrc.x;',
    '  float ab = uAberr * (uv.x - 0.5) * 2.0;',
    '  float py = uv.y * uSrc.y;',
    '  float d = abs(fract(py) - 0.5);',
    '  vec3 c = rowRGB(px, floor(py), ab);',
    '  vec3 col = c * beam(d, luma(c));',
    '',
    // halation: bright pixels bleed a soft glow into their neighbours
    '  vec2 t = 1.5 / uSrc;',
    '  vec3 blur = texture2D(tDiffuse, uv + vec2( t.x,  t.y)).rgb',
    '            + texture2D(tDiffuse, uv + vec2(-t.x,  t.y)).rgb',
    '            + texture2D(tDiffuse, uv + vec2( t.x, -t.y)).rgb',
    '            + texture2D(tDiffuse, uv + vec2(-t.x, -t.y)).rgb;',
    '  blur *= 0.25;',
    '  col += blur * blur * uGlow;',
    '',
    // phosphor grille: every canvas pixel column favours some phosphors
    '  vec3 mask = vec3(1.0 - uMask);',
    '  if (uMaskType < 0.5) {',
    '    float m = mod(floor(gl_FragCoord.x), 2.0);',
    '    if (m < 0.5) { mask.r = 1.0; mask.b = 1.0; } else mask.g = 1.0;',
    '  } else {',
    '    float m = mod(floor(gl_FragCoord.x), 3.0);',
    '    if (m < 0.5) mask.r = 1.0; else if (m < 1.5) mask.g = 1.0; else mask.b = 1.0;',
    '  }',
    '  col *= mask;',
    '',
    // the film grade: a touch more contrast and saturation, highlights
    // pushed warm and shadows cool, a soft roll-off so bright steel and
    // muzzle flashes bloom instead of clipping
    '  if (uGrade > 0.0) {',
    '    float l = luma(col);',
    '    col = mix(vec3(l), col, 1.0 + 0.22 * uGrade);',
    '    col = (col - 0.5) * (1.0 + 0.14 * uGrade) + 0.5;',
    '    col += (l - 0.45) * vec3(0.05, 0.01, -0.06) * uGrade;',
    '    col = max(col, 0.0);',
    '    col = col / (1.0 + col * 0.12 * uGrade) * (1.0 + 0.12 * uGrade);',
    '  }',
    '',
    // give back what the gaps and mask took, then darken the corners
    '  col *= uGain;',
    '  float v = 16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);',
    '  col *= pow(clamp(v, 0.0, 1.0), uVig);',
    '  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));',
    '  col *= smoothstep(0.0, 0.004, edge);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function ensure() {
    if (target) return;
    target = new THREE.WebGLRenderTarget(uniforms.uSrc.value.x, uniforms.uSrc.value.y, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false
    });
    uniforms.tDiffuse.value = target.texture;
    mat = new THREE.ShaderMaterial({
      uniforms: uniforms, vertexShader: VERT, fragmentShader: FRAG,
      depthTest: false, depthWrite: false
    });
    quadScene = new THREE.Scene();
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    applyLevel();
  }

  function applyLevel() {
    var L = LEVELS[level] || LEVELS.subtle;
    uniforms.uCurve.value = L.curve; uniforms.uScan.value = L.scan; uniforms.uMask.value = L.mask;
    uniforms.uGlow.value = L.glow; uniforms.uAberr.value = L.aberr; uniforms.uVig.value = L.vig;
    uniforms.uMaskType.value = L.maskType;
    uniforms.uGrade.value = L.grade || 0;
    // gain roughly restores mid-tone brightness lost to the gaps and the mask,
    // held a little under 1:1 so highlights keep their contrast
    var scanAvg = 1.0 - 0.32 * L.scan;
    var maskAvg = L.maskType ? 1.0 - L.mask * 2 / 3 : 1.0 - L.mask / 2;
    uniforms.uGain.value = 0.92 / (scanAvg * maskAvg);
  }

  // true when the shader pass (rather than the CSS overlay) will be used
  M.setEnabled = function (on) { enabled = !!on && !failed; return enabled; };
  M.active = function () { return enabled; };
  M.failed = function () { return failed; };
  M.setLevel = function (name) { level = LEVELS[name] ? name : 'film'; if (mat) applyLevel(); };
  M.levels = function () { return Object.keys(LEVELS); };

  // rw/rh: the low-res scene size, w/h: the canvas size
  M.resize = function (rw, rh, w, h) {
    ensure();
    target.setSize(rw, rh);
    uniforms.uSrc.value.set(rw, rh);
    uniforms.uOut.value.set(w, h);
  };

  M.render = function (renderer, scene, camera) {
    if (!enabled) { renderer.render(scene, camera); return; }
    try {
      ensure();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCam);
      if (!checked) {
        checked = true;
        // a shader that failed to compile renders nothing: detect it once and
        // hand the job back to the CSS overlay
        var progs = renderer.info.programs || [];
        for (var i = 0; i < progs.length; i++) {
          var d = progs[i].diagnostics;
          if (d && d.runnable === false) throw new Error('CRT shader failed to compile');
        }
      }
    } catch (e) {
      console.warn('CRT shader disabled:', e);
      failed = true; enabled = false;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      if (M.onFail) M.onFail();
    }
  };

  return M;
})();
