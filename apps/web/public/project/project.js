// The project page's one animation: a lime token travelling the reroute loop in the pipeline
// diagram (solver → route → check-off → reroute → solver). It moves only along the connectors and
// the right-hand rail: while its centre is inside a box it is hidden and that box's border turns
// lime ("now"), so it never passes over a label. The script also plays each video (the close-up
// arrival in the hero, the reroute loop in the app section) only while it is on screen. Under
// prefers-reduced-motion nothing moves: the token rests on the connector below the check-off box and
// the videos keep their controls and posters.

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

// ---------------------------------------------------------------- the loop token
const path = document.getElementById("loop-path");
const token = document.getElementById("loop-token");
if (path && token) {
  const svg = path.ownerSVGElement;
  const length = path.getTotalLength();
  const LAP_MS = 6400;
  const MARGIN = 8; // the token's halo radius: hidden this close to a box too
  const boxes = [...svg.querySelectorAll("rect.box")].map((el) => {
    const x = +el.getAttribute("x");
    const y = +el.getAttribute("y");
    return { el, x0: x - MARGIN, y0: y - MARGIN, x1: x + +el.getAttribute("width") + MARGIN, y1: y + +el.getAttribute("height") + MARGIN };
  });
  let lit = null;
  const place = (t) => {
    const p = path.getPointAtLength((((t % 1) + 1) % 1) * length);
    const inside = boxes.find((b) => p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1);
    token.setAttribute("transform", `translate(${p.x} ${p.y})`);
    token.style.opacity = inside ? "0" : "1";
    const now = inside && inside.el.dataset.box ? inside.el : null;
    if (now !== lit) {
      lit?.classList.remove("now");
      now?.classList.add("now");
      lit = now;
    }
  };
  // at rest: on the connector between check-off and reroute (y ≈ 515)
  const restAt = (515 - 332) / length;
  const rest = () => place(restAt);
  let raf = 0;
  let visible = false;
  let start = 0;
  const frame = (now) => {
    if (!start) start = now;
    place((now - start) / LAP_MS);
    raf = requestAnimationFrame(frame);
  };
  const update = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    if (visible && !reduce.matches) raf = requestAnimationFrame(frame);
    else rest();
  };
  rest();
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    update();
  }).observe(svg);
  reduce.addEventListener("change", update);
}

// ---------------------------------------------------------------- the videos
// none fetches before the page has loaded and gone idle: the hero's clip is a megabyte, and on a phone's link
// it would race the fonts and the text that is the first paint (the poster shows meanwhile)
const settled = new Promise((resolve) => {
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(() => resolve(), { timeout: 2000 }) : setTimeout(resolve, 200));
  if (document.readyState === "complete") idle();
  else addEventListener("load", idle, { once: true });
});
// the stills below the fold are lazy; once the page has loaded and gone idle, fetch them all, so a fast scroll on a
// phone never outruns them (the placeholders cover the moment before)
settled.then(() => {
  for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = "eager";
});
for (const video of document.querySelectorAll("video[data-autoplay]")) {
  let onScreen = false;
  let ready = false;
  settled.then(() => {
    ready = true;
    // the small poster carried the first paint; the 2× one is for whoever never plays the video (a video below
    // the fold has no poster until now: it would have been fetched with the first paint's resources)
    if (video.dataset.posterHi) video.poster = video.dataset.posterHi;
    sync();
  });
  const sync = () => {
    if (reduce.matches) {
      video.pause();
      video.controls = true;
      return;
    }
    video.controls = false;
    if (onScreen) {
      if (!ready) return;
      if (video.preload === "none") video.preload = "auto";
      video.play().catch(() => {
        video.controls = true; // autoplay refused: the visitor can still press play
      });
    } else video.pause();
  };
  new IntersectionObserver(
    (entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      sync();
    },
    { rootMargin: "100px" },
  ).observe(video);
  reduce.addEventListener("change", sync);
}

// ---------------------------------------------------------------- the Try it block
// The demo (the app's resolver and solver, src/project-demo/demo.ts → /project/demo/demo.js) loads on the first
// focus, tap or click inside the block: a visit that never touches it never downloads it.
const demo = document.querySelector("[data-demo]");
if (demo) {
  let loading = null;
  const load = (andRun) => {
    loading ??= import("/project/demo/demo.js").then((m) => m.mount(demo));
    loading.then((run) => andRun && run()).catch(() => {
      const note = demo.querySelector("[data-demo-note]");
      if (note) note.textContent = "The demo could not load here; the app itself still works.";
    });
  };
  demo.addEventListener("focusin", () => load(false), { once: true });
  demo.addEventListener("pointerdown", () => load(false), { once: true });
  demo.querySelector("[data-demo-route]")?.addEventListener("click", () => {
    if (!demo.dataset.ready) load(true);
  });
}

// ---------------------------------------------------------------- the waitlist form
// apps/resolver/src/waitlist.ts. Turnstile's script loads when someone first focuses the form; the token it gives is
// sent with the email and checked by the Worker, which keeps only the address, the list and the date.
const wl = document.querySelector("[data-waitlist]");
const wlForm = wl?.querySelector("[data-waitlist-form]");
if (wl && wlForm && wl.dataset.sitekey) {
  const status = wl.querySelector("[data-waitlist-status]");
  let token = "";
  let widget = null;
  let loading = null;
  const turnstile = () =>
    (loading ??= new Promise((resolve, reject) => {
      window.__onTurnstile = () => resolve(window.turnstile);
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__onTurnstile";
      s.async = true;
      s.onerror = reject;
      document.head.appendChild(s);
    }).then((t) => {
      widget = t.render(wl.querySelector("[data-turnstile]"), { sitekey: wl.dataset.sitekey, theme: "dark", callback: (v) => (token = v), "expired-callback": () => (token = "") });
      return t;
    }));
  wlForm.addEventListener("focusin", () => turnstile().catch(() => (status.textContent = "The check could not load; try again later.")), { once: true });
  wlForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = wlForm.elements.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      status.textContent = "That does not look like an email address.";
      return;
    }
    await turnstile().catch(() => null);
    if (!token) {
      status.textContent = "One moment: finish the check above, then send again.";
      return;
    }
    status.textContent = "Sending…";
    try {
      const r = await fetch(wl.dataset.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, token, list: wlForm.elements.list.value }) });
      const body = await r.json().catch(() => ({}));
      status.textContent = r.ok ? (body.already ? "You're already on the list." : "You are on the list. Thank you.") : body.error ? `Not sent: ${body.error}.` : "Not sent; try again.";
      if (r.ok) wlForm.reset();
    } catch {
      status.textContent = "Not sent: the network did not answer; try again.";
    }
    token = "";
    if (widget !== null) window.turnstile?.reset(widget);
  });
}

