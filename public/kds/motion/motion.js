/* KDS v1.0 · motion/motion.js · © Khosha Systems. All rights reserved.
   Zero-dependency WAAPI motion engine; honours prefers-reduced-motion and
   --kds-motion-scale. Reference + doctrine: references/motion.md */

/** reducedMotion() -> boolean */
export const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** motionScale() -> number — `--kds-motion-scale` on <html> (1; Monolith 0) */
export function motionScale() {
  if (typeof document === "undefined") return 1;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--kds-motion-scale"));
  return v >= 0 ? v : 1;
}

/** ease — easing strings mirroring the `--kds-ease-*` tokens */
export const ease = {
  standard: "cubic-bezier(0.2, 0, 0.2, 1)",
  enter: "cubic-bezier(0.16, 1, 0.3, 1)",
  exit: "cubic-bezier(0.6, 0, 0.85, 0.4)",
  emphasized: "cubic-bezier(0.3, 0, 0, 1)",
  springGentle: "cubic-bezier(0.34, 1.45, 0.5, 1)",
};

/** spring({stiffness=180, damping=18, mass=1}) -> {easing, duration} — physics -> CSS linear() */
export function spring({ stiffness = 180, damping = 18, mass = 1 } = {}) {
  const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass));
  const settle = z < 1 ? -Math.log(0.005) / (z * w0) : 5.3 / w0;
  const duration = Math.min(Math.max(settle * 1000, 150), 2500), pts = [];
  for (let i = 0; i <= 80; i++) {
    const t = (i / 80) * (duration / 1000), wd = w0 * Math.sqrt(Math.abs(1 - z * z));
    const x = z < 1
      ? 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t))
      : 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    pts.push(Math.round(x * 1000) / 1000);
  }
  return { easing: `linear(${pts.join(",")})`, duration };
}

const BASE = { duration: 360, easing: ease.enter, fill: "both" };
const noop = () => {};
const list = (t) => (typeof t === "string" ? [...document.querySelectorAll(t)] : t instanceof Element ? [t] : [...(t || [])]);
const on = (el, map) => {
  for (const k in map) el.addEventListener(k, map[k], { passive: true });
  return () => { for (const k in map) el.removeEventListener(k, map[k]); };
};

/** animate(el, keyframes, options?) -> Animation|null — WAAPI; reduced motion -> 0ms */
export function animate(el, keyframes, options = {}) {
  if (!el) return null;
  const o = { ...BASE, ...options };
  if (reducedMotion()) return el.animate(keyframes, { ...o, duration: 0, delay: 0 });
  const s = motionScale();
  if (s !== 1) (o.duration *= s), (o.delay = (o.delay || 0) * s);
  return el.animate(keyframes, o);
}

const io = (from, to) => ({ keyframes: [{ opacity: 0, ...from }, { opacity: 1, ...to }] });
const tx = (x, y) => io({ transform: `translate(${x}px,${y}px)` }, { transform: "translate(0,0)" });
const rx = (d) => ({ transform: `perspective(800px) rotateX(${d})`, transformOrigin: "50% 0" });

/** presets — entrance keyframes for play() */
export const presets = {
  fadeIn: io({}, {}),
  riseIn: tx(0, 16),
  slideInLeft: tx(-24, 0),
  slideInRight: tx(24, 0),
  scaleIn: io({ transform: "scale(0.92)" }, { transform: "scale(1)" }),
  popIn: { ...io({ transform: "scale(0.6)" }, { transform: "scale(1)" }), spring: { stiffness: 260, damping: 14 } },
  blurIn: io({ filter: "blur(8px)" }, { filter: "blur(0px)" }),
  slideUp: tx(0, 32),
  slideDown: tx(0, -32),
  flipIn: io(rx("-70deg"), rx("0deg")),
};

/** play(el, name, options?) -> Animation|null — run a preset */
export function play(el, name, options = {}) {
  const p = presets[name];
  if (!p) throw new Error(`KDS Motion: unknown preset "${name}"`);
  return animate(el, p.keyframes, { ...(p.spring ? spring(p.spring) : {}), ...options });
}

/** stagger(els, name, {gap=70, ...options}) -> Animation[] — cascade, gap ms apart */
export function stagger(els, name, { gap = 70, ...options } = {}) {
  return [...els].map((el, i) => play(el, name, { ...options, delay: (options.delay ?? 0) + i * gap }));
}

/** sequence([[el, name, options?], …]) -> Promise<void> — one after another */
export async function sequence(steps) {
  for (const [el, name, options] of steps) {
    const a = play(el, name, options);
    if (a) await a.finished.catch(noop);
  }
}

/** inView(target, cb, {threshold, rootMargin, once}) -> cleanup — cb(el, entry) on enter */
export function inView(target, cb, { threshold = 0.15, rootMargin = "0px", once = true } = {}) {
  const els = list(target);
  if (!els.length) return noop;
  const ob = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      cb(en.target, en);
      if (once) ob.unobserve(en.target);
    }
  }, { threshold, rootMargin });
  els.forEach((el) => ob.observe(el));
  return () => ob.disconnect();
}

/** reveal(target="[data-kds-reveal]", {preset, gap, once, threshold}) -> cleanup — scroll entrances */
export function reveal(target = "[data-kds-reveal]", { preset = "riseIn", gap = 60, once = true, threshold = 0.15 } = {}) {
  const els = list(target);
  if (!els.length) return noop;
  els.forEach((el) => (el.style.opacity = "0"));
  let batch = 0, timer = 0;
  const stop = inView(els, (el) => {
    play(el, el.dataset.kdsReveal || preset, { delay: batch++ * gap });
    clearTimeout(timer);
    timer = setTimeout(() => (batch = 0), 200);
  }, { once, threshold });
  return () => (clearTimeout(timer), stop());
}

/** scrollProgress(bar, {scroller?}) -> cleanup — writes 0–100% to bar.style.width */
export function scrollProgress(bar, { scroller } = {}) {
  if (!bar) return noop;
  const root = scroller || document.documentElement;
  let raf = 0;
  const update = () => {
    raf = 0;
    const max = root.scrollHeight - root.clientHeight;
    bar.style.width = `${max > 0 ? (root.scrollTop / max) * 100 : 0}%`;
  };
  const tick = () => { if (!raf) raf = requestAnimationFrame(update); };
  update();
  const off1 = on(scroller || window, { scroll: tick }), off2 = on(window, { resize: tick });
  return () => (off1(), off2(), cancelAnimationFrame(raf));
}

/** pressable(el, {scale=0.97}) -> cleanup — press on pointerdown, spring back */
export function pressable(el, { scale = 0.97 } = {}) {
  if (!el || reducedMotion()) return noop;
  const s = spring({ stiffness: 320, damping: 16 });
  const go = (a, b, o) => () => el.animate([{ transform: `scale(${a})` }, { transform: `scale(${b})` }], { ...o, fill: "forwards" });
  const up = go(scale, 1, { duration: s.duration, easing: s.easing });
  return on(el, { pointerdown: go(1, scale, { duration: 90, easing: ease.standard }), pointerup: up, pointerleave: up });
}

/** magnetic(el, {strength=0.35}) -> cleanup — drifts toward the cursor, springs back; off on touch */
export function magnetic(el, { strength = 0.35 } = {}) {
  if (!el || reducedMotion() || matchMedia("(pointer: coarse)").matches) return noop;
  let anim = null;
  const off = on(el, {
    pointermove(e) {
      anim?.cancel();
      const r = el.getBoundingClientRect();
      el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * strength}px,${(e.clientY - r.top - r.height / 2) * strength}px)`;
    },
    pointerleave() {
      const from = el.style.transform || "none", s = spring({ stiffness: 220, damping: 14 });
      el.style.transform = "";
      anim = el.animate([{ transform: from }, { transform: "none" }], { duration: s.duration, easing: s.easing });
    },
  });
  return () => (off(), anim?.cancel(), (el.style.transform = ""));
}

/** spotlight(el, {tilt=false, max=5}) -> cleanup — sets --mx/--my (%) + --rx/--ry (deg) on .kds-spotlight */
export function spotlight(el, { tilt = false, max = 5 } = {}) {
  if (!el || reducedMotion()) return noop;
  const set = (o) => { for (const k in o) el.style.setProperty(k, o[k]); };
  const added = tilt && !el.classList.contains("kds-spotlight--tilt");
  if (added) el.classList.add("kds-spotlight--tilt");
  const off = on(el, {
    pointermove(e) {
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / (r.width || 1), y = (e.clientY - r.top) / (r.height || 1);
      set({ "--mx": `${(x * 100).toFixed(1)}%`, "--my": `${(y * 100).toFixed(1)}%` });
      if (tilt) set({ "--rx": `${((y - 0.5) * -max).toFixed(2)}deg`, "--ry": `${((x - 0.5) * max).toFixed(2)}deg` });
    },
    pointerleave: () => set({ "--rx": "0deg", "--ry": "0deg" }),
  });
  return () => (off(), added && el.classList.remove("kds-spotlight--tilt"));
}

/** typewriter(el, strings, {speed, deleteSpeed, pause, loop, caret, delay}) -> cleanup */
export function typewriter(el, strings, { speed = 55, deleteSpeed = 28, pause = 1500, loop = true, caret = true, delay = 0 } = {}) {
  const words = [].concat(strings).filter(Boolean);
  if (!el || !words.length) return noop;
  el.setAttribute("aria-label", words[0]);
  el.innerHTML = `<span aria-hidden="true"></span>${caret ? '<span class="kds-caret" aria-hidden="true"></span>' : ""}`;
  const text = el.firstChild;
  if (reducedMotion()) return (text.textContent = words[0]), noop;
  let i = 0, ch = 0, del = false, t = 0;
  const tick = () => {
    const full = words[i];
    if (!del) {
      text.textContent = full.slice(0, ++ch);
      if (ch < full.length) return (t = setTimeout(tick, speed));
      if (words.length === 1 || (!loop && i === words.length - 1)) return;
      del = true;
      return (t = setTimeout(tick, pause));
    }
    text.textContent = full.slice(0, --ch);
    if (ch <= 0) (del = false), (i = (i + 1) % words.length);
    t = setTimeout(tick, deleteSpeed);
  };
  t = setTimeout(tick, delay);
  return () => clearTimeout(t);
}

const CONFETTI = ["var(--kds-brand)", "var(--kds-accent)", "var(--kds-positive)", "var(--kds-warning)"];

/** confetti({count=90, colors, origin={x:.5,y:.35}, layer?}) -> Promise (+.cancel()) — one burst, self-removing layer */
export function confetti({ count = 90, colors = CONFETTI, origin = { x: 0.5, y: 0.35 }, layer } = {}) {
  if (typeof document === "undefined" || reducedMotion()) return Object.assign(Promise.resolve(), { cancel: noop });
  const box = (layer || document.body).appendChild(document.createElement("div"));
  box.className = "kds-confetti-layer";
  box.setAttribute("aria-hidden", "true");
  if (layer) box.style.position = "absolute";
  const cx = box.clientWidth * origin.x, cy = box.clientHeight * origin.y, anims = [];
  for (let i = 0; i < count; i++) {
    const bit = box.appendChild(document.createElement("span")), w = 6 + (i % 7), v = 120 + ((i * 53) % 220);
    const a = (Math.PI * 2 * i) / count + ((i % 5) - 2) * 0.12;
    bit.className = "kds-confetti-bit";
    bit.style.cssText = `left:${cx}px;top:${cy}px;width:${w}px;height:${w * 0.6}px;background:${colors[i % colors.length]}`;
    anims.push(bit.animate(
      [{ transform: "translate(0,0) rotate(0)", opacity: 1 }, { transform: `translate(${Math.cos(a) * v}px,${Math.sin(a) * v + 280}px) rotate(${((i * 97) % 720) - 360}deg)`, opacity: 0 }],
      { duration: 1100 + ((i * 17) % 700), easing: "cubic-bezier(0.2,0.6,0.3,1)", fill: "forwards" },
    ));
  }
  const p = Promise.all(anims.map((a) => a.finished.catch(noop))).then(() => box.remove());
  p.cancel = () => (anims.forEach((a) => a.cancel()), box.remove());
  return p;
}

/** flip(target, mutate, {duration=320, easing=ease.emphasized}) -> Animation|null (array for a list) — FLIP */
export function flip(target, mutate, { duration = 320, easing = ease.emphasized } = {}) {
  const single = target instanceof Element, els = list(target), first = els.map((el) => el.getBoundingClientRect());
  mutate?.();
  if (reducedMotion()) return single ? null : els.map(() => null);
  const anims = els.map((el, i) => {
    const a = first[i], b = el.getBoundingClientRect();
    if (!a.width || !b.width) return null;
    const dx = a.left - b.left, dy = a.top - b.top, sx = a.width / b.width, sy = a.height / b.height;
    if (!(dx || dy) && sx === 1 && sy === 1) return null;
    const o = { transformOrigin: "0 0" };
    return animate(el, [{ ...o, transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, { ...o, transform: "none" }], { duration, easing, fill: "none" });
  });
  return single ? anims[0] : anims;
}
