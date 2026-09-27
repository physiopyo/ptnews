/* Calendar-scaled SVG chart. Missing observations are never interpolated. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PTBuzzChart = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var DAY = 86400000,
    MAX_ZOOM = 32,
    serial = 0,
    mounted = new WeakMap();
  var PLOT = Object.freeze({
    x: 64,
    y: 20,
    width: 792,
    height: 222,
    viewWidth: 880,
    viewHeight: 294,
  });
  var EMPTY =
    "이 기간에 수집된 값이 없습니다. 미수집을 0건으로 표시하지 않습니다.";
  var HELP =
    "선이나 점에 포인터를 올리면 실제 관측값을 확인합니다. 범례 선택 후 방향키로 날짜·계열을 탐색할 수 있습니다.";
  var CSS =
    '.pt-buzz-chart{margin:16px 0;padding:14px;border:1px solid #ddd9d0;border-radius:14px;background:#fffdf9;color:#302e29;font:13px/1.5 system-ui,sans-serif}.pt-buzz-chart *{box-sizing:border-box}.pt-buzz-chart .pt-chart-legend{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px;padding:0;list-style:none}.pt-buzz-chart button{font:inherit;cursor:pointer;border:1px solid #d9d5cc;background:#fff;border-radius:8px;padding:6px 10px;color:inherit}.pt-buzz-chart button:focus-visible,.pt-buzz-chart svg:focus-visible{outline:3px solid #2b6fc0;outline-offset:3px}.pt-buzz-chart .pt-chart-legend button{display:flex;align-items:center;gap:7px;text-align:left;transition:opacity 90ms}.pt-buzz-chart .pt-chart-legend button[aria-pressed="true"]{border-color:var(--pt-series-color);background:#f1efe8;font-weight:700}.pt-buzz-chart .pt-chart-swatch{display:inline-block;flex:0 0 18px;height:4px;background:var(--pt-series-color);border-radius:2px}.pt-buzz-chart .pt-chart-unavailable{margin:6px 0;color:#716b60;font-size:12px}.pt-buzz-chart .pt-chart-unavailable ul{display:flex;flex-wrap:wrap;gap:4px 16px;padding-left:20px}.pt-buzz-chart .pt-chart-tools{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:4px 0 2px}.pt-buzz-chart .pt-chart-zoom{margin-left:3px;color:#666159;font-variant-numeric:tabular-nums}.pt-buzz-chart .pt-chart-stage{width:100%;overflow:hidden}.pt-buzz-chart svg{display:block;width:100%;height:auto;overflow:visible}.pt-buzz-chart .pt-chart-line{transition:opacity 90ms;vector-effect:non-scaling-stroke}.pt-buzz-chart .pt-chart-detail{min-height:50px;margin-top:6px;padding:10px 12px;border:1px solid #e4e0d7;border-radius:9px;background:#f6f3ec;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.pt-buzz-chart .pt-chart-hint{margin:8px 0 0;color:#716b60;font-size:11px}.pt-buzz-chart .pt-chart-empty{margin:12px 0}.pt-buzz-chart .pt-chart-grid{stroke:#e8e4db;stroke-width:1}.pt-buzz-chart .pt-chart-tick{fill:#6b665d;font-size:11px;font-variant-numeric:tabular-nums}@media(prefers-reduced-motion:reduce){.pt-buzz-chart .pt-chart-line,.pt-buzz-chart .pt-chart-legend button{transition:none}}';
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }
  function finite(value) {
    return typeof value === "number" && isFinite(value);
  }
  function fmt(value) {
    return value.toLocaleString("ko-KR", { maximumFractionDigits: 20 });
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function stamp(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return null;
    var time = Date.parse(value + "T00:00:00Z");
    return isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
      ? time
      : null;
  }
  function colorForName(name) {
    var hash = 2166136261,
      text = String(name);
    for (var i = 0; i < text.length; i++)
      hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x846ca68b);
    hash = (hash ^ (hash >>> 16)) >>> 0;
    return (
      "hsl(" +
      (hash % 36000) / 100 +
      ", " +
      (62 + ((hash >>> 16) % 12)) +
      "%, " +
      (34 + ((hash >>> 24) % 10)) +
      "%)"
    );
  }
  function safeColor(color, name) {
    return typeof color === "string" &&
      (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color) ||
        /^(?:rgb|hsl)a?\([\d.,% +\-]+\)$/.test(color))
      ? color
      : colorForName(name);
  }
  function normalize(dates, series, unit) {
    var rows = (Array.isArray(dates) ? dates : [])
      .map(function (date, index) {
        return { date: date, time: stamp(date), index: index };
      })
      .filter(function (row) {
        return row.time !== null;
      })
      .sort(function (a, b) {
        return a.time - b.time || a.index - b.index;
      });
    var low = 0,
      high = 0,
      count = 0;
    var items = (Array.isArray(series) ? series : []).map(function (item) {
      var s = item || {},
        name = String(s.name == null ? "" : s.name),
        values = Array.isArray(s.values) ? s.values : [];
      var samples = rows.map(function (row) {
        var value = values[row.index];
        if (!finite(value))
          return { date: row.date, time: row.time, value: null };
        low = Math.min(low, value);
        high = Math.max(high, value);
        count++;
        return { date: row.date, time: row.time, value: value };
      });
      return { name: name, color: safeColor(s.color, name), samples: samples };
    });
    var start = rows.length ? rows[0].time : 0,
      end = rows.length ? rows[rows.length - 1].time : DAY;
    return {
      series: items,
      unit: String(unit == null ? "" : unit),
      count: count,
      x: start === end ? [start - DAY / 2, end + DAY / 2] : [start, end],
      y: [low < 0 ? low * 1.08 : 0, high > 0 ? high * 1.08 : 1],
    };
  }
  function zoomDomain(domain, bounds, anchor, factor) {
    var full = bounds[1] - bounds[0],
      span = domain[1] - domain[0];
    var nextSpan = clamp(span / factor, full / MAX_ZOOM, full);
    var start = anchor - ((anchor - domain[0]) / span) * nextSpan;
    start = clamp(start, bounds[0], bounds[1] - nextSpan);
    return [start, start + nextSpan];
  }
  function xAt(time, domain) {
    return PLOT.x + ((time - domain[0]) / (domain[1] - domain[0])) * PLOT.width;
  }
  function yAt(value, domain) {
    return (
      PLOT.y +
      PLOT.height -
      ((value - domain[0]) / (domain[1] - domain[0])) * PLOT.height
    );
  }
  function geometry(series, x, y) {
    var points = [],
      segments = [],
      path = "",
      previous = null;
    series.samples.forEach(function (sample, index) {
      if (!finite(sample.value)) {
        previous = null;
        return;
      }
      var point = {
        x: xAt(sample.time, x),
        y: yAt(sample.value, y),
        sample: sample,
        index: index,
      };
      var connected = previous && sample.time - previous.sample.time === DAY;
      path +=
        (connected ? " L" : " M") +
        point.x.toFixed(3) +
        " " +
        point.y.toFixed(3);
      if (connected) segments.push([previous, point]);
      points.push(point);
      previous = point;
    });
    return { points: points, segments: segments, path: path };
  }
  function sampleLabel(model, index, sample) {
    return (
      sample.date +
      " · " +
      model.series[index].name +
      " " +
      fmt(sample.value) +
      model.unit
    );
  }
  function axes(x, y) {
    var html = "",
      i,
      value,
      px,
      py,
      label;
    for (i = 0; i <= 4; i++) {
      value = y[0] + ((y[1] - y[0]) * i) / 4;
      py = yAt(value, y);
      html +=
        '<line class="pt-chart-grid" x1="' +
        PLOT.x +
        '" x2="' +
        (PLOT.x + PLOT.width) +
        '" y1="' +
        py +
        '" y2="' +
        py +
        '"/><text class="pt-chart-tick" x="' +
        (PLOT.x - 9) +
        '" y="' +
        (py + 4) +
        '" text-anchor="end">' +
        esc(value.toLocaleString("ko-KR", { maximumSignificantDigits: 5 })) +
        "</text>";
    }
    var ticks = x[1] - x[0] < 2 * DAY ? 2 : 4;
    for (i = 0; i <= ticks; i++) {
      value = x[0] + ((x[1] - x[0]) * i) / ticks;
      px = xAt(value, x);
      label = new Date(value).toISOString();
      label =
        ticks === 2
          ? label.slice(0, 10) + " " + label.slice(11, 16)
          : label.slice(0, 10);
      html +=
        '<text class="pt-chart-tick" x="' +
        px +
        '" y="' +
        (PLOT.y + PLOT.height + 26) +
        '" text-anchor="' +
        (i === 0 ? "start" : i === ticks ? "end" : "middle") +
        '">' +
        esc(label) +
        "</text>";
    }
    return html;
  }
  function render(dates, series, unit) {
    var model = normalize(dates, series, unit),
      id = "pt-buzz-" + ++serial,
      clip = id + "-plot",
      reveal = id + "-reveal",
      unavailable = [];
    var legend = model.series
      .map(function (s, index) {
        if (
          !s.samples.some(function (sample) {
            return finite(sample.value);
          })
        ) {
          unavailable.push(s.name);
          return "";
        }
        return (
          '<li><button type="button" data-chart-series="' +
          index +
          '" aria-pressed="false" style="--pt-series-color:' +
          esc(s.color) +
          '"><span class="pt-chart-swatch" aria-hidden="true"></span>' +
          esc(s.name) +
          "</button></li>"
        );
      })
      .join("");
    var html =
      '<section class="pt-buzz-chart" data-chart-model="' +
      esc(JSON.stringify(model)) +
      '" aria-label="여론 관측 추이"><style>' +
      CSS +
      '</style><ul class="pt-chart-legend" aria-label="계열 범례">' +
      legend +
      "</ul>";
    if (unavailable.length)
      html +=
        '<details class="pt-chart-unavailable"><summary>' +
        unavailable.length +
        "개 계열 미수집</summary><ul>" +
        unavailable
          .map(function (name) {
            return "<li>" + esc(name) + " · 미수집</li>";
          })
          .join("") +
        "</ul></details>";
    if (!model.count)
      return (
        html +
        '<p class="pt-chart-empty">' +
        EMPTY +
        '</p><div class="pt-chart-detail" role="status" aria-live="polite">' +
        EMPTY +
        "</div></section>"
      );
    html +=
      '<div class="pt-chart-tools" aria-label="그래프 배율"><button type="button" data-chart-action="zoom-in" aria-label="그래프 확대">＋ 확대</button><button type="button" data-chart-action="zoom-out" aria-label="그래프 축소">− 축소</button><button type="button" data-chart-action="reset">전체 보기 · 초기화</button><output class="pt-chart-zoom" aria-label="현재 배율">1×</output></div>';
    html +=
      '<div class="pt-chart-stage"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 294" preserveAspectRatio="xMidYMid meet" tabindex="0" role="group" aria-labelledby="' +
      id +
      '-title" aria-describedby="' +
      id +
      '-help"><title id="' +
      id +
      '-title">' +
      esc(model.unit + " 추이: 실제 관측점만 표시") +
      '</title><desc id="' +
      id +
      '-help">좌우 방향키: 이전·다음 관측일. 위아래 방향키: 계열 변경. Home·End: 처음·마지막 관측값. 그래프 안에서 휠로 확대·축소.</desc><defs><clipPath id="' +
      clip +
      '" clipPathUnits="userSpaceOnUse"><rect x="' +
      PLOT.x +
      '" y="' +
      PLOT.y +
      '" width="' +
      PLOT.width +
      '" height="' +
      PLOT.height +
      '"/></clipPath><clipPath id="' +
      reveal +
      '" clipPathUnits="userSpaceOnUse"><rect class="pt-chart-reveal" x="' +
      PLOT.x +
      '" y="' +
      PLOT.y +
      '" width="' +
      PLOT.width +
      '" height="' +
      PLOT.height +
      '"/></clipPath></defs><g class="pt-chart-axes">' +
      axes(model.x, model.y) +
      '</g><g clip-path="url(#' +
      clip +
      ')"><g clip-path="url(#' +
      reveal +
      ')">';
    model.series.forEach(function (s, index) {
      var g = geometry(s, model.x, model.y);
      html +=
        '<g class="pt-chart-series" data-series-index="' +
        index +
        '"><path class="pt-chart-line" data-series-index="' +
        index +
        '" d="' +
        g.path +
        '" stroke="' +
        esc(s.color) +
        '" fill="none" stroke-width="2.4" style="opacity:1"/><g class="pt-chart-dots">';
      g.points.forEach(function (point) {
        html +=
          '<circle class="pt-chart-dot" data-sample-index="' +
          point.index +
          '" cx="' +
          point.x +
          '" cy="' +
          point.y +
          '" r="2.8" fill="' +
          esc(s.color) +
          '"><title>' +
          esc(sampleLabel(model, index, point.sample)) +
          "</title></circle>";
      });
      html += "</g></g>";
    });
    return (
      html +
      '<circle class="pt-chart-active-dot" r="5" fill="#fffdf9" stroke-width="2.5" visibility="hidden" pointer-events="none"/></g></g></svg></div><div class="pt-chart-detail" role="status" aria-live="polite" aria-atomic="true">' +
      HELP +
      '</div><p class="pt-chart-hint">휠: 포인터를 기준으로 가로·세로 확대/축소 (최대 32배). 범례: 계열 선택. 빈 날짜는 연결하지 않습니다.</p></section>'
    );
  }
  function toSvgPoint(svg, clientX, clientY) {
    if (svg.getScreenCTM && svg.createSVGPoint) {
      var matrix = svg.getScreenCTM();
      if (matrix) {
        try {
          var point = svg.createSVGPoint();
          point.x = clientX;
          point.y = clientY;
          var local = point.matrixTransform(matrix.inverse());
          if (finite(local.x) && finite(local.y))
            return {
              x: local.x,
              y: local.y,
              scale: Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b),
            };
        } catch (_) {
          /* A detached SVG may have a singular matrix. */
        }
      }
    }
    var rect = svg.getBoundingClientRect(),
      scale = Math.min(
        rect.width / PLOT.viewWidth,
        rect.height / PLOT.viewHeight,
      );
    if (!finite(scale) || scale <= 0) return null;
    return {
      x:
        (clientX - rect.left - (rect.width - PLOT.viewWidth * scale) / 2) /
        scale,
      y:
        (clientY - rect.top - (rect.height - PLOT.viewHeight * scale) / 2) /
        scale,
      scale: scale,
    };
  }
  function inPlot(point) {
    return (
      point &&
      point.x >= PLOT.x &&
      point.x <= PLOT.x + PLOT.width &&
      point.y >= PLOT.y &&
      point.y <= PLOT.y + PLOT.height
    );
  }
  function nearest(geometries, pointer, tolerance, right) {
    var best = null,
      distance = tolerance * tolerance;
    function consider(index, sample, x, y) {
      if (x < PLOT.x || x > right || y < PLOT.y || y > PLOT.y + PLOT.height)
        return;
      var d =
        (x - pointer.x) * (x - pointer.x) + (y - pointer.y) * (y - pointer.y);
      if (d <= distance && (!best || d < distance)) {
        distance = d;
        best = { series: index, point: sample };
      }
    }
    geometries.forEach(function (g, index) {
      g.points.forEach(function (p) {
        consider(index, p, p.x, p.y);
      });
      g.segments.forEach(function (segment) {
        var a = segment[0],
          b = segment[1],
          dx = b.x - a.x,
          dy = b.y - a.y;
        var t = clamp(
          ((pointer.x - a.x) * dx + (pointer.y - a.y) * dy) /
            (dx * dx + dy * dy),
          0,
          1,
        );
        consider(index, t <= 0.5 ? a : b, a.x + t * dx, a.y + t * dy);
      });
    });
    return best;
  }
  function mount(element) {
    if (mounted.has(element)) return mounted.get(element);
    var model;
    try {
      model = JSON.parse(element.getAttribute("data-chart-model"));
    } catch (_) {
      return null;
    }
    var win = element.ownerDocument.defaultView,
      svg = element.querySelector("svg"),
      detail = element.querySelector(".pt-chart-detail");
    var x = model.x.slice(),
      y = model.y.slice(),
      active = null,
      geometries = [],
      destroyed = false,
      frame = null,
      revealProgress = 1;
    var listeners = [],
      observer = null,
      media = win.matchMedia
        ? win.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    var reveal = element.querySelector(".pt-chart-reveal"),
      ring = element.querySelector(".pt-chart-active-dot");
    var groups = Array.from(element.querySelectorAll(".pt-chart-series")),
      legends = Array.from(element.querySelectorAll("[data-chart-series]"));
    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      listeners.push(function () {
        target.removeEventListener(type, handler, options);
      });
    }
    function highlight(selection) {
      active = selection;
      if (active) {
        element.setAttribute("data-active-series", active.series);
        element.setAttribute("data-active-sample", active.point.index);
      } else {
        element.removeAttribute("data-active-series");
        element.removeAttribute("data-active-sample");
      }
      groups.forEach(function (group, index) {
        var opacity = active && active.series !== index ? "0.2" : "1",
          line = group.querySelector(".pt-chart-line");
        line.style.opacity = opacity;
        line.setAttribute(
          "stroke-width",
          active && active.series === index ? "3.8" : "2.4",
        );
        group.querySelector(".pt-chart-dots").style.opacity = opacity;
      });
      legends.forEach(function (button) {
        var selected =
          active &&
          Number(button.getAttribute("data-chart-series")) === active.series;
        button.style.opacity = active && !selected ? "0.2" : "1";
        button.setAttribute("aria-pressed", String(!!selected));
      });
      var text = active
        ? sampleLabel(model, active.series, active.point.sample)
        : model.count
          ? HELP
          : EMPTY;
      if (detail.textContent !== text) detail.textContent = text;
      if (ring) {
        ring.setAttribute("visibility", active ? "visible" : "hidden");
        if (active) {
          ring.setAttribute("cx", active.point.x);
          ring.setAttribute("cy", active.point.y);
          ring.setAttribute("stroke", model.series[active.series].color);
        }
      }
    }
    function finishReveal() {
      if (frame !== null) win.cancelAnimationFrame(frame);
      frame = null;
      revealProgress = 1;
      if (reveal) reveal.setAttribute("width", PLOT.width);
      element.setAttribute("data-reveal-state", "complete");
    }
    function draw() {
      geometries = model.series.map(function (s) {
        return geometry(s, x, y);
      });
      groups.forEach(function (group, index) {
        var g = geometries[index];
        group.querySelector(".pt-chart-line").setAttribute("d", g.path);
        Array.from(group.querySelectorAll(".pt-chart-dot")).forEach(
          function (dot, pointIndex) {
            var p = g.points[pointIndex];
            dot.setAttribute("cx", p.x);
            dot.setAttribute("cy", p.y);
          },
        );
      });
      element.querySelector(".pt-chart-axes").innerHTML = axes(x, y);
      var zoom = (model.x[1] - model.x[0]) / (x[1] - x[0]);
      element.querySelector(".pt-chart-zoom").textContent =
        zoom.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "×";
      element.setAttribute("data-zoom", zoom);
      svg.setAttribute("data-x-min", x[0]);
      svg.setAttribute("data-x-max", x[1]);
      svg.setAttribute("data-y-min", y[0]);
      svg.setAttribute("data-y-max", y[1]);
      if (active)
        highlight({
          series: active.series,
          point: geometries[active.series].points.find(function (p) {
            return p.index === active.point.index;
          }),
        });
    }
    function zoom(factor, pointer) {
      if (!svg || destroyed) return false;
      var point = pointer || {
        x: PLOT.x + PLOT.width / 2,
        y: PLOT.y + PLOT.height / 2,
      };
      var anchorX = x[0] + ((point.x - PLOT.x) / PLOT.width) * (x[1] - x[0]);
      var anchorY = y[1] - ((point.y - PLOT.y) / PLOT.height) * (y[1] - y[0]);
      var nx = zoomDomain(x, model.x, anchorX, factor),
        ny = zoomDomain(y, model.y, anchorY, factor);
      if (nx[0] === x[0] && nx[1] === x[1] && ny[0] === y[0] && ny[1] === y[1])
        return false;
      finishReveal();
      x = nx;
      y = ny;
      highlight(null);
      draw();
      return true;
    }
    function reset() {
      if (!svg || destroyed) return;
      finishReveal();
      x = model.x.slice();
      y = model.y.slice();
      highlight(null);
      draw();
    }
    function chooseSeries(index, time) {
      var points = geometries[index] && geometries[index].points;
      if (!points || !points.length) return;
      var visible = points.filter(function (p) {
        return p.sample.time >= x[0] && p.sample.time <= x[1];
      });
      var point = (visible.length ? visible : points)[0];
      if (finite(time))
        points.forEach(function (p) {
          if (
            Math.abs(p.sample.time - time) < Math.abs(point.sample.time - time)
          )
            point = p;
        });
      finishReveal();
      highlight({ series: index, point: point });
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      finishReveal();
      listeners.forEach(function (remove) {
        remove();
      });
      if (observer) observer.disconnect();
      mounted.delete(element);
      element.removeAttribute("data-chart-mounted");
    }
    var controller = {
      destroy: destroy,
      reset: reset,
      getState: function () {
        return {
          x: x.slice(),
          y: y.slice(),
          boundsX: model.x.slice(),
          boundsY: model.y.slice(),
          zoom: (model.x[1] - model.x[0]) / (x[1] - x[0]),
          active: active
            ? { series: active.series, sample: active.point.index }
            : null,
          destroyed: destroyed,
        };
      },
    };
    mounted.set(element, controller);
    element.setAttribute("data-chart-mounted", "true");
    if (!svg) return controller;
    draw();
    listen(
      svg,
      "wheel",
      function (event) {
        var point = toSvgPoint(svg, event.clientX, event.clientY);
        if (!inPlot(point) || !finite(event.deltaY) || !event.deltaY) return;
        var delta =
          event.deltaY *
          (event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? PLOT.height
              : 1);
        if (zoom(Math.exp(-clamp(delta, -600, 600) * 0.002), point))
          event.preventDefault();
      },
      { passive: false },
    );
    listen(svg, "pointermove", function (event) {
      var point = toSvgPoint(svg, event.clientX, event.clientY);
      highlight(
        inPlot(point)
          ? nearest(
              geometries,
              point,
              10 / point.scale,
              PLOT.x + PLOT.width * revealProgress,
            )
          : null,
      );
    });
    listen(svg, "pointerleave", function () {
      highlight(null);
    });
    listen(element, "focusin", function (event) {
      var button = event.target.closest("[data-chart-series]");
      if (button)
        chooseSeries(Number(button.getAttribute("data-chart-series")));
    });
    listen(element, "focusout", function (event) {
      if (!element.contains(event.relatedTarget)) highlight(null);
    });
    listen(element, "click", function (event) {
      var button = event.target.closest("button");
      if (!button || !element.contains(button)) return;
      var action = button.getAttribute("data-chart-action");
      if (action === "zoom-in") zoom(2);
      else if (action === "zoom-out") zoom(0.5);
      else if (action === "reset") reset();
      else if (button.hasAttribute("data-chart-series"))
        chooseSeries(Number(button.getAttribute("data-chart-series")));
    });
    listen(element, "keydown", function (event) {
      if (event.target !== svg && !event.target.closest("[data-chart-series]"))
        return;
      if (event.key === "+" || event.key === "=" || event.key === "-") {
        event.preventDefault();
        zoom(event.key === "-" ? 0.5 : 2);
        return;
      }
      if (event.key === "0" || event.key === "Escape") {
        event.preventDefault();
        reset();
        return;
      }
      if (
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
        ].indexOf(event.key) < 0
      )
        return;
      event.preventDefault();
      finishReveal();
      var available = geometries
        .map(function (g, index) {
          return g.points.length ? index : -1;
        })
        .filter(function (index) {
          return index >= 0;
        });
      var index = active ? active.series : available[0],
        points = geometries[index].points;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        var next = clamp(
          available.indexOf(index) + (event.key === "ArrowDown" ? 1 : -1),
          0,
          available.length - 1,
        );
        chooseSeries(available[next], active ? active.point.sample.time : null);
        return;
      }
      var position = active
        ? points.findIndex(function (point) {
            return point.index === active.point.index;
          })
        : 0;
      if (event.key === "Home") position = 0;
      else if (event.key === "End") position = points.length - 1;
      else if (active)
        position = clamp(
          position + (event.key === "ArrowRight" ? 1 : -1),
          0,
          points.length - 1,
        );
      highlight({ series: index, point: points[position] });
    });
    if (win.MutationObserver) {
      var connected = element.isConnected;
      observer = new win.MutationObserver(function () {
        if (element.isConnected) connected = true;
        else if (connected) destroy();
      });
      observer.observe(element.ownerDocument, {
        childList: true,
        subtree: true,
      });
    }
    if (media && media.addEventListener)
      listen(media, "change", function (event) {
        if (event.matches) finishReveal();
      });
    if (
      (!media || !media.matches) &&
      win.requestAnimationFrame &&
      element.isConnected
    ) {
      var started = null;
      revealProgress = 0;
      reveal.setAttribute("width", "0");
      element.setAttribute("data-reveal-state", "running");
      function animate(time) {
        frame = null;
        if (destroyed || !element.isConnected) {
          destroy();
          return;
        }
        if (started === null) started = time;
        revealProgress = clamp((time - started) / 900, 0, 1);
        reveal.setAttribute("width", PLOT.width * revealProgress);
        if (revealProgress < 1) frame = win.requestAnimationFrame(animate);
        else finishReveal();
      }
      frame = win.requestAnimationFrame(animate);
    } else finishReveal();
    return controller;
  }
  function mountAll(root) {
    if (!root && typeof document !== "undefined") root = document;
    if (!root || !root.querySelectorAll) return [];
    var elements = Array.from(root.querySelectorAll(".pt-buzz-chart"));
    if (root.matches && root.matches(".pt-buzz-chart")) elements.unshift(root);
    return elements.map(mount).filter(Boolean);
  }
  return {
    render: render,
    mountAll: mountAll,
    css: CSS,
    colorForName: colorForName,
    helpers: {
      normalize: normalize,
      geometry: geometry,
      zoomDomain: zoomDomain,
      toSvgPoint: toSvgPoint,
      plot: PLOT,
    },
  };
});
