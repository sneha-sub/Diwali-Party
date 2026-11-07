/* Diwali Party Photo Booth
 * Live camera -> canvas, with brand filters + draggable stickers composited on top.
 * Everything the user sees on the stage canvas is exactly what gets saved.
 */
(() => {
  "use strict";

  // ---------- Brand ----------
  const C = {
    marigold: "#FF7011",
    magenta: "#E836DC",
    indigo: "#3636E8",
    leaf: "#328532",
    gold: "#F7C869",
    rose: "#FFB0FA",
    khaki: "#B4914F",
    ink: "#14124a",
    paper: "#fffaf2",
  };
  const DISPLAY = '"Abril Fatface", Georgia, serif';
  const SANS = '"Outfit", system-ui, sans-serif';

  const ASSET_NAMES = [
    "wordmark", "diya-lit", "diya-2026", "sparkler", "jalebi", "samosa", "rangoli",
    "badge-diya", "badge-diya-blue", "badge-jalebi", "badge-jalebi-green",
    "badge-rangoli", "badge-rangoli-green",
  ];
  const STICKER_NAMES = [
    "diya-lit", "diya-2026", "sparkler", "jalebi", "samosa", "rangoli",
    "badge-diya", "badge-diya-blue", "badge-jalebi", "badge-jalebi-green",
    "badge-rangoli", "badge-rangoli-green", "wordmark",
  ];
  const img = {};

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const stage = $("stage");
  const ctx = stage.getContext("2d");
  const W = stage.width;   // 1080
  const H = stage.height;  // 1350
  const video = $("video");

  // ---------- State ----------
  const state = {
    source: null,          // HTMLVideoElement | HTMLImageElement
    mirror: true,
    facing: "user",
    stream: null,
    filter: 0,
    mode: "strip",
    busy: false,
    stickers: [],          // {name, x, y, size, rot}
    selected: null,
    photos: [],            // {url, name}
    lastShotUrl: null,
  };

  // ---------- Helpers ----------
  const loadImage = (src) =>
    new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Could not load " + src));
      i.src = src;
    });

  function drawCover(c, source, x, y, w, h, mirror) {
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) return;
    const s = Math.max(w / sw, h / sh);
    const dw = sw * s, dh = sh * s;
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    if (mirror) {
      c.translate(x + w, y);
      c.scale(-1, 1);
      c.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      c.drawImage(source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    }
    c.restore();
  }

  /** Draw image centred at (x,y), fitting its longest side to `size`, rotated by `rot` radians. */
  function drawAsset(c, name, x, y, size, rot = 0, alpha = 1) {
    const i = img[name];
    if (!i) return;
    const s = size / Math.max(i.width, i.height);
    c.save();
    c.globalAlpha = alpha;
    c.translate(x, y);
    c.rotate(rot);
    c.drawImage(i, (-i.width * s) / 2, (-i.height * s) / 2, i.width * s, i.height * s);
    c.restore();
  }

  function assetHeightFor(name, width) {
    const i = img[name];
    return i ? (width * i.height) / i.width : 0;
  }

  function roundRectPath(c, x, y, w, h, r) {
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /** Path of the frame region: the whole canvas minus a rounded photo window. */
  function framePath(c, inset, r = 34) {
    c.beginPath();
    c.rect(0, 0, W, H);
    roundRectPath(c, inset.l, inset.t, W - inset.l - inset.r, H - inset.t - inset.b, r);
  }

  /** Solid frame with the badge-style white polka dots. */
  function dottedFrame(c, color, inset, dot = "rgba(255,255,255,.55)") {
    c.save();
    framePath(c, inset);
    c.clip("evenodd");
    c.fillStyle = color;
    c.fillRect(0, 0, W, H);
    dots(c, 0, 0, W, H, 26, 3.2, dot);
    c.restore();
  }

  function dots(c, x, y, w, h, gap, r, color) {
    c.fillStyle = color;
    c.beginPath();
    for (let yy = y + gap / 2; yy < y + h; yy += gap) {
      for (let xx = x + gap / 2; xx < x + w; xx += gap) {
        c.moveTo(xx + r, yy);
        c.arc(xx, yy, r, 0, Math.PI * 2);
      }
    }
    c.fill();
  }

  function text(c, str, x, y, { font = DISPLAY, size = 90, color = C.gold, shadow = null, maxWidth = W - 80, align = "center", weight = "" } = {}) {
    c.save();
    c.font = `${weight} ${size}px ${font}`.trim();
    c.textAlign = align;
    c.textBaseline = "alphabetic";
    if (shadow) {
      c.fillStyle = shadow;
      c.fillText(str, x, y + size * 0.07, maxWidth);
    }
    c.fillStyle = color;
    c.fillText(str, x, y, maxWidth);
    c.restore();
  }

  // Seeded particles so every filter has stable, repeatable motion.
  function makeParticles(n, seed) {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: n }, () => ({
      x: rnd(), y: rnd(), r: rnd(), sp: 0.4 + rnd(), ph: rnd() * Math.PI * 2, hue: rnd(),
    }));
  }
  const glowParticles = makeParticles(38, 7);
  const sparkParticles = makeParticles(26, 99);

  /** Little four-point sparkle star. */
  function star(c, x, y, r, color, rot = 0) {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, -r);
    c.quadraticCurveTo(r * 0.18, -r * 0.18, r, 0);
    c.quadraticCurveTo(r * 0.18, r * 0.18, 0, r);
    c.quadraticCurveTo(-r * 0.18, r * 0.18, -r, 0);
    c.quadraticCurveTo(-r * 0.18, -r * 0.18, 0, -r);
    c.fill();
    c.restore();
  }

  /** Burst of sparks around a point, animated with time t (seconds). */
  function sparkBurst(c, cx, cy, radius, t, colors) {
    sparkParticles.forEach((p, i) => {
      const life = (t * p.sp * 0.9 + p.r) % 1;
      const ang = p.ph + i;
      const d = radius * (0.25 + life);
      const x = cx + Math.cos(ang) * d;
      const y = cy + Math.sin(ang) * d;
      star(c, x, y, 18 * (1 - life) + 4, colors[i % colors.length], ang);
    });
  }

  // ---------- "Lets get LIT!" banner ----------
  // Colour-blocked lockup from the brand, drawn in code so it stays crisp at any size.
  // Proportions measured from the brand artwork (666 x 138).
  const SAGE = "#7CA87C";
  const BANNER_RATIO = 138 / 666;
  function litBannerHeight(w) { return w * BANNER_RATIO; }

  /** Draw the banner with its top-left corner at (x, y), `w` wide. */
  function drawLitBanner(c, x, y, w) {
    const h = w * BANNER_RATIO;
    const u = w / 666; // one unit of the original artwork
    const blocks = [
      [0, 186, C.rose, "Lets", C.magenta],
      [186, 187, SAGE, "get", C.rose],
      [373, 180, C.indigo, "LIT!", C.rose],
      [553, 113, C.marigold, null, null],
    ];
    c.save();
    c.translate(x, y);
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.font = `800 ${Math.round(58 * u)}px ${SANS}`;
    blocks.forEach(([bx, bw, bg, word, fg]) => {
      c.fillStyle = bg;
      c.fillRect(bx * u, 0, bw * u + 0.5, h);
      if (word) {
        c.fillStyle = fg;
        c.fillText(word, (bx + bw / 2) * u, 90 * u);
      }
    });
    // Sparkler: magenta stick, gold starburst, little pink sparks
    const sx = 611 * u, sy = 52 * u;
    c.fillStyle = C.magenta;
    c.fillRect(613 * u, 62 * u, 4.5 * u, h - 62 * u);
    c.fillStyle = C.gold;
    for (let i = 0; i < 8; i++) {
      c.save();
      c.translate(sx, sy);
      c.rotate((i * Math.PI) / 4 + 0.2);
      c.fillRect(-7 * u, -34 * u, 14 * u, 34 * u);
      c.restore();
    }
    c.beginPath();
    c.arc(sx, sy, 14 * u, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = C.rose;
    [[568, 30, 0.4], [654, 34, -0.6], [566, 74, 2.4], [656, 72, -2.2], [604, 12, 3.3]].forEach(([tx, ty, r]) => {
      c.save();
      c.translate(tx * u, ty * u);
      c.rotate(r);
      c.beginPath();
      c.moveTo(0, -6 * u);
      c.lineTo(5 * u, 4 * u);
      c.lineTo(-5 * u, 4 * u);
      c.closePath();
      c.fill();
      c.restore();
    });
    c.restore();
  }
  /** Same, centred horizontally on cx with its top at y. */
  const litBannerAt = (c, cx, y, w) => drawLitBanner(c, cx - w / 2, y, w);

  // ---------- Filters ----------
  // Each filter has:
  //   frame(c, t)  border + lettering, used for single photos only
  //   deco(c, t)   props drawn over the photo (on single photos and on every strip shot)
  //   strip(c, w, h)  background of the printed strip
  //   ink          colours for the strip's footer lettering
  // `t` is time in seconds, for animation.
  const dottedBg = (color, dot = "rgba(255,255,255,.5)") => (c, w, h) => {
    c.fillStyle = color;
    c.fillRect(0, 0, w, h);
    dots(c, 0, 0, w, h, 24, 3, dot);
  };

  const FILTERS = [
    {
      name: "Let’s get LIT",
      mark: "banner", // lettering rule: banner OR wordmark, never both
      swatch: `url(assets/brand/badge-diya.png) center/120% no-repeat, ${C.magenta}`,
      strip: dottedBg(C.magenta),
      frame(c) {
        dottedFrame(c, C.magenta, { t: 60, l: 60, r: 60, b: 330 });
        const bw = 780;
        litBannerAt(c, W / 2, H - 330 + (330 - litBannerHeight(bw)) / 2, bw);
      },
      deco(c, t, strip) {
        drawAsset(c, "diya-lit", 150, 170, 280, -0.18 + Math.sin(t * 1.6) * 0.03);
        const sx = W - 140, sy = strip ? H - 220 : H - 520;
        drawAsset(c, "sparkler", sx, sy, 300, 0.32);
        sparkBurst(c, sx - 30, sy - 90, 150, t, [C.gold, C.rose, "#fff"]);
      },
    },
    {
      name: "Gift Wrap",
      mark: "banner", // lettering rule: banner OR wordmark, never both
      swatch: `linear-gradient(90deg, ${C.khaki} 0 22%, ${C.rose} 22% 34%, ${C.marigold} 34% 48%, ${C.leaf} 48% 62%, ${C.indigo} 62%)`,
      strip(c, w, h) {
        giftPaper(c, w, h);
      },
      frame(c) {
        c.save();
        framePath(c, { t: 80, l: 70, r: 70, b: 270 });
        c.clip("evenodd");
        giftPaper(c, W, H);
        c.restore();
        const bw = 760;
        litBannerAt(c, W / 2, H - 270 + (270 - litBannerHeight(bw)) / 2, bw);
      },
      deco(c) {
        bow(c, W * 0.38, 40, 1.15);
      },
    },
    {
      name: "Rangoli",
      mark: "wordmark", // lettering rule: banner OR wordmark, never both
      swatch: `url(assets/brand/badge-rangoli-green.png) center/110% no-repeat, ${C.indigo}`,
      strip: dottedBg(C.indigo),
      frame(c) {
        dottedFrame(c, C.indigo, { t: 70, l: 70, r: 70, b: 270 });
        const wmW = 420;
        const wmH = assetHeightFor("wordmark", wmW);
        drawAsset(c, "wordmark", W / 2, H - 270 + (270 - wmH) / 2 + wmH / 2, wmW);
      },
      deco(c, t) {
        const s = 250, spin = t * 0.25;
        drawAsset(c, "badge-rangoli", 95, 95, s, spin);
        drawAsset(c, "badge-rangoli-green", W - 95, 95, s, -spin);
        drawAsset(c, "badge-rangoli-green", 110, H - 140, s, -spin);
        drawAsset(c, "badge-rangoli", W - 110, H - 140, s, spin);
      },
    },
    {
      name: "Snack Attack",
      mark: "banner", // lettering rule: banner OR wordmark, never both
      swatch: `url(assets/brand/badge-jalebi-green.png) center/110% no-repeat, ${C.leaf}`,
      strip: dottedBg(C.leaf),
      frame(c) {
        dottedFrame(c, C.leaf, { t: 60, l: 60, r: 60, b: 290 });
        const bw = 620;
        litBannerAt(c, W * 0.63, H - 290 + (290 - litBannerHeight(bw)) / 2, bw);
      },
      deco(c, t, strip) {
        drawAsset(c, "jalebi", W - 150, 160, 310, t * 0.5);
        drawAsset(c, "badge-jalebi", 120, 120, 190, -0.2);
        drawAsset(c, "samosa", 175, strip ? H - 170 : H - 220, 330, -0.15 + Math.sin(t * 2) * 0.04);
      },
    },
    {
      name: "Festival of Lights",
      mark: "banner", // lettering rule: banner OR wordmark, never both
      swatch: `url(assets/brand/diya-lit.png) center/80% no-repeat, radial-gradient(${C.gold}, ${C.marigold})`,
      strip(c, w, h) {
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, C.marigold);
        g.addColorStop(1, C.magenta);
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
        dots(c, 0, 0, w, h, 24, 3, "rgba(255,255,255,.35)");
      },
      frame(c) {
        litBannerAt(c, W / 2, 50, 700);
      },
      deco(c, t) {
        const g = c.createRadialGradient(W / 2, H * 0.45, H * 0.25, W / 2, H * 0.5, H * 0.8);
        g.addColorStop(0, "rgba(255,112,17,0)");
        g.addColorStop(1, "rgba(232,54,220,.55)");
        c.fillStyle = g;
        c.fillRect(0, 0, W, H);
        glowParticles.forEach((p) => {
          const y = (((p.y - t * 0.04 * p.sp) % 1) + 1) % 1;
          const x = p.x * W + Math.sin(t * p.sp + p.ph) * 20;
          const r = 8 + p.r * 22;
          const a = 0.35 + 0.35 * Math.sin(t * 2 * p.sp + p.ph);
          const col = p.hue > 0.5 ? "255,200,105" : "255,176,250";
          const rg = c.createRadialGradient(x, y * H, 0, x, y * H, r);
          rg.addColorStop(0, `rgba(${col},${a})`);
          rg.addColorStop(1, `rgba(${col},0)`);
          c.fillStyle = rg;
          c.beginPath();
          c.arc(x, y * H, r, 0, Math.PI * 2);
          c.fill();
        });
        const names = ["badge-diya", "badge-diya-blue", "diya-2026", "badge-diya-blue", "badge-diya"];
        names.forEach((n, i) => {
          const x = W * (0.1 + i * 0.2);
          const big = n === "diya-2026";
          drawAsset(c, n, x, H - (big ? 150 : 110), big ? 260 : 190, Math.sin(t * 1.5 + i) * 0.06);
        });
      },
    },
    {
      name: "Sparklers",
      mark: "wordmark", // lettering rule: banner OR wordmark, never both
      swatch: `url(assets/brand/sparkler.png) center/70% no-repeat, ${C.ink}`,
      strip: dottedBg(C.ink, "rgba(247,200,105,.45)"),
      frame(c) {
        const wmW = 360;
        drawAsset(c, "wordmark", W / 2, H - 40 - assetHeightFor("wordmark", wmW) / 2, wmW, -0.03);
      },
      deco(c, t) {
        drawAsset(c, "sparkler", 140, 230, 330, -0.35);
        sparkBurst(c, 150, 120, 160, t, [C.gold, "#fff", C.rose]);
        drawAsset(c, "sparkler", W - 140, 230, 330, 0.35);
        sparkBurst(c, W - 150, 120, 160, t + 0.5, [C.gold, C.marigold, "#fff"]);
      },
    },
    {
      name: "Clean",
      mark: "wordmark", // lettering rule: banner OR wordmark, never both
      swatch: `url(assets/brand/wordmark.png) center/85% no-repeat, ${C.paper}`,
      strip: dottedBg(C.paper, "rgba(54,54,232,.18)"),
      frame(c) {
        const wmW = 260;
        drawAsset(c, "wordmark", W - 40 - wmW / 2, H - 40 - assetHeightFor("wordmark", wmW) / 2, wmW);
      },
      deco() {},
    },
  ];

  /** Colour-blocked wrapping paper with a gold ribbon, like the wordmark gift box. */
  function giftPaper(c, w, h) {
    const blocks = [[C.khaki, 0.3], [C.rose, 0.08], [C.marigold, 0.1], [C.leaf, 0.12], [C.indigo, 0.4]];
    let x = 0;
    blocks.forEach(([col, f]) => { c.fillStyle = col; c.fillRect(x, 0, w * f + 1, h); x += w * f; });
    c.fillStyle = C.gold;
    c.fillRect(w * 0.38 - w * 0.02, 0, w * 0.04, h);
    c.fillRect(0, h * 0.42 - w * 0.02, w, w * 0.04);
  }

  // ---------- Film look ----------
  // Warm, hazy instant-film look: soft glow, faded shadows, warm skin tones,
  // gentle vignette and visible grain. Colour stays in. Done with blend modes
  // (not ctx.filter) so it also works in Safari.
  const grainTiles = [];
  function grainTile() {
    if (!grainTiles.length) {
      for (let k = 0; k < 3; k++) {
        const g = document.createElement("canvas");
        g.width = g.height = 200;
        const gx = g.getContext("2d");
        const d = gx.createImageData(200, 200);
        for (let i = 0; i < d.data.length; i += 4) {
          const v = 128 + (Math.random() + Math.random() - 1) * 90;
          // A little colour in the grain, like film
          d.data[i] = v + (Math.random() - 0.5) * 24;
          d.data[i + 1] = v + (Math.random() - 0.5) * 24;
          d.data[i + 2] = v + (Math.random() - 0.5) * 24;
          d.data[i + 3] = 255;
        }
        gx.putImageData(d, 0, 0);
        grainTiles.push(g);
      }
    }
    return grainTiles[(Math.random() * grainTiles.length) | 0];
  }

  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = Math.round(W / 10);
  glowCanvas.height = Math.round(H / 10);
  const glowCtx = glowCanvas.getContext("2d");

  const CAN_FILTER = typeof ctx.filter === "string";

  function filmLook(c) {
    // Soft haze/bloom: a tiny blurred copy of the photo screened back on top
    glowCtx.imageSmoothingEnabled = true;
    glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
    glowCtx.drawImage(c.canvas, 0, 0, glowCanvas.width, glowCanvas.height);
    c.save();
    c.imageSmoothingEnabled = true;
    c.globalCompositeOperation = "screen";
    c.globalAlpha = 0.18;
    c.drawImage(glowCanvas, 0, 0, W, H);
    c.globalAlpha = 1;

    // Faded, milky shadows
    c.fillStyle = "rgb(36,22,16)";
    c.fillRect(0, 0, W, H);

    // Warm red-orange cast through the skin tones
    c.globalCompositeOperation = "soft-light";
    c.fillStyle = "rgba(255,112,50,.55)";
    c.fillRect(0, 0, W, H);

    // Gentle vignette
    c.globalCompositeOperation = "multiply";
    const v = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
    v.addColorStop(0, "rgba(255,255,255,0)");
    v.addColorStop(1, "rgba(110,80,75,.55)");
    c.fillStyle = v;
    c.fillRect(0, 0, W, H);

    // Visible grain, drawn a bit larger than 1:1 so it survives on a phone screen
    c.globalCompositeOperation = "overlay";
    c.globalAlpha = 0.32;
    const tile = grainTile();
    const scale = 1.6, step = tile.width * scale;
    const ox = -Math.random() * step, oy = -Math.random() * step;
    for (let y = oy; y < H; y += step) {
      for (let x = ox; x < W; x += step) c.drawImage(tile, x, y, step, step);
    }
    c.restore();
  }

  function bow(c, x, y, s) {
    c.save();
    c.translate(x, y);
    c.scale(s, s);
    c.fillStyle = C.gold;
    c.strokeStyle = "#d9a53e";
    c.lineWidth = 4;
    const loop = (dir) => {
      c.beginPath();
      c.moveTo(0, 20);
      c.bezierCurveTo(dir * 40, -50, dir * 110, -20, dir * 70, 25);
      c.bezierCurveTo(dir * 50, 45, dir * 20, 35, 0, 20);
      c.fill();
      c.stroke();
    };
    loop(-1);
    loop(1);
    c.beginPath();
    c.moveTo(-10, 25); c.lineTo(-45, 95); c.lineTo(-22, 88); c.lineTo(-12, 108); c.lineTo(0, 30);
    c.moveTo(10, 25); c.lineTo(45, 95); c.lineTo(22, 88); c.lineTo(12, 108); c.lineTo(0, 30);
    c.fill();
    c.beginPath();
    c.arc(0, 22, 16, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.restore();
  }

  // ---------- Render loop ----------
  const t0 = performance.now();
  let rafId = 0;

  function render(c = ctx, opts = {}) {
    const t = (performance.now() - t0) / 1000;
    c.fillStyle = C.ink;
    c.fillRect(0, 0, W, H);
    if (state.source) {
      // Punch the colour up first so the film fade doesn't leave it looking grey.
      if (CAN_FILTER) c.filter = "saturate(1.6) contrast(1.06)";
      drawCover(c, state.source, 0, 0, W, H, state.mirror);
      if (CAN_FILTER) {
        c.filter = "none";
      } else {
        // Browsers without canvas filters: overlay the photo on itself for more colour
        c.save();
        c.globalCompositeOperation = "overlay";
        c.globalAlpha = 0.45;
        c.drawImage(c.canvas, 0, 0);
        c.restore();
      }
      filmLook(c);
    }
    // Strip shots get just the props; the strip itself is the frame.
    const f = FILTERS[state.filter];
    const strip = state.mode === "strip";
    if (!strip) f.frame(c, t);
    f.deco(c, t, strip);
    state.stickers.forEach((s) => {
      drawAsset(c, s.name, s.x, s.y, s.size, s.rot);
      if (!opts.clean && s === state.selected) {
        c.save();
        c.strokeStyle = "rgba(255,255,255,.85)";
        c.setLineDash([14, 10]);
        c.lineWidth = 4;
        c.translate(s.x, s.y);
        c.rotate(s.rot);
        c.strokeRect(-s.size / 2 - 8, -s.size / 2 - 8, s.size + 16, s.size + 16);
        c.restore();
      }
    });
  }

  function loop() {
    render();
    rafId = requestAnimationFrame(loop);
  }

  // ---------- Camera ----------
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser can’t open the camera. Try Safari or Chrome, or use a photo instead.");
    }
    stopCamera();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facing, width: { ideal: 1920 }, height: { ideal: 1920 } },
      audio: false,
    });
    state.stream = stream;
    video.srcObject = stream;
    await video.play();
    state.source = video;
    state.mirror = state.facing === "user";
  }

  function stopCamera() {
    state.stream?.getTracks().forEach((tr) => tr.stop());
    state.stream = null;
  }

  // ---------- Screens ----------
  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    if (id === "booth") {
      cancelAnimationFrame(rafId);
      loop();
    } else {
      cancelAnimationFrame(rafId);
    }
  }

  // ---------- Capture ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function countdown(n = 3) {
    const el = $("countdown");
    for (let i = n; i > 0; i--) {
      el.textContent = i;
      beep(i === 1 ? 1175 : 880);
      el.classList.remove("pop");
      void el.offsetWidth;
      el.classList.add("pop");
      await sleep(850);
    }
    el.textContent = "";
    el.classList.remove("pop");
  }

  function flash() {
    const f = $("flash");
    f.classList.remove("go");
    void f.offsetWidth;
    f.classList.add("go");
  }

  /** Grab the current frame (without selection outline) as a canvas. */
  function snapshot() {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    render(c.getContext("2d"), { clean: true });
    return c;
  }

  function buildStrip(shots) {
    // Even "film" borders: the same width around and between every photo.
    const sw = 600, sh = 750, m = 30, footer = 200;
    const f = FILTERS[state.filter];
    const c = document.createElement("canvas");
    c.width = sw + m * 2;
    c.height = m + shots.length * sh + (shots.length - 1) * m + footer;
    const x = c.getContext("2d");
    f.strip(x, c.width, c.height);
    shots.forEach((s, i) => {
      const y = m + i * (sh + m);
      x.save();
      x.beginPath();
      roundRectPath(x, m, y, sw, sh, 6);
      x.clip();
      x.drawImage(s, m, y, sw, sh);
      x.restore();
      // A thin dark edge so each photo reads like a frame on the film
      x.save();
      x.beginPath();
      roundRectPath(x, m + 1, y + 1, sw - 2, sh - 2, 6);
      x.strokeStyle = "rgba(0,0,0,.28)";
      x.lineWidth = 2;
      x.stroke();
      x.restore();
    });
    const fy = c.height - footer;
    // One mark only: the filter's banner or the wordmark
    if (f.mark === "banner") {
      const bw = 560;
      litBannerAt(x, c.width / 2, fy + (footer - m - litBannerHeight(bw)) / 2, bw);
    } else {
      const wmW = 340;
      drawAsset(x, "wordmark", c.width / 2, fy + (footer - m) / 2, wmW);
    }
    return c;
  }

  // ---------- Sounds (tiny WebAudio synth, no files needed) ----------
  let audio = null;
  function ac() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
    } catch { audio = null; }
    return audio;
  }
  function beep(freq = 880, dur = 0.12, vol = 0.12) {
    const a = ac(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start(); o.stop(a.currentTime + dur);
  }
  function noise(dur, { vol = 0.2, freq = 2000, q = 0.8, wobble = 0 } = {}) {
    const a = ac(); if (!a) return;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
    const g = a.createGain();
    g.gain.setValueAtTime(vol, a.currentTime);
    if (wobble) {
      // Stuttering motor: dips in volume at the same moments the print pauses
      [0.22, 0.55].forEach((p) => {
        g.gain.setValueAtTime(vol, a.currentTime + dur * p);
        g.gain.linearRampToValueAtTime(vol * 0.15, a.currentTime + dur * p + 0.05);
        g.gain.setValueAtTime(vol * 0.15, a.currentTime + dur * (p + 0.07));
        g.gain.linearRampToValueAtTime(vol, a.currentTime + dur * (p + 0.07) + 0.05);
      });
    }
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  }
  const shutterSound = () => { noise(0.08, { vol: 0.5, freq: 3000, q: 0.6 }); setTimeout(() => noise(0.06, { vol: 0.35, freq: 1800 }), 90); };
  const motorSound = (dur) => noise(dur, { vol: 0.12, freq: 420, q: 2.5, wobble: 1 });

  const STRIP_SHOTS = 3;

  function resetFilmTray(n) {
    const tray = $("film-tray");
    tray.innerHTML = "";
    for (let i = 0; i < n; i++) tray.appendChild(document.createElement("span"));
  }

  function addToFilmTray(i, canvas) {
    const t = document.createElement("canvas");
    t.width = 80; t.height = 100;
    t.getContext("2d").drawImage(canvas, 0, 0, 80, 100);
    const cell = $("film-tray").children[i];
    if (cell) {
      cell.style.backgroundImage = `url(${t.toDataURL("image/jpeg", 0.7)})`;
      cell.classList.add("filled");
    }
  }

  async function capture() {
    if (state.busy) return;
    ac(); // unlock audio on the tap
    state.busy = true;
    $("shutter").disabled = true;
    state.selected = null;
    const tray = $("film-tray"), hint = $("hint"), prog = $("strip-progress");
    try {
      let out;
      if (state.mode === "strip") {
        const shots = [];
        resetFilmTray(STRIP_SHOTS);
        tray.hidden = false;
        hint.hidden = true;
        prog.hidden = false;
        for (let i = 0; i < STRIP_SHOTS; i++) {
          prog.textContent = `Photo ${i + 1} of ${STRIP_SHOTS}`;
          await countdown(3);
          flash();
          shutterSound();
          const shot = snapshot();
          shots.push(shot);
          addToFilmTray(i, shot);
          await sleep(i === STRIP_SHOTS - 1 ? 700 : 900);
        }
        out = buildStrip(shots);
      } else {
        await countdown(3);
        flash();
        shutterSound();
        out = snapshot();
        await sleep(600);
      }
      await showResult(out);
    } finally {
      state.busy = false;
      $("shutter").disabled = false;
      tray.hidden = true;
      hint.hidden = false;
      prog.hidden = true;
    }
  }

  function canvasToBlob(c) {
    return new Promise((res) => c.toBlob(res, "image/png"));
  }

  /** Save to the camera roll where possible: the share sheet on phones has "Save Image". */
  async function saveImage(blob, name) {
    const file = new File([blob], name, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        // Files only: adding text can hide "Save Image" on iPhone.
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return; // they closed the sheet
      }
    }
    if (hostDownloads) {
      hostDownloads.save({ filename: name, data: blob }).catch(() => {});
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  let printRun = 0;

  async function showResult(canvas) {
    const blob = await canvasToBlob(canvas);
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const name = `diwali-party-${stamp}.png`;
    state.photos.unshift({ url, name, blob });
    state.lastShotUrl = url;
    $("gallery-count").textContent = state.photos.length;

    const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File([blob], name, { type: "image/png" })] }));
    $("save-btn").textContent = canShareFiles ? "Save to Camera Roll" : "Download";
    $("save-hint").hidden = !canShareFiles;
    $("save-btn").onclick = () => saveImage(blob, name);

    // Size the print so the whole thing fits on screen once it has dropped out.
    const ratio = canvas.height / canvas.width;
    const availH = Math.max(260, window.innerHeight - 330);
    const maxW = state.mode === "strip" ? 200 : 250;
    const w = Math.round(Math.min(maxW, window.innerWidth - 64, availH / ratio));
    const inner = document.querySelector("#result .result-inner");
    inner.style.setProperty("--print-w", `${w}px`);
    inner.style.setProperty("--print-h", `${Math.round(w * ratio) + 12}px`);

    // The printer wears the same mark as the strip it prints
    $("printer-mark").src = FILTERS[state.filter].mark === "banner" ? "assets/brand/lets-get-lit.png" : "assets/brand/wordmark.png";
    const pic = $("result-img");
    const print = $("print");
    const status = $("develop-status");
    const actions = $("result-actions");
    pic.src = url;
    try { await pic.decode(); } catch { /* shows when loaded */ }

    const run = ++printRun;
    pic.className = "undeveloped";
    print.className = "print";
    actions.classList.add("waiting");
    inner.classList.add("printing");
    status.textContent = "Printing…";
    show("result");
    window.scrollTo(0, 0);

    void print.offsetWidth;
    print.classList.add("feeding");
    motorSound(3.4);
    await sleep(3400);
    if (run !== printRun) return;

    print.className = "print dropped";
    status.textContent = "Developing…";
    void pic.offsetWidth;
    pic.className = "developing";
    inner.classList.remove("printing");
    await sleep(2600);
    if (run !== printRun) return;

    status.textContent = "Ready!";
    actions.classList.remove("waiting");
  }

  // When running inside a claude.ai artifact, plain <a download> links are blocked,
  // so hand the file to the host's save dialog. Elsewhere the normal link is used.
  let hostDownloads = null;
  if (window.claude?.use) {
    window.claude.use("downloads").then((d) => (hostDownloads = d)).catch(() => {});
  }
  function saveViaHost(e, blob, name) {
    if (!hostDownloads) return;
    e.preventDefault();
    hostDownloads.save({ filename: name, data: blob }).catch(() => {});
  }

  // ---------- Stickers ----------
  function canvasPoint(e) {
    const r = stage.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  }

  function hitSticker(p) {
    for (let i = state.stickers.length - 1; i >= 0; i--) {
      const s = state.stickers[i];
      // Rotate the point into the sticker's local space
      const dx = p.x - s.x, dy = p.y - s.y;
      const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
      const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
      if (Math.abs(lx) <= s.size / 2 && Math.abs(ly) <= s.size / 2) return s;
    }
    return null;
  }

  function addSticker(name) {
    const n = state.stickers.length;
    const s = {
      name,
      x: W / 2 + ((n % 3) - 1) * 120,
      y: H / 2 + ((Math.floor(n / 3) % 3) - 1) * 120,
      size: name === "wordmark" ? 420 : 280,
      rot: (Math.random() - 0.5) * 0.4,
    };
    state.stickers.push(s);
    state.selected = s;
  }

  const pointers = new Map();
  let gesture = null;
  let lastTap = { time: 0, sticker: null };

  stage.addEventListener("pointerdown", (e) => {
    const p = canvasPoint(e);
    pointers.set(e.pointerId, p);
    stage.setPointerCapture(e.pointerId);

    if (pointers.size === 1) {
      const s = hitSticker(p);
      state.selected = s;
      if (s) {
        // Bring to front
        state.stickers.splice(state.stickers.indexOf(s), 1);
        state.stickers.push(s);
        const now = performance.now();
        if (lastTap.sticker === s && now - lastTap.time < 320) {
          state.stickers = state.stickers.filter((x) => x !== s);
          state.selected = null;
          gesture = null;
          lastTap = { time: 0, sticker: null };
          return;
        }
        lastTap = { time: now, sticker: s };
        gesture = { type: "drag", s, ox: p.x - s.x, oy: p.y - s.y };
      } else {
        gesture = null;
      }
    } else if (pointers.size === 2 && state.selected) {
      const [a, b] = [...pointers.values()];
      gesture = {
        type: "pinch",
        s: state.selected,
        d0: Math.hypot(b.x - a.x, b.y - a.y),
        a0: Math.atan2(b.y - a.y, b.x - a.x),
        size0: state.selected.size,
        rot0: state.selected.rot,
      };
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = canvasPoint(e);
    pointers.set(e.pointerId, p);
    if (!gesture) return;
    if (gesture.type === "drag" && pointers.size === 1) {
      gesture.s.x = p.x - gesture.ox;
      gesture.s.y = p.y - gesture.oy;
    } else if (gesture.type === "pinch" && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      gesture.s.size = Math.min(1400, Math.max(80, gesture.size0 * (d / gesture.d0)));
      gesture.s.rot = gesture.rot0 + (ang - gesture.a0);
    }
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) gesture = null;
    else if (pointers.size === 1 && gesture?.type === "pinch") {
      const p = [...pointers.values()][0];
      const s = gesture.s;
      gesture = { type: "drag", s, ox: p.x - s.x, oy: p.y - s.y };
    }
  };
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);

  stage.addEventListener("wheel", (e) => {
    const s = state.selected || hitSticker(canvasPoint(e));
    if (!s) return;
    e.preventDefault();
    if (e.shiftKey) s.rot += e.deltaY * 0.002;
    else s.size = Math.min(1400, Math.max(80, s.size * (1 - e.deltaY * 0.0015)));
  }, { passive: false });

  document.addEventListener("keydown", (e) => {
    if (!$("booth").classList.contains("active")) return;
    if ((e.key === "Delete" || e.key === "Backspace") && state.selected) {
      state.stickers = state.stickers.filter((x) => x !== state.selected);
      state.selected = null;
    } else if (e.key === " " && e.target === document.body) {
      e.preventDefault();
      capture();
    }
  });

  // ---------- UI wiring ----------
  function buildFilterChips() {
    const nav = $("filters");
    FILTERS.forEach((f, i) => {
      const b = document.createElement("button");
      b.className = "filter-chip";
      b.setAttribute("aria-pressed", String(i === state.filter));
      b.innerHTML = `<span class="sw"></span><span></span>`;
      b.querySelector(".sw").style.background = f.swatch;
      b.lastElementChild.textContent = f.name;
      b.addEventListener("click", () => {
        state.filter = i;
        nav.querySelectorAll(".filter-chip").forEach((x, j) => x.setAttribute("aria-pressed", String(j === i)));
        b.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      });
      nav.appendChild(b);
    });
  }

  function buildStickerTray() {
    const grid = $("tray-grid");
    STICKER_NAMES.forEach((n) => {
      const b = document.createElement("button");
      b.setAttribute("aria-label", `Add ${n.replace(/-/g, " ")} sticker`);
      b.innerHTML = `<img src="assets/brand/${n}.png" alt="" />`;
      b.addEventListener("click", () => {
        addSticker(n);
        toggleTray(false);
      });
      grid.appendChild(b);
    });
  }

  function toggleTray(open) {
    const tray = $("sticker-tray");
    const isOpen = open ?? tray.hidden;
    tray.hidden = !isOpen;
    $("stickers-btn").setAttribute("aria-expanded", String(isOpen));
  }

  function showWelcomeError(msg) {
    const el = $("welcome-error");
    el.textContent = msg;
    el.hidden = false;
  }

  function renderGallery() {
    const grid = $("gallery-grid");
    grid.innerHTML = "";
    $("gallery-empty").hidden = state.photos.length > 0;
    state.photos.forEach((p) => {
      const a = document.createElement("a");
      a.href = p.url;
      a.download = p.name;
      a.title = "Download";
      a.addEventListener("click", (e) => saveViaHost(e, p.blob, p.name));
      a.innerHTML = `<img alt="Diwali Party photo" />`;
      a.firstElementChild.src = p.url;
      grid.appendChild(a);
    });
  }

  async function enterBoothWithCamera() {
    const btn = $("start-btn");
    btn.disabled = true;
    btn.textContent = "Opening camera…";
    try {
      await startCamera();
      $("flip-btn").hidden = false;
      show("booth");
    } catch (err) {
      const denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
      showWelcomeError(
        denied
          ? "Camera access was blocked. Allow camera access in your browser settings, or use a photo instead."
          : err.message || "Couldn’t open the camera. You can use a photo instead."
      );
    } finally {
      btn.disabled = false;
      btn.textContent = "Open the booth";
    }
  }

  function wire() {
    $("start-btn").addEventListener("click", enterBoothWithCamera);

    $("upload-input").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      try {
        const i = await loadImage(url);
        stopCamera();
        state.source = i;
        state.mirror = false;
        $("flip-btn").hidden = true;
        show("booth");
      } catch {
        showWelcomeError("That file couldn’t be opened as an image.");
      }
      e.target.value = "";
    });

    $("shutter").addEventListener("click", capture);

    document.querySelectorAll(".mode-toggle button").forEach((b) =>
      b.addEventListener("click", () => {
        state.mode = b.dataset.mode;
        document.querySelectorAll(".mode-toggle button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      })
    );

    $("flip-btn").addEventListener("click", async () => {
      state.facing = state.facing === "user" ? "environment" : "user";
      try {
        await startCamera();
      } catch {
        state.facing = state.facing === "user" ? "environment" : "user";
        await startCamera().catch(() => {});
      }
    });

    $("stickers-btn").addEventListener("click", () => toggleTray());
    $("clear-stickers").addEventListener("click", () => {
      state.stickers = [];
      state.selected = null;
      toggleTray(false);
    });

    $("retake-btn").addEventListener("click", () => {
      printRun++;
      show("booth");
    });
    $("gallery-btn").addEventListener("click", () => {
      renderGallery();
      show("gallery");
    });
    $("gallery-close").addEventListener("click", () => show(state.source ? "booth" : "welcome"));
  }

  // ---------- Boot ----------
  async function boot() {
    buildFilterChips();
    buildStickerTray();
    wire();
    await Promise.all([
      ...ASSET_NAMES.map((n) => loadImage(`assets/brand/${n}.png`).then((i) => (img[n] = i)).catch(() => {})),
      document.fonts?.load(`100px "Abril Fatface"`).catch(() => {}),
      document.fonts?.load(`800 40px "Outfit"`).catch(() => {}),
      document.fonts?.load(`600 40px "Outfit"`).catch(() => {}),
    ]);
  }

  // Expose a tiny hook for automated checks.
  window.__booth = { state, FILTERS, render, snapshot, buildStrip };
  boot();
})();
