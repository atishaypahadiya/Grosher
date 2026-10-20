// Produce's textures, drawn in the page by gen-hero-textures.mjs (a second page.evaluate: self-contained, no
// closures; the data comes in as `d`). Returns { name: dataURL } for hi and `.lo` (half size):
//
//   oak        1024², warm oak planks 12 cm wide, staggered joints, oiled (tile 1.6 m)
//   brushed    512², brushed stainless, grain along u
//   chalk      2048 × 1280: chalkboards (slate, handwritten white chalk, the price under the name), the juice
//              labels (white, GROSHER PRESS, the number big), black header boards with white uppercase
//   packs      2048 × 1024, 8 × 4 cells of 256: what shows through a tub, a punnet, a clamshell, a bag
//   mounds     1024 × 512, 8 × 4 cells of 128: piles at the fruit's real size, near-white (tinted), tileable
//   foliage    1024², RGBA, 4 × 4 cells of 256: leaves, fronds, a pineapple's crown, blooms (alpha-tested)

export async function drawProduce(d) {
  const face = new FontFace("Outfit", `url(data:font/woff2;base64,${d.font})`, { weight: "100 900" });
  await face.load();
  document.fonts.add(face);
  let seed = 41;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const canvas = (w, h) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  };
  const periodic = (cells) => {
    const g = Array.from({ length: cells * cells }, () => rand());
    const at = (i, j) => g[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
    const s = (t) => t * t * (3 - 2 * t);
    return (u, v) => {
      const x = u * cells;
      const y = v * cells;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = s(x - x0);
      const fy = s(y - y0);
      return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    };
  };
  const fbm = (octaves) => {
    const ns = octaves.map(([c]) => periodic(c));
    const total = octaves.reduce((s, [, a]) => s + a, 0);
    return (u, v) => ns.reduce((s, n, i) => s + n(u, v) * octaves[i][1], 0) / total;
  };
  const paint = (w, h, f) => {
    const c = canvas(w, h);
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const [r, g, b] = f(x / w, y / h, x, y);
        const i = (y * w + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return c;
  };
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const half = (c) => {
    const h = canvas(c.width / 2, c.height / 2);
    const ctx = h.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(c, 0, 0, h.width, h.height);
    return h;
  };
  const out = {};
  const put = (name, c) => {
    out[name] = c.toDataURL("image/png");
    out[`${name}.lo`] = half(c).toDataURL("image/png");
  };
  const rgb = (h, k = 1) => {
    const n = parseInt(h.slice(1), 16);
    return [((n >> 16) & 255) * k, ((n >> 8) & 255) * k, (n & 255) * k];
  };
  const css = (c, a = 1) => `rgba(${clamp(c[0])},${clamp(c[1])},${clamp(c[2])},${a})`;

  // ---------------------------------------------------------------- oak planks: 12 cm wide, warm, oiled
  {
    const N = 1024;
    const PLANKS = 13; // across the 1.6 m tile
    /** periodic noise with its own cell count along u and v: long grain that still tiles */
    const periodic2 = (cu, cv) => {
      const g = Array.from({ length: cu * cv }, () => rand());
      const at = (i, j) => g[(((j % cv) + cv) % cv) * cu + (((i % cu) + cu) % cu)];
      const s = (t) => t * t * (3 - 2 * t);
      return (u, v) => {
        const x = u * cu;
        const y = v * cv;
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = s(x - x0);
        const fy = s(y - y0);
        return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      };
    };
    const lens = Array.from({ length: PLANKS }, () => [rand(), 0.36 + rand() * 0.4]); // joint offset, length (tile fractions)
    const tones = Array.from({ length: PLANKS * 3 }, () => (rand() - 0.5) * 34);
    const wave = periodic2(3, PLANKS * 4); // the grain's slow wander along the plank
    const streak = periodic2(8, PLANKS * 40); // fine fibres
    const pores = periodic2(64, PLANKS * 60);
    put("oak", paint(N, N, (u, v) => {
      const p = v * PLANKS;
      const row = Math.floor(p);
      const across = p - row;
      const [off, len] = lens[row];
      const along = (u + off) / len;
      const seg = Math.floor(along);
      const t = along - seg;
      const tone = tones[(row * 3 + (((seg % 3) + 3) % 3)) % tones.length];
      // growth rings cut lengthways: lines along the plank, wandering a little
      const w = wave(u, v + seg * 0.13);
      const lines = Math.pow(Math.abs(Math.sin((across * 5 + w * 2.2 + row * 0.7) * Math.PI)), 7);
      let l = tone - lines * 22 + (streak(u, v) - 0.5) * 20 + (pores(u, v) - 0.5) * 10;
      // the gaps between planks and at their ends: thin dark lines
      if (across < 0.03 || across > 0.975 || t < 0.0025 / len || t > 1 - 0.0025 / len) l -= 70;
      return [clamp(176 + l), clamp(122 + l * 0.85), clamp(76 + l * 0.65)];
    }));
  }
  // ---------------------------------------------------------------- brushed stainless
  {
    const streak = periodic(4);
    const fine = periodic(160);
    put("brushed", paint(512, 512, (u, v) => {
      const s = (fine(u * 0.02, v) - 0.5) * 16 + (streak(u * 0.3, v * 40) - 0.5) * 8 + (streak(u, v * 4) - 0.5) * 6;
      return [clamp(168 + s), clamp(170 + s), clamp(170 + s)];
    }));
  }

  // ---------------------------------------------------------------- chalk: boards, juice labels, headers
  {
    const [W, H] = d.CHALK_ATLAS;
    const c = canvas(W, H);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#1A1C1B";
    ctx.fillRect(0, 0, W, H);
    const dust = (x, y, w, h) => {
      // slate: a dark green-black, wiped, the ghosts of old writing
      const img = ctx.getImageData(x, y, w, h);
      const n = periodic(9);
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const k = (j * w + i) * 4;
          // smooth (noise would cost the atlas its compression): the wipes are low-frequency only
          const l = (n(i / w + x * 0.001, j / h) - 0.5) * 16;
          img.data[k] = clamp(30 + l);
          img.data[k + 1] = clamp(33 + l);
          img.data[k + 2] = clamp(31 + l);
          img.data[k + 3] = 255;
        }
      ctx.putImageData(img, x, y);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.filter = "blur(6px)";
      ctx.fillStyle = "rgba(230,230,224,0.05)";
      for (let s = 0; s < 2; s++) {
        ctx.beginPath();
        ctx.ellipse(x + rand() * w, y + rand() * h, 30 + rand() * 40, 5 + rand() * 6, (rand() - 0.5) * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };
    /** handwriting from Outfit: each letter turned and lifted a little, slanted, then roughened like chalk */
    const chalkText = (text, cx, cy, size, color = "rgba(246,244,236,0.95)", maxW = 1e9) => {
      ctx.save();
      ctx.font = `500 ${size}px Outfit`;
      let w = 0;
      const widths = [...text].map((ch) => ctx.measureText(ch).width * 0.96);
      w = widths.reduce((a, b) => a + b, 0);
      const k = Math.min(1, maxW / w);
      let x = cx - (w * k) / 2;
      ctx.fillStyle = color;
      [...text].forEach((ch, i) => {
        ctx.save();
        ctx.translate(x + (widths[i] * k) / 2, cy + (rand() - 0.5) * size * 0.08);
        ctx.rotate((rand() - 0.5) * 0.12);
        ctx.transform(k, 0, -0.16, 1, 0, 0);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(ch, 0, 0);
        ctx.restore();
        x += widths[i] * k;
      });
      ctx.restore();
    };
    const roughen = (x, y, w, h) => {
      // chalk does not cover: knock speckles out of the strokes, leave dust round them
      const img = ctx.getImageData(x, y, w, h);
      for (let k = 0; k < img.data.length; k += 4) {
        const l = img.data[k];
        if (l > 90 && rand() < 0.12) {
          const v = 110 + rand() * 50;
          img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
        }
      }
      ctx.putImageData(img, x, y);
    };
    const S = d.SIGN;
    d.SIGNS.forEach((s, i) => {
      const x = (i % S.cols) * S.w;
      const y = Math.floor(i / S.cols) * S.h;
      dust(x, y, S.w, S.h);
      // the name, on one line or two; the price under it, a little bigger, a line drawn under the name
      const words = s.name.split(" ");
      let lines = [s.name];
      ctx.font = `500 26px Outfit`;
      if (ctx.measureText(s.name).width > S.w - 24 && words.length > 1) {
        let best = 1;
        let bestW = 1e9;
        for (let b = 1; b < words.length; b++) {
          const wmax = Math.max(ctx.measureText(words.slice(0, b).join(" ")).width, ctx.measureText(words.slice(b).join(" ")).width);
          if (wmax < bestW) {
            bestW = wmax;
            best = b;
          }
        }
        lines = [words.slice(0, best).join(" "), words.slice(best).join(" ")];
      }
      const size = lines.length === 1 ? 25 : 21;
      lines.forEach((l, k) => chalkText(l, x + S.w / 2, y + (lines.length === 1 ? 26 : 17 + k * 21), size, undefined, S.w - 20));
      ctx.strokeStyle = "rgba(240,238,230,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const ly = y + (lines.length === 1 ? 43 : 51);
      ctx.moveTo(x + S.w * 0.28, ly);
      ctx.quadraticCurveTo(x + S.w * 0.5, ly + 2, x + S.w * 0.72, ly - 1);
      ctx.stroke();
      chalkText(s.price, x + S.w / 2, y + S.h - 18, 23, "rgba(246,232,170,0.95)", S.w - 24);
      roughen(x, y, S.w, S.h);
    });
    // the juice labels: white, the line's name small, the number big, the juice's name, the size
    const J = d.JUICE_LABEL;
    d.JUICES.forEach((j) => {
      const x = (j.n - 1) * J.w;
      const y = J.y;
      ctx.fillStyle = "#F7F5F0";
      ctx.fillRect(x + 2, y + 2, J.w - 4, J.h - 4);
      ctx.fillStyle = "#1E1D1C";
      ctx.textAlign = "center";
      ctx.font = "600 8px Outfit";
      ctx.letterSpacing = "1px";
      ctx.fillText("GROSHER PRESS", x + J.w / 2, y + 20);
      ctx.letterSpacing = "0px";
      ctx.font = "700 40px Outfit";
      ctx.fillText(`J${String(j.n).padStart(2, "0")}`, x + J.w / 2, y + 66);
      let size = 11;
      ctx.font = `500 ${size}px Outfit`;
      while (ctx.measureText(j.name).width > J.w - 10 && size > 7) ctx.font = `500 ${--size}px Outfit`;
      ctx.fillText(j.name, x + J.w / 2, y + 88);
      ctx.fillStyle = j.color;
      ctx.fillRect(x + 16, y + 98, J.w - 32, 4);
      ctx.fillStyle = "#5A5854";
      ctx.font = "500 7px Outfit";
      ctx.fillText("COLD-PRESSED", x + J.w / 2, y + 113);
      ctx.fillText("12 FL OZ", x + J.w / 2, y + 122);
    });
    // header boards: black, white uppercase, as the shelf kit's
    const HD = d.HEADER;
    d.HEADERS.forEach((t, i) => {
      const x = (i % HD.cols) * HD.w;
      const y = HD.y + Math.floor(i / HD.cols) * HD.h;
      ctx.fillStyle = "#151413";
      ctx.fillRect(x, y, HD.w, HD.h);
      ctx.fillStyle = "#F4F1EA";
      ctx.textAlign = "center";
      let size = 30;
      ctx.letterSpacing = "3px";
      ctx.font = `600 ${size}px Outfit`;
      while (ctx.measureText(t).width > HD.w - 30 && size > 12) ctx.font = `600 ${--size}px Outfit`;
      ctx.fillText(t, x + HD.w / 2, y + HD.h / 2 + size * 0.36);
      ctx.letterSpacing = "0px";
    });
    put("chalk", c);
  }

  // ---------------------------------------------------------------- packs: what shows through the plastic
  {
    const C = 256;
    const c = canvas(C * 8, C * 5);
    const ctx = c.getContext("2d");
    const cell = (i) => [(i % 8) * C, Math.floor(i / 8) * C];
    /** chunks: shaded rounded blocks of the given colours, packed and overlapping, front to back */
    const chunks = (x0, y0, colors, o = {}) => {
      // packed full, as the reference's tubs are: what shows between the pieces is the fruit's own colour, darker
      const n = Math.round((o.n ?? 70) * 1.6);
      const base = o.base ?? css(rgb(colors[0], 0.5));
      ctx.fillStyle = base;
      ctx.fillRect(x0, y0, C, C);
      for (let k = 0; k < n; k++) {
        const col = rgb(colors[Math.floor(rand() * colors.length)], 0.85 + rand() * 0.25);
        const s = (o.size ?? 34) * (0.7 + rand() * 0.6);
        const x = x0 + rand() * C;
        const y = y0 + rand() * C;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, C, C);
        ctx.clip();
        ctx.translate(x, y);
        ctx.rotate(rand() * Math.PI);
        const g = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
        g.addColorStop(0, css(col.map((q) => q * 1.18)));
        g.addColorStop(1, css(col.map((q) => q * 0.72)));
        ctx.fillStyle = g;
        if (o.round) {
          ctx.beginPath();
          ctx.ellipse(0, 0, s / 2, s / 2 * (o.round === true ? 1 : o.round), 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const r = s * 0.18;
          ctx.beginPath();
          ctx.roundRect(-s / 2, -s / 2, s, s * (0.7 + rand() * 0.4), r);
          ctx.fill();
        }
        if (o.seeds) {
          ctx.fillStyle = "rgba(20,20,16,0.7)";
          for (let q = 0; q < 6; q++) ctx.fillRect((rand() - 0.5) * s * 0.6, (rand() - 0.5) * s * 0.6, 2, 3);
        }
        ctx.restore();
      }
      // the plastic's sheen: a soft diagonal highlight
      const sh = ctx.createLinearGradient(x0, y0, x0 + C, y0 + C);
      sh.addColorStop(0.2, "rgba(255,255,255,0)");
      sh.addColorStop(0.35, "rgba(255,255,255,0.18)");
      sh.addColorStop(0.5, "rgba(255,255,255,0)");
      ctx.fillStyle = sh;
      ctx.fillRect(x0, y0, C, C);
    };
    const kiwi = (x0, y0, n = 26) => {
      for (let k = 0; k < n; k++) {
        const x = x0 + rand() * C;
        const y = y0 + rand() * C;
        const r = 18 + rand() * 8;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, C, C);
        ctx.clip();
        ctx.fillStyle = "#6E9A2A";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#E8EAC0";
        ctx.beginPath();
        ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1E1A10";
        for (let q = 0; q < 12; q++) {
          const a = (q / 12) * Math.PI * 2;
          ctx.fillRect(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45, 2, 2);
        }
        ctx.restore();
      }
    };
    const leaves = (x0, y0, colors, n, w, h) => {
      ctx.fillStyle = "#3A5A2A";
      ctx.fillRect(x0, y0, C, C);
      for (let k = 0; k < n; k++) {
        const col = rgb(colors[Math.floor(rand() * colors.length)], 0.8 + rand() * 0.35);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, C, C);
        ctx.clip();
        ctx.translate(x0 + rand() * C, y0 + rand() * C);
        ctx.rotate(rand() * Math.PI * 2);
        ctx.fillStyle = css(col);
        ctx.beginPath();
        ctx.ellipse(0, 0, w * (0.6 + rand() * 0.6), h * (0.6 + rand() * 0.6), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = css(col.map((q) => q * 1.3), 0.6);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-w, 0);
        ctx.lineTo(w, 0);
        ctx.stroke();
        ctx.restore();
      }
    };
    const DRAW = {
      fruitMedley: (x, y) => { chunks(x, y, ["#F2C230", "#E8505A", "#F0902A", "#8CC04A", "#F4E070"], { n: 60 }); kiwi(x, y, 6); },
      watermelonCubes: (x, y) => chunks(x, y, ["#E8404A", "#F05A60", "#D8303A"], { n: 70, seeds: true }),
      pineappleChunks: (x, y) => chunks(x, y, ["#F4D040", "#F0C838", "#F8DC60"], { n: 80, size: 30 }),
      mangoChunks: (x, y) => chunks(x, y, ["#F0A020", "#F4B030", "#E8902A"], { n: 70 }),
      cantaloupeCubes: (x, y) => chunks(x, y, ["#F09A50", "#F4A860"], { n: 70 }),
      honeydewCubes: (x, y) => chunks(x, y, ["#C8E09A", "#D4E8A8"], { n: 70 }),
      kiwiSlices: (x, y) => { ctx.fillStyle = "#C8D89A"; ctx.fillRect(x, y, C, C); kiwi(x, y, 34); },
      grapesMix: (x, y) => chunks(x, y, ["#6A2A4A", "#8AB04A", "#7A3A5A", "#A8C860"], { n: 90, size: 26, round: 0.85 }),
      berryCups: (x, y) => chunks(x, y, ["#C8202A", "#3A3A7A", "#7A1A3A", "#E8404A"], { n: 110, size: 22, round: true }),
      papayaCubes: (x, y) => chunks(x, y, ["#F07A3A", "#F48A4A"], { n: 70 }),
      citrusSegments: (x, y) => chunks(x, y, ["#F0902A", "#F8C848", "#F0A060"], { n: 60, size: 40, round: 0.45 }),
      dragonfruit: (x, y) => chunks(x, y, ["#F2F0EA", "#E8306A"], { n: 70, seeds: true }),
      stirFry: (x, y) => chunks(x, y, ["#3E8A2A", "#E8B030", "#C8302A", "#F0E8D0", "#E87A2A"], { n: 90, size: 26 }),
      veggieNoodles: (x, y) => {
        ctx.fillStyle = "#D8E0A0";
        ctx.fillRect(x, y, C, C);
        for (let k = 0; k < 90; k++) {
          ctx.strokeStyle = css(rgb(rand() < 0.5 ? "#7AA03A" : "#E8C060", 0.9 + rand() * 0.2));
          ctx.lineWidth = 5;
          ctx.beginPath();
          const sx = x + rand() * C;
          const sy = y + rand() * C;
          ctx.moveTo(sx, sy);
          ctx.bezierCurveTo(sx + 40, sy - 30, sx - 30, sy + 40, sx + (rand() - 0.5) * 80, sy + (rand() - 0.5) * 80);
          ctx.stroke();
        }
      },
      dicedOnion: (x, y) => chunks(x, y, ["#F2EEE0", "#E8E0C8", "#F8F4EA"], { n: 120, size: 18 }),
      broccoliFlorets: (x, y) => chunks(x, y, ["#2E5A26", "#3A6A2A", "#4A7A32"], { n: 70, size: 40, round: true }),
      carrotSticks: (x, y) => chunks(x, y, ["#F0802A", "#E8742A", "#F0A040"], { n: 90, size: 30, round: 0.25 }),
      butternutCubes: (x, y) => chunks(x, y, ["#F0A040", "#E89A3A"], { n: 70 }),
      strawberries: (x, y) => {
        ctx.fillStyle = "#8A1A1A";
        ctx.fillRect(x, y, C, C);
        for (let k = 0; k < 24; k++) {
          const sx = x + rand() * C;
          const sy = y + rand() * C;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, C, C);
          ctx.clip();
          ctx.translate(sx, sy);
          ctx.rotate(rand() * 6);
          const g = ctx.createRadialGradient(-6, -6, 2, 0, 0, 34);
          g.addColorStop(0, "#F0504A");
          g.addColorStop(1, "#A8141E");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(0, -30);
          ctx.bezierCurveTo(30, -28, 24, 18, 0, 30);
          ctx.bezierCurveTo(-24, 18, -30, -28, 0, -30);
          ctx.fill();
          ctx.fillStyle = "#F4E070";
          for (let q = 0; q < 14; q++) ctx.fillRect((rand() - 0.5) * 34, (rand() - 0.5) * 44, 1.5, 2);
          ctx.fillStyle = "#3A7A2A";
          ctx.beginPath();
          ctx.ellipse(0, -28, 14, 5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      },
      blueberries: (x, y) => chunks(x, y, ["#3A3E6A", "#2E3260", "#4A4A7A"], { n: 150, size: 22, round: true, base: "#22243A" }),
      raspberries: (x, y) => chunks(x, y, ["#C8244A", "#B81E40", "#D83A5A"], { n: 110, size: 26, round: true, base: "#6A1020" }),
      blackberries: (x, y) => chunks(x, y, ["#2A1A2A", "#3A2034", "#1E141E"], { n: 110, size: 26, round: true, base: "#140A12" }),
      whiteMushrooms: (x, y) => chunks(x, y, ["#F2EEE6", "#E8E2D6", "#DCD4C4"], { n: 40, size: 56, round: true, base: "#B8AC98" }),
      babyBella: (x, y) => chunks(x, y, ["#8A6A4A", "#7A5A3E", "#9A7A58"], { n: 40, size: 56, round: true, base: "#4A3828" }),
      shiitake: (x, y) => chunks(x, y, ["#6A4A30", "#5A3E28", "#7A5A3A"], { n: 34, size: 64, round: 0.8, base: "#3A2A1C" }),
      oyster: (x, y) => chunks(x, y, ["#D8D0C0", "#C8BEAC", "#E4DCCC"], { n: 34, size: 64, round: 0.6, base: "#9A9080" }),
      sprouts: (x, y) => {
        ctx.fillStyle = "#E8E4D0";
        ctx.fillRect(x, y, C, C);
        for (let k = 0; k < 240; k++) {
          ctx.strokeStyle = rand() < 0.15 ? "rgba(200,200,90,0.9)" : "rgba(250,248,236,0.9)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          const sx = x + rand() * C;
          const sy = y + rand() * C;
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(sx + (rand() - 0.5) * 30, sy - 20, sx + (rand() - 0.5) * 40, sy - 40);
          ctx.stroke();
        }
      },
      microgreens: (x, y) => leaves(x, y, ["#7AB84A", "#6AA840", "#8AC858", "#B8448A"], 260, 9, 5),
      spinach: (x, y) => leaves(x, y, ["#2E5A26", "#3A6A2E", "#264E20"], 90, 26, 16),
      springMix: (x, y) => leaves(x, y, ["#3A6A2E", "#7AA840", "#7A2A3A", "#5A8A3A", "#A8C860"], 110, 22, 13),
      saladKit: (x, y) => {
        // the bag's print: kraft and white, a window onto the leaves, the house name
        ctx.fillStyle = "#F4F1EA";
        ctx.fillRect(x, y, C, C);
        leaves(x + 40, y + 70, ["#3A6A2E", "#7AA840", "#5A8A3A", "#E8E0A0"], 30, 20, 12);
        ctx.fillStyle = "#F4F1EA";
        ctx.fillRect(x, y, C, 70);
        ctx.fillRect(x, y + 200, C, 56);
        ctx.fillRect(x, y + 70, 40, 130);
        ctx.fillRect(x + 216, y + 70, 40, 130);
        ctx.fillStyle = "#3E6A2E";
        ctx.fillRect(x, y + 210, C, 46);
        ctx.fillStyle = "#1E1D1C";
        ctx.textAlign = "center";
        ctx.font = "700 26px Outfit";
        ctx.fillText("GROSHER", x + C / 2, y + 36);
        ctx.font = "500 18px Outfit";
        ctx.fillText("Salad Kit", x + C / 2, y + 60);
        ctx.fillStyle = "#F4F1EA";
        ctx.font = "600 16px Outfit";
        ctx.fillText("CHOPPED · 10 OZ", x + C / 2, y + 238);
      },
      grapes: (x, y) => chunks(x, y, ["#F0F0EC", "#E0E0DA", "#D0D0C8"], { n: 140, size: 26, round: 0.85, base: "#8A8A84" }),
      // far rows, seen from the aisle: four bottles side by side (a juice each, the white label, a dark cap)
      bottlesRow: (x, y) => {
        ctx.fillStyle = "#3A3E3C";
        ctx.fillRect(x, y, C, C);
        ["#6E9A2E", "#E8802A", "#8A1E3A", "#E8D86A"].forEach((col, k) => {
          const bx = x + k * 64 + 8;
          ctx.fillStyle = "rgba(230,236,232,0.35)";
          ctx.fillRect(bx, y + 40, 48, 216);
          ctx.fillStyle = col;
          ctx.fillRect(bx + 3, y + 70, 42, 186);
          ctx.fillStyle = "#F7F5F0";
          ctx.fillRect(bx + 1, y + 130, 46, 76);
          ctx.fillStyle = "#1E1D1C";
          ctx.fillRect(bx + 14, y + 150, 20, 14);
          ctx.fillStyle = "#151515";
          ctx.fillRect(bx + 14, y + 16, 20, 26);
        });
      },
      // energy balls and bites: rolled balls, close-packed, dusted or coated, each a shade apart
      bitesCocoa: (x, y) => chunks(x, y, ["#4A2E1E", "#5A3826", "#3E2618"], { n: 60, size: 46, round: true, base: "#2A1A10" }),
      bitesCoconut: (x, y) => chunks(x, y, ["#EDE6D6", "#E2D8C4", "#F4EEE2"], { n: 60, size: 46, round: true, base: "#9A8E78" }),
      bitesDate: (x, y) => chunks(x, y, ["#7A4A2A", "#8A5A32", "#6A3E22"], { n: 60, size: 46, round: true, base: "#3A2414" }),
      bitesMatcha: (x, y) => chunks(x, y, ["#8AA04A", "#7A9440", "#9AAE5A"], { n: 60, size: 46, round: true, base: "#3E4A22" }),
      headsRow: (x, y) => {
        ctx.fillStyle = "#2E4A26";
        ctx.fillRect(x, y, C, C);
        for (let k = 0; k < 3; k++) {
          const cx = x + 43 + k * 85;
          for (let q = 0; q < 9; q++) {
            ctx.fillStyle = css(rgb(q % 2 ? "#7AB44A" : "#5A9A3A", 0.85 + rand() * 0.3));
            ctx.beginPath();
            ctx.ellipse(cx + (rand() - 0.5) * 50, y + 150 + (rand() - 0.5) * 60, 30 + rand() * 14, 40 + rand() * 20, rand(), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      },
      herbsRow: (x, y) => {
        ctx.fillStyle = "#2A3E22";
        ctx.fillRect(x, y, C, C);
        for (let k = 0; k < 5; k++) {
          const cx = x + 26 + k * 51;
          ctx.strokeStyle = "#5A8A3A";
          ctx.lineWidth = 3;
          for (let q = 0; q < 6; q++) {
            ctx.beginPath();
            ctx.moveTo(cx, y + C);
            ctx.lineTo(cx + (rand() - 0.5) * 40, y + 90);
            ctx.stroke();
          }
          for (let q = 0; q < 14; q++) {
            ctx.fillStyle = css(rgb("#4A8A32", 0.8 + rand() * 0.4));
            ctx.beginPath();
            ctx.arc(cx + (rand() - 0.5) * 46, y + 40 + rand() * 90, 9 + rand() * 8, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = "#B89A6A";
          ctx.fillRect(cx - 10, y + 170, 20, 8);
        }
      },
    };
    d.PACKS.forEach((id, i) => {
      const [x, y] = cell(i);
      ctx.save();
      DRAW[id](x, y);
      ctx.restore();
    });
    put("packs", c);
  }

  // ---------------------------------------------------------------- mounds: piles at real size, near-white
  {
    const C = 128;
    const c = canvas(C * 8, C * 4);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#6A6A66";
    ctx.fillRect(0, 0, c.width, c.height);
    d.MOUNDS.forEach((m, i) => {
      const x0 = (i % 8) * C;
      const y0 = Math.floor(i / 8) * C;
      const px = (m.size / m.cellM) * C; // a fruit's size in pixels
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, C, C);
      ctx.clip();
      // the gaps between them: the shade inside a pile
      ctx.fillStyle = "#34322F";
      ctx.fillRect(x0, y0, C, C);
      // packed: every gap shows another fruit under it
      const n = Math.round(((C * C) / (px * px)) * 4);
      for (let k = 0; k < n; k++) {
        const x = rand() * C;
        const y = rand() * C;
        const s = px * (0.75 + rand() * 0.45);
        const l = 200 + rand() * 50;
        // tileable: drawn wrapped round the cell's edges
        for (const [ox, oy] of [[0, 0], [C, 0], [-C, 0], [0, C], [0, -C], [C, C], [-C, -C], [C, -C], [-C, C]]) {
          ctx.save();
          ctx.translate(x0 + x + ox, y0 + y + oy);
          ctx.rotate(rand() * Math.PI);
          const g = ctx.createRadialGradient(-s * 0.18, -s * 0.2, s * 0.05, 0, 0, s * 0.6);
          g.addColorStop(0, `rgb(${l},${l},${l})`);
          g.addColorStop(0.7, `rgb(${l * 0.7},${l * 0.7},${l * 0.7})`);
          g.addColorStop(1, `rgb(${l * 0.35},${l * 0.35},${l * 0.35})`);
          ctx.fillStyle = g;
          ctx.beginPath();
          if (m.id === "long") ctx.ellipse(0, 0, s * 0.5, s * 0.16, 0, 0, Math.PI * 2);
          else if (m.id === "thin") ctx.ellipse(0, 0, s * 0.5, s * 0.07, 0, 0, Math.PI * 2);
          else if (m.id === "lumpy") ctx.ellipse(0, 0, s * 0.55, s * 0.38, 0, 0, Math.PI * 2);
          else if (m.id === "punnet") ctx.roundRect(-s * 0.5, -s * 0.38, s, s * 0.76, s * 0.08);
          else if (m.id === "leafy") ctx.ellipse(0, 0, s * 0.55, s * 0.3, 0, 0, Math.PI * 2);
          else ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.restore();
    });
    put("mounds", c);
  }

  // ---------------------------------------------------------------- foliage: leaves, fronds, blooms (RGBA)
  {
    const C = 256;
    const c = canvas(C * 4, C * 4);
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    const leaf = (x, y, len, wid, ang, col, serr = 0) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      const g = ctx.createLinearGradient(0, -wid, 0, wid);
      g.addColorStop(0, css(col.map((q) => q * 0.8)));
      g.addColorStop(0.5, css(col.map((q) => q * 1.1)));
      g.addColorStop(1, css(col.map((q) => q * 0.75)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const w = Math.sin(t * Math.PI) * wid * (1 + (serr && i % 2 ? serr : 0));
        ctx.lineTo(t * len, -w);
      }
      for (let i = steps; i >= 0; i--) {
        const t = i / steps;
        const w = Math.sin(t * Math.PI) * wid * (1 + (serr && i % 2 ? serr : 0));
        ctx.lineTo(t * len, w);
      }
      ctx.fill();
      ctx.strokeStyle = css(col.map((q) => q * 1.35), 0.7);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len * 0.95, 0);
      ctx.stroke();
      ctx.restore();
    };
    const stem = (x0, y0, x1, y1, col, w = 2) => {
      ctx.strokeStyle = css(col);
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    };
    const GREEN = rgb("#4E8A34");
    const PALE = rgb("#DCECCB"); // herbs and greens: pale, the instance's colour tints them
    const at = (i) => [(i % 4) * C, Math.floor(i / 4) * C];
    const DRAW = {
      // a long pinnate frond, from the bottom centre up
      palm: (x, y) => {
        stem(x + C / 2, y + C, x + C / 2, y + 8, rgb("#5A7A3A"), 3);
        for (let k = 0; k < 22; k++) {
          const t = k / 22;
          const yy = y + C - t * (C - 16);
          const len = 70 * Math.sin((0.2 + t * 0.8) * Math.PI) + 10;
          leaf(x + C / 2, yy, len, 5, -0.55 - t * 0.3, GREEN.map((q) => q * (0.85 + rand() * 0.3)));
          leaf(x + C / 2, yy, len, 5, Math.PI + 0.55 + t * 0.3, GREEN.map((q) => q * (0.85 + rand() * 0.3)));
        }
      },
      dracaena: (x, y) => {
        for (let k = 0; k < 9; k++) leaf(x + C / 2, y + C - 4, C * (0.75 + rand() * 0.2), 9, -Math.PI / 2 + (k - 4) * 0.13, rgb("#3E7A2E").map((q) => q * (0.85 + rand() * 0.3)));
      },
      // herbs and greens: a bunch is mostly leaf, from just above the twine to the top; stems show only below
      cilantro: (x, y) => {
        for (let k = 0; k < 9; k++) stem(x + C / 2 + (rand() - 0.5) * 20, y + C, x + 30 + rand() * (C - 60), y + 70 + rand() * 60, PALE, 2);
        for (let q = 0; q < 90; q++) leaf(x + 24 + rand() * (C - 48), y + 16 + rand() * 170, 22 + rand() * 10, 12 + rand() * 4, rand() * 6, PALE.map((c) => c * (0.8 + rand() * 0.3)), 0.35);
      },
      parsley: (x, y) => {
        for (let k = 0; k < 9; k++) stem(x + C / 2 + (rand() - 0.5) * 20, y + C, x + 30 + rand() * (C - 60), y + 70 + rand() * 60, PALE, 2);
        for (let q = 0; q < 100; q++) leaf(x + 22 + rand() * (C - 44), y + 14 + rand() * 175, 20 + rand() * 10, 11 + rand() * 4, rand() * 6, PALE.map((c) => c * (0.75 + rand() * 0.3)), 0.55);
      },
      basil: (x, y) => {
        for (let k = 0; k < 7; k++) stem(x + C / 2 + (rand() - 0.5) * 20, y + C, x + 40 + rand() * (C - 80), y + 60 + rand() * 50, PALE, 3);
        for (let q = 0; q < 46; q++) leaf(x + 28 + rand() * (C - 56), y + 20 + rand() * 160, 36 + rand() * 12, 17 + rand() * 5, rand() * 6, PALE.map((c) => c * (0.8 + rand() * 0.3)));
      },
      mint: (x, y) => {
        for (let k = 0; k < 7; k++) stem(x + C / 2 + (rand() - 0.5) * 20, y + C, x + 40 + rand() * (C - 80), y + 50 + rand() * 50, PALE, 2.5);
        for (let q = 0; q < 56; q++) leaf(x + 28 + rand() * (C - 56), y + 18 + rand() * 165, 28 + rand() * 10, 14 + rand() * 4, rand() * 6, PALE.map((c) => c * (0.8 + rand() * 0.3)), 0.15);
      },
      dill: (x, y) => {
        for (let k = 0; k < 12; k++) {
          const ex = x + 20 + rand() * (C - 40);
          const ey = y + 20 + rand() * 60;
          stem(x + C / 2 + (rand() - 0.5) * 20, y + C, ex, ey, PALE, 1.8);
          for (let q = 0; q < 26; q++) {
            const t = rand();
            const px = x + C / 2 + (ex - x - C / 2) * t;
            const py = y + C + (ey - y - C) * t;
            if (py > y + 190) continue;
            stem(px, py, px + (rand() - 0.5) * 44, py - 8 - rand() * 14, PALE, 1);
          }
        }
      },
      kale: (x, y) => {
        for (let k = 0; k < 7; k++) leaf(x + C / 2 + (rand() - 0.5) * 20, y + C - 4, C * (0.75 + rand() * 0.2), 30, -Math.PI / 2 + (k - 3) * 0.17, PALE.map((c) => c * (0.75 + rand() * 0.3)), 0.3);
      },
      chard: (x, y) => {
        for (let k = 0; k < 5; k++) {
          const a = -Math.PI / 2 + (k - 2) * 0.2;
          leaf(x + C / 2, y + C - 4, C * 0.85, 40, a, PALE, 0.08);
          stem(x + C / 2, y + C, x + C / 2 + Math.cos(a) * 70, y + C + Math.sin(a) * 70, rgb("#E8E0D0"), 6);
        }
      },
      onionTops: (x, y) => {
        for (let k = 0; k < 14; k++) stem(x + C / 2 + (rand() - 0.5) * 30, y + C, x + 20 + rand() * (C - 40), y + 10, PALE, 6);
      },
      carrotTops: (x, y) => {
        for (let k = 0; k < 8; k++) {
          const ex = x + 20 + rand() * (C - 40);
          stem(x + C / 2, y + C, ex, y + 30, PALE, 2);
          for (let q = 0; q < 12; q++) stem(ex, y + 40 + q * 14, ex + (rand() - 0.5) * 36, y + 32 + q * 14, PALE, 1.2);
        }
      },
      crown: (x, y) => {
        for (let k = 0; k < 16; k++) leaf(x + C / 2, y + C - 4, C * (0.5 + rand() * 0.4), 9, -Math.PI / 2 + (k - 7.5) * 0.12, PALE);
      },
      fern: (x, y) => {
        for (let k = 0; k < 5; k++) {
          const a = -Math.PI / 2 + (k - 2) * 0.35;
          for (let q = 0; q < 14; q++) {
            const t = q / 14;
            leaf(x + C / 2 + Math.cos(a) * t * C * 0.8, y + C + Math.sin(a) * t * C * 0.8, 22 * (1 - t) + 6, 4, a - 1.2, GREEN);
            leaf(x + C / 2 + Math.cos(a) * t * C * 0.8, y + C + Math.sin(a) * t * C * 0.8, 22 * (1 - t) + 6, 4, a + 1.2, GREEN);
          }
        }
      },
      // blooms: pale, the bucket's colour tints them; a stem and a leaf below
      bloomRose: (x, y) => {
        stem(x + C / 2, y + C, x + C / 2, y + 90, GREEN, 4);
        leaf(x + C / 2, y + 170, 50, 16, -0.6, GREEN);
        for (let r = 60; r > 6; r -= 9) {
          ctx.fillStyle = css([255 - r, 250 - r, 248 - r].map((q) => q * 0.95 + 40));
          ctx.beginPath();
          ctx.arc(x + C / 2 + (rand() - 0.5) * 6, y + 80 + (rand() - 0.5) * 6, r * 0.75, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(120,100,100,0.35)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x + C / 2, y + 80, r * 0.7, rand() * 6, rand() * 6 + 3);
          ctx.stroke();
        }
      },
      bloomDaisy: (x, y) => {
        stem(x + C / 2, y + C, x + C / 2, y + 90, GREEN, 3);
        for (let k = 0; k < 16; k++) leaf(x + C / 2, y + 86, 60, 10, (k / 16) * Math.PI * 2, [250, 248, 242]);
        ctx.fillStyle = "#E8B020";
        ctx.beginPath();
        ctx.arc(x + C / 2, y + 86, 16, 0, Math.PI * 2);
        ctx.fill();
      },
      bloomTulip: (x, y) => {
        stem(x + C / 2, y + C, x + C / 2, y + 100, GREEN, 4);
        leaf(x + C / 2, y + C - 10, 120, 18, -1.3, GREEN);
        ctx.fillStyle = "#F4F0EC";
        ctx.beginPath();
        ctx.moveTo(x + C / 2 - 34, y + 50);
        ctx.quadraticCurveTo(x + C / 2 - 40, y + 120, x + C / 2, y + 120);
        ctx.quadraticCurveTo(x + C / 2 + 40, y + 120, x + C / 2 + 34, y + 50);
        ctx.lineTo(x + C / 2 + 16, y + 70);
        ctx.lineTo(x + C / 2, y + 40);
        ctx.lineTo(x + C / 2 - 16, y + 70);
        ctx.closePath();
        ctx.fill();
      },
    };
    d.FOLIAGE.forEach((id, i) => {
      const [x, y] = at(i);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, C, C);
      ctx.clip();
      DRAW[id](x, y);
      ctx.restore();
    });
    put("foliage", c);
  }
  return out;
}
