/* KDS v1.0 · ui/ui.js · © Khosha Systems. All rights reserved.
   Accessible behaviours for the KDS CSS recipes. Zero deps, ES module, imports
   only ../motion/motion.js. Every widget returns destroy() or a controller
   object carrying destroy(). API + markup contract: references/ui.md */
import * as M from "../motion/motion.js";
const { play, animate, ease } = M;
const doc = document, win = window, html = doc.documentElement, noop = () => {};
const $ = (s, r = doc) => Array.from(r.querySelectorAll(s));
const on = (el, ev, fn, o) => (el.addEventListener(ev, fn, o), () => el.removeEventListener(ev, fn, o));
let seq = 0;
const idOf = (el, p) => el.id || (el.id = `kds-${p}-${++seq}-${(Math.random() * 1e4) | 0}`);
const emit = (el, n, detail) => el.dispatchEvent(new CustomEvent(n, { detail, bubbles: true }));
const make = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const FOCUS = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const focusables = (el) => $(FOCUS, el).filter((e) => e.getClientRects().length);
function trap(el, e) { // Tab cycles inside el
  if (e.key !== "Tab") return;
  const f = focusables(el), a = doc.activeElement, first = f[0], last = f[f.length - 1];
  if (!f.length) return e.preventDefault();
  if (e.shiftKey ? a === first || !el.contains(a) : a === last) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
}
function arrow(e, axis = "h") { // → 1 | -1 | "home" | "end" | 0
  const k = e.key;
  if (k === "Home") return "home";
  if (k === "End") return "end";
  if (axis !== "v" && k === "ArrowRight" || axis !== "h" && k === "ArrowDown") return 1;
  if (axis !== "v" && k === "ArrowLeft" || axis !== "h" && k === "ArrowUp") return -1;
  return 0;
}
const move = (n, i, d) => (d === "home" ? 0 : d === "end" ? n - 1 : (i + d + n) % n);
const slide = (ink, t) => { if (ink && t) { ink.style.width = t.offsetWidth + "px"; ink.style.transform = `translateX(${t.offsetLeft - ink.offsetLeft}px)`; } };
const track = (el, fn) => { const ro = new ResizeObserver(fn); ro.observe(el); return () => ro.disconnect(); };
let locks = 0, prevOv = "";
const lock = () => { if (!locks++) { prevOv = doc.body.style.overflow; doc.body.style.overflow = "hidden"; } };
const unlock = () => { if (locks && !--locks) doc.body.style.overflow = prevOv; };
const fadeOut = (el, shift) => animate(el, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: shift }], { duration: 160, easing: ease.exit });
const settled = (a) => new Promise((r) => { const t = setTimeout(r, 400); a && a.finished.catch(noop).then(() => { clearTimeout(t); r(); }); }); // never hangs on a stuck animation
const destroyer = (offs, extra) => Object.assign(() => offs.forEach((f) => f()), extra);

/* tabs: roving tabindex, arrows/Home/End, aria-selected/controls, sliding __ink */
export function tabs(root, { onChange } = {}) {
  const list = root.matches('.kds-tabs,[role="tablist"]') ? root : root.querySelector('.kds-tabs,[role="tablist"]');
  if (!list) return noop;
  const items = $('.kds-tab,[role="tab"]', list);
  let ink = list.querySelector(".kds-tabs__ink");
  if (!ink) { ink = make("span", "kds-tabs__ink"); ink.setAttribute("aria-hidden", "true"); list.prepend(ink); }
  list.setAttribute("role", "tablist");
  const axis = list.getAttribute("aria-orientation") === "vertical" ? "v" : "h";
  const loose = $('[role="tabpanel"],.kds-tabs__panel', root === list ? root.parentElement || doc : root).filter((p) => !list.contains(p));
  const panels = items.map((t, i) => { const id = t.getAttribute("aria-controls"); return (id && doc.getElementById(id)) || loose[i] || null; });
  items.forEach((t, i) => {
    t.setAttribute("role", "tab"); if (t.tagName === "BUTTON") t.type = "button";
    const p = panels[i]; if (!p) return;
    p.setAttribute("role", "tabpanel"); p.setAttribute("aria-labelledby", idOf(t, "tab")); t.setAttribute("aria-controls", idOf(p, "panel"));
    if (!p.hasAttribute("tabindex")) p.tabIndex = 0;
  });
  let cur = -1;
  const select = (i, focus) => {
    items.forEach((t, j) => { const a = j === i; t.setAttribute("aria-selected", a); t.tabIndex = a ? 0 : -1; if (panels[j]) panels[j].hidden = !a; });
    slide(ink, items[i]); if (focus) items[i].focus();
    if (i !== cur) { const was = cur; cur = i; if (was >= 0) { onChange && onChange(i, items[i]); emit(root, "kds:change", { index: i, tab: items[i], panel: panels[i] }); } }
  };
  const offs = items.map((t, i) => on(t, "click", () => select(i)));
  offs.push(on(list, "keydown", (e) => { const d = arrow(e, axis); if (d) { e.preventDefault(); select(move(items.length, cur, d), true); } }), track(list, () => slide(ink, items[cur])));
  select(Math.max(0, items.findIndex((t) => t.getAttribute("aria-selected") === "true")));
  return destroyer(offs, { select });
}

/* accordion: aria-expanded/controls, .is-open drives the 0fr→1fr panel, inert when closed */
export function accordion(root, { single = false, onChange } = {}) {
  const items = $(".kds-accordion__item", root), trig = items.map((it) => it.querySelector(".kds-accordion__trigger"));
  const set = (i, open) => { const p = items[i].querySelector(".kds-accordion__panel"); items[i].classList.toggle("is-open", open); trig[i].setAttribute("aria-expanded", open); if (p) p.inert = !open; };
  const toggle = (i, open = !items[i].classList.contains("is-open")) => {
    if (open && single) items.forEach((it, j) => j !== i && it.classList.contains("is-open") && set(j, false));
    set(i, open); onChange && onChange(i, open); emit(root, "kds:toggle", { index: i, open });
  };
  const offs = [];
  items.forEach((it, i) => {
    const t = trig[i], p = it.querySelector(".kds-accordion__panel"); if (!t) return;
    if (t.tagName === "BUTTON") t.type = "button";
    if (p) { p.setAttribute("role", "region"); p.setAttribute("aria-labelledby", idOf(t, "acc")); t.setAttribute("aria-controls", idOf(p, "panel")); }
    set(i, it.classList.contains("is-open") || t.getAttribute("aria-expanded") === "true");
    offs.push(on(t, "click", () => toggle(i)), on(t, "keydown", (e) => { const d = arrow(e, "v"); if (d) { e.preventDefault(); trig[move(trig.length, i, d)].focus(); } }));
  });
  return destroyer(offs, { toggle });
}

/* segmented: role=radiogroup, aria-checked, all four arrows wrap, sliding __thumb */
export function segmented(root, { onChange, value } = {}) {
  const btns = $(".kds-segmented__btn", root);
  let thumb = root.querySelector(".kds-segmented__thumb");
  if (!thumb) { thumb = make("span", "kds-segmented__thumb"); thumb.setAttribute("aria-hidden", "true"); root.prepend(thumb); }
  root.setAttribute("role", "radiogroup");
  const val = (b) => b.dataset.value ?? b.getAttribute("value") ?? b.textContent.trim();
  let cur = -1;
  const select = (i, focus) => {
    btns.forEach((b, j) => { const a = j === i; b.setAttribute("aria-checked", a); b.classList.toggle("is-active", a); b.tabIndex = a ? 0 : -1; });
    slide(thumb, btns[i]); if (focus) btns[i].focus();
    if (i !== cur) { const was = cur; cur = i; if (was >= 0) { onChange && onChange(val(btns[i]), btns[i]); emit(root, "kds:change", { value: val(btns[i]), index: i }); } }
  };
  const offs = btns.map((b, i) => { b.setAttribute("role", "radio"); if (b.tagName === "BUTTON") b.type = "button"; return on(b, "click", () => select(i)); });
  offs.push(on(root, "keydown", (e) => { const d = arrow(e, "hv"); if (d) { e.preventDefault(); select(move(btns.length, cur, d), true); } }), track(root, () => slide(thumb, btns[cur])));
  let i0 = value != null ? btns.findIndex((b) => val(b) === String(value)) : -1;
  if (i0 < 0) i0 = btns.findIndex((b) => b.classList.contains("is-active") || b.getAttribute("aria-checked") === "true");
  select(Math.max(0, i0));
  return destroyer(offs, { select: (v) => { const i = btns.findIndex((b) => val(b) === String(v)); if (i >= 0) select(i); } });
}

/* theme: data-kds-theme on <html>; no attribute = follow the OS */
let themeKey = "kds-theme";
export const theme = {
  get: () => html.getAttribute("data-kds-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  set(t, persist = true) {
    const ok = t === "dark" || t === "light";
    ok ? html.setAttribute("data-kds-theme", t) : html.removeAttribute("data-kds-theme");
    if (persist) try { ok ? localStorage.setItem(themeKey, t) : localStorage.removeItem(themeKey); } catch {}
    emit(doc, "kds:theme", { theme: theme.get() });
  },
  toggle: () => theme.set(theme.get() === "dark" ? "light" : "dark"),
};
export function initTheme({ storageKey = "kds-theme", fallback } = {}) {
  themeKey = storageKey;
  let s = null; try { s = localStorage.getItem(storageKey); } catch {}
  if (s === "dark" || s === "light") theme.set(s, false); else if (fallback) theme.set(fallback, false);
  return on(win, "storage", (e) => e.key === storageKey && theme.set(e.newValue, false));
}
/* inline <head> script string — restores the stored theme before first paint */
export const themeScript = (key = "kds-theme") => `(function(){try{var t=localStorage.getItem('${key}');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-kds-theme',t)}catch(e){}})()`;
export function themeToggle(btn) {
  btn.classList.add("kds-theme-toggle"); if (btn.tagName === "BUTTON") btn.type = "button";
  const sync = () => { const t = theme.get(); btn.dataset.theme = t; btn.setAttribute("aria-pressed", t === "dark"); btn.setAttribute("aria-label", `Switch to ${t === "dark" ? "light" : "dark"} theme`); };
  sync();
  return destroyer([on(btn, "click", theme.toggle), on(doc, "kds:theme", sync)]);
}

/* toast: lazy aria-live region; hover/focus pauses the timer; returns dismiss() */
let region;
export function toast(message, { tone = "info", timeout = 4200, action } = {}) {
  if (!region || !region.isConnected) {
    region = doc.querySelector(".kds-toast-region") || doc.body.appendChild(make("div", "kds-toast-region"));
    region.setAttribute("role", "status"); region.setAttribute("aria-live", "polite");
  }
  const el = make("div", `kds-toast kds-toast--${tone}`); if (tone === "danger") el.setAttribute("role", "alert");
  el.append(make("span", "kds-toast__msg", message));
  let timer, out = false;
  const arm = () => { if (timeout > 0) timer = setTimeout(dismiss, timeout); }, disarm = () => clearTimeout(timer);
  const dismiss = () => { if (out) return; out = true; disarm(); settled(fadeOut(el, "translateX(16px)")).then(() => el.remove()); };
  const btn = (cls, text, fn, label) => { const b = make("button", `kds-btn kds-btn--ghost kds-btn--sm ${cls}`, text); b.type = "button"; b.onclick = fn; if (label) b.setAttribute("aria-label", label); el.append(b); };
  if (action) btn("kds-toast__action", action.label, () => { action.onClick && action.onClick(); dismiss(); });
  btn("kds-btn--icon kds-toast__close", "×", dismiss, "Dismiss");
  region.append(el); play(el, "slideInRight");
  for (const [ev, fn] of [["pointerenter", disarm], ["focusin", disarm], ["pointerleave", arm], ["focusout", arm]]) el.addEventListener(ev, fn);
  arm();
  return dismiss;
}

/* dialog / drawer: native <dialog>; focus trap + return focus, Esc, backdrop click, [data-kds-close] */
const ctrl = new WeakMap();
const SHIFT = { left: "translateX(-24px)", right: "translateX(24px)", bottom: "translateY(24px)", top: "translateY(-24px)" };
export function dialog(el, { side, onOpen, onClose, closeOnBackdrop = true, closeOnEsc = true } = {}) {
  if (ctrl.has(el)) return ctrl.get(el);
  if (side) el.classList.add("kds-drawer", `kds-drawer--${side}`);
  el.setAttribute("aria-modal", "true");
  let last = null, offs = [], busy = false;
  const isOpen = () => el.open;
  const cleanup = () => { // sync after our close(); also the fallback for closes we did not start (form method=dialog)
    if (!offs.length) return;
    offs.forEach((f) => f()); offs = []; unlock(); last && last.focus && last.focus(); last = null;
    emit(el, "kds:close", { value: el.returnValue }); onClose && onClose(el.returnValue);
  };
  const open = () => {
    if (isOpen()) return;
    last = doc.activeElement; el.showModal(); lock();
    const f = el.querySelector("[autofocus]") || focusables(el)[0]; if (f) f.focus(); else { el.tabIndex = -1; el.focus(); }
    offs = [
      on(el, "keydown", (e) => trap(el, e)),
      on(el, "cancel", (e) => { e.preventDefault(); closeOnEsc && close(); }),
      on(el, "click", (e) => {
        const c = e.target.closest("[data-kds-close]"); if (c) return close(c.dataset.kdsClose);
        const r = el.getBoundingClientRect();
        if (closeOnBackdrop && e.target === el && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) close();
      }),
      on(el, "close", cleanup),
    ];
    emit(el, "kds:open"); onOpen && onOpen();
  };
  const close = async (value) => {
    if (!isOpen() || busy) return; busy = true;
    const a = fadeOut(el, SHIFT[side] || "translateY(8px) scale(0.98)"); await settled(a);
    busy = false; a && a.cancel(); el.close(value == null ? "" : String(value)); cleanup();
  };
  const api = { el, open, close, toggle: () => (isOpen() ? close() : open()), isOpen, destroy: () => { isOpen() && el.close(); cleanup(); ctrl.delete(el); } };
  ctrl.set(el, api);
  return api;
}
export const drawer = (el, { side = "right", ...o } = {}) => dialog(el, { ...o, side });
export const controller = (el) => ctrl.get(el);

/* menu: [popover] with CSS anchor positioning, getBoundingClientRect fallback; roving menuitems */
const AREA = { "bottom-start": "bottom span-right", "bottom-end": "bottom span-left", "top-start": "top span-right", "top-end": "top span-left" };
export function menu(trigger, { items, placement = "bottom-start", anchor = true, onSelect } = {}) {
  if (ctrl.has(trigger)) return ctrl.get(trigger);
  const el = items ? make("div") : doc.getElementById(trigger.getAttribute("aria-controls") || trigger.getAttribute("popovertarget") || "") || trigger.nextElementSibling;
  if (!el) return null;
  if (items) {
    for (const it of items) {
      if (it.sep) { el.append(Object.assign(make("hr", "kds-menu__sep"), { role: "separator" })); continue; }
      const b = make("button", `kds-menu__item${it.danger ? " kds-menu__item--danger" : ""}`, it.label); b.type = "button"; b.disabled = !!it.disabled; b._item = it; el.append(b);
    }
    trigger.after(el);
  }
  trigger.removeAttribute("popovertarget");
  el.classList.add("kds-menu"); el.setAttribute("role", "menu"); el.setAttribute("popover", ""); el.setAttribute("aria-labelledby", idOf(trigger, "menu-btn"));
  trigger.setAttribute("aria-haspopup", "menu"); trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-controls", idOf(el, "menu"));
  const opts = () => $(".kds-menu__item", el).filter((i) => !i.disabled && i.getAttribute("aria-disabled") !== "true");
  $(".kds-menu__item", el).forEach((i) => { i.setAttribute("role", "menuitem"); i.tabIndex = -1; });
  const useAnchor = anchor && "positionArea" in el.style, top = placement.startsWith("top");
  if (useAnchor) {
    const name = `--${el.id}`; trigger.style.anchorName = name;
    Object.assign(el.style, { positionAnchor: name, positionArea: AREA[placement] || AREA["bottom-start"], inset: "auto", margin: top ? "0 0 4px" : "4px 0 0", positionTryFallbacks: "flip-block, flip-inline" });
  }
  const place = () => {
    if (useAnchor) return;
    const r = trigger.getBoundingClientRect(), m = el.getBoundingClientRect(), vw = win.innerWidth, vh = win.innerHeight;
    let y = top ? r.top - m.height - 4 : r.bottom + 4;
    if (y + m.height > vh - 8 && r.top - m.height - 4 >= 0) y = r.top - m.height - 4; else if (y < 8) y = r.bottom + 4;
    const x = Math.max(8, Math.min(placement.endsWith("end") ? r.right - m.width : r.left, vw - m.width - 8));
    Object.assign(el.style, { position: "fixed", inset: "auto", margin: "0", top: `${y}px`, left: `${x}px` });
  };
  let offs = [];
  const isOpen = () => el.matches(":popover-open");
  const close = (focus = true) => { if (isOpen()) { trigger.setAttribute("aria-expanded", "false"); el.hidePopover(); focus && trigger.focus(); } };
  const pick = (b) => { close(); const it = b._item || { label: b.textContent.trim(), el: b }; it.onSelect && it.onSelect(it); onSelect && onSelect(it, b); emit(el, "kds:select", it); };
  const open = () => {
    if (isOpen()) return;
    el.showPopover(); place(); trigger.setAttribute("aria-expanded", "true");
    const first = opts()[0]; first && first.focus();
    offs = [
      on(el, "keydown", (e) => {
        const o = opts(), i = o.indexOf(doc.activeElement), d = arrow(e, "v");
        if (d) { e.preventDefault(); o[move(o.length, i < 0 ? (d < 0 ? 0 : -1) : i, d)].focus(); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === "Tab") close(false);
        else if (e.key.length === 1 && /\S/.test(e.key)) { const k = e.key.toLowerCase(), hit = o.find((b, j) => j > i && b.textContent.trim().toLowerCase().startsWith(k)) || o.find((b) => b.textContent.trim().toLowerCase().startsWith(k)); hit && hit.focus(); }
      }),
      on(el, "click", (e) => { const b = e.target.closest(".kds-menu__item"); b && opts().includes(b) && pick(b); }),
      on(el, "toggle", (e) => { if (e.newState === "closed") { offs.forEach((f) => f()); offs = []; trigger.setAttribute("aria-expanded", "false"); } }),
      on(win, "resize", place), on(win, "scroll", place, true),
    ];
  };
  const base = [on(trigger, "click", () => (isOpen() ? close() : open())), on(trigger, "keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(); } })];
  const api = { el, open, close, toggle: () => (isOpen() ? close() : open()), isOpen, destroy: () => { close(false); base.forEach((f) => f()); ctrl.delete(trigger); } };
  ctrl.set(trigger, api);
  return api;
}

/* tooltip: hover/focus (CSS shows it), aria-describedby, side auto-flip, Esc hides */
const OPP = { top: "bottom", bottom: "top", left: "right", right: "left" };
export function tooltip(root, { side } = {}) {
  root.classList.add("kds-tooltip-wrap");
  let tip = root.querySelector(".kds-tooltip");
  if (!tip) { if (!root.dataset.kdsTooltip) return noop; tip = make("span", "kds-tooltip", root.dataset.kdsTooltip); root.append(tip); }
  side = side || Object.keys(OPP).find((s) => tip.classList.contains(`kds-tooltip--${s}`)) || "top";
  const setSide = (s) => { tip.classList.remove(`kds-tooltip--${OPP[s]}`); tip.classList.add(`kds-tooltip--${s}`); };
  setSide(side); tip.setAttribute("role", "tooltip");
  const trigger = Array.from(root.children).find((c) => c !== tip) || root;
  trigger.setAttribute("aria-describedby", idOf(tip, "tip"));
  if (!trigger.matches(FOCUS) && root.tabIndex < 0) root.tabIndex = 0;
  const show = () => {
    tip.style.visibility = ""; setSide(side);
    const r = tip.getBoundingClientRect();
    if (side === "top" && r.top < 0 || side === "bottom" && r.bottom > win.innerHeight || side === "left" && r.left < 0 || side === "right" && r.right > win.innerWidth) setSide(OPP[side]);
  };
  const hide = () => setSide(side);
  return destroyer([on(root, "pointerenter", show), on(root, "focusin", show), on(root, "pointerleave", hide), on(root, "focusout", hide), on(root, "keydown", (e) => { if (e.key === "Escape") tip.style.visibility = "hidden"; })]);
}

/* marquee: wraps children in __track and appends an aria-hidden __clone for a seamless loop */
export function marquee(root, { speed, gap, reverse, pauseOnHover = true, fade = true } = {}) {
  root.classList.add("kds-marquee"); root.classList.toggle("kds-marquee--fade", !!fade); root.classList.toggle("kds-marquee--pause", !!pauseOnHover);
  if (reverse) root.dataset.reverse = "true";
  let track = root.querySelector(".kds-marquee__track");
  if (!track) { track = make("div", "kds-marquee__track"); track.append(...root.childNodes); root.append(track); }
  if (speed) track.style.setProperty("--kds-marquee-dur", `${speed}s`);
  if (gap) track.style.setProperty("--kds-marquee-gap", gap);
  let clone = track.querySelector(".kds-marquee__clone");
  if (!clone) { clone = make("span", "kds-marquee__clone"); clone.setAttribute("aria-hidden", "true"); for (const n of Array.from(track.childNodes)) clone.append(n.cloneNode(true)); track.append(clone); }
  return () => clone.remove();
}

/* command palette: role=dialog + combobox/listbox, typeahead + fuzzy, groups, ⌘K/Ctrl-K */
export function commandPalette({ items = [], hotkey = "k", placeholder = "Search or jump to…", run, emptyText = "No matches.", label = "Command menu", limit = 40 } = {}) {
  const root = make("div", "kds-cmdk"); root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", label); root.style.display = "none";
  root.innerHTML = '<div class="kds-cmdk__panel"><div class="kds-cmdk__search"><input class="kds-cmdk__input" type="text" role="combobox" aria-expanded="true" aria-autocomplete="list" autocomplete="off" spellcheck="false"><kbd class="kds-kbd">esc</kbd></div><div class="kds-cmdk__list" role="listbox"></div></div>';
  doc.body.append(root);
  const panel = root.firstElementChild, input = root.querySelector("input"), list = root.querySelector(".kds-cmdk__list");
  input.placeholder = placeholder; input.setAttribute("aria-label", label); input.setAttribute("aria-controls", idOf(list, "cmdk"));
  let all = items, shown = [], active = 0, last = null, token = 0;
  const score = (it, q) => {
    if (!q) return 1;
    const hay = `${it.title} ${it.subtitle || ""} ${(it.keywords || []).join(" ")}`.toLowerCase(), i = hay.indexOf(q);
    if (i >= 0) return 1000 - i;
    let j = 0; for (const c of hay) if (c === q[j]) j++;
    return j === q.length ? 10 : 0;
  };
  const setActive = (i) => {
    const btns = $(".kds-cmdk__item", list); active = Math.max(0, Math.min(i, btns.length - 1));
    btns.forEach((b, j) => { const a = j === active; b.classList.toggle("is-active", a); b.setAttribute("aria-selected", a); });
    const b = btns[active];
    if (b) { input.setAttribute("aria-activedescendant", b.id); b.scrollIntoView && b.scrollIntoView({ block: "nearest" }); } else input.removeAttribute("aria-activedescendant");
  };
  const render = () => {
    list.textContent = ""; let g;
    if (!shown.length) list.append(make("p", "kds-cmdk__empty", emptyText));
    shown.forEach((it, i) => {
      if (it.group && it.group !== g) { g = it.group; const h = make("p", "kds-cmdk__group", g); h.setAttribute("role", "presentation"); list.append(h); }
      const b = make("button", "kds-cmdk__item"); b.type = "button"; b.setAttribute("role", "option"); idOf(b, "opt"); b.tabIndex = -1;
      b.append(make("span", "kds-cmdk__item-title", it.title)); if (it.subtitle) b.append(make("span", "kds-cmdk__item-sub", it.subtitle));
      b.onmousemove = () => active !== i && setActive(i); b.onclick = () => choose(i);
      list.append(b);
    });
    setActive(0);
  };
  const filter = async () => {
    const q = input.value.trim().toLowerCase(), t = ++token;
    const src = typeof all === "function" ? await all(q) : all; if (t !== token) return;
    const scored = src.map((it, i) => [it, score(it, q), i]).filter((x) => x[1] > 0);
    if (q) scored.sort((a, b) => b[1] - a[1] || a[2] - b[2]);
    const order = [...new Set(scored.map((x) => x[0].group))];
    scored.sort((a, b) => order.indexOf(a[0].group) - order.indexOf(b[0].group));
    shown = scored.slice(0, limit).map((x) => x[0]); render();
  };
  const go = run || ((it) => (it.run ? it.run(it) : it.href && (location.href = it.href)));
  const choose = (i) => { const it = shown[i]; if (it) { close(); go(it); emit(root, "kds:select", it); } };
  const isOpen = () => root.style.display !== "none";
  const open = () => { if (isOpen()) return; last = doc.activeElement; root.style.display = ""; lock(); input.value = ""; filter(); input.focus(); emit(root, "kds:open"); };
  const close = () => { if (!isOpen()) return; root.style.display = "none"; unlock(); last && last.focus && last.focus(); last = null; emit(root, "kds:close"); };
  const toggle = () => (isOpen() ? close() : open());
  const offs = [
    on(input, "input", filter),
    on(root, "keydown", (e) => {
      const d = arrow(e, "v");
      if (d) { e.preventDefault(); setActive(move($(".kds-cmdk__item", list).length, active, d)); }
      else if (e.key === "Enter") { e.preventDefault(); choose(active); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      else trap(panel, e);
    }),
    on(root, "mousedown", (e) => e.target === root && close()),
    on(win, "keydown", (e) => { if (hotkey && (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === hotkey) { e.preventDefault(); toggle(); } }),
    on(win, "kds:cmdk-open", open),
    on(doc, "click", (e) => e.target.closest(".kds-cmdk-trigger,[data-kds-cmdk]") && open()),
  ];
  return { el: root, open, close, toggle, isOpen, setItems: (v) => { all = v; isOpen() && filter(); }, destroy: () => { close(); offs.forEach((f) => f()); root.remove(); } };
}

/* init: auto-wire [data-kds="…"], [data-kds-open="#sel"] delegates; idempotent via WeakSet */
const wired = new WeakSet();
const WIRE = { tabs, accordion, segmented, "theme-toggle": themeToggle, marquee, tooltip, menu, dialog, drawer, spotlight: (el, o) => (M.spotlight ? M.spotlight(el, o) : noop) };
const dataOpts = (el) => Object.fromEntries(Object.entries(el.dataset).filter(([k]) => k.length > 3 && k.startsWith("kds")).map(([k, v]) => [k[3].toLowerCase() + k.slice(4), v === "true" ? true : v === "false" ? false : v !== "" && !isNaN(v) ? +v : v]));
export function init(root = doc) {
  const outs = [];
  if (!wired.has(doc)) {
    wired.add(doc); initTheme();
    outs.push(on(doc, "click", (e) => {
      const t = e.target.closest("[data-kds-open]"), el = t && doc.querySelector(t.dataset.kdsOpen); if (!el) return;
      e.preventDefault(); (ctrl.get(el) || (el.dataset.kds === "drawer" ? drawer : dialog)(el, dataOpts(el))).open();
    }));
  }
  for (const el of $("[data-kds]", root)) {
    const fn = WIRE[el.dataset.kds]; if (!fn || wired.has(el)) continue;
    wired.add(el); const r = fn(el, dataOpts(el)); outs.push(typeof r === "function" ? r : r && r.destroy);
  }
  return () => outs.forEach((f) => f && f());
}
export default init;
