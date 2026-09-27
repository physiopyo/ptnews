/* Periods change display only. Stored observations never expire. */
var PTBuzz = (function () {
  "use strict";
  var PERIODS = {
    "1일": 1,
    "1주일": 7,
    "1개월": 30,
    "3개월": 90,
    "6개월": 180,
    "1년": 365,
    전체: null,
  };
  var Chart =
    typeof PTBuzzChart !== "undefined"
      ? PTBuzzChart
      : require("./buzz_chart.js");
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
  function number(value) {
    return typeof value === "number" && isFinite(value);
  }
  function fmt(value) {
    return number(value) ? value.toLocaleString("ko-KR") : "미수집";
  }
  function day(value) {
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
      !isNaN(Date.parse(value + "T00:00:00Z")) &&
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
    );
  }
  function shift(value, delta) {
    return new Date(Date.parse(value + "T00:00:00Z") + delta * 86400000)
      .toISOString()
      .slice(0, 10);
  }
  function bounds(end, period, offset) {
    var n = PERIODS[period];
    var e = n ? shift(end, -(offset || 0) * n) : end;
    return { start: n ? shift(e, 1 - n) : "", end: e, days: n };
  }
  function within(date, range) {
    return (
      day(date) && (!range.start || date >= range.start) && date <= range.end
    );
  }
  function rangeLabel(range) {
    return (range.start || "최초 기록") + " ~ " + range.end;
  }
  function button(action, attr, value, label, active) {
    return (
      '<button type="button" class="chip' +
      (active ? " active" : "") +
      '" data-act="' +
      action +
      '" data-' +
      attr +
      '="' +
      esc(value) +
      '" aria-pressed="' +
      !!active +
      '">' +
      esc(label) +
      "</button>"
    );
  }
  function toolbar(html) {
    return (
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0">' +
      html +
      "</div>"
    );
  }
  function note(text) {
    return (
      '<p style="font-size:12px;line-height:1.7;color:#6c665d">' +
      esc(text) +
      "</p>"
    );
  }
  function total(row) {
    var values = ["news", "blog", "cafe"].map(function (k) {
      return row[k];
    });
    return values.every(number)
      ? values.reduce(function (a, b) {
          return a + b;
        }, 0)
      : null;
  }
  function align(datasets, range) {
    var dates = new Set();
    var maps = datasets.map(function (rows) {
      var map = new Map();
      (rows || []).forEach(function (r) {
        if (within(r.date, range)) {
          dates.add(r.date);
          map.set(r.date, r);
        }
      });
      return map;
    });
    var sorted = Array.from(dates).sort();
    return {
      dates: sorted,
      rows: maps.map(function (map) {
        return sorted.map(function (d) {
          return map.get(d) || null;
        });
      }),
    };
  }
  function chart(dates, series, unit) {
    return Chart.render(dates, series, unit);
  }
  var STYLE =
    '.pt-buzz{border:1px solid #e5e7eb;border-radius:16px;padding:20px;background:#fff;min-width:0}.pt-buzz button,.pt-buzz input,.pt-buzz select,.pt-buzz summary{font:inherit}.pt-buzz .chip{cursor:pointer}.pt-buzz-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0}.pt-buzz-picker{position:relative;min-width:220px;max-width:100%;font-size:13px}.pt-buzz-picker summary{cursor:pointer;list-style:none;border:1px solid #d4d9df;border-radius:9px;padding:10px 34px 10px 12px;background:#fff;position:relative}.pt-buzz-picker summary::-webkit-details-marker{display:none}.pt-buzz-picker summary:after{content:"⌄";position:absolute;right:12px;top:9px}.pt-buzz-picker[open] summary{border-color:#315eab;box-shadow:0 0 0 2px #315eab18}.pt-buzz-options{position:absolute;top:calc(100% + 6px);left:0;z-index:30;width:320px;max-width:calc(100vw - 64px);border:1px solid #d4d9df;border-radius:12px;background:#fff;box-shadow:0 12px 32px #1a2b4422;padding:8px}.pt-buzz-options fieldset{border:0;margin:0;padding:0}.pt-buzz-options legend{font-size:11px;color:#697586;padding:6px 8px}.pt-buzz-options label{display:flex;align-items:center;gap:9px;padding:9px 8px;cursor:pointer;border-radius:6px;line-height:1.45}.pt-buzz-options label:hover{background:#f2f5fa}.pt-buzz-options input{accent-color:#315eab;width:16px;height:16px;flex:none}.pt-buzz-all{font-weight:700;border-bottom:1px solid #edf0f3}.pt-buzz-key-list{max-height:290px;overflow:auto;overscroll-behavior:contain}.pt-buzz-dates{display:flex;align-items:center;gap:12px;flex-wrap:nowrap;margin:16px 0;padding:12px;background:#f6f8fb;border-radius:10px;font-size:12px;overflow:auto}.pt-buzz-dates label{display:flex;align-items:center;gap:8px;white-space:nowrap}.pt-buzz-dates input,.pt-buzz-detail-select{border:1px solid #d4d9df;border-radius:7px;background:white;padding:7px 9px;color:#263445}.pt-buzz-periods{display:flex;align-items:center;gap:4px;white-space:nowrap}.pt-buzz-dates .chip{font-size:12px;padding:7px 10px;flex:none}.pt-buzz-detail-label{display:flex;align-items:center;gap:8px;font-size:12px}.pt-buzz-empty{padding:28px 12px;border:1px dashed #ccd4df;border-radius:10px;color:#697586;font-size:13px}.pt-buzz :focus-visible{outline:2px solid #315eab;outline-offset:3px}@media(max-width:640px){.pt-buzz{padding:12px}.pt-buzz-picker{width:100%}.pt-buzz-dates{gap:10px}.pt-buzz-options{width:calc(100% - 18px);max-width:none}}';
  function selection(b, state) {
    var all = b.keywords || [],
      subject = (b.subjects || []).find(function (s) {
        return s.id === state.buzzSubject;
      });
    var id = subject ? subject.id : "all",
      available = subject
        ? all.filter(function (k) {
            return subject.keywords.indexOf(k) >= 0;
          })
        : all.slice();
    var stored = (state.buzzSelections || {})[id];
    return {
      id: id,
      label: subject ? subject.label : "전체 직역",
      available: available,
      keys: Array.isArray(stored)
        ? available.filter(function (k) {
            return stored.indexOf(k) >= 0;
          })
        : available.slice(),
    };
  }
  function picker(s, state) {
    var all = s.keys.length === s.available.length && s.available.length > 0;
    var text = all
      ? s.label + " 전체 · " + s.keys.length + "개"
      : s.keys.length
        ? s.keys[0] +
          (s.keys.length > 1 ? " 외 " + (s.keys.length - 1) + "개" : "")
        : "검색어 선택 · 0개";
    return (
      '<details class="pt-buzz-picker"' +
      (state.buzzPickerOpen ? " open" : "") +
      '><summary aria-label="검색어 선택">' +
      esc(text) +
      '</summary><div class="pt-buzz-options"><fieldset><legend>' +
      esc(s.label) +
      ' 검색어 · 복수 선택</legend><label class="pt-buzz-all"><input type="checkbox" data-buzz-all="1"' +
      (all ? " checked" : "") +
      ">" +
      esc(s.label === "전체 직역" ? "전체 검색어" : s.label + " 전체") +
      '</label><div class="pt-buzz-key-list">' +
      s.available
        .map(function (k) {
          return (
            '<label><input type="checkbox" data-buzz-key="' +
            esc(k) +
            '"' +
            (s.keys.indexOf(k) >= 0 ? " checked" : "") +
            ">" +
            esc(k) +
            "</label>"
          );
        })
        .join("") +
      "</div></fieldset></div></details>"
    );
  }
  function unmount(root) {
    if (root.__buzzCleanup) root.__buzzCleanup();
    root.__buzzCleanup = null;
  }
  function mount(root, b, state, refresh) {
    unmount(root);
    var charts = Chart.mountAll(root);
    var details = root.querySelector(".pt-buzz-picker");
    if (!details) return;
    var doc = root.ownerDocument,
      s = selection(b, state),
      all = details.querySelector("[data-buzz-all]");
    all.indeterminate = s.keys.length > 0 && s.keys.length < s.available.length;
    function close(focus) {
      details.open = false;
      state.buzzPickerOpen = false;
      if (focus) details.querySelector("summary").focus();
    }
    function outside(e) {
      if (!details.contains(e.target)) close(false);
    }
    function key(e) {
      if (e.key === "Escape" && details.open) {
        e.preventDefault();
        close(true);
      }
    }
    function changed(e) {
      var input = e.target;
      if (!input.matches("[data-buzz-key],[data-buzz-all]")) return;
      var current = selection(b, state),
        name = input.getAttribute("data-buzz-key");
      var next = input.hasAttribute("data-buzz-all")
        ? input.checked
          ? current.available.slice()
          : []
        : current.available.filter(function (k) {
            return k === name ? input.checked : current.keys.indexOf(k) >= 0;
          });
      state.buzzSelections = state.buzzSelections || {};
      state.buzzSelections[current.id] = next;
      state.buzzPickerOpen = true;
      if (next.indexOf(state.buzzKw) < 0) state.buzzKw = next[0] || "";
      refresh();
      var candidates = root.querySelectorAll(
        name === null ? "[data-buzz-all]" : "[data-buzz-key]",
      );
      var focus = Array.from(candidates).find(function (el) {
        return name === null || el.getAttribute("data-buzz-key") === name;
      });
      if (focus) focus.focus();
    }
    function toggle() {
      if (details.isConnected) state.buzzPickerOpen = details.open;
    }
    details.addEventListener("change", changed);
    details.addEventListener("toggle", toggle);
    doc.addEventListener("pointerdown", outside);
    doc.addEventListener("keydown", key);
    root.__buzzCleanup = function () {
      charts.forEach(function (chart) {
        chart.destroy();
      });
      doc.removeEventListener("pointerdown", outside);
      doc.removeEventListener("keydown", key);
      details.removeEventListener("change", changed);
      details.removeEventListener("toggle", toggle);
    };
  }
  function words(rows, range, channel) {
    var related = new Map(),
      sentiment = new Map(),
      days = new Set(),
      relatedDays = new Set(),
      docs = 0,
      observations = [],
      partialDays = 0;
    (rows || []).forEach(function (row) {
      if (!within(row.date, range)) return;
      var counts = row.documents || {};
      if (
        ["news", "blog", "cafe"].some(function (c) {
          return number(counts[c]);
        })
      )
        relatedDays.add(row.date);
      var selected = channel === "community" ? ["blog", "cafe"] : [channel];
      if (
        selected.some(function (c) {
          return number(counts[c]);
        })
      )
        days.add(row.date);
      if (
        !selected.every(function (c) {
          return number(counts[c]);
        })
      )
        partialDays += 1;
      if (row.observed_at)
        observations.push(
          typeof row.observed_at === "string"
            ? row.observed_at
            : row.observed_at.kst || row.observed_at.utc || "",
        );
      docs +=
        channel === "community"
          ? (counts.blog || 0) + (counts.cafe || 0)
          : counts[channel] || 0;
      (row.related || []).forEach(function (it) {
        if (number(it.c)) related.set(it.w, (related.get(it.w) || 0) + it.c);
      });
      ((row.sentiment || {})[channel] || []).forEach(function (it) {
        var key = JSON.stringify([it.w, it.p]);
        var old = sentiment.get(key) || { w: it.w, p: it.p, c: 0 };
        if (number(it.c)) old.c += it.c;
        sentiment.set(key, old);
      });
    });
    function sort(a, b) {
      return b.c - a.c || a.w.localeCompare(b.w, "ko");
    }
    return {
      related: Array.from(related, function (pair) {
        return { w: pair[0], c: pair[1] };
      }).sort(sort),
      sentiment: Array.from(sentiment.values()).sort(sort),
      documents: docs,
      days: days.size,
      relatedDays: relatedDays.size,
      partialDays: partialDays,
      last: observations.sort().pop() || "",
    };
  }
  function wordTable(
    current,
    previous,
    currentDocs,
    previousDocs,
    previousDays,
  ) {
    var old = new Map(
      previous.map(function (r, i) {
        return [JSON.stringify([r.w, r.p]), { c: r.c, rank: i + 1 }];
      }),
    );
    if (!current.length)
      return note(
        currentDocs
          ? "분석한 글에서 이 분류의 표현이 검출되지 않았습니다. 중립이나 찬반 없음으로 해석하지 않습니다."
          : "해당 기간의 단어 관측 자료가 없습니다.",
      );
    var rows = current
      .slice(0, 50)
      .map(function (r, i) {
        var prev = old.get(JSON.stringify([r.w, r.p]));
        var change = previousDays
          ? prev
            ? String(prev.rank - (i + 1))
            : "비교 표본에 없음"
          : "비교 자료 없음";
        var label =
          r.p == null
            ? "연관어"
            : r.p > 0
              ? "긍정 표현"
              : r.p < 0
                ? "부정 표현"
                : "사전 미등재/중립";
        var rate = currentDocs ? ((r.c / currentDocs) * 100).toFixed(1) : "—";
        var prevRate = previousDocs
          ? (((prev ? prev.c : 0) / previousDocs) * 100).toFixed(1)
          : "—";
        return (
          "<tr><td>" +
          (i + 1) +
          "</td><td>" +
          esc(r.w) +
          "</td><td>" +
          label +
          "</td><td>" +
          fmt(r.c) +
          "</td><td>" +
          rate +
          "</td><td>" +
          prevRate +
          "</td><td>" +
          esc(change) +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div style="overflow-x:auto"><table style="width:100%;font-size:12px;text-align:left;border-collapse:collapse"><thead><tr><th>순위</th><th>표현</th><th>분류</th><th>출현 횟수</th><th>글 100건당</th><th>직전 기간 100건당</th><th>순위 변화</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div>" +
      note(
        "화면에는 상위 50개만 표시합니다. 전체 단어와 수집 이력은 삭제하지 않습니다. 출현 횟수는 사람 수·찬반 비율이 아닙니다.",
      )
    );
  }
  function legacy(nv, kw, updated, currentRange, previousRange, channel) {
    var saved = (nv.sentiment || {})[kw],
      weeks = (nv.related_weeks || {})[kw] || [];
    var weeklyView = new Map();
    weeks.forEach(function (w) {
      if (
        day(w.key) &&
        w.key <= currentRange.end &&
        shift(w.key, 6) >= currentRange.start
      )
        weeklyView.set(w.key, w);
    });
    weeks = Array.from(weeklyView.values()).sort(function (a, b) {
      return a.key.localeCompare(b.key);
    });
    var history = (nv.legacy_snapshots || {})[kw] || [];
    var inRange = function (range) {
      return history
        .filter(function (s) {
          return within(String(s.recorded_at || "").slice(0, 10), range);
        })
        .sort(function (a, b) {
          return String(a.recorded_at).localeCompare(String(b.recorded_at));
        })
        .pop();
    };
    var current = inRange(currentRange),
      previous = inRange(previousRange);
    var get = function (row) {
      var data = row && row.sentiment;
      return Array.isArray(data)
        ? channel === "community"
          ? data
          : []
        : (data || {})[channel] || [];
    };
    var comparison = "";
    if (history.length) {
      comparison =
        "<h3>복구된 과거 저장 시점 비교</h3>" +
        note(
          "각 기간 마지막으로 저장된 검색 표본끼리 비교합니다. 기간 전체 합산·원문 발생일 통계가 아닙니다. 같은 날의 다른 원본과 순위 밖 자료도 보관층에서 삭제하지 않습니다.",
        ) +
        note(
          "현재 선택 기간 저장본: " +
            (current ? current.recorded_at : "없음") +
            " · 직전 기간 저장본: " +
            (previous ? previous.recorded_at : "없음"),
        );
      if (current)
        comparison +=
          "<h4>감성 표현</h4>" +
          wordTable(get(current), get(previous), 0, 0, previous ? 1 : 0) +
          "<h4>연관어</h4>" +
          wordTable(
            current.related || [],
            (previous && previous.related) || [],
            0,
            0,
            previous ? 1 : 0,
          ) +
          note(
            "기존 상위 단어만 남아 있으므로 비교표에 없는 표현을 당시 0회였다고 해석하지 않습니다.",
          );
    }
    if (!saved && !weeks.length) return comparison;
    var raw = Array.isArray(saved)
      ? saved
      : (saved || {}).community || (saved || {}).all || [];
    return (
      comparison +
      "<details><summary>기존 자료 원형 보기 · 기간별 신규 통계와 별도</summary>" +
      note(
        "기존 최신 감성 단어의 개별 발생일은 저장되지 않았습니다. 표시된 갱신 시각도 개별 글의 작성일이 아닙니다. 기준: " +
          (updated || "시점 미상"),
      ) +
      wordTable(raw, [], 0, 0, 0) +
      weeks
        .map(function (w) {
          return (
            "<h4>" +
            esc(w.label || w.key) +
            "</h4>" +
            note(
              "해당 주에 저장된 검색 표본 순위이며 일별 발생량으로 분할하지 않습니다.",
            ) +
            wordTable(w.items || [], [], 0, 0, 0)
          );
        })
        .join("") +
      "</details>"
    );
  }
  function render(b, state) {
    var subjects = b.subjects || [],
      chosen = selection(b, state),
      keys = chosen.keys;
    var kw = keys.indexOf(state.buzzKw) >= 0 ? state.buzzKw : keys[0];
    var view =
      ["cnt", "senti"].indexOf(state.buzzView) >= 0 ? state.buzzView : "all4";
    var nv = b.naver || {},
      daily = nv.channel_daily || {};
    var statuses = Object.keys(b.collection || {})
      .filter(function (key) {
        return key.indexOf("mentions:" + kw + ":") === 0;
      })
      .map(function (key) {
        return b.collection[key];
      });
    var successes = statuses
      .map(function (s) {
        return s.success_at;
      })
      .filter(number);
    var status = {
      success_at: successes.length ? Math.max.apply(null, successes) : null,
      status: statuses.some(function (s) {
        return s.status !== "ok";
      })
        ? "일부 미수집/실패"
        : "ok",
    };
    var end = day(state.buzzEnd)
      ? state.buzzEnd
      : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    var period = Object.prototype.hasOwnProperty.call(PERIODS, state.buzzPeriod)
      ? state.buzzPeriod
      : "3개월";
    var wp =
      ["1일", "1주일", "1개월", "3개월"].indexOf(state.buzzWordPeriod) >= 0
        ? state.buzzWordPeriod
        : "1주일";
    var range = bounds(end, period, 0),
      body = "";
    var controls = toolbar(
      [{ id: "all", label: "전체" }]
        .concat(subjects)
        .map(function (s) {
          return button(
            "buzzsubject",
            "subject",
            s.id,
            s.label,
            chosen.id === s.id,
          );
        })
        .join(""),
    );
    controls +=
      '<div class="pt-buzz-toolbar">' +
      picker(chosen, state) +
      '<span style="font-size:12px;color:#697586">' +
      keys.length +
      " / " +
      chosen.available.length +
      "개 선택</span></div>";
    controls += toolbar(
      [
        ["all4", "키워드별 추이"],
        ["cnt", "언급 추이"],
        ["senti", "긍·부정 연관어"],
      ]
        .map(function (v) {
          return button("buzzview", "view", v[0], v[1], view === v[0]);
        })
        .join(""),
    );
    var periods =
      view === "senti"
        ? ["1일", "1주일", "1개월", "3개월"]
        : Object.keys(PERIODS);
    controls +=
      '<div class="pt-buzz-dates"><label>조회 종료일 <input type="date" data-buzz-end="1" value="' +
      esc(end) +
      '"></label><div class="pt-buzz-periods" role="group" aria-label="조회 기간">' +
      periods
        .map(function (p) {
          return button(
            view === "senti" ? "buzzwordper" : "buzzper",
            view === "senti" ? "period" : "per",
            p,
            p,
            p === (view === "senti" ? wp : period),
          );
        })
        .join("") +
      "</div></div>";
    if (view !== "all4" && keys.length > 1)
      controls +=
        '<label class="pt-buzz-detail-label">상세 검색어 <select class="pt-buzz-detail-select" data-buzz-detail="1" aria-label="상세 검색어">' +
        keys
          .map(function (k) {
            return (
              '<option value="' +
              esc(k) +
              '"' +
              (kw === k ? " selected" : "") +
              ">" +
              esc(k) +
              "</option>"
            );
          })
          .join("") +
        "</select></label>" +
        note(
          "체크한 검색어 중 하나의 상세를 표시합니다. 여러 검색어의 비교는 ‘키워드별 추이’에서 확인합니다.",
        );
    function wrap(content) {
      return (
        "<style>" +
        STYLE +
        '</style><section class="pt-buzz" aria-label="여론 이력">' +
        controls +
        content +
        "</section>"
      );
    }
    if (!kw)
      return wrap(
        '<div class="pt-buzz-empty">' +
          (chosen.available.length
            ? "선택한 검색어가 없습니다. 드롭다운에서 검색어를 체크하거나 해당 직역의 전체를 선택하세요."
            : "등록된 검색어가 없습니다.") +
          "</div>",
      );
    var spec = (b.vocabulary || []).find(function (s) {
      return s.keyword === kw;
    });
    controls += note(
      "수집: 언급·감성·연관어 6시간, 트렌드·자동완성 24시간. 저장 데이터는 기간 경과로 삭제하지 않습니다.",
    );
    if (view !== "all4")
      controls += note(
        kw +
          " · " +
          (status.success_at
            ? "마지막 성공 " + new Date(status.success_at * 1000).toISOString()
            : "새 수집 상태 미확인 · 기존 자료는 별도 보존") +
          (status.status && status.status !== "ok"
            ? " · 최근 수집 " +
              status.status +
              " (실패값으로 이전 자료를 덮지 않음)"
            : "") +
          (spec && spec.note ? " · " + spec.note : ""),
      );
    if (view === "senti") {
      var wr = bounds(end, wp, 0),
        pr = bounds(end, wp, 1),
        channel =
          ["blog", "cafe"].indexOf(state.buzzSentCh) >= 0
            ? state.buzzSentCh
            : "community";
      controls += toolbar(
        [
          ["community", "블로그+카페"],
          ["blog", "블로그"],
          ["cafe", "카페"],
        ]
          .map(function (s) {
            return button("buzzsent", "sch", s[0], s[1], channel === s[0]);
          })
          .join(""),
      );
      var source = (nv.word_daily || {})[kw] || [],
        cur = words(source, wr, channel),
        prev = words(source, pr, channel);
      body +=
        "<h3>긍·부정 표현 · " +
        esc(rangeLabel(wr)) +
        "</h3>" +
        note(
          "직전 동일 길이 기간: " +
            rangeLabel(pr) +
            " · 최초 발견일 기준, 원문 작성일과 다를 수 있습니다.",
        );
      body += note(
        "현재 기간 관측 " +
          cur.days +
          "/" +
          wr.days +
          "일 · 새로 발견한 분석 글 " +
          cur.documents +
          "건 · 비교 기간 관측 " +
          prev.days +
          "/" +
          pr.days +
          "일. 수집 전 구간·수집 실패는 0건이나 중립이 아닙니다.",
      );
      if (cur.partialDays || prev.partialDays)
        body += note(
          "채널 일부만 관측된 날짜: 현재 " +
            cur.partialDays +
            "일, 비교 " +
            prev.partialDays +
            "일. 빈도 차이에는 수집 범위 차이가 포함될 수 있습니다.",
        );
      if (cur.last) body += note("마지막 단어 관측 시각: " + cur.last);
      if (cur.sentiment.length)
        body +=
          '<div style="height:260px;position:relative"><div id="d3cloud" data-w="' +
          esc(
            encodeURIComponent(
              JSON.stringify(
                cur.sentiment.slice(0, 50).map(function (r) {
                  return [r.w, r.c, r.p];
                }),
              ),
            ),
          ) +
          '" style="position:absolute;inset:0"></div></div>';
      body += wordTable(
        cur.sentiment,
        prev.sentiment,
        cur.documents,
        prev.documents,
        prev.days,
      );
      var rd = function (rows, r) {
        return (rows || [])
          .filter(function (x) {
            return within(x.date, r);
          })
          .reduce(function (sum, x) {
            var d = x.documents || {};
            return sum + (d.news || 0) + (d.blog || 0) + (d.cafe || 0);
          }, 0);
      };
      body +=
        "<h3>연관어 변화 · 뉴스+블로그+카페</h3>" +
        note(
          "연관어 관측일: 현재 " +
            cur.relatedDays +
            "일 · 비교 " +
            prev.relatedDays +
            "일. 감성 채널 선택과 별도로 집계합니다.",
        ) +
        wordTable(
          cur.related,
          prev.related,
          rd(source, wr),
          rd(source, pr),
          prev.relatedDays,
        );
      body += note(
        "검색 제목·요약의 감성사전 표현입니다. 정책 찬반·직역 지지율이 아닙니다. 같은 글은 키워드 안에서 한 번만 집계하지만 키워드 사이에는 중복될 수 있습니다.",
      );
      body += legacy(nv, kw, b.updated, wr, pr, channel);
    } else {
      body += "<h3>" + esc(rangeLabel(range)) + "</h3>";
      if (view === "all4") {
        var aligned = align(
          keys.map(function (k) {
            return daily[k] || [];
          }),
          range,
        );
        body += chart(
          aligned.dates,
          keys.map(function (k, i) {
            return {
              name: k,
              values: aligned.rows[i].map(function (row) {
                return row ? total(row) : null;
              }),
            };
          }),
          "건",
        );
        body += note(
          "키워드별 검색 표본이며 키워드끼리 중복됩니다. 여러 선의 값을 합해 전체 여론량으로 해석하지 않습니다. 공급자 일부만 수집된 날짜가 포함될 수 있습니다. 날짜별 범위는 개별 키워드 표에서 확인합니다.",
        );
      } else {
        var metric =
          ["nidx", "gidx"].indexOf(state.buzzMetric) >= 0
            ? state.buzzMetric
            : "cnt";
        controls += toolbar(
          [
            ["cnt", "언급 건수"],
            ["nidx", "네이버 지수"],
            ["gidx", "구글 지수"],
          ]
            .map(function (m) {
              return button("buzzmetric", "met", m[0], m[1], m[0] === metric);
            })
            .join(""),
        );
        if (metric === "cnt") {
          var rows = (daily[kw] || [])
            .filter(function (r) {
              return within(r.date, range);
            })
            .sort(function (a, c) {
              return a.date.localeCompare(c.date);
            });
          body += chart(
            rows.map(function (r) {
              return r.date;
            }),
            [
              ["news", "뉴스"],
              ["blog", "블로그"],
              ["cafe", "카페"],
            ].map(function (c) {
              return {
                name: c[1],
                values: rows.map(function (r) {
                  return number(r[c[0]]) ? r[c[0]] : null;
                }),
              };
            }),
            "건",
          );
          body +=
            '<details><summary>날짜별 수치 보기</summary><div style="max-height:360px;overflow:auto"><table><thead><tr><th>날짜</th><th>뉴스</th><th>블로그</th><th>카페</th><th>수집 범위</th></tr></thead><tbody>' +
            rows
              .map(function (r) {
                var scope = r.scope && r.scope.total && r.scope.total.status;
                return (
                  "<tr><td>" +
                  esc(r.date) +
                  "</td><td>" +
                  fmt(r.news) +
                  "</td><td>" +
                  fmt(r.blog) +
                  "</td><td>" +
                  fmt(r.cafe) +
                  "</td><td>" +
                  (scope === "complete"
                    ? "설정된 공급자"
                    : scope === "partial"
                      ? "일부 공급자만"
                      : "기존 집계/확인 불가") +
                  "</td></tr>"
                );
              })
              .join("") +
            "</tbody></table></div></details>";
          body += note(
            "뉴스·블로그는 게시일, 카페는 발견일 기준인 기존 자료를 보존합니다. 새 단어 통계는 최초 발견일 기준입니다. 검색결과 수집 한도 내 관측이며 인터넷 전체 언급량이 아닙니다. 과거 수집기의 0건에는 미수집·실패가 섞였을 수 있으며 이를 소급해서 판별하지 않습니다.",
          );
        } else {
          var trend = metric === "gidx" ? b.trend || {} : nv.datalab || {};
          var dates = [],
            values = [],
            series = (trend.series || {})[kw] || [];
          (trend.dates || []).forEach(function (d, i) {
            if (within(d, range)) {
              dates.push(d);
              values.push(number(series[i]) ? series[i] : null);
            }
          });
          body += chart(dates, [{ name: kw, values: values }], "지수");
          body += note(
            "공급자·요청 묶음·요청 기간별 상대지수입니다. 별도 요청값끼리 비교하거나 과거 0~100 지수를 연속된 절대량처럼 연결하지 않습니다. 이전 요청 원본도 영구 보존합니다. 다른 공급자의 값으로 빈 지수를 대체하지 않습니다.",
          );
        }
      }
    }
    if (view !== "all4") {
      var suggestions = (b.related_naver || {})[kw] || [];
      var google = (b.related_google || {})[kw] || {};
      var acState = (b.collection || {})["autocomplete:" + kw] || {};
      body +=
        "<details><summary>검색 제안 참고 · 최신 성공 수집본</summary>" +
        note(
          "자동완성·검색 연관어는 감성 분석이나 정책 찬반이 아닙니다. 위 기간별 게시글 통계와 섞어 합산하지 않습니다.",
        );
      body +=
        "<h4>네이버 자동완성</h4>" +
        note(
          acState.success_at
            ? new Date(acState.success_at * 1000).toISOString()
            : "이 키워드의 수집 시각 미상",
        ) +
        (suggestions.length
          ? "<p>" + suggestions.map(esc).join(" · ") + "</p>"
          : note("수집 자료 없음"));
      ["top", "rising"].forEach(function (kind) {
        var entries = google[kind] || [];
        body +=
          "<h4>구글 " +
          (kind === "top" ? "상위 검색어" : "급상승 검색어") +
          "</h4>" +
          (entries.length
            ? "<ul>" +
              entries
                .map(function (item) {
                  return "<li>" + esc(item.q) + " (" + esc(item.v) + ")</li>";
                })
                .join("") +
              "</ul>"
            : note("수집 자료 없음"));
      });
      body +=
        note(
          "구글 항목별 수집 시각은 개별 보관본에 기록합니다. 다른 키워드 갱신 시각을 이 목록의 수집 시각으로 대입하지 않습니다.",
        ) + "</details>";
    }
    return wrap(body);
  }
  return {
    render: render,
    mount: mount,
    unmount: unmount,
    selection: selection,
    bounds: bounds,
    align: align,
    words: words,
    chart: chart,
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = PTBuzz;
