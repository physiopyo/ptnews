"use strict";
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const buzz = require("../buzz_view.js");

const DAY = 86400000;
const day = (start, offset) =>
  new Date(Date.parse(start + "T00:00:00Z") + offset * DAY)
    .toISOString()
    .slice(0, 10);
function observed(start, days, word) {
  return Array.from({ length: days }, (_, i) => ({
    date: day(start, i),
    documents: { news: 1, blog: 1, cafe: 1 },
    related: [
      { w: word(i), c: 10 },
      { w: "공통", c: 5 },
    ],
    sentiment: { community: [{ w: "개선", p: 1, c: 2 }] },
  }));
}
const titles = (html) =>
  [...html.matchAll(/<h5>([^<]*) <span>([^<]*)<\/span>/g)].map(
    (m) => m[1] + "|" + m[2],
  );

// --- rankTrack: how many periods, in what order, compared with what. ---
const END = "2026-10-01";
const rows = observed("2026-08-28", 35, (i) => "주" + Math.floor(i / 7));
const track = buzz.rankTrack(rows, END, "1주일", "community");
assert.equal(track.count, 5, "five whole weeks of observations");
assert.deepEqual(titles(track.html), [
  "4주 전|08.28 ~ 09.03",
  "3주 전|09.04 ~ 09.10",
  "2주 전|09.11 ~ 09.17",
  "직전 기간|09.18 ~ 09.24",
  "이번 기간|09.25 ~ 10.01",
]);
// The oldest card has no older sample: nothing is labelled NEW against nothing.
const cards = track.html.split('<div class="pt-bz-card">').slice(1);
assert.doesNotMatch(cards[0], /NEW|▲|▼/, "oldest period has no comparison");
// Each later card compares against the period right before it.
assert.match(cards[1], /<span[^>]*>주1<\/span><i[^>]*>NEW<\/i>/);
assert.match(cards[1], /<span[^>]*>공통<\/span><i[^>]*>-<\/i>/);
assert.deepEqual(
  buzz.rankTrack([], END, "1주일", "community").count,
  2,
  "no observations still shows this and the previous period",
);
assert.equal(
  buzz.rankTrack(
    observed("2020-01-01", 2000, () => "x"),
    END,
    "1일",
    "blog",
  ).count,
  26,
  "the number of periods is capped",
);
const sparse = buzz.rankTrack(
  observed("2026-09-29", 3, (i) => "단어" + i),
  END,
  "1주일",
  "community",
);
assert.equal(sparse.count, 2);
assert.match(
  sparse.html,
  /관측 3\/7일/,
  "partial coverage is stated, not hidden",
);
assert.match(sparse.html, /비교 기간/);
assert.equal(
  buzz.rankTrack(rows, END, "1개월", "community").count,
  2,
  "monthly periods follow the available span",
);
assert.deepEqual(
  titles(buzz.rankTrack(rows, END, "3개월", "community").html).map(
    (t) => t.split("|")[0],
  ),
  ["직전 기간", "이번 기간"],
);

// --- rendered view: the track replaces the three fixed cards. ---
const data = {
  keywords: ["도수치료"],
  naver: { word_daily: { 도수치료: rows }, channel_daily: { 도수치료: [] } },
};
const html = buzz.render(data, {
  buzzKw: "도수치료",
  buzzView: "senti",
  buzzWordPeriod: "1주일",
  buzzEnd: END,
});
assert.match(html, /연관어 순위변화/);
assert.match(html, /data-buzz-rank-track/);
assert.match(html, /좌우로 끌면 이전 기간 순위를 볼 수 있어요 · 5개 기간/);
assert.match(html, /tabindex="0"/);
assert.match(html, /감성 표현/);
assert.equal(
  (html.match(/<h5>이번 기간 /g) || []).length,
  1,
  "the current period appears once",
);
const none = buzz.render(
  { keywords: ["도수치료"], naver: {} },
  { buzzKw: "도수치료", buzzView: "senti", buzzEnd: END },
);
assert.doesNotMatch(
  none,
  /좌우로 끌면/,
  "no hint when there is nothing to scroll",
);
assert.doesNotMatch(html, /NaN|undefined/);

// --- mounted behaviour: drag scrolling. ---
function harness(extraRows = rows, state = {}) {
  const dom = new JSDOM(
    "<!doctype html><main>" +
      buzz.render(
        {
          keywords: ["도수치료"],
          naver: { word_daily: { 도수치료: extraRows } },
        },
        {
          buzzKw: "도수치료",
          buzzView: "senti",
          buzzWordPeriod: "1주일",
          buzzEnd: END,
          ...state,
        },
      ) +
      "</main>",
  );
  const win = dom.window;
  const root = win.document.querySelector("main");
  const el = root.querySelector("[data-buzz-rank-track]");
  // JSDOM has no layout: give the track a fixed viewport and content width.
  Object.defineProperty(el, "clientWidth", { value: 600, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: 1400, configurable: true });
  let left = 0;
  Object.defineProperty(el, "scrollLeft", {
    configurable: true,
    get: () => left,
    set(value) {
      const max = el.scrollWidth - el.clientWidth;
      const next = Math.min(max, Math.max(0, value));
      if (next === left) return;
      left = next;
      el.dispatchEvent(new win.Event("scroll"));
    },
  });
  const captured = new Set();
  el.setPointerCapture = (id) => captured.add(id);
  el.releasePointerCapture = (id) => captured.delete(id);
  el.hasPointerCapture = (id) => captured.has(id);
  function fire(type, x, extra = {}) {
    const event = new win.MouseEvent(type, {
      clientX: x,
      clientY: 10,
      button: 0,
      buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
      bubbles: true,
      cancelable: true,
      ...extra,
    });
    Object.defineProperty(event, "pointerId", { value: extra.pointerId || 1 });
    Object.defineProperty(event, "pointerType", {
      value: extra.pointerType || "mouse",
    });
    el.dispatchEvent(event);
    return event;
  }
  return { win, root, el, captured, fire };
}

const state = {};
const h = harness(rows, state);
const buzzData = {
  keywords: ["도수치료"],
  naver: { word_daily: { 도수치료: rows } },
};
buzz.mount(h.root, buzzData, state, () => {
  throw new Error("scrolling must not trigger a refresh");
});
assert.equal(h.el.scrollLeft, 800, "starts at the newest period on the right");
assert.equal(
  h.el.hasAttribute("data-scrollable"),
  true,
  "overflowing tracks advertise dragging",
);
h.fire("pointerdown", 300);
assert.ok(h.captured.has(1), "pointer capture follows a drag outside the card");
h.fire("pointermove", 302);
assert.equal(h.el.scrollLeft, 800, "a 2px wobble is not a drag");
assert.equal(h.el.hasAttribute("data-dragging"), false);
h.fire("pointermove", 300 + 250, { pointerId: 9 });
assert.equal(h.el.scrollLeft, 800, "other pointers are ignored");
h.fire("pointermove", 300 + 250);
assert.equal(h.el.scrollLeft, 550, "dragging right reveals earlier periods");
assert.equal(h.el.getAttribute("data-dragging"), "true");
assert.equal(
  state.buzzRankScroll.fromEnd,
  250,
  "remembered from the newest edge",
);
h.fire("pointermove", 300 - 100);
assert.equal(h.el.scrollLeft, 800, "dragging left returns to newer periods");
h.fire("pointermove", 300 + 5000);
assert.equal(h.el.scrollLeft, 0, "cannot scroll past the oldest period");
h.fire("pointerup", 300);
assert.equal(h.captured.size, 0, "capture is released on pointerup");
assert.equal(h.el.hasAttribute("data-dragging"), false);
const parked = h.el.scrollLeft;
h.fire("pointermove", 100, { buttons: 0 });
assert.equal(h.el.scrollLeft, parked, "moving after release does not scroll");
h.fire("pointerdown", 300);
h.fire("pointermove", 380);
assert.equal(h.el.getAttribute("data-dragging"), "true");
h.fire("pointermove", 420, { buttons: 0 });
assert.equal(
  h.el.hasAttribute("data-dragging"),
  false,
  "a missed mouseup ends the drag",
);
h.fire("pointerdown", 300, { button: 2, buttons: 2 });
assert.equal(h.captured.size, 0, "right button does not drag");
h.fire("pointerdown", 300, { pointerType: "touch" });
assert.equal(
  h.captured.size,
  0,
  "touch uses native scrolling, never double-scrolled",
);
h.fire("pointermove", 400, { pointerType: "touch" });
assert.equal(h.el.scrollLeft, parked, "touch is left to the browser");

// Keyboard scrolling.
function key(name) {
  const event = new h.win.KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
  });
  h.el.dispatchEvent(event);
  return event;
}
h.el.scrollLeft = 400;
assert.equal(key("ArrowLeft").defaultPrevented, true);
assert.equal(
  h.el.scrollLeft,
  0,
  "arrow keys page by most of a viewport, clamped at the start",
);
h.el.scrollLeft = 100;
key("ArrowRight");
assert.equal(h.el.scrollLeft, 580, "arrow keys page by 80% of the viewport");
key("ArrowRight");
assert.equal(h.el.scrollLeft, 800, "clamped at the newest period");
key("Home");
assert.equal(h.el.scrollLeft, 0);
key("End");
assert.equal(h.el.scrollLeft, 800);
assert.equal(key("a").defaultPrevented, false);

// Position survives the full re-render the board performs on every change,
// and is kept relative to the newest edge so lazy-loaded history cannot shift it.
buzz.unmount(h.root);
h.fire("pointerdown", 300);
assert.equal(h.captured.size, 0, "an unmounted track ignores pointers");
const again = harness(rows, state);
state.buzzRankScroll = {
  key: again.el.getAttribute("data-buzz-rank-key"),
  fromEnd: 300,
};
buzz.mount(again.root, buzzData, state, () => {});
assert.equal(again.el.scrollLeft, 500, "restored 300px from the newest edge");
Object.defineProperty(again.el, "scrollWidth", { value: 2000 });
buzz.unmount(again.root);
buzz.mount(again.root, buzzData, state, () => {});
assert.equal(
  again.el.scrollLeft,
  1100,
  "extra older cards do not move the view",
);
const otherKey = harness(rows, { buzzWordPeriod: "1일" });
buzz.mount(otherKey.root, buzzData, state, () => {});
assert.equal(
  otherKey.el.scrollLeft,
  800,
  "a different period resets to the newest card",
);
assert.equal(state.buzzRankScroll.fromEnd, 0);

// Cleanup removes every listener and never leaves capture or flags behind.
const cleaned = harness(rows, {});
const cleanState = {};
buzz.mount(cleaned.root, buzzData, cleanState, () => {});
cleaned.fire("pointerdown", 300);
cleaned.fire("pointermove", 380);
assert.equal(cleaned.el.getAttribute("data-dragging"), "true");
buzz.unmount(cleaned.root);
assert.equal(cleaned.el.hasAttribute("data-dragging"), false);
assert.equal(cleaned.captured.size, 0);
const left = cleaned.el.scrollLeft;
cleaned.fire("pointerdown", 300);
cleaned.fire("pointermove", 500);
assert.equal(cleaned.el.scrollLeft, left, "no listeners survive unmount");

// A track that fits needs no dragging.
const fits = harness(rows, {});
Object.defineProperty(fits.el, "scrollWidth", { value: 600 });
buzz.mount(fits.root, buzzData, {}, () => {});
fits.fire("pointerdown", 300);
assert.equal(fits.captured.size, 0, "nothing to scroll, nothing to capture");
assert.equal(
  fits.el.hasAttribute("data-scrollable"),
  false,
  "no grab cursor or selection lock when nothing scrolls",
);
Object.defineProperty(fits.el, "scrollWidth", { value: 1400 });
fits.fire("pointerenter", 300);
assert.equal(
  fits.el.hasAttribute("data-scrollable"),
  true,
  "resizing is picked up when the pointer arrives",
);

console.log(
  "buzz rank scroll: weekly cards, comparisons, coverage, drag/keyboard scroll, restore and cleanup passed",
);
