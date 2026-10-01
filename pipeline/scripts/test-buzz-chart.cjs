"use strict";
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const Chart = require("../buzz_chart.js");
const { normalize, geometry, zoomDomain, panDomain, toSvgPoint, plot } =
  Chart.helpers;
const DAY = 86400000;
const dates = [
  "2026-09-20",
  "2026-09-21",
  "2026-09-22",
  "2026-09-23",
  "2026-09-24",
];
const series = [
  { name: "뉴스", values: [10, 30, null, 40, 20] },
  { name: "블로그", values: [60, 60, 60, 60, 60] },
  { name: "자료 없음", values: [null, null] },
];
function closeTo(actual, expected, tolerance = 1e-7) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
}
function harness(html = Chart.render(dates, series, "건"), reduced = true) {
  const dom = new JSDOM("<!doctype html><main>" + html + "</main>");
  const { window: win } = dom;
  const frames = new Map();
  let frameId = 0;
  win.requestAnimationFrame = (callback) => {
    const id = ++frameId;
    frames.set(id, callback);
    return id;
  };
  win.cancelAnimationFrame = (id) => frames.delete(id);
  const media = new win.EventTarget();
  media.matches = reduced;
  win.matchMedia = () => media;
  const root = win.document.querySelector("main");
  for (const svg of root.querySelectorAll("svg"))
    svg.getBoundingClientRect = () => ({
      left: 100,
      top: 40,
      width: Chart.helpers.plot.viewWidth / 2,
      height: Chart.helpers.plot.viewHeight / 2,
      right: 100 + Chart.helpers.plot.viewWidth / 2,
      bottom: 40 + Chart.helpers.plot.viewHeight / 2,
    });
  const controllers = Chart.mountAll(root);
  const element = root.querySelector(".pt-buzz-chart"),
    svg = element.querySelector("svg");
  function client(point) {
    return { clientX: 100 + point.x / 2, clientY: 40 + point.y / 2 };
  }
  function wheel(point, deltaY, deltaMode = 0) {
    const event = new win.WheelEvent("wheel", {
      ...client(point),
      deltaY,
      deltaMode,
      bubbles: true,
      cancelable: true,
    });
    svg.dispatchEvent(event);
    return event;
  }
  function pointer(point) {
    svg.dispatchEvent(
      new win.MouseEvent("pointermove", { ...client(point), bubbles: true }),
    );
  }
  const captured = new Set();
  if (svg) {
    svg.setPointerCapture = (id) => captured.add(id);
    svg.releasePointerCapture = (id) => captured.delete(id);
    svg.hasPointerCapture = (id) => captured.has(id);
  }
  function drag(type, point, extra = {}) {
    // JSDOM has no PointerEvent: a MouseEvent carries the pointer fields.
    const event = new win.MouseEvent(type, {
      ...client(point),
      button: 0,
      buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
      bubbles: true,
      cancelable: true,
      ...extra,
    });
    Object.defineProperty(event, "pointerId", {
      value: extra.pointerId === undefined ? 7 : extra.pointerId,
    });
    Object.defineProperty(event, "pointerType", {
      value: extra.pointerType || "mouse",
    });
    svg.dispatchEvent(event);
    return event;
  }
  function tick(time) {
    const current = [...frames.values()];
    frames.clear();
    current.forEach((callback) => callback(time));
  }
  function close() {
    controllers.forEach((controller) => controller.destroy());
    assert.equal(frames.size, 0, "no surviving animation work");
    win.close();
  }
  return {
    dom,
    win,
    root,
    element,
    svg,
    controller: controllers[0],
    controllers,
    frames,
    media,
    client,
    wheel,
    pointer,
    drag,
    captured,
    tick,
    close,
  };
}
async function main() {
  // Pure zoom invariants, clamped bounds, and immutable source data.
  const original = JSON.stringify({ dates, series });
  const domain = [0, 100],
    anchor = 31,
    zoomed = zoomDomain(domain, domain, anchor, 2);
  closeTo((anchor - zoomed[0]) / (zoomed[1] - zoomed[0]), 0.31);
  assert.deepEqual(zoomDomain(zoomed, domain, anchor, 0.5), domain);
  let deep = domain;
  for (let i = 0; i < 100; i++) deep = zoomDomain(deep, domain, 0, 2);
  closeTo(deep[0], 0);
  closeTo(deep[1] - deep[0], 100 / 32);
  assert.deepEqual(zoomDomain([80, 90], domain, 90, 0.1), domain);
  const model = normalize(dates, series, "건");
  assert.equal(JSON.stringify({ dates, series }), original);
  const g = geometry(model.series[0], model.x, model.y);
  assert.equal((g.path.match(/ M/g) || []).length, 2);
  assert.equal(g.segments.length, 2);
  const gap = normalize(
    ["2026-09-20", "2026-09-23"],
    [{ name: "x", values: [10, 20] }],
    "건",
  );
  assert.equal(
    geometry(gap.series[0], gap.x, gap.y).segments.length,
    0,
    "absent calendar dates break lines",
  );
  const irregular = normalize(
    ["2026-09-24", "2026-09-20", "2026-09-21"],
    [{ name: "x", values: [4, 0, 1] }],
    "건",
  );
  const ig = geometry(irregular.series[0], irregular.x, irregular.y);
  closeTo(ig.points[1].x - ig.points[0].x, plot.width / 4);
  assert.deepEqual(
    ig.points.map((p) => p.sample.value),
    [0, 1, 4],
    "calendar sorting preserves value pairing",
  );
  const fortyFour = Array.from({ length: 44 }, (_, i) => "분야 " + i);
  assert.equal(new Set(fortyFour.map(Chart.colorForName)).size, 44);
  assert.equal(
    normalize(dates, [series[1]], "건").series[0].color,
    model.series[1].color,
    "subset order does not recolor names",
  );
  assert.equal(
    normalize(dates, [{ name: "x", color: "#135abc", values: [1] }], "건")
      .series[0].color,
    "#135abc",
  );

  const h = harness();
  const { element, svg, controller } = h;
  assert.equal(
    Chart.mountAll(h.root)[0],
    controller,
    "mounting repeatedly does not duplicate listeners",
  );
  assert.equal(
    Chart.mountAll(element)[0],
    controller,
    "root chart is mounted too",
  );
  assert.equal(h.frames.size, 0, "reduced motion schedules no animation");
  assert.equal(element.getAttribute("data-reveal-state"), "complete");
  assert.equal(
    element.querySelector(".pt-chart-reveal").getAttribute("width"),
    String(plot.width),
  );
  const legend = element.querySelector(".pt-chart-legend"),
    detail = element.querySelector(".pt-chart-detail");
  assert.ok(
    legend.compareDocumentPosition(svg) &
      h.win.Node.DOCUMENT_POSITION_FOLLOWING,
    "legend is above SVG",
  );
  assert.ok(
    svg.compareDocumentPosition(detail) &
      h.win.Node.DOCUMENT_POSITION_FOLLOWING,
    "exact details are below SVG",
  );
  assert.equal(legend.querySelectorAll("button").length, 2);
  assert.match(
    element.querySelector(".pt-chart-unavailable").textContent,
    /자료 없음 · 미수집/,
  );
  assert.equal(
    JSON.parse(element.getAttribute("data-chart-model")).series.length,
    3,
    "unavailable series remain in the model",
  );
  assert.equal(
    element.querySelector(".pt-chart-dot title").textContent,
    "2026-09-20 · 뉴스 10건",
  );
  const svgPoint = toSvgPoint(svg, 100 + plot.x / 2, 40 + plot.y / 2);
  closeTo(svgPoint.x, plot.x);
  closeTo(svgPoint.y, plot.y);
  closeTo(svgPoint.scale, 0.5);
  const letterbox = {
    getBoundingClientRect: () => ({
      left: 10,
      top: 20,
      width: plot.viewWidth / 2,
      height: 200,
    }),
  };
  const local = toSvgPoint(
    letterbox,
    10 + plot.x / 2,
    20 + (200 - plot.viewHeight / 2) / 2 + plot.y / 2,
  );
  closeTo(local.x, plot.x);
  closeTo(local.y, plot.y);
  const matrixSvg = {
    getScreenCTM: () => ({ a: 2, b: 0, inverse: () => "inverse" }),
    createSVGPoint: () => ({
      matrixTransform(matrix) {
        assert.equal(matrix, "inverse");
        return { x: 70, y: 80 };
      },
    }),
  };
  assert.deepEqual(toSvgPoint(matrixSvg, 140, 160), { x: 70, y: 80, scale: 2 });
  const initial = controller.getState();
  const point = { x: plot.x + plot.width * 0.3, y: plot.y + plot.height * 0.6 };
  const ax = initial.x[0] + (initial.x[1] - initial.x[0]) * 0.3;
  const ay = initial.y[1] - (initial.y[1] - initial.y[0]) * 0.6;
  const axesBefore = element.querySelector(".pt-chart-axes").innerHTML;
  assert.equal(
    h.wheel({ x: 20, y: 20 }, -100).defaultPrevented,
    false,
    "outside plot scroll is untouched",
  );
  assert.equal(h.wheel(point, 0).defaultPrevented, false);
  assert.equal(h.wheel(point, -160).defaultPrevented, true);
  let state = controller.getState();
  closeTo((ax - state.x[0]) / (state.x[1] - state.x[0]), 0.3);
  closeTo((state.y[1] - ay) / (state.y[1] - state.y[0]), 0.6);
  assert.notEqual(
    element.querySelector(".pt-chart-axes").innerHTML,
    axesBefore,
    "zoom updates axes",
  );
  assert.equal(h.frames.size, 0, "wheel does not restart reveal");
  for (let i = 0; i < 20; i++) h.wheel(point, -600);
  state = controller.getState();
  closeTo(state.zoom, 32);
  assert.ok(state.x[0] >= initial.x[0] && state.x[1] <= initial.x[1]);
  assert.ok(state.y[0] >= initial.y[0] && state.y[1] <= initial.y[1]);
  assert.equal(
    h.wheel(point, -600).defaultPrevented,
    false,
    "zoom cap is not a scroll trap",
  );
  element.querySelector('[data-chart-action="reset"]').click();
  assert.deepEqual(controller.getState().x, initial.x);
  assert.deepEqual(controller.getState().y, initial.y);
  assert.equal(
    h.wheel(point, 100).defaultPrevented,
    false,
    "full extent allows outward scroll",
  );
  element.querySelector('[data-chart-action="zoom-in"]').click();
  closeTo(controller.getState().zoom, 2);
  element.querySelector('[data-chart-action="zoom-out"]').click();
  closeTo(controller.getState().zoom, 1);
  h.wheel(point, -5, 1);
  assert.ok(controller.getState().zoom > 1);
  controller.reset();

  // Dragging pans the zoomed view without changing the zoom level.
  const full = controller.getState();
  const mid = { x: plot.x + plot.width / 2, y: plot.y + plot.height / 2 };
  h.drag("pointerdown", mid);
  assert.equal(h.captured.size, 0, "full extent has nothing to pan");
  h.drag("pointermove", { x: mid.x - 200, y: mid.y });
  assert.deepEqual(controller.getState().x, full.x);
  h.drag("pointerup", mid);
  element.querySelector('[data-chart-action="zoom-in"]').click();
  element.querySelector('[data-chart-action="zoom-in"]').click();
  const base = controller.getState();
  closeTo(base.zoom, 4);
  const span = base.x[1] - base.x[0];
  assert.equal(
    h.drag("pointerdown", mid, { button: 2, buttons: 2 }).defaultPrevented,
    false,
  );
  assert.equal(h.captured.size, 0, "secondary button does not pan");
  h.drag("pointerdown", { x: 20, y: 20 });
  assert.equal(h.captured.size, 0, "axis margin does not pan");
  h.drag("pointerdown", mid);
  assert.ok(
    h.captured.has(7),
    "pointer capture keeps the drag alive outside the SVG",
  );
  h.drag("pointermove", { x: mid.x + 1, y: mid.y + 1 });
  assert.deepEqual(
    controller.getState().x,
    base.x,
    "sub-threshold jitter is a click",
  );
  assert.equal(element.hasAttribute("data-panning"), false);
  h.drag(
    "pointermove",
    { x: mid.x + plot.width / 8, y: mid.y },
    { pointerId: 99 },
  );
  assert.deepEqual(
    controller.getState().x,
    base.x,
    "foreign pointer is ignored",
  );
  h.drag("pointermove", { x: mid.x + plot.width / 8, y: mid.y });
  state = controller.getState();
  assert.equal(element.getAttribute("data-panning"), "true");
  closeTo(state.x[0], base.x[0] - span / 8, 1e-3);
  closeTo(state.x[1] - state.x[0], span, 1e-3);
  closeTo(state.zoom, 4, 1e-9);
  assert.deepEqual(state.y, base.y, "horizontal drag leaves y untouched");
  assert.equal(controller.getState().active, null, "no hover while dragging");
  h.drag("pointermove", {
    x: mid.x + plot.width / 8,
    y: mid.y - plot.height / 8,
  });
  const up = controller.getState();
  closeTo(up.x[0], state.x[0], 1e-3);
  assert.ok(up.y[0] < base.y[0], "dragging the data up shows lower values");
  closeTo(up.y[1] - up.y[0], base.y[1] - base.y[0], 1e-6);
  h.drag("pointermove", { x: mid.x + 4000, y: mid.y - 4000 });
  state = controller.getState();
  closeTo(state.x[0], full.x[0], 1e-6);
  assert.ok(
    state.y[1] <= full.y[1] + 1e-6 && state.y[0] >= full.y[0] - 1e-6,
    "pan never leaves data bounds",
  );
  h.drag("pointermove", { x: mid.x - 4000, y: mid.y + 4000 });
  state = controller.getState();
  closeTo(state.x[1], full.x[1], 1e-6);
  assert.ok(state.y[0] >= full.y[0] - 1e-6);
  h.drag("pointerup", mid);
  assert.equal(h.captured.size, 0, "pointer capture is released on pointerup");
  assert.equal(element.hasAttribute("data-panning"), false);
  const parked = controller.getState().x.slice();
  h.drag("pointermove", { x: mid.x - 80, y: mid.y }, { buttons: 0 });
  assert.deepEqual(
    controller.getState().x,
    parked,
    "moving after release does not pan",
  );
  h.drag("pointerdown", mid);
  h.drag("pointermove", { x: mid.x + 60, y: mid.y });
  assert.equal(element.getAttribute("data-panning"), "true");
  h.drag("pointermove", { x: mid.x + 90, y: mid.y }, { buttons: 0 });
  assert.equal(
    element.hasAttribute("data-panning"),
    false,
    "a missed mouseup ends the drag",
  );
  h.drag("pointerdown", mid, { pointerType: "touch" });
  h.drag("pointermove", { x: mid.x + 60, y: mid.y }, { pointerType: "touch" });
  assert.equal(
    element.getAttribute("data-panning"),
    "true",
    "touch drags pan too",
  );
  h.drag("pointercancel", mid, { pointerType: "touch" });
  assert.equal(
    element.hasAttribute("data-panning"),
    false,
    "pointercancel ends the drag",
  );
  assert.equal(h.captured.size, 0);
  controller.reset();
  closeTo(controller.getState().zoom, 1);
  assert.equal(
    controller.pan(50 * DAY, 10),
    false,
    "programmatic pan at full extent is a no-op",
  );
  element.querySelector('[data-chart-action="zoom-in"]').click();
  assert.equal(controller.pan(DAY, 0), true);
  const panned = controller.getState();
  assert.ok(panned.x[0] > full.x[0], "controller.pan moves the window");
  controller.reset();
  closeTo(panDomain([20, 40], [0, 100], 70)[1], 100);
  assert.deepEqual(panDomain([20, 40], [0, 100], -70), [0, 20]);
  assert.deepEqual(panDomain([20, 40], [0, 100], 10), [30, 50]);
  assert.deepEqual(panDomain([0, 100], [0, 100], 25), [0, 100]);
  assert.match(element.querySelector("svg desc").textContent, /끌어/);
  assert.match(detail.textContent, /마우스로 끌면/);

  // Proximity is to drawn segments; details choose an actual endpoint, never interpolate.
  const a = g.points[0],
    b = g.points[1];
  h.pointer({ x: a.x + (b.x - a.x) * 0.7, y: a.y + (b.y - a.y) * 0.7 });
  assert.equal(detail.textContent, "2026-09-21 · 뉴스 30건");
  assert.equal(
    element.querySelector('.pt-chart-line[data-series-index="0"]').style
      .opacity,
    "1",
  );
  assert.equal(
    element.querySelector('.pt-chart-line[data-series-index="1"]').style
      .opacity,
    "0.2",
  );
  assert.equal(
    legend
      .querySelector('[data-chart-series="0"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    legend.querySelector('[data-chart-series="1"]').style.opacity,
    "0.2",
  );
  assert.equal(
    element
      .querySelector('.pt-chart-line[data-series-index="0"]')
      .getAttribute("stroke-width"),
    "3.4",
  );
  assert.equal(h.frames.size, 0);
  // Midpoint of a null gap must not acquire the nonexistent connection.
  h.pointer({
    x: (g.points[1].x + g.points[2].x) / 2,
    y: (g.points[1].y + g.points[2].y) / 2,
  });
  assert.equal(controller.getState().active, null);
  h.pointer(g.points[0]);
  assert.equal(detail.textContent, "2026-09-20 · 뉴스 10건");
  svg.dispatchEvent(new h.win.Event("pointerleave"));
  assert.equal(controller.getState().active, null);
  for (const line of element.querySelectorAll(".pt-chart-line"))
    assert.equal(line.style.opacity, "1");
  const firstLegend = legend.querySelector('[data-chart-series="0"]');
  firstLegend.focus();
  assert.equal(detail.textContent, "2026-09-20 · 뉴스 10건");
  firstLegend.dispatchEvent(
    new h.win.KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(detail.textContent, "2026-09-21 · 뉴스 30건");
  firstLegend.dispatchEvent(
    new h.win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  assert.equal(
    detail.textContent,
    "2026-09-23 · 뉴스 40건",
    "keyboard skips missing values",
  );
  firstLegend.dispatchEvent(
    new h.win.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  assert.equal(detail.textContent, "2026-09-23 · 블로그 60건");
  svg.dispatchEvent(
    new h.win.KeyboardEvent("keydown", { key: "End", bubbles: true }),
  );
  assert.equal(detail.textContent, "2026-09-24 · 블로그 60건");
  svg.dispatchEvent(
    new h.win.KeyboardEvent("keydown", { key: "+", bubbles: true }),
  );
  closeTo(controller.getState().zoom, 2);
  svg.dispatchEvent(
    new h.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  closeTo(controller.getState().zoom, 1);
  legend.querySelector('[data-chart-series="1"]').click();
  assert.match(detail.textContent, /블로그 60건/);
  assert.equal(
    JSON.stringify({ dates, series }),
    original,
    "interaction does not mutate input",
  );
  h.close();

  for (const values of [[0], [7], [0, 0, 0]]) {
    const edge = harness(
      Chart.render(
        dates.slice(0, values.length),
        [{ name: "단일", values }],
        "건",
      ),
    );
    assert.equal(
      edge.element.querySelectorAll(".pt-chart-dot").length,
      values.length,
    );
    assert.doesNotMatch(edge.svg.innerHTML, /NaN|Infinity|undefined/);
    const circle = edge.element.querySelector(".pt-chart-dot");
    edge.pointer({
      x: Number(circle.getAttribute("cx")),
      y: Number(circle.getAttribute("cy")),
    });
    assert.match(
      edge.element.querySelector(".pt-chart-detail").textContent,
      new RegExp("단일 " + values[0] + "건"),
    );
    edge.element.querySelector('[data-chart-action="zoom-in"]').click();
    closeTo(edge.controller.getState().zoom, 2);
    edge.close();
  }
  for (const empty of [
    Chart.render([], [], "건"),
    Chart.render(
      dates,
      [{ name: "누락", values: [null, undefined, NaN] }],
      "건",
    ),
    Chart.render(["2026-02-31"], [{ name: "오류", values: [1] }], "건"),
  ]) {
    const e = harness(empty);
    assert.equal(e.svg, null);
    assert.match(e.element.textContent, /미수집을 0건으로 표시하지 않습니다/);
    e.close();
  }
  const hostile =
    '</title><img src=x onerror=alert(1)><script>alert(1)</script>"&';
  const escaped = harness(
    Chart.render(
      ["2026-09-20"],
      [
        {
          name: hostile,
          values: [3],
          color: "red; background:url(https://invalid)",
        },
        { name: hostile, values: [null] },
      ],
      hostile,
    ),
  );
  assert.equal(escaped.root.querySelectorAll("script,img").length, 0);
  assert.equal(
    escaped.root.querySelector(".pt-chart-dot title").textContent,
    "2026-09-20 · " + hostile + " 3" + hostile,
  );
  escaped.element.querySelector('[data-chart-series="0"]').click();
  assert.equal(escaped.root.querySelectorAll("script,img").length, 0);
  assert.match(
    escaped.root.querySelector(".pt-chart-detail").textContent,
    /<img/,
  );
  assert.doesNotMatch(
    escaped.root.querySelector(".pt-chart-line").getAttribute("stroke"),
    /url|background/,
  );
  escaped.close();
  const multiple = harness(
    Chart.render(dates, series, "건") + Chart.render(dates, series, "건"),
  );
  const ids = [...multiple.root.querySelectorAll("[id]")].map(
    (node) => node.id,
  );
  assert.equal(
    new Set(ids).size,
    ids.length,
    "per-chart clip and accessibility IDs are unique",
  );
  for (const node of multiple.root.querySelectorAll("[clip-path]"))
    assert.ok(
      multiple.root.querySelector(node.getAttribute("clip-path").slice(4, -1)),
    );
  multiple.close();

  const animation = harness(undefined, false);
  assert.equal(
    animation.element.querySelector(".pt-chart-reveal").getAttribute("width"),
    "0",
  );
  animation.tick(100);
  animation.tick(550);
  closeTo(
    Number(
      animation.element.querySelector(".pt-chart-reveal").getAttribute("width"),
    ),
    plot.width / 2,
  );
  assert.equal(
    animation.element.querySelector(".pt-chart-reveal").getAttribute("x"),
    String(plot.x),
    "reveal always starts at first chronological date",
  );
  animation.tick(1000);
  assert.equal(animation.frames.size, 0);
  assert.equal(animation.element.getAttribute("data-reveal-state"), "complete");
  Chart.mountAll(animation.root);
  assert.equal(animation.frames.size, 0, "remount does not replay animation");
  animation.pointer(g.points[0]);
  animation.wheel(point, -100);
  assert.equal(animation.frames.size, 0);
  animation.close();
  const interrupted = harness(undefined, false);
  assert.equal(interrupted.frames.size, 1);
  interrupted.wheel(point, -100);
  assert.equal(
    interrupted.frames.size,
    0,
    "wheel ends reveal without restarting it",
  );
  interrupted.close();
  const changedMotion = harness(undefined, false);
  const change = new changedMotion.win.Event("change");
  Object.defineProperty(change, "matches", { value: true });
  changedMotion.media.dispatchEvent(change);
  assert.equal(changedMotion.frames.size, 0);
  changedMotion.close();
  const removed = harness(undefined, false);
  removed.element.remove();
  await Promise.resolve();
  assert.equal(removed.frames.size, 0, "DOM removal cancels pending animation");
  assert.equal(removed.controller.getState().destroyed, true);
  removed.close();
  console.log(
    "buzz chart: zoom anchors/bounds, rendered wheel/reset, hover exact samples, legends/keyboard, gaps/edge values, escaping, reveal/reduced motion and cleanup passed",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
