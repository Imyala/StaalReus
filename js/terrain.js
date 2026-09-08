// STAALREUS — terrain: height fields, biomes, surfaces, and the map rim.
// Every zone owns an analytic height function h(x,z) built from seeded
// value noise plus biome shaping (dune ridges, mountain ranges, terraced
// mesas, lava basins). The same function drives the ground mesh, every
// entity's y, vehicle physics (slope, soft sand, jumps), and surface
// queries (ice / water / lava / mud). Fixed installations sit on flat
// pads blended into the field, and a mountain rim seals every map edge
// so the world never ends at a visible line.
GH.terrain = (function () {
  var T = {};
  T.active = null;

  // ---------------- seeded value noise ----------------
  function hash2(ix, iz, seed) {
    var n = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n = n ^ (n >>> 16);
    return (n & 0x7fffffff) / 0x7fffffff;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function vnoise(x, z, seed) {
    var ix = Math.floor(x), iz = Math.floor(z);
    var fx = smooth(x - ix), fz = smooth(z - iz);
    var a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
    var c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
  }
  // fractal noise in [0,1]
  function fbm(x, z, seed, oct) {
    var v = 0, amp = 0.5, sum = 0;
    for (var i = 0; i < (oct || 4); i++) {
      v += vnoise(x, z, seed + i * 17) * amp;
      sum += amp;
      x *= 2.03; z *= 1.97; amp *= 0.5;
    }
    return v / sum;
  }
  // ridged noise in [0,1]: sharp crests
  function ridged(x, z, seed, oct) {
    var v = 0, amp = 0.5, sum = 0;
    for (var i = 0; i < (oct || 3); i++) {
      var n = 1 - Math.abs(vnoise(x, z, seed + i * 23) * 2 - 1);
      v += n * n * amp;
      sum += amp;
      x *= 2.1; z *= 2.1; amp *= 0.5;
    }
    return v / sum;
  }
  function sstep(a, b, t) {
    t = GH.clamp((t - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  T.noise = fbm;
  T.ridged = ridged;
  T.sstep = sstep;

  // ---------------- colliders ----------------
  // Trees, walls and buildings are solid. Circles {x,z,r} and axis-aligned
  // rects {x,z,hw,hd} live in a coarse spatial hash; resolve() pushes a
  // moving disc out of everything in the neighbouring cells.
  var CELL = 12;
  var colliders = { map: {}, count: 0 };
  function ckey(cx, cz) { return cx + ',' + cz; }
  T.clearColliders = function () { colliders = { map: {}, count: 0 }; };
  T.addCollider = function (c) {
    var minX = Math.floor((c.x - (c.r || c.hw)) / CELL), maxX = Math.floor((c.x + (c.r || c.hw)) / CELL);
    var minZ = Math.floor((c.z - (c.r || c.hd)) / CELL), maxZ = Math.floor((c.z + (c.r || c.hd)) / CELL);
    for (var cx = minX; cx <= maxX; cx++) {
      for (var cz = minZ; cz <= maxZ; cz++) {
        var k = ckey(cx, cz);
        (colliders.map[k] || (colliders.map[k] = [])).push(c);
      }
    }
    colliders.count++;
  };
  T.colliderCount = function () { return colliders.count; };
  var resOut = { x: 0, z: 0, hit: false };
  T.resolve = function (x, z, r) {
    resOut.x = x; resOut.z = z; resOut.hit = false;
    if (!colliders.count) return resOut;
    var cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (var ix = cx - 1; ix <= cx + 1; ix++) {
      for (var iz = cz - 1; iz <= cz + 1; iz++) {
        var list = colliders.map[ckey(ix, iz)];
        if (!list) continue;
        for (var i = 0; i < list.length; i++) {
          var c = list[i];
          if (c.r !== undefined) {
            var dx = resOut.x - c.x, dz = resOut.z - c.z;
            var d2 = dx * dx + dz * dz, minD = c.r + r;
            if (d2 < minD * minD) {
              var d = Math.sqrt(d2);
              if (d < 0.001) { dx = 1; dz = 0; d = 1; } // dead centre: pick a way out
              resOut.x = c.x + dx / d * minD; resOut.z = c.z + dz / d * minD; resOut.hit = true;
            }
          } else {
            // rect: push out along the shallowest axis
            var ox = resOut.x - c.x, oz = resOut.z - c.z;
            var px = c.hw + r - Math.abs(ox), pz = c.hd + r - Math.abs(oz);
            if (px > 0 && pz > 0) {
              if (px < pz) resOut.x = c.x + (ox < 0 ? -1 : 1) * (c.hw + r);
              else resOut.z = c.z + (oz < 0 ? -1 : 1) * (c.hd + r);
              resOut.hit = true;
            }
          }
        }
      }
    }
    return resOut;
  };
  T.blockedAt = function (x, z, r) {
    var o = T.resolve(x, z, r);
    return o.hit;
  };

  // ---------------- biomes ----------------
  // base(x,z): raw height before pads/rim. color(h, slope, x, z, out).
  // soft(x,z): 0..1 bog-ability of the ground under a vehicle.
  // surface(x,z,h): 'ice' | 'water' | 'lava' | 'mud' | 'sand' | 'snow' | 'rock' | null
  T.BIOMES = {
    wreck: {
      name: 'DUNE COAST', ground: 'sand', gravity: 24,
      water: { level: -1.9, color: 0x2a7a8a, opacity: 0.72 },
      base: function (x, z) {
        var broad = fbm(x * 0.012, z * 0.012, 11) * 3.2;
        // dune field: ridges running NE, warped by low noise
        var u = x * 0.8 + z * 0.6, v = -x * 0.6 + z * 0.8;
        var warp = fbm(v * 0.02, u * 0.01, 12) * 2.5;
        var d = 1 - Math.abs(Math.sin(u * 0.11 + warp));
        d = Math.pow(d, 1.7) * (3.2 + fbm(x * 0.03, z * 0.03, 13) * 2.2);
        // the dune field thins toward the beach in the south
        var beach = sstep(150, 215, z);
        var h = broad + d * (1 - beach * 0.85);
        h -= sstep(195, 245, z) * 6.5;
        return h;
      },
      soft: function (x, z) { return 1; },
      color: function (h, s, x, z, o) {
        var n = fbm(x * 0.08, z * 0.08, 14);
        var t = GH.clamp((h + 1) / 8, 0, 1);
        o[0] = 0.78 + t * 0.14 + n * 0.06 - s * 0.35;
        o[1] = 0.66 + t * 0.12 + n * 0.05 - s * 0.3;
        o[2] = 0.42 + t * 0.10 + n * 0.02 - s * 0.2;
        if (h < -0.6) { var w = sstep(-0.6, -1.8, h); o[0] -= w * 0.25; o[1] -= w * 0.12; o[2] += w * 0.02; }
      },
      surface: function (x, z, h) { return h < -1.7 ? 'water' : 'sand'; }
    },
    glacier: {
      name: 'FROST RANGE', ground: 'snow', gravity: 24,
      base: function (x, z) {
        var roll = fbm(x * 0.02, z * 0.02, 21) * 4.0;
        var mask = sstep(0.42, 0.7, fbm(x * 0.006 + 7, z * 0.006, 22));
        var peaks = Math.pow(ridged(x * 0.009, z * 0.009, 23), 2.2) * 16 * mask;
        // frozen lakes: flat sheets sunk into the valleys
        var lake = sstep(0.62, 0.7, fbm(x * 0.03, z * 0.03, 24));
        var h = roll + peaks;
        h = h * (1 - lake) + Math.min(h, 0.6) * lake;
        return h;
      },
      soft: function (x, z) { return 0.8; },
      color: function (h, s, x, z, o) {
        var n = fbm(x * 0.1, z * 0.1, 25);
        var rock = sstep(0.35, 0.75, s);
        var ice = sstep(0.62, 0.7, fbm(x * 0.03, z * 0.03, 24)) * (h < 1.2 ? 1 : 0);
        o[0] = 0.74 + n * 0.1; o[1] = 0.8 + n * 0.08; o[2] = 0.9;
        o[0] = o[0] * (1 - rock) + 0.36 * rock; o[1] = o[1] * (1 - rock) + 0.38 * rock; o[2] = o[2] * (1 - rock) + 0.44 * rock;
        o[0] = o[0] * (1 - ice) + 0.68 * ice; o[1] = o[1] * (1 - ice) + 0.82 * ice; o[2] = o[2] * (1 - ice) + 0.9 * ice;
      },
      surface: function (x, z, h) {
        if (h < 1.2 && fbm(x * 0.03, z * 0.03, 24) > 0.66) return 'ice';
        return 'snow';
      }
    },
    cloister: {
      name: 'RAIN CANOPY', ground: 'moss', gravity: 24,
      water: { level: 0.15, color: 0x1e5a4a, opacity: 0.78 },
      base: function (x, z) {
        var h = fbm(x * 0.018, z * 0.018, 31) * 6 + 1.2;
        var hills = Math.pow(fbm(x * 0.01 + 3, z * 0.01, 32), 2) * 7;
        // river basins and ponds
        var pond = fbm(x * 0.016 + 5, z * 0.016 + 5, 33);
        h += hills - sstep(0.36, 0.26, pond) * 4.5;
        return h;
      },
      soft: function (x, z) { return 0.3; },
      color: function (h, s, x, z, o) {
        var n = fbm(x * 0.12, z * 0.12, 34);
        var mud = sstep(1.0, 0.2, h);
        o[0] = 0.22 + n * 0.12 + mud * 0.18; o[1] = 0.46 + n * 0.16 - mud * 0.16; o[2] = 0.16 + n * 0.06;
        var rock = sstep(0.45, 0.8, s);
        o[0] = o[0] * (1 - rock) + 0.34 * rock; o[1] = o[1] * (1 - rock) + 0.33 * rock; o[2] = o[2] * (1 - rock) + 0.28 * rock;
      },
      surface: function (x, z, h) { return h < 0.0 ? 'water' : h < 0.9 ? 'mud' : 'moss'; }
    },
    ember: {
      name: 'CINDER WASTES', ground: 'basalt', gravity: 24,
      water: { level: -0.55, color: 0xff5a10, opacity: 0.95, lava: true },
      base: function (x, z) {
        var h = fbm(x * 0.02, z * 0.02, 41) * 2.6;
        var cones = Math.pow(ridged(x * 0.012, z * 0.012, 42), 3) * 12 * sstep(0.5, 0.75, fbm(x * 0.007 + 2, z * 0.007, 43));
        var basin = fbm(x * 0.02 + 9, z * 0.02, 44);
        h += cones - sstep(0.34, 0.24, basin) * 2.6;
        return h;
      },
      soft: function (x, z) { return 0.15; },
      color: function (h, s, x, z, o) {
        var n = fbm(x * 0.1, z * 0.1, 45);
        o[0] = 0.34 + n * 0.1; o[1] = 0.22 + n * 0.06; o[2] = 0.19 + n * 0.05;
        var glow = sstep(0.3, -0.4, h);
        o[0] += glow * 0.7; o[1] += glow * 0.3;
        var ash = sstep(0.3, 0.7, s);
        o[0] = o[0] * (1 - ash) + 0.38 * ash; o[1] = o[1] * (1 - ash) + 0.3 * ash; o[2] = o[2] * (1 - ash) + 0.28 * ash;
      },
      surface: function (x, z, h) { return h < -0.45 ? 'lava' : 'basalt'; }
    },
    storm: {
      name: 'THUNDER HIGHLANDS', ground: 'slate', gravity: 24,
      base: function (x, z) {
        var q = fbm(x * 0.011, z * 0.011, 51) * 5.2;
        var f = q - Math.floor(q);
        var terr = (Math.floor(q) + sstep(0.3, 0.7, f)) * 2.6; // mesas
        var detail = fbm(x * 0.05, z * 0.05, 52) * 0.8;
        return terr + detail - 2;
      },
      soft: function (x, z) { return 0.1; },
      color: function (h, s, x, z, o) {
        var n = fbm(x * 0.09, z * 0.09, 53);
        var heath = sstep(0.3, 0.05, s) * sstep(0.45, 0.6, fbm(x * 0.04, z * 0.04, 54));
        o[0] = 0.36 + n * 0.08; o[1] = 0.38 + n * 0.08; o[2] = 0.46 + n * 0.06;
        o[0] = o[0] * (1 - heath) + 0.42 * heath; o[1] = o[1] * (1 - heath) + 0.32 * heath; o[2] = o[2] * (1 - heath) + 0.5 * heath;
      },
      surface: function (x, z, h) { return 'slate'; }
    },
    null: {
      name: 'VOID SANCTUM', ground: 'void', gravity: 11,
      base: function (x, z) {
        var h = fbm(x * 0.02, z * 0.02, 61) * 1.4;
        var shards = Math.pow(ridged(x * 0.02, z * 0.02, 62), 4) * 9 * sstep(0.55, 0.8, fbm(x * 0.01 + 4, z * 0.01, 63));
        var chasm = sstep(0.24, 0.16, fbm(x * 0.014 + 1, z * 0.014 + 8, 64)) * 5;
        return h + shards - chasm;
      },
      soft: function (x, z) { return 0; },
      color: function (h, s, x, z, o) {
        var n = fbm(x * 0.15, z * 0.15, 65);
        var deep = sstep(0, -3, h);
        o[0] = 0.5 + n * 0.1 - deep * 0.3; o[1] = 0.46 + n * 0.1 - deep * 0.35; o[2] = 0.56 + n * 0.1 - deep * 0.1;
        var glow = sstep(0.4, 0.9, s);
        o[0] += glow * 0.25; o[2] += glow * 0.35;
      },
      surface: function (x, z, h) { return 'void'; }
    }
  };

  // ---------------- built territories ----------------
  // These zones are made of structures as much as ground: a hive city on
  // a plateau, a walled keep with a moat, drowned ruins, cave warrens cut
  // into solid rock, and islands hanging in the sky. Each biome's macro()
  // lays the big shapes (districts, caverns, islands) from the zone seed
  // so the field, the buildings and the AI all agree on them.
  function zrng(seedStr) {
    var s0 = 0;
    for (var i = 0; i < seedStr.length; i++) s0 = (Math.imul(s0, 31) + seedStr.charCodeAt(i)) >>> 0;
    s0 = s0 || 1;
    return function () { s0 ^= s0 << 13; s0 >>>= 0; s0 ^= s0 >> 17; s0 ^= s0 << 5; s0 >>>= 0; return s0 / 4294967296; };
  }
  T.zrng = zrng;
  function segDist2(px, pz, x1, z1, x2, z2) {
    var vx = x2 - x1, vz = z2 - z1, wx = px - x1, wz = pz - z1;
    var c2 = vx * vx + vz * vz || 1;
    var t = GH.clamp((vx * wx + vz * wz) / c2, 0, 1);
    return GH.dist2(px, pz, x1 + vx * t, z1 + vz * t);
  }
  T.segDist2 = segDist2;

  T.BIOMES.hive = {
    name: 'SPIRE HIVE', ground: 'slate', gravity: 24, built: true,
    macro: function (size, rnd, lay) { return { spire: { x: 0, z: 0, r: 52 } }; },
    base: function (x, z, m) {
      var h = 1.5 + fbm(x * 0.03, z * 0.03, 71) * 0.7;
      // the central district climbs toward the spire in terraces
      var d = Math.sqrt(x * x + z * z);
      h += sstep(160, 60, d) * 6 + sstep(80, 40, d) * 5;
      return h;
    },
    soft: function () { return 0; },
    color: function (h, s, x, z, o) {
      var n = fbm(x * 0.2, z * 0.2, 72);
      o[0] = 0.3 + n * 0.08; o[1] = 0.3 + n * 0.08; o[2] = 0.34 + n * 0.08;
      var grime = sstep(0.5, 0.75, fbm(x * 0.04, z * 0.04, 73));
      o[0] -= grime * 0.1; o[1] -= grime * 0.08; o[2] -= grime * 0.08;
    },
    surface: function () { return 'slate'; }
  };
  T.BIOMES.ruins = {
    name: 'FALLEN CITADEL', ground: 'moss', gravity: 24, built: true,
    water: { level: -0.4, color: 0x2a4a48, opacity: 0.7 },
    macro: function (size, rnd, lay) { return {}; },
    base: function (x, z) {
      var h = fbm(x * 0.02, z * 0.02, 81) * 4.5 + 0.8;
      var lake = fbm(x * 0.014 + 2, z * 0.014, 82);
      h -= sstep(0.34, 0.26, lake) * 3.2;
      return h;
    },
    soft: function () { return 0.2; },
    color: function (h, s, x, z, o) {
      var n = fbm(x * 0.12, z * 0.12, 83);
      var stone = sstep(0.55, 0.7, fbm(x * 0.05, z * 0.05, 84));
      o[0] = 0.3 + n * 0.1; o[1] = 0.42 + n * 0.12; o[2] = 0.24 + n * 0.06;
      o[0] = o[0] * (1 - stone) + 0.5 * stone; o[1] = o[1] * (1 - stone) + 0.48 * stone; o[2] = o[2] * (1 - stone) + 0.44 * stone;
      var mud = sstep(0.6, -0.2, h); o[0] += mud * 0.1; o[1] -= mud * 0.12;
    },
    surface: function (x, z, h) { return h < -0.6 ? 'water' : h < 0.2 ? 'mud' : 'moss'; }
  };
  T.BIOMES.keep = {
    name: 'BASTION KEEP', ground: 'slate', gravity: 24, built: true,
    water: { level: -1.6, color: 0x1e3a4a, opacity: 0.78 },
    macro: function (size, rnd, lay) { return { wallR: 118, moatR: 134, moatW: 9 }; },
    base: function (x, z, m) {
      var h = 1 + fbm(x * 0.025, z * 0.025, 91) * 1.6;
      var d = Math.sqrt(x * x + z * z);
      // the moat ring, and a raised inner ward
      var moat = 1 - sstep(0, m.moatW, Math.abs(d - m.moatR));
      h -= moat * 4.2;
      h += sstep(m.wallR, m.wallR - 30, d) * 1.5;
      return h;
    },
    soft: function () { return 0; },
    color: function (h, s, x, z, o) {
      var n = fbm(x * 0.15, z * 0.15, 92);
      var grass = sstep(0.4, 0.6, fbm(x * 0.05, z * 0.05, 93));
      o[0] = 0.42 + n * 0.08; o[1] = 0.4 + n * 0.08; o[2] = 0.36 + n * 0.06;
      o[0] = o[0] * (1 - grass) + 0.32 * grass; o[1] = o[1] * (1 - grass) + 0.46 * grass; o[2] = o[2] * (1 - grass) + 0.22 * grass;
    },
    surface: function (x, z, h) { return h < -1.8 ? 'water' : 'slate'; }
  };
  T.BIOMES.warrens = {
    name: 'DEEP WARRENS', ground: 'basalt', gravity: 24, built: true, wallH: 5.5, dark: true,
    macro: function (size, rnd, lay) {
      // cavern cities joined by tunnels; every gate and pad gets its own cavern
      var cav = [];
      var anchors = [{ x: 0, z: 0, r: 46 }];
      lay.gates.forEach(function (g) { anchors.push({ x: g.x, z: g.z, r: 24 }); });
      lay.nests.forEach(function (n) { anchors.push({ x: n.x, z: n.z, r: 16 }); });
      if (lay.relay) anchors.push({ x: lay.relay.x, z: lay.relay.z, r: 18 });
      for (var i = 0; i < 9; i++) anchors.push({ x: (rnd() - 0.5) * (size - 80), z: (rnd() - 0.5) * (size - 80), r: 26 + rnd() * 20 });
      anchors.forEach(function (a) { cav.push(a); });
      // tunnels: each cavern links to its two nearest neighbours
      var tun = [];
      cav.forEach(function (a, i) {
        var near = cav.map(function (b, j) { return { j: j, d: GH.dist2(a.x, a.z, b.x, b.z) }; })
          .filter(function (e) { return e.j !== i; }).sort(function (p, q) { return p.d - q.d; }).slice(0, 2);
        near.forEach(function (e) { tun.push({ x1: a.x, z1: a.z, x2: cav[e.j].x, z2: cav[e.j].z, w: 7 + rnd() * 5 }); });
      });
      return { caverns: cav, tunnels: tun };
    },
    open: function (x, z, m) {
      // how far inside open space we are (positive = open)
      var best = -1e9;
      var wob = (fbm(x * 0.08, z * 0.08, 101) - 0.5) * 8;
      for (var i = 0; i < m.caverns.length; i++) {
        var c = m.caverns[i];
        var d = c.r - Math.sqrt(GH.dist2(x, z, c.x, c.z)) + wob;
        if (d > best) best = d;
      }
      for (var t = 0; t < m.tunnels.length; t++) {
        var tn = m.tunnels[t];
        var d2 = tn.w - Math.sqrt(segDist2(x, z, tn.x1, tn.z1, tn.x2, tn.z2)) + wob * 0.5;
        if (d2 > best) best = d2;
      }
      return best;
    },
    base: function (x, z, m) {
      var open = this.open(x, z, m);
      var floor = fbm(x * 0.05, z * 0.05, 102) * 0.9;
      if (open > 1.5) return floor;
      if (open < -1.5) return floor + this.wallH + fbm(x * 0.1, z * 0.1, 103) * 2.5;
      return floor + (1 - (open + 1.5) / 3) * this.wallH;
    },
    solid: function (x, z, m) { return this.open(x, z, m) < 0; },
    soft: function () { return 0; },
    color: function (h, s, x, z, o) {
      var n = fbm(x * 0.15, z * 0.15, 104);
      var wall = sstep(2.0, 4.5, h);
      o[0] = 0.28 + n * 0.08; o[1] = 0.24 + n * 0.06; o[2] = 0.3 + n * 0.08;
      o[0] = o[0] * (1 - wall) + 0.2 * wall; o[1] = o[1] * (1 - wall) + 0.16 * wall; o[2] = o[2] * (1 - wall) + 0.2 * wall;
      var glow = sstep(0.55, 0.75, fbm(x * 0.06, z * 0.06, 105)) * (1 - wall);
      o[1] += glow * 0.25; o[2] += glow * 0.3;
    },
    surface: function () { return 'basalt'; }
  };
  T.BIOMES.sky = {
    name: 'AETHER COURT', ground: 'snow', gravity: 14, built: true, voidBelow: -30,
    water: { level: -16, color: 0xc8d2ea, opacity: 0.96, cloud: true },
    macro: function (size, rnd, lay) {
      var isl = [{ x: 0, z: 0, r: 58, h: 0 }];
      lay.gates.forEach(function (g) { isl.push({ x: g.x, z: g.z, r: 26, h: 0 }); });
      lay.nests.forEach(function (n) { isl.push({ x: n.x, z: n.z, r: 18, h: rnd() * 4 - 1 }); });
      for (var i = 0; i < 12; i++) {
        isl.push({ x: (rnd() - 0.5) * (size - 90), z: (rnd() - 0.5) * (size - 90), r: 20 + rnd() * 26, h: rnd() * 8 - 2 });
      }
      // bridges: nearest-neighbour spans
      var br = [];
      isl.forEach(function (a, i) {
        var near = isl.map(function (b, j) { return { j: j, d: GH.dist2(a.x, a.z, b.x, b.z) }; })
          .filter(function (e) { return e.j !== i; }).sort(function (p, q) { return p.d - q.d; }).slice(0, 2);
        near.forEach(function (e) {
          var b = isl[e.j];
          if (Math.sqrt(e.d) - a.r - b.r < 90) br.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, h1: a.h, h2: b.h });
        });
      });
      return { islands: isl, bridges: br };
    },
    base: function (x, z, m) {
      // islands: a plateau with a soft brim; bridges: narrow spans; else the void
      var best = -1e9, bh = 0;
      var wob = (fbm(x * 0.06, z * 0.06, 111) - 0.5) * 10;
      for (var i = 0; i < m.islands.length; i++) {
        var c = m.islands[i];
        var d = c.r - Math.sqrt(GH.dist2(x, z, c.x, c.z)) + wob;
        if (d > best) { best = d; bh = c.h; }
      }
      var top = bh + fbm(x * 0.04, z * 0.04, 112) * 2.2;
      var h;
      if (best > 6) h = top;
      else if (best > -4) h = top - (1 - (best + 4) / 10) * 6;
      else h = -48;
      for (var b = 0; b < m.bridges.length; b++) {
        var bg = m.bridges[b];
        var d2 = segDist2(x, z, bg.x1, bg.z1, bg.x2, bg.z2);
        if (d2 < 3.2 * 3.2) {
          var vx = bg.x2 - bg.x1, vz = bg.z2 - bg.z1;
          var t = GH.clamp(((x - bg.x1) * vx + (z - bg.z1) * vz) / (vx * vx + vz * vz || 1), 0, 1);
          var by = bg.h1 + (bg.h2 - bg.h1) * t + 0.4;
          if (by > h) h = by;
        }
      }
      return h;
    },
    soft: function () { return 0; },
    color: function (h, s, x, z, o) {
      var n = fbm(x * 0.12, z * 0.12, 113);
      // cloud marble a shade below white: the court used to wash out into its own haze
      o[0] = 0.6 + n * 0.1; o[1] = 0.63 + n * 0.1; o[2] = 0.75;
      var gold = sstep(0.6, 0.8, fbm(x * 0.05, z * 0.05, 114)); o[0] += gold * 0.12; o[1] += gold * 0.06; o[2] -= gold * 0.2;
      var edge = sstep(-2, -6, h); o[0] -= edge * 0.3; o[1] -= edge * 0.3; o[2] -= edge * 0.2;
    },
    surface: function (x, z, h) { return h < -30 ? 'void' : 'snow'; }
  };

  // ---------------- the active field ----------------
  // pads: flat spots blended into the field so fixed installations sit true.
  function padWeight(p, x, z) {
    var d2 = GH.dist2(x, z, p.x, p.z);
    if (p.w !== undefined) { // annulus
      var d = Math.sqrt(d2);
      var band = Math.abs(d - p.r);
      return 1 - sstep(p.w, p.w + p.fade, band);
    }
    var outer = p.r + p.fade;
    if (d2 > outer * outer) return 0;
    return 1 - sstep(p.r, outer, Math.sqrt(d2));
  }

  T.makeField = function (zoneId, info, lay) {
    var st = GH.world.stageFor(zoneId);
    var biome = T.BIOMES[st.id] || T.BIOMES.wreck;
    var half = info.size / 2;
    var pads = [];
    var macro = biome.macro ? biome.macro(info.size, zrng('macro:' + zoneId), lay) : null;
    var flat = false;       // whole map flat (authored floors)
    var amp = 1;            // amplitude scale
    if (info.dungeon) {
      if (info.arch === 'labyrinth' || info.arch === 'halls' || info.arch === 'fluxways') flat = true;
      else if (info.arch === 'raceway') amp = 0.28;
      else if (info.arch === 'gauntlet' || info.arch === 'convoy') amp = 0.35;
      else amp = 0.45;
    }
    var addPad = function (x, z, r, fade) { pads.push({ x: x, z: z, r: r, fade: fade || 10 }); };
    if (!info.dungeon) {
      lay.gates.forEach(function (g) { addPad(g.x, g.z, g.arch ? 11 : 13, 12); });
      lay.nests.forEach(function (n) { addPad(n.x, n.z, 6, 8); });
      if (lay.relay) addPad(lay.relay.x, lay.relay.z, 8, 10);
      if (zoneId === 'wreck') {
        var W = GH.world;
        addPad(W.CAMP.x, W.CAMP.z, W.CAMP.r + 4, 14);
        addPad(W.DUEL_PIT.x, W.DUEL_PIT.z, 24, 12);
        pads.push({ x: W.CIRCUIT.x, z: W.CIRCUIT.z, r: W.CIRCUIT.r, w: 11, fade: 12 });
      }
      (lay.ruins || []).forEach(function (r) { addPad(r.x, r.z, r.kind === 'hulk' ? 12 : 11, 10); });
    } else {
      lay.gates.forEach(function (g) { addPad(g.x, g.z, 10, 10); });
      if (lay.lair) addPad(lay.lair.x, lay.lair.z, 14, 12);
      if (lay.vault) addPad(lay.vault.x, lay.vault.z, 10, 10);
      if (lay.chest) addPad(lay.chest.x, lay.chest.z, 6, 8);
      if (lay.objective) addPad(lay.objective.x, lay.objective.z, 12, 10);
      if (lay.relic) addPad(lay.relic.x, lay.relic.z, 7, 8);
      if (lay.crucible) addPad(lay.crucible.x, lay.crucible.z, 26, 14);
      (lay.checkpoints || []).forEach(function (c) { addPad(c.x, c.z, 5, 6); });
      (lay.convoyPath || []).forEach(function (c) { addPad(c.x, c.z, 5, 6); });
      (lay.breaches || []).forEach(function (b) { addPad(b.x, b.z, 6, 8); });
    }
    // pad heights sample the raw field once (deterministic)
    pads.forEach(function (p) {
      p.y = flat ? 0 : (field_base_probe(p.x, p.z));
      if (zoneId === 'wreck' && p.w === undefined && p.r >= 20) p.y = Math.max(p.y, -0.4);
      if (biome.water && !biome.water.cloud && p.y < biome.water.level + 0.9) p.y = biome.water.level + 0.9;
      if (biome.voidBelow !== undefined && p.y < biome.voidBelow) p.y = 0;
      if (biome.solid) p.y = Math.min(p.y, 1.2);
    });
    function field_base_probe(x, z) {
      var m = (info.dungeon && biome.built) ? null : macro;
      return (m ? biome.base(x, z, m) : (biome.built ? (fbm(x * 0.03, z * 0.03, 5) * 2.2 + 0.4) : biome.base(x, z))) * amp;
    }

    var field = {
      id: zoneId, biome: biome, half: half, size: info.size, pads: pads, flat: flat, amp: amp,
      dungeon: info.dungeon, gravity: biome.gravity, macro: macro, track: null,
      water: (!info.dungeon || info.arch === 'depths' || info.arch === 'hive' || info.arch === 'crucible') ? biome.water : null
    };
    // built biomes keep their macro shapes only on the surface; their
    // dungeons fall back to plain ground of the same palette
    if (info.dungeon && biome.built) { field.macro = null; }
    field.solid = function (x, z) {
      return !!(field.macro && biome.solid && biome.solid(x, z, field.macro));
    };
    field.isVoid = function (x, z) {
      return biome.voidBelow !== undefined && field.hTerrain(x, z) < biome.voidBelow;
    };
    field.raw = function (x, z) {
      if (flat) return 0;
      var h = (field.macro ? biome.base(x, z, field.macro)
        : (biome.built ? (fbm(x * 0.03, z * 0.03, 5) * 2.2 + 0.4) : biome.base(x, z))) * amp;
      for (var i = 0; i < pads.length; i++) {
        var w = padWeight(pads[i], x, z);
        if (w > 0) h = h + (pads[i].y - h) * w;
      }
      return h;
    };
    field.hTerrain = function (x, z) {
      var h = field.raw(x, z);
      // the rim: a mountain wall past the playable edge, so no map has a visible end
      var rinf = Math.max(Math.abs(x), Math.abs(z));
      var start = info.dungeon ? half - 6 : half - 10;
      if (rinf > start) {
        // a cliff bank at the edge, then a mountain wall rising into the fog
        h += sstep(start, half + 5, rinf) * (info.dungeon ? 12 : 16);
        var t = sstep(start, half + (info.dungeon ? 60 : 100), rinf);
        h += Math.pow(t, 1.5) * (info.dungeon ? 40 : 58) + t * ridged(x * 0.03, z * 0.03, 77) * 12;
      }
      return h;
    };
    // the race ribbon rides above the ground where its profile lifts it
    field.h = function (x, z) {
      var h = field.hTerrain(x, z);
      if (field.track) {
        var ts = T.trackSample(field.track, x, z);
        if (ts.on && ts.y > h) h = ts.y;
      }
      return h;
    };
    return field;
  };

  // ---------------- queries ----------------
  T.h = function (x, z) { return T.active ? T.active.h(x, z) : 0; };
  // dh per unit travelled along (dx,dz) (normalised)
  T.slope = function (x, z, dx, dz) {
    if (!T.active) return 0;
    var l = Math.sqrt(dx * dx + dz * dz);
    if (l < 0.0001) return 0;
    dx /= l; dz /= l;
    var step = 1.6;
    return (T.active.h(x + dx * step, z + dz * step) - T.active.h(x - dx * step * 0.5, z - dz * step * 0.5)) / (step * 1.5);
  };
  T.steepness = function (x, z) {
    if (!T.active) return 0;
    var e = 1.2;
    var dx = (T.active.h(x + e, z) - T.active.h(x - e, z)) / (2 * e);
    var dz = (T.active.h(x, z + e) - T.active.h(x, z - e)) / (2 * e);
    return Math.sqrt(dx * dx + dz * dz);
  };
  T.surface = function (x, z) {
    if (!T.active) return null;
    var h = T.active.h(x, z);
    if (T.active.water && h < T.active.water.level - 0.25) return T.active.water.lava ? 'lava' : 'water';
    return T.active.biome.surface(x, z, h);
  };
  T.soft = function (x, z) { return T.active ? T.active.biome.soft(x, z) : 0; };
  T.solidAt = function (x, z) { return T.active ? T.active.solid(x, z) : false; };
  T.voidAt = function (x, z) { return T.active ? T.active.isVoid(x, z) : false; };
  T.dark = function () { return !!(T.active && T.active.biome.dark && !T.active.dungeon); };
  T.gravity = function () { return T.active ? T.active.gravity : 24; };
  T.waterLevel = function () { return T.active && T.active.water ? T.active.water.level : -999; };

  // ---------------- mesh ----------------
  T.build = function (zoneId, info, lay, beforeMesh) {
    var field = T.makeField(zoneId, info, lay);
    T.active = field;
    T.clearColliders();
    if (beforeMesh) beforeMesh(field);
    var group = new THREE.Group();
    var margin = info.dungeon ? 70 : 140;
    var W = info.size + margin * 2;
    var seg = Math.min(220, Math.max(60, Math.round(W / (info.dungeon ? 2.6 : 3.6))));
    var geo = new THREE.PlaneGeometry(W, W, seg, seg);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    var colors = new Float32Array(pos.count * 3);
    var o = [0, 0, 0];
    // heights first, then slopes from the grid neighbours (one field
    // sample per vertex instead of five)
    var cols = seg + 1;
    var hs = new Float32Array(pos.count);
    for (var hi = 0; hi < pos.count; hi++) {
      hs[hi] = field.hTerrain(pos.getX(hi), pos.getZ(hi));
      pos.setY(hi, hs[hi]);
    }
    var cell = W / seg;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      var h = hs[i];
      var r = Math.floor(i / cols), c = i % cols;
      var hl = hs[r * cols + Math.max(0, c - 1)], hr = hs[r * cols + Math.min(seg, c + 1)];
      var hu = hs[Math.max(0, r - 1) * cols + c], hd = hs[Math.min(seg, r + 1) * cols + c];
      var sx = (hr - hl) / (2 * cell), sz = (hd - hu) / (2 * cell);
      var s = Math.min(1, Math.sqrt(sx * sx + sz * sz));
      field.biome.color(h, s, x, z, o);
      if (info.dungeon) { o[0] *= 0.55; o[1] *= 0.55; o[2] *= 0.62; }
      colors[i * 3] = GH.clamp(o[0], 0, 1);
      colors[i * 3 + 1] = GH.clamp(o[1], 0, 1);
      colors[i * 3 + 2] = GH.clamp(o[2], 0, 1);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    field.geo = geo;
    field.colorAttr = geo.attributes.color;
    var tex = GH.assets.groundTex[field.biome.ground];
    // flat shading: every facet catches the sun, so relief reads at a glance
    var mat = GH.assets.lambert({ map: tex, vertexColors: true, flatShading: true }, { nosnap: true });
    if (tex) { tex.repeat.set(W / 9, W / 9); tex.needsUpdate = true; }
    var mesh = new THREE.Mesh(geo, mat);
    mesh.userData.terrain = true;
    group.add(mesh);
    field.mesh = mesh;

    if (field.water) {
      var wgeo = new THREE.PlaneGeometry(W, W, 1, 1);
      wgeo.rotateX(-Math.PI / 2);
      var wmat = new THREE.MeshBasicMaterial({
        color: field.water.color, transparent: true, opacity: field.water.opacity, depthWrite: !!field.water.cloud
      });
      var wm = new THREE.Mesh(wgeo, wmat);
      wm.position.y = field.water.level;
      group.add(wm);
      field.waterMesh = wm;
    }
    group.userData.field = field;
    return group;
  };

  // paint a worn road into the vertex colours (no floating decals on hills)
  T.paintStrip = function (x1, z1, x2, z2, halfW, tint, strength) {
    var f = T.active;
    if (!f || !f.geo) return;
    var pos = f.geo.attributes.position, col = f.colorAttr;
    var vx = x2 - x1, vz = z2 - z1, len2 = vx * vx + vz * vz || 1;
    var minX = Math.min(x1, x2) - halfW - 4, maxX = Math.max(x1, x2) + halfW + 4;
    var minZ = Math.min(z1, z2) - halfW - 4, maxZ = Math.max(z1, z2) + halfW + 4;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      var t = GH.clamp(((x - x1) * vx + (z - z1) * vz) / len2, 0, 1);
      var px = x1 + vx * t, pz = z1 + vz * t;
      var d = Math.sqrt(GH.dist2(x, z, px, pz));
      if (d > halfW + 3) continue;
      var w = (1 - sstep(halfW, halfW + 3, d)) * strength;
      col.setX(i, col.getX(i) + (tint[0] - col.getX(i)) * w);
      col.setY(i, col.getY(i) + (tint[1] - col.getY(i)) * w);
      col.setZ(i, col.getZ(i) + (tint[2] - col.getZ(i)) * w);
    }
    col.needsUpdate = true;
  };
  T.paintDisc = function (x0, z0, r, tint, strength) {
    var f = T.active;
    if (!f || !f.geo) return;
    var pos = f.geo.attributes.position, col = f.colorAttr;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      if (Math.abs(x - x0) > r + 3 || Math.abs(z - z0) > r + 3) continue;
      var d = Math.sqrt(GH.dist2(x, z, x0, z0));
      var w = (1 - sstep(r * 0.6, r + 2, d)) * strength;
      if (w <= 0) continue;
      col.setX(i, col.getX(i) + (tint[0] - col.getX(i)) * w);
      col.setY(i, col.getY(i) + (tint[1] - col.getY(i)) * w);
      col.setZ(i, col.getZ(i) + (tint[2] - col.getZ(i)) * w);
    }
    col.needsUpdate = true;
  };

  // ---------------- static merging ----------------
  // Props are built as little groups of boxes; merging them per material
  // turns a forest of thousands of parts into a dozen draw calls.
  T.makeBuckets = function () { return { byMat: {}, order: [] }; };
  T.mergeInto = function (buckets, group) {
    group.updateMatrixWorld(true);
    group.traverse(function (ch) {
      if (!ch.isMesh || !ch.geometry) return;
      var key = ch.material.uuid;
      var b = buckets.byMat[key];
      if (!b) {
        b = buckets.byMat[key] = { mat: ch.material, pos: [], nor: [] };
        buckets.order.push(key);
      }
      var g = ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry;
      var p = g.attributes.position, n = g.attributes.normal;
      var m = ch.matrixWorld;
      var nm = new THREE.Matrix3().getNormalMatrix(m);
      var v = new THREE.Vector3(), vn = new THREE.Vector3();
      for (var i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
        b.pos.push(v.x, v.y, v.z);
        if (n) {
          vn.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(nm).normalize();
          b.nor.push(vn.x, vn.y, vn.z);
        } else b.nor.push(0, 1, 0);
      }
      if (g !== ch.geometry) g.dispose();
    });
  };
  T.flushBuckets = function (buckets, parent) {
    buckets.order.forEach(function (key) {
      var b = buckets.byMat[key];
      if (!b.pos.length) return;
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      var mesh = new THREE.Mesh(geo, b.mat);
      mesh.frustumCulled = false;
      parent.add(mesh);
    });
    buckets.byMat = {}; buckets.order = [];
  };

  // ---------------- biome vegetation ----------------
  // kinds map to GH.models.biomeProps; density noise clusters them into
  // groves / boulder fields / crystal gardens instead of an even sprinkle.
  T.PROP_SETS = {
    wreck: [
      { kind: 'palm', solid: 0.35, n: 420, cluster: 0.55, seed: 101, band: [-1.2, 99] },
      { kind: 'cactus', solid: 0.3, n: 520, cluster: 0.5, seed: 102, band: [0.5, 99] },
      { kind: 'duneRock', solid: 1.1, n: 360, cluster: 0.45, seed: 103, band: [-1, 99] },
      { kind: 'wreckRib', solid: 1.6, n: 44, cluster: 0.0, seed: 104, band: [-1.5, 99] },
      { kind: 'bones', n: 130, cluster: 0.3, seed: 105, band: [0, 99] }
    ],
    glacier: [
      { kind: 'pine', solid: 0.4, n: 1900, cluster: 0.55, seed: 201, band: [-99, 9] },
      { kind: 'snowRock', solid: 1.0, n: 420, cluster: 0.4, seed: 202, band: [-99, 99] },
      { kind: 'iceSpire', solid: 0.6, n: 220, cluster: 0.6, seed: 203, band: [-99, 4] },
      { kind: 'deadTree', solid: 0.3, n: 160, cluster: 0.4, seed: 204, band: [3, 99] }
    ],
    cloister: [
      { kind: 'jungleTree', solid: 0.45, n: 1500, cluster: 0.45, seed: 301, band: [1.0, 99] },
      { kind: 'fern', n: 1600, cluster: 0.35, seed: 302, band: [0.6, 99] },
      { kind: 'vineCurtain', solid: 0.4, n: 240, cluster: 0.5, seed: 303, band: [1.2, 99] },
      { kind: 'mushroom', n: 480, cluster: 0.5, seed: 304, band: [0.5, 6] },
      { kind: 'mossRock', solid: 0.9, n: 320, cluster: 0.4, seed: 305, band: [0.8, 99] }
    ],
    ember: [
      { kind: 'basalt', solid: 1.3, n: 520, cluster: 0.55, seed: 401, band: [-0.2, 99] },
      { kind: 'lavaRock', solid: 0.9, n: 520, cluster: 0.4, seed: 402, band: [-0.3, 99] },
      { kind: 'charTree', solid: 0.3, n: 380, cluster: 0.5, seed: 403, band: [0.4, 99] },
      { kind: 'ventStack', solid: 0.8, n: 110, cluster: 0.0, seed: 404, band: [-0.2, 6] }
    ],
    storm: [
      { kind: 'slateSpire', solid: 0.9, n: 480, cluster: 0.5, seed: 501, band: [-99, 99] },
      { kind: 'heather', n: 1100, cluster: 0.45, seed: 502, band: [-99, 99] },
      { kind: 'deadTree', n: 480, cluster: 0.45, seed: 503, band: [-99, 99] },
      { kind: 'menhir', solid: 0.9, n: 64, cluster: 0.0, seed: 504, band: [-99, 99] }
    ],
    hive: [
      { kind: 'habVent', solid: 0.6, n: 260, cluster: 0.4, seed: 701, band: [-99, 99] },
      { kind: 'cableMast', solid: 0.3, n: 140, cluster: 0.3, seed: 702, band: [-99, 99] },
      { kind: 'scrapPile', solid: 0.9, n: 300, cluster: 0.5, seed: 703, band: [-99, 99] }
    ],
    ruins: [
      { kind: 'brokenColumn', solid: 0.5, n: 420, cluster: 0.5, seed: 801, band: [0.1, 99] },
      { kind: 'rubble', solid: 0.8, n: 420, cluster: 0.45, seed: 802, band: [-0.3, 99] },
      { kind: 'jungleTree', solid: 0.45, n: 520, cluster: 0.55, seed: 803, band: [0.4, 99] },
      { kind: 'fern', n: 700, cluster: 0.35, seed: 804, band: [0.2, 99] },
      { kind: 'mossRock', solid: 0.9, n: 260, cluster: 0.4, seed: 805, band: [0.2, 99] }
    ],
    keep: [
      { kind: 'brazier', solid: 0.4, n: 120, cluster: 0.0, seed: 901, band: [-0.5, 99] },
      { kind: 'barrel', solid: 0.4, n: 260, cluster: 0.5, seed: 902, band: [-0.5, 99] },
      { kind: 'deadTree', solid: 0.3, n: 300, cluster: 0.5, seed: 903, band: [-0.5, 99] },
      { kind: 'heather', n: 500, cluster: 0.45, seed: 904, band: [-0.5, 99] }
    ],
    warrens: [
      { kind: 'stalagmite', solid: 0.6, n: 700, cluster: 0.4, seed: 1001, band: [-99, 2.5] },
      { kind: 'glowFungus', n: 900, cluster: 0.5, seed: 1002, band: [-99, 2.5] },
      { kind: 'crystal', solid: 0.8, n: 300, cluster: 0.5, seed: 1003, band: [-99, 2.5] }
    ],
    sky: [
      { kind: 'cloudPillar', solid: 0.7, n: 220, cluster: 0.45, seed: 1101, band: [-8, 99] },
      { kind: 'aetherTree', solid: 0.4, n: 420, cluster: 0.5, seed: 1102, band: [-8, 99] },
      { kind: 'skyLantern', n: 70, cluster: 0.75, seed: 1103, band: [-8, 99] } // was 360: a sky full of lamps hid the view
    ],
    null: [
      { kind: 'crystal', solid: 0.8, n: 720, cluster: 0.5, seed: 601, band: [-99, 99] },
      { kind: 'floatShard', n: 460, cluster: 0.4, seed: 602, band: [-99, 99] },
      { kind: 'monolith', solid: 1.0, n: 72, cluster: 0.0, seed: 603, band: [-1, 99] },
      { kind: 'voidReed', n: 720, cluster: 0.5, seed: 604, band: [-6, 99] }
    ]
  };

  // a prop template: its parts flattened into local-space arrays, so a
  // thousand copies cost a thousand transforms instead of a thousand builds
  function templateOf(group) {
    group.updateMatrixWorld(true);
    var parts = [];
    group.traverse(function (ch) {
      if (!ch.isMesh || !ch.geometry) return;
      var g = ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry;
      var p = g.attributes.position, n = g.attributes.normal;
      var m = ch.matrixWorld;
      var nm = new THREE.Matrix3().getNormalMatrix(m);
      var pos = new Float32Array(p.count * 3), nor = new Float32Array(p.count * 3);
      var v = new THREE.Vector3(), vn = new THREE.Vector3();
      for (var i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        if (n) vn.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(nm).normalize();
        else vn.set(0, 1, 0);
        nor[i * 3] = vn.x; nor[i * 3 + 1] = vn.y; nor[i * 3 + 2] = vn.z;
      }
      if (g !== ch.geometry) g.dispose();
      parts.push({ mat: ch.material, pos: pos, nor: nor });
    });
    return parts;
  }
  function stamp(buckets, parts, x, y, z, yaw, sc) {
    var c = Math.cos(yaw), s = Math.sin(yaw);
    for (var k = 0; k < parts.length; k++) {
      var part = parts[k];
      var key = part.mat.uuid;
      var b = buckets.byMat[key];
      if (!b) { b = buckets.byMat[key] = { mat: part.mat, pos: [], nor: [] }; buckets.order.push(key); }
      var P = part.pos, N = part.nor;
      for (var i = 0; i < P.length; i += 3) {
        var px = P[i], py = P[i + 1], pz = P[i + 2];
        b.pos.push((px * c + pz * s) * sc + x, py * sc + y, (-px * s + pz * c) * sc + z);
        var nx = N[i], ny = N[i + 1], nz = N[i + 2];
        b.nor.push(nx * c + nz * s, ny, -nx * s + nz * c);
      }
    }
  }
  T.templateOf = templateOf;
  T.stamp = stamp;

  T.scatterProps = function (parent, zoneId, info, rnd, avoid) {
    var f = T.active;
    if (!f) return 0;
    var st = GH.world.stageFor(zoneId);
    var set = T.PROP_SETS[st.id] || T.PROP_SETS.wreck;
    var scale = info.dungeon ? 0.3 : 1;
    var buckets = T.makeBuckets();
    var placed = 0;
    var builders = GH.models.biomeProps;
    set.forEach(function (ps) {
      var b = builders[ps.kind];
      if (!b) return;
      // a handful of authored variants per kind, stamped by transform
      var variants = [];
      for (var v = 0; v < 6; v++) variants.push(templateOf(b(rnd)));
      var want = Math.round(ps.n * scale);
      var tries = want * 4;
      var count = 0;
      while (count < want && tries-- > 0) {
        var x = (rnd() - 0.5) * (f.size - 10);
        var z = (rnd() - 0.5) * (f.size - 10);
        // clustering: keep only spots where the kind's density noise is high
        if (ps.cluster > 0 && fbm(x * 0.02, z * 0.02, ps.seed) < 0.38 + ps.cluster * 0.3) continue;
        var h = f.h(x, z);
        if (h < ps.band[0] || h > ps.band[1]) continue;
        if (f.water && !f.water.cloud && h < f.water.level + 0.3) continue;
        if (f.isVoid(x, z) || f.solid(x, z)) continue;
        if (T.steepness(x, z) > 0.9) continue;
        if (T.blockedAt(x, z, 1.5)) continue;
        if (avoid && avoid(x, z)) continue;
        var sc = 0.8 + rnd() * 0.5;
        stamp(buckets, variants[Math.floor(rnd() * variants.length)], x, h - 0.05, z, rnd() * Math.PI * 2, sc);
        if (ps.solid) T.addCollider({ x: x, z: z, r: ps.solid * sc });
        count++;
        placed++;
      }
    });
    T.flushBuckets(buckets, parent);
    return placed;
  };

  // ---------------- race track ribbon ----------------
  // rw.path points carry elev (metres above the ground), bank (radians,
  // positive = left edge high), gap (no asphalt: a jump) and boost. The
  // ribbon rides field.hTerrain + elev; the field's h() then returns the
  // ribbon height on it, so vehicles, rivals and pickups climb the hills,
  // fly the gaps and lean into the banks.
  T.setTrack = function (rw) {
    var f = T.active;
    if (!f) return;
    var path = rw.path, n = path.length;
    for (var i = 0; i < n; i++) {
      var p = path[i], q = path[(i + 1) % n], r = path[(i - 1 + n) % n];
      var tx = q.x - r.x, tz = q.z - r.z;
      var tl = Math.sqrt(tx * tx + tz * tz) || 1;
      tx /= tl; tz /= tl;
      p.tx = tx; p.tz = tz; p.nx = tz; p.nz = -tx;
      p.ground = f.hTerrain(p.x, p.z);
      p.y = p.ground + 0.15 + (p.elev || 0);
    }
    rw.width = rw.width || 14;
    f.track = rw;
  };

  // nearest segment sample: {on, y, side, i, t, gap, boost}
  var tsOut = { on: false, y: 0, side: 0, i: 0, t: 0, gap: false, boost: false, d: 0 };
  T.trackSample = function (rw, x, z) {
    var path = rw.path, n = path.length, best = 1e18, bi = 0, bt = 0;
    for (var i = 0; i < n; i++) {
      var a = path[i], b = path[(i + 1) % n];
      var vx = b.x - a.x, vz = b.z - a.z, wx = x - a.x, wz = z - a.z;
      var c2 = vx * vx + vz * vz || 1;
      var t = GH.clamp((vx * wx + vz * wz) / c2, 0, 1);
      var d2 = GH.dist2(x, z, a.x + vx * t, a.z + vz * t);
      if (d2 < best) { best = d2; bi = i; bt = t; }
    }
    var A = path[bi], B = path[(bi + 1) % n];
    var hw = (rw.width || 14) / 2;
    var d = Math.sqrt(best);
    // signed side: left of travel is positive
    var px = A.x + (B.x - A.x) * bt, pz = A.z + (B.z - A.z) * bt;
    var side = ((x - px) * A.nx + (z - pz) * A.nz);
    var yc = A.y + (B.y - A.y) * bt;
    var bank = (A.bank || 0) + ((B.bank || 0) - (A.bank || 0)) * bt;
    tsOut.d = d; tsOut.i = bi; tsOut.t = bt; tsOut.side = side;
    tsOut.gap = !!(A.gap || B.gap);
    tsOut.boost = !!(A.boost && bt < 0.5) || !!(B.boost && bt >= 0.5);
    tsOut.on = d <= hw && !tsOut.gap;
    tsOut.y = yc + Math.tan(bank) * side;
    return tsOut;
  };

  T.buildTrack = function (parent, rw) {
    var f = T.active;
    if (!f.track) T.setTrack(rw);
    var path = rw.path, n = path.length;
    var w = rw.width / 2;
    var pos = [], col = [], nor = [];
    var bands = [-1, -0.83, -0.05, 0.05, 0.83, 1]; // curb | asphalt | centre | asphalt | curb
    function edgeY(p, sfrac) { return p.y + Math.tan(p.bank || 0) * w * sfrac; }
    for (var i2 = 0; i2 < n; i2++) {
      var a = path[i2], b = path[(i2 + 1) % n];
      if (a.gap || b.gap) continue;
      for (var k = 0; k < bands.length - 1; k++) {
        var s0 = bands[k], s1 = bands[k + 1];
        var isCurb = k === 0 || k === 4;
        var isMid = k === 2;
        var cx, cy, cz;
        if (a.boost && !isCurb) { cx = 1.0; cy = 0.55 + ((i2 % 2) ? 0.2 : 0); cz = 0.1; }
        else if (isCurb) { var red = (i2 % 4) < 2; cx = red ? 0.8 : 0.9; cy = red ? 0.16 : 0.9; cz = red ? 0.12 : 0.88; }
        else if (isMid) { var wht = (i2 % 8) < 4; cx = wht ? 0.85 : 0.2; cy = wht ? 0.85 : 0.2; cz = wht ? 0.8 : 0.22; }
        else { var shade = 0.2 + ((i2 % 2) ? 0.02 : 0); cx = shade; cy = shade; cz = shade + 0.03; }
        var quad = [
          [a.x + a.nx * w * s0, edgeY(a, s0), a.z + a.nz * w * s0],
          [a.x + a.nx * w * s1, edgeY(a, s1), a.z + a.nz * w * s1],
          [b.x + b.nx * w * s1, edgeY(b, s1), b.z + b.nz * w * s1],
          [b.x + b.nx * w * s0, edgeY(b, s0), b.z + b.nz * w * s0]
        ];
        var tri = [0, 1, 2, 0, 2, 3];
        for (var ti = 0; ti < 6; ti++) {
          var v = quad[tri[ti]];
          pos.push(v[0], v[1], v[2]);
          nor.push(0, 1, 0);
          col.push(cx, cy, cz);
        }
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    var mesh = new THREE.Mesh(geo, GH.assets.lambert({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }, { nosnap: true }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    parent.add(mesh);
    // furniture: tyre walls on corners, pillars and rails under and along
    // elevated sections, ramp lips before every gap
    var buckets = T.makeBuckets();
    for (var i3 = 0; i3 < n; i3 += 2) {
      var c0 = path[i3], c1 = path[(i3 + 4) % n];
      var turn = Math.atan2(c0.tx * c1.tz - c0.tz * c1.tx, c0.tx * c1.tx + c0.tz * c1.tz);
      var elevated = (c0.elev || 0) > 1.5;
      if (Math.abs(turn) >= 0.11 && !elevated && !c0.gap) {
        var side = turn > 0 ? -1 : 1;
        for (var j = 0; j < 2; j++) {
          var pp = path[(i3 + j) % n];
          if (pp.gap) continue;
          var bx = pp.x + pp.nx * (w + 1.1) * side, bz = pp.z + pp.nz * (w + 1.1) * side;
          var tyre = GH.models.buildTyreWall((i3 + j) % 3 === 0);
          tyre.position.set(bx, f.hTerrain(bx, bz), bz);
          tyre.rotation.y = Math.atan2(pp.tx, pp.tz);
          T.mergeInto(buckets, tyre);
        }
      }
      if (elevated && !c0.gap) {
        // a pillar down to the ground and a rail on each edge
        var pil = GH.models.buildTrackPillar(c0.y - c0.ground + 0.2);
        pil.position.set(c0.x, c0.ground - 0.3, c0.z);
        T.mergeInto(buckets, pil);
        for (var sd = -1; sd <= 1; sd += 2) {
          var rail = GH.models.buildRail(Math.sqrt(GH.dist2(c0.x, c0.z, path[(i3 + 2) % n].x, path[(i3 + 2) % n].z)) + 0.3);
          var rx = c0.x + c0.nx * (w + 0.3) * sd, rz = c0.z + c0.nz * (w + 0.3) * sd;
          rail.position.set(rx, edgeY(c0, sd) - 0.05, rz);
          rail.rotation.y = Math.atan2(c0.tx, c0.tz);
          T.mergeInto(buckets, rail);
        }
      }
    }
    T.flushBuckets(buckets, parent);
    return mesh;
  };

  // distance from a point to the track centreline (for off-track rules)
  T.trackDistance = function (rw, x, z) {
    var best = 1e9, path = rw.path, n = path.length;
    for (var i = 0; i < n; i++) {
      var a = path[i], b = path[(i + 1) % n];
      var vx = b.x - a.x, vz = b.z - a.z;
      var wx = x - a.x, wz = z - a.z;
      var c2 = vx * vx + vz * vz || 1;
      var t = GH.clamp((vx * wx + vz * wz) / c2, 0, 1);
      var d2 = GH.dist2(x, z, a.x + vx * t, a.z + vz * t);
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  };

  T.update = function (dt) {
    var f = T.active;
    if (!f) return;
    if (f.waterMesh) {
      f.waterMesh.position.y = f.water.level + Math.sin(performance.now() * 0.0012) * (f.water.lava ? 0.05 : 0.12);
    }
  };

  T.clear = function () {
    if (T.active && T.active.geo) T.active.geo.dispose();
    T.active = null;
  };

  return T;
})();
