/* KDS v1.0 · svg/svg.js · © Khosha Systems. All rights reserved.
   Vector toolkit. Charts use --kds-* tokens, carry
   role="img" + aria-label, draw in unless reduced motion. Ref: references/motion.md */

import { reducedMotion, ease } from "../motion/motion.js";

const noop = () => {};
const SVG = "http://www.w3.org/2000/svg";
/* el(tag, attrs, parent?) -> SVGElement */
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(SVG, tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  return parent ? parent.appendChild(n) : n;
};
/* root(host, w, h, label) -> fresh <svg role="img"> inside host */
const root = (host, w, h, label) => {
  host.textContent = "";
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, fill: "none", role: "img", "aria-label": label }, host);
};
const midLabel = (host, text) => {
  host.classList.add("kds-ring");
  const s = host.appendChild(document.createElement("span"));
  s.className = "kds-ring__label";
  s.textContent = text;
  return s;
};
const PALETTE = ["var(--kds-accent)", "var(--kds-brand)", "var(--kds-positive)", "var(--kds-warning)", "var(--kds-info)", "var(--kds-danger)"];

/** draw(shape, {duration=900, delay=0, easing}) -> Animation|null - pen-draws any stroked shape */
export function draw(shape, { duration = 900, delay = 0, easing = ease.enter } = {}) {
  if (!shape?.getTotalLength) return null;
  const len = shape.getTotalLength();
  shape.style.strokeDasharray = String(len);
  if (reducedMotion()) return (shape.style.strokeDashoffset = "0"), null;
  return shape.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration, delay, easing, fill: "both" });
}

/** drawAll(svgOrSelector, {stagger=120, ...opts}) -> Animation[] - draw each stroked shape */
export function drawAll(target, { stagger: gap = 120, ...opts } = {}) {
  const r = typeof target === "string" ? document.querySelector(target) : target;
  if (!r) return [];
  return [...r.querySelectorAll("path, line, polyline, circle, ellipse")].map((s, i) => draw(s, { ...opts, delay: (opts.delay ?? 0) + i * gap }));
}

/** morph(pathEl, toD, {duration=600}) -> Promise|null - tween `d` (same structure) else swap */
export function morph(path, toD, { duration = 600 } = {}) {
  if (!path) return null;
  const fromD = path.getAttribute("d");
  const nums = (d) => (d.match(/-?\d*\.?\d+/g) || []).map(Number);
  const shape = (d) => d.replace(/-?\d*\.?\d+/g, "#");
  if (reducedMotion() || shape(fromD) !== shape(toD)) return path.setAttribute("d", toD), null;
  const a = nums(fromD), b = nums(toD), tpl = shape(fromD).split("#"), start = performance.now();
  return new Promise((resolve) => {
    const frame = (now) => {
      const t = Math.min((now - start) / duration, 1), e = 1 - Math.pow(1 - t, 3);
      let i = 0;
      path.setAttribute("d", tpl.map((seg, k) => (k < a.length ? seg + (a[i] + (b[i] - a[i++]) * e).toFixed(2) : seg)).join(""));
      t < 1 ? requestAnimationFrame(frame) : resolve(path);
    };
    requestAnimationFrame(frame);
  });
}

const fmtIN = (n) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

/** countUp(el, {to, from=0, duration=1200, format}) -> cancel - en-IN grouped count (1,60,000) */
export function countUp(host, { to, from = 0, duration = 1200, format = fmtIN } = {}) {
  if (!host) return noop;
  if (reducedMotion()) return (host.textContent = format(to)), noop;
  const start = performance.now();
  let raf = 0;
  const frame = (now) => {
    const t = Math.min((now - start) / duration, 1), e = 1 - Math.pow(1 - t, 4);
    host.textContent = format(from + (to - from) * e);
    if (t < 1) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

const points = (data, w, h, pad) => {
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1, n = Math.max(data.length - 1, 1);
  return data.map((v, i) => [pad + (i / n) * (w - pad * 2), h - pad - ((v - min) / span) * (h - pad * 2)]);
};

/** sparklinePath(data, w=120, h=32, pad=2) -> string - "M x y L x y …" path for a trend line */
export function sparklinePath(data, w = 120, h = 32, pad = 2) {
  return points(data, w, h, pad).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
}

/** sparkline(el, data, {width, height, stroke, strokeWidth, area, label, animate}) -> <polyline> - trend line, drawn in */
export function sparkline(host, data, { width = 120, height = 32, stroke = "var(--kds-accent)", strokeWidth = 2, area = false, label = "trend", animate = true } = {}) {
  if (!host || !data?.length) return null;
  const svg = root(host, width, height, label), pts = points(data, width, height, strokeWidth);
  if (area) el("path", { d: `${sparklinePath(data, width, height, strokeWidth)} V${height} H${pts[0][0].toFixed(1)} Z`, fill: stroke, "fill-opacity": 0.12 }, svg);
  const line = el("polyline", { points: pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "), stroke, "stroke-width": strokeWidth, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
  if (animate) draw(line, { duration: 800 });
  return line;
}

/** ring(el, {value, size, stroke, color, track, label, duration, whenVisible}) -> cleanup - progress ring + countUp label */
export function ring(host, { value = 0, size = 72, stroke = 7, color = "var(--kds-accent)", track = "var(--kds-surface-2)", label, duration = 1100, whenVisible = true } = {}) {
  if (!host) return noop;
  const v = Math.min(100, Math.max(0, value)), r = (size - stroke) / 2, c = 2 * Math.PI * r, h = size / 2;
  const end = c - (c * v) / 100, final = label ?? `${Math.round(v)}%`, svg = root(host, size, size, final);
  el("circle", { cx: h, cy: h, r, stroke: track, "stroke-width": stroke }, svg);
  const arc = el("circle", { cx: h, cy: h, r, stroke: color, "stroke-width": stroke, "stroke-linecap": "round", "stroke-dasharray": c, "stroke-dashoffset": c, transform: `rotate(-90 ${h} ${h})` }, svg);
  const text = midLabel(host, label ?? "0%");
  let anim = null, stopCount = noop, io = null;
  const run = () => {
    if (reducedMotion()) return arc.setAttribute("stroke-dashoffset", end), (text.textContent = final);
    anim = arc.animate([{ strokeDashoffset: c }, { strokeDashoffset: end }], { duration, easing: ease.enter, fill: "both" });
    if (label == null) stopCount = countUp(text, { to: v, duration, format: (n) => `${Math.round(n)}%` });
  };
  if (whenVisible) {
    io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (io.disconnect(), run()), { threshold: 0.4 });
    io.observe(host);
  } else run();
  return () => (io?.disconnect(), anim?.cancel(), stopCount());
}

/** bars(el, data, {width, height, gap, color, colors, label, stagger, duration, animate}) -> <svg> - mini bar chart */
export function bars(host, data, { width = 120, height = 32, gap = 2, color = "var(--kds-accent)", colors, label, stagger = 40, duration = 500, animate = true } = {}) {
  if (!host || !data?.length) return null;
  const n = data.length, bw = (width - gap * (n - 1)) / n;
  const min = Math.min(0, ...data), max = Math.max(0, ...data), span = max - min || 1;
  const y = (v) => height - ((v - min) / span) * height, y0 = y(0);
  const svg = root(host, width, height, label ?? data.join(", "));
  data.forEach((v, i) => {
    const x = i * (bw + gap) + bw / 2;
    el("line", { x1: x, y1: y0, x2: x, y2: y(v), stroke: colors?.[i % colors.length] ?? color, "stroke-width": bw }, svg);
  });
  if (animate) drawAll(svg, { stagger, duration });
  return svg;
}

/** donut(el, segments, {size, stroke, gap, colors, track, label, duration, stagger, animate}) -> <svg> - segments: numbers or {value, color, label} */
export function donut(host, segments, { size = 96, stroke = 10, gap = 2, colors = PALETTE, track = "var(--kds-surface-2)", label, duration = 700, stagger = 90, animate = true } = {}) {
  if (!host || !segments?.length) return null;
  const segs = segments.map((s) => (typeof s === "number" ? { value: s } : s)), total = segs.reduce((a, s) => a + s.value, 0) || 1;
  const h = size / 2, r = (size - stroke) / 2, pt = (deg) => `${(h + r * Math.cos((deg * Math.PI) / 180)).toFixed(2)} ${(h + r * Math.sin((deg * Math.PI) / 180)).toFixed(2)}`;
  const svg = root(host, size, size, segs.map((s, i) => `${s.label ?? `segment ${i + 1}`} ${Math.round((s.value / total) * 100)}%`).join(", "));
  el("circle", { cx: h, cy: h, r, stroke: track, "stroke-width": stroke }, svg);
  let start = -90;
  segs.forEach((s, i) => {
    const sweep = (s.value / total) * 360, a = Math.min(sweep - gap, 359.99);
    if (a > 0) el("path", { d: `M${pt(start)} A${r} ${r} 0 ${a > 180 ? 1 : 0} 1 ${pt(start + a)}`, stroke: s.color ?? colors[i % colors.length], "stroke-width": stroke }, svg);
    start += sweep;
  });
  if (label != null) midLabel(host, label);
  if (animate) [...svg.querySelectorAll("path")].forEach((p, i) => draw(p, { duration, delay: i * stagger }));
  return svg;
}

/** check(el, {size=24, color}) - success checkmark */
export function check(host, { size = 24, color = "var(--kds-positive)" } = {}) {
  if (!host) return;
  host.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="2"/><path d="M7.5 12.5l3 3 6-7" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  drawAll(host, { stagger: 180, duration: 500 });
}

/** spinner(el, {size=20, color}) - loading spinner, role="status" */
export function spinner(host, { size = 20, color = "var(--kds-accent)" } = {}) {
  if (!host) return;
  host.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" aria-label="loading" role="status"><circle cx="12" cy="12" r="9" stroke="${color}" stroke-opacity="0.2" stroke-width="2.5"/><path d="M21 12a9 9 0 0 0-9-9" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/></svg>`;
  if (!reducedMotion()) host.firstElementChild.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 800, iterations: Infinity, easing: "linear" });
}
