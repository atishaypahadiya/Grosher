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
for (const video of document.querySelectorAll("video[data-autoplay]")) {
  let onScreen = false;
  const sync = () => {
    if (reduce.matches) {
      video.pause();
      video.controls = true;
      return;
    }
    video.controls = false;
    if (onScreen) {
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
