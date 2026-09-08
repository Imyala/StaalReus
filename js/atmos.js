// STAALREUS — atmosphere: weather particles that live around the pilot.
// Snow over the frost range, rain under the canopy and on the highlands,
// rising embers over the cinder wastes, blown sand on the dune coast,
// drifting motes in the void. One Points (or LineSegments) cloud per
// zone, re-wrapped around the camera target every frame.
GH.atmos = (function () {
  var A = {};
  var cur = null; // {kind, obj, pos, vel, n, box}

  var KINDS = {
    // counts were 260 / 900 / 700 / 380 / 900 / 420: dense enough to veil
    // the view, and the bright rising embers read as a sky full of lanterns
    wreck: { kind: 'dust', n: 180, color: 0xe8d4a0, size: 0.2, opacity: 0.35, box: [70, 14, 70] },
    glacier: { kind: 'snow', n: 480, color: 0xffffff, size: 0.28, opacity: 0.7, box: [70, 30, 70] },
    cloister: { kind: 'rain', n: 460, color: 0xbfe8e0, opacity: 0.38, box: [60, 30, 60] },
    ember: { kind: 'ember', n: 140, color: 0xff8a3a, size: 0.18, opacity: 0.6, box: [70, 20, 70] },
    storm: { kind: 'rain', n: 560, color: 0xc8d0f0, opacity: 0.42, box: [70, 32, 70] },
    null: { kind: 'motes', n: 220, color: 0xc090ff, size: 0.24, opacity: 0.6, box: [70, 24, 70] }
  };

  function rnd(a, b) { return a + Math.random() * (b - a); }

  A.set = function (scene, zoneId, dungeon) {
    A.clear(scene);
    var st = GH.world.stageFor(zoneId);
    var def = KINDS[st.id];
    if (!def) return;
    var n = dungeon ? Math.floor(def.n * 0.35) : def.n;
    var box = def.box;
    var pos = new Float32Array(n * 3 * (def.kind === 'rain' ? 2 : 1));
    var vel = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var x = rnd(-box[0] / 2, box[0] / 2), y = rnd(0, box[1]), z = rnd(-box[2] / 2, box[2] / 2);
      if (def.kind === 'rain') {
        pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
        pos[i * 6 + 3] = x + 0.15; pos[i * 6 + 4] = y - 1.3; pos[i * 6 + 5] = z;
        vel[i * 3] = 1.5; vel[i * 3 + 1] = -rnd(26, 34); vel[i * 3 + 2] = 0;
      } else {
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        if (def.kind === 'snow') { vel[i * 3] = rnd(-1.2, 1.2); vel[i * 3 + 1] = -rnd(1.6, 3.2); vel[i * 3 + 2] = rnd(-0.8, 0.8); }
        else if (def.kind === 'ember') { vel[i * 3] = rnd(-0.8, 0.8); vel[i * 3 + 1] = rnd(1.2, 3.0); vel[i * 3 + 2] = rnd(-0.8, 0.8); }
        else if (def.kind === 'dust') { vel[i * 3] = rnd(6, 11); vel[i * 3 + 1] = rnd(-0.3, 0.3); vel[i * 3 + 2] = rnd(2, 4); }
        else { vel[i * 3] = rnd(-0.6, 0.6); vel[i * 3 + 1] = rnd(-0.4, 0.4); vel[i * 3 + 2] = rnd(-0.6, 0.6); }
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var obj;
    if (def.kind === 'rain') {
      obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: def.color, transparent: true, opacity: def.opacity, depthWrite: false
      }));
    } else {
      obj = new THREE.Points(geo, new THREE.PointsMaterial({
        color: def.color, size: def.size, transparent: true, opacity: def.opacity,
        depthWrite: false, sizeAttenuation: true
      }));
    }
    obj.frustumCulled = false;
    scene.add(obj);
    cur = { kind: def.kind, obj: obj, pos: pos, vel: vel, n: n, box: box, cx: 0, cz: 0, t: 0 };
  };

  A.update = function (dt, px, py, pz) {
    if (!cur) return;
    cur.t += dt;
    var b = cur.box, pos = cur.pos, vel = cur.vel;
    var hx = b[0] / 2, hz = b[2] / 2;
    var floor = py - 1, ceil = py + b[1];
    var gust = cur.kind === 'dust' ? Math.max(0, Math.sin(cur.t * 0.7)) * 8 : 0;
    var stride = cur.kind === 'rain' ? 6 : 3;
    for (var i = 0; i < cur.n; i++) {
      var o = i * stride;
      var x = pos[o] + (vel[i * 3] + gust) * dt;
      var y = pos[o + 1] + vel[i * 3 + 1] * dt;
      var z = pos[o + 2] + vel[i * 3 + 2] * dt;
      if (cur.kind === 'snow') { x += Math.sin(cur.t * 1.3 + i) * 0.6 * dt; }
      if (cur.kind === 'motes') { y += Math.sin(cur.t * 0.8 + i * 0.3) * 0.4 * dt; }
      // wrap around the pilot
      if (x < px - hx) x += b[0]; else if (x > px + hx) x -= b[0];
      if (z < pz - hz) z += b[2]; else if (z > pz + hz) z -= b[2];
      if (y < floor) y = ceil - (floor - y) % b[1];
      else if (y > ceil) y = floor + (y - ceil) % b[1];
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      if (cur.kind === 'rain') { pos[o + 3] = x + 0.15; pos[o + 4] = y - 1.3; pos[o + 5] = z; }
    }
    cur.obj.geometry.attributes.position.needsUpdate = true;
  };

  A.clear = function (scene) {
    if (cur) {
      scene.remove(cur.obj);
      cur.obj.geometry.dispose();
      cur.obj.material.dispose();
      cur = null;
    }
  };

  return A;
})();
