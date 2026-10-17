// The project page's one animation: a lime token travelling the reroute loop in the pipeline
// diagram (solver → route → check-off → reroute → solver). It also attaches the trip video's
// poster as it nears the viewport and plays the video only while it is on screen. Under
// prefers-reduced-motion neither moves: the token rests on the check-off node and the video
// keeps its controls and poster.

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

// ---------------------------------------------------------------- the loop token
const path = document.getElementById("loop-path");
const token = document.getElementById("loop-token");
if (path && token) {
  const length = path.getTotalLength();
  const LAP_MS = 5200;
  const place = (t) => {
    const p = path.getPointAtLength(((t % 1) + 1) % 1 * length);
    token.setAttribute("transform", `translate(${p.x} ${p.y})`);
  };
  // rest on the check-off node (about two fifths of the way round)
  const rest = () => place(0.36);
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
  }).observe(path.ownerSVGElement);
  reduce.addEventListener("change", update);
}

// ---------------------------------------------------------------- the trip video
const video = document.getElementById("trip-video");
if (video) {
  // the poster, deferred until the video is within a screen of the viewport
  new IntersectionObserver(
    (entries, obs) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      if (video.dataset.poster && !video.poster) video.poster = video.dataset.poster;
      obs.disconnect();
    },
    { rootMargin: "100% 0px" },
  ).observe(video);
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
        video.controls = true; // autoplay refused: the shopper can still press play
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
