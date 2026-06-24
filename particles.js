/*
 * Product-space background — no dependencies.
 *
 * A live, Hoberg-Phillips-style product space: each firm is a point in a latent
 * two-characteristic product space. Proximity means product similarity, i.e.
 * competition, so nearby firms are linked (a text-network / TNIC edge). Product
 * characteristics evolve endogenously:
 *   - differentiation: firms are repelled by close competitors and drift apart,
 *   - demand: latent demand pockets pull firms into clusters (industries) that
 *     shift as demand moves,
 *   - churn: firms enter into open niches and exit from over-crowded ones,
 *   - repositioning: a firm occasionally makes a discrete leap to a new niche.
 * Hover to highlight a firm's competitors; click to launch a new product there
 * and watch incumbents differentiate away.
 * Renders into <canvas class="hero-canvas"> inside the hero banner.
 */
(function () {
  "use strict";

  var canvas = document.querySelector(".hero-canvas");
  if (!canvas || !canvas.getContext) return;

  var hero = canvas.parentElement;
  var ctx = canvas.getContext("2d");
  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var W = 0, H = 0, dpr = 1, time = 0, mx = 40, my = 30;
  var firms = [], demand = [];
  var pointer = { x: -9999, y: -9999, active: false };
  var running = false, frame = null, lastTs = 0;
  var entryAcc = 0, entryNext = 2.4, exitAcc = 0, exitNext = 3.2;
  var repoAcc = 0, repoNext = 6, relocAcc = 0, relocNext = 10, bridgeAcc = 0, bridgeNext = 8;
  var MIN_FIRMS = 24, MAX_FIRMS = 52, BRIDGE_MAX = 3;

  var SIM_DIST = 80;     // px: closer than this => product-similar => competitors (linked)
  var BRIDGE_DIST = 152; // px: reach of a bridge firm's cross-market links
  var R_REPEL = 104;     // px: range over which firms differentiate away from rivals
  var REPEL_K = 50;      // strength of differentiation force
  var ATTRACT_K = 0.34;  // pull toward nearest demand pocket
  var BOUND_K = 1.1;     // soft containment at the edges
  var FR = 2.8;          // velocity damping rate
  var MAX_V = 26;        // px/sec cap on how fast characteristics change
  var JIT = 7;           // idiosyncratic product tweaks

  var NODE_RGB = "255,255,255";
  var LINK_RGB = "150,185,230";
  var ENTER_RGB = "255,212,150";   // newly entered firm (warm), fades to white
  var DEMAND_RGB = "120,170,235";  // latent demand pocket glow
  var BRIDGE_RGB = "120,232,205";  // a firm/product bridging two markets

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = hero.clientWidth;
    H = hero.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function build() {
    firms = []; demand = [];
    mx = Math.max(34, W * 0.04); my = 28;
    var nD = clamp(Math.round((W * H) / 135000), 2, 4);
    for (var i = 0; i < nD; i++) {
      demand.push({
        x: rand(mx + 60, W - mx - 60), y: rand(my + 30, H - my - 30),
        vx: rand(-6, 6), vy: rand(-4, 4)
      });
    }
    var n = clamp(Math.round(W / 22), MIN_FIRMS, MAX_FIRMS);
    for (var j = 0; j < n; j++) addFirm(rand(mx, W - mx), rand(my, H - my), true);
  }

  function addFirm(x, y, instant, bridge) {
    if (firms.length >= MAX_FIRMS) return;
    firms.push({
      x: x, y: y, vx: 0, vy: 0,
      size: bridge ? rand(2.6, 3.4) : rand(1.6, 3.0),
      life: instant ? 1 : 0, dying: false,
      warm: instant ? 0 : 1, flash: bridge ? 1 : 0,
      bridge: bridge || null, age: 0, bridgeLife: rand(15, 24)
    });
  }

  function bridgeCount() {
    var c = 0;
    for (var i = 0; i < firms.length; i++) if (firms[i].bridge && !firms[i].dying) c++;
    return c;
  }

  // a new product that bridges two (preferably distant) markets
  function spawnBridge() {
    if (demand.length < 2 || firms.length >= MAX_FIRMS || bridgeCount() >= BRIDGE_MAX) return;
    var a = (Math.random() * demand.length) | 0, b = a, far = -1;
    for (var i = 0; i < demand.length; i++) {
      if (i === a) continue;
      var d = Math.hypot(demand[i].x - demand[a].x, demand[i].y - demand[a].y);
      if (d > far) { far = d; b = i; }
    }
    if (b === a) return;
    addFirm((demand[a].x + demand[b].x) / 2 + rand(-20, 20),
            (demand[a].y + demand[b].y) / 2 + rand(-20, 20), false, { a: a, b: b });
  }

  // an open niche: the emptiest of several sampled points
  function sampleNiche() {
    var best = null, bestD = -1;
    for (var s = 0; s < 14; s++) {
      var px = rand(mx, W - mx), py = rand(my, H - my), nearest = 1e9;
      for (var i = 0; i < firms.length; i++) {
        var d = Math.hypot(firms[i].x - px, firms[i].y - py);
        if (d < nearest) nearest = d;
      }
      if (nearest > bestD) { bestD = nearest; best = { x: px, y: py }; }
    }
    return best;
  }

  function crowdedFirm() {
    var worst = null, worstP = -1;
    for (var i = 0; i < firms.length; i++) {
      var f = firms[i];
      if (f.dying || f.life < 0.9 || f.bridge) continue;
      var p = 0;
      for (var j = 0; j < firms.length; j++) {
        if (i === j) continue;
        var d = Math.hypot(f.x - firms[j].x, f.y - firms[j].y);
        if (d < R_REPEL) p += (R_REPEL - d);
      }
      if (p > worstP) { worstP = p; worst = f; }
    }
    return worst;
  }

  function nearestFirm(x, y, maxD) {
    var best = null, bd = maxD || 1e9;
    for (var i = 0; i < firms.length; i++) {
      if (firms[i].dying) continue;
      var d = Math.hypot(firms[i].x - x, firms[i].y - y);
      if (d < bd) { bd = d; best = firms[i]; }
    }
    return best;
  }

  function update(dt) {
    time += dt;

    // demand pockets drift, bounce, and occasionally relocate (a demand shock)
    for (var k = 0; k < demand.length; k++) {
      var dn = demand[k];
      dn.x += dn.vx * dt; dn.y += dn.vy * dt;
      if (dn.x < mx + 40 || dn.x > W - mx - 40) dn.vx *= -1;
      if (dn.y < my + 20 || dn.y > H - my - 20) dn.vy *= -1;
      dn.x = clamp(dn.x, mx + 40, W - mx - 40);
      dn.y = clamp(dn.y, my + 20, H - my - 20);
    }
    relocAcc += dt;
    if (relocAcc >= relocNext && demand.length) {
      relocAcc = 0; relocNext = rand(9, 13);
      var dd = demand[(Math.random() * demand.length) | 0];
      dd.x = rand(mx + 60, W - mx - 60); dd.y = rand(my + 30, H - my - 30);
    }

    // forces on each firm
    for (var i = 0; i < firms.length; i++) {
      var f = firms[i];
      var ax = 0, ay = 0;
      // differentiate away from close competitors
      for (var j = 0; j < firms.length; j++) {
        if (i === j) continue;
        var dx = f.x - firms[j].x, dy = f.y - firms[j].y;
        var d = Math.hypot(dx, dy);
        if (d > 0.01 && d < R_REPEL) {
          var m = REPEL_K * (R_REPEL - d) / R_REPEL;
          ax += (dx / d) * m; ay += (dy / d) * m;
        }
      }
      // demand pull: a bridge firm spans two markets; everyone else seeks the nearest
      if (f.bridge) {
        var da = demand[f.bridge.a], db = demand[f.bridge.b];
        if (da) { ax += (da.x - f.x) * ATTRACT_K * 0.6; ay += (da.y - f.y) * ATTRACT_K * 0.6; }
        if (db) { ax += (db.x - f.x) * ATTRACT_K * 0.6; ay += (db.y - f.y) * ATTRACT_K * 0.6; }
      } else {
        var na = null, nd = 1e9;
        for (var a = 0; a < demand.length; a++) {
          var dd2 = Math.hypot(demand[a].x - f.x, demand[a].y - f.y);
          if (dd2 < nd) { nd = dd2; na = demand[a]; }
        }
        if (na) { ax += (na.x - f.x) * ATTRACT_K; ay += (na.y - f.y) * ATTRACT_K; }
      }
      // soft containment + idiosyncratic tweaks
      if (f.x < mx) ax += (mx - f.x) * BOUND_K;
      if (f.x > W - mx) ax += (W - mx - f.x) * BOUND_K;
      if (f.y < my) ay += (my - f.y) * BOUND_K;
      if (f.y > H - my) ay += (H - my - f.y) * BOUND_K;
      ax += rand(-JIT, JIT); ay += rand(-JIT, JIT);

      var damp = Math.exp(-dt * FR);
      f.vx = f.vx * damp + ax * dt;
      f.vy = f.vy * damp + ay * dt;
      var sp = Math.hypot(f.vx, f.vy);
      if (sp > MAX_V) { f.vx = f.vx / sp * MAX_V; f.vy = f.vy / sp * MAX_V; }
      f.x = clamp(f.x + f.vx * dt, 3, W - 3);
      f.y = clamp(f.y + f.vy * dt, 3, H - 3);

      // life / entry warmth / bridge ageing (bridges eventually dissolve)
      if (f.dying) f.life -= dt * 1.5;
      else if (f.life < 1) f.life = Math.min(1, f.life + dt * 1.7);
      if (f.warm > 0) f.warm = Math.max(0, f.warm - dt * 0.7);
      if (f.flash > 0) f.flash = Math.max(0, f.flash - dt * 0.5);
      if (f.bridge && !f.dying) { f.age += dt; if (f.age > f.bridgeLife) f.dying = true; }
    }
    for (var r = firms.length - 1; r >= 0; r--) if (firms[r].life <= 0) firms.splice(r, 1);

    // entry into an open niche
    entryAcc += dt;
    if (entryAcc >= entryNext) {
      entryAcc = 0; entryNext = rand(2.2, 3.8);
      if (firms.length < MAX_FIRMS) { var nm = sampleNiche(); if (nm) addFirm(nm.x, nm.y, false); }
    }
    // exit from the most crowded niche
    exitAcc += dt;
    if (exitAcc >= exitNext) {
      exitAcc = 0; exitNext = rand(2.8, 4.6);
      if (firms.length > MIN_FIRMS) { var cf = crowdedFirm(); if (cf) cf.dying = true; }
    }
    // a firm repositions — a discrete leap to a new niche
    repoAcc += dt;
    if (repoAcc >= repoNext) {
      repoAcc = 0; repoNext = rand(5, 8);
      var live = firms.filter(function (q) { return !q.dying && q.life > 0.9 && !q.bridge; });
      if (live.length) {
        var mover = live[(Math.random() * live.length) | 0];
        var target = sampleNiche();
        if (target) {
          var vx = target.x - mover.x, vy = target.y - mover.y, l = Math.hypot(vx, vy) || 1;
          mover.vx += vx / l * MAX_V * 1.6; mover.vy += vy / l * MAX_V * 1.6;
          mover.warm = 0.6;
        }
      }
    }
    // a new product enters to bridge two markets
    bridgeAcc += dt;
    if (bridgeAcc >= bridgeNext) { bridgeAcc = 0; bridgeNext = rand(7, 11); spawnBridge(); }

    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    var i, j, f, q, hovered = pointer.active ? nearestFirm(pointer.x, pointer.y, 70) : null;

    // latent demand pockets (very faint glow)
    for (i = 0; i < demand.length; i++) {
      var g = ctx.createRadialGradient(demand[i].x, demand[i].y, 0, demand[i].x, demand[i].y, 150);
      g.addColorStop(0, "rgba(" + DEMAND_RGB + ",0.07)");
      g.addColorStop(1, "rgba(" + DEMAND_RGB + ",0)");
      ctx.fillStyle = g;
      ctx.fillRect(demand[i].x - 150, demand[i].y - 150, 300, 300);
    }

    // competitor links — product-similarity edges; bridge firms reach across markets
    for (i = 0; i < firms.length; i++) {
      f = firms[i];
      for (j = i + 1; j < firms.length; j++) {
        q = firms[j];
        var dx = f.x - q.x, dy = f.y - q.y, d = Math.hypot(dx, dy);
        var isBridge = (f.bridge || q.bridge);
        var thresh = isBridge ? BRIDGE_DIST : SIM_DIST;
        if (d < thresh) {
          var hi = (f === hovered || q === hovered);
          if (isBridge) {
            var pulse = 0.6 + 0.4 * Math.sin(time * 3 + d * 0.05);
            var alb = (1 - d / thresh) * 0.75 * pulse * Math.min(f.life, q.life);
            ctx.strokeStyle = "rgba(" + BRIDGE_RGB + "," + alb.toFixed(3) + ")";
            ctx.lineWidth = 1.4;
          } else {
            var al = (1 - d / thresh) * (hi ? 0.85 : 0.4) * Math.min(f.life, q.life);
            ctx.strokeStyle = "rgba(" + LINK_RGB + "," + al.toFixed(3) + ")";
            ctx.lineWidth = hi ? 1.4 : 1;
          }
          ctx.beginPath();
          ctx.moveTo(f.x, f.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
    }

    // firms
    for (i = 0; i < firms.length; i++) {
      f = firms[i];
      var rad = (f.size + (f === hovered ? 1.8 : 0)) * (0.4 + 0.6 * f.life);

      if (f.bridge) {
        ctx.fillStyle = "rgba(" + BRIDGE_RGB + "," + (0.18 * f.life * (0.5 + 0.5 * f.flash)).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(f.x, f.y, rad + 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(" + BRIDGE_RGB + "," + (0.95 * f.life).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(f.x, f.y, rad, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(" + BRIDGE_RGB + "," + (0.5 * f.life).toFixed(3) + ")";
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(f.x, f.y, rad + 4, 0, Math.PI * 2); ctx.stroke();
        continue;
      }

      var rgb = f.warm > 0.02
        ? "255," + (212 + (255 - 212) * (1 - f.warm) | 0) + "," + (150 + (255 - 150) * (1 - f.warm) | 0)
        : NODE_RGB;
      if (f === hovered || f.warm > 0.2) {
        ctx.fillStyle = "rgba(" + (f.warm > 0.2 ? ENTER_RGB : LINK_RGB) + "," + (0.16 * f.life).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(f.x, f.y, rad + 7, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "rgba(" + rgb + "," + (0.9 * f.life).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(f.x, f.y, rad, 0, Math.PI * 2); ctx.fill();
    }
  }

  function loop(ts) {
    var dt = lastTs ? (ts - lastTs) / 1000 : 0.016;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    update(dt);
    frame = window.requestAnimationFrame(loop);
  }

  function start() {
    if (running || reduceMotion) return;
    running = true; lastTs = 0;
    frame = window.requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (frame) window.cancelAnimationFrame(frame);
    frame = null;
  }
  function rebuild() { size(); build(); draw(); }

  hero.addEventListener("pointermove", function (ev) {
    var rect = hero.getBoundingClientRect();
    pointer.x = ev.clientX - rect.left; pointer.y = ev.clientY - rect.top; pointer.active = true;
  });
  hero.addEventListener("pointerleave", function () {
    pointer.active = false; pointer.x = pointer.y = -9999;
  });
  hero.addEventListener("pointerdown", function (ev) {
    var rect = hero.getBoundingClientRect();
    addFirm(ev.clientX - rect.left, ev.clientY - rect.top, false);
  });

  if (window.ResizeObserver) new ResizeObserver(rebuild).observe(hero);
  else window.addEventListener("resize", rebuild);

  if (window.IntersectionObserver) {
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) start(); else stop();
    }, { threshold: 0 }).observe(hero);
  } else { start(); }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });

  rebuild();
  start();
})();
