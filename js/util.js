// STAALREUS — small helpers, shared namespace
window.GH = {};

GH.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
GH.lerp = function (a, b, t) { return a + (b - a) * t; };
GH.rand = function (a, b) { return a + Math.random() * (b - a); };
GH.randInt = function (a, b) { return Math.floor(GH.rand(a, b + 1)); };
GH.pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };

GH.angleTo = function (fromX, fromZ, toX, toZ) {
  return Math.atan2(toX - fromX, toZ - fromZ);
};

GH.dist2 = function (ax, az, bx, bz) {
  var dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
};

// shortest-path angle interpolation
GH.lerpAngle = function (a, b, t) {
  var d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

GH.fmt1 = function (n) { return (Math.round(n * 10) / 10).toFixed(1); };

// weighted pick: array of {w: weight, ...}
GH.weightedPick = function (arr) {
  var total = 0, i;
  for (i = 0; i < arr.length; i++) total += arr[i].w;
  var r = Math.random() * total;
  for (i = 0; i < arr.length; i++) {
    r -= arr[i].w;
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
};

// COMBAT PACE — one dial for how fast a fight moves. The Reach was tuned
// for deliberate, one-body-at-a-time combat; this pulls it toward the
// arcade mech games (Gun Metal's boost-and-strafe cadence): quicker
// triggers, faster rounds, longer dashes, hostiles that wake sooner and
// close faster, and less hull per body so kills land in bursts. Every
// frame keeps its relative balance (tools/balance.js reads the raw defs).
GH.PACE = {
  atkSpd: 1.3,       // primary (and vehicle strafe) cycle rate
  projSpd: 1.35,     // player rounds fly faster ...
  projLife: 0.82,    // ... and live a little shorter, so range grows ~10%
  moveSpd: 1.12,     // frame walking speed
  dashSpd: 34,       // boost dash units per second (was 26)
  boostRegen: 1.25,  // dash meter refill
  cdMult: 0.8,       // Combat Art and signature recharge
  energyRegen: 1.25, // capacitor refill
  enemySpd: 1.15,    // hostiles move ...
  enemyShot: 1.3,    // ... and shoot faster ...
  enemyFire: 0.8,    // ... more often ...
  enemyHp: 1.0,      // ... with less hull each (the old build stacked ×1.5)
  aggroMelee: 16,    // notice range (was 11)
  aggroRanged: 22,   // (was 16)
  leash: 44,         // give-up range (was 32)
  packWake: 80,      // roaming packs wake this far out (was 65)
  localCap: 26       // hostiles a nest field may hold at once (was 20)
};
