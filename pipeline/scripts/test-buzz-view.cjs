"use strict";
const assert = require("node:assert/strict");
const buzz = require("../buzz_view.js");
const old = { date: "2025-01-01", news: 3, blog: 4, cafe: 5 };
const range = buzz.bounds("2026-09-26", "전체", 0);
const a = buzz.align(
  [[old, { date: "2026-09-26", news: 1 }], [{ date: "2026-09-25", news: 2 }]],
  range,
);
assert.deepEqual(a.dates, ["2025-01-01", "2026-09-25", "2026-09-26"]);
assert.equal(a.rows[1][0], null);
assert.equal(a.rows[0][1], null);
assert.deepEqual(old, { date: "2025-01-01", news: 3, blog: 4, cafe: 5 });
assert.deepEqual(buzz.bounds("2026-03-01", "1주일", 1), {
  start: "2026-02-16",
  end: "2026-02-22",
  days: 7,
});
const rows = [
  {
    date: "2026-09-19",
    observed_at: "2026-09-19T10:00:00Z",
    documents: { blog: 2, cafe: 1 },
    related: [{ w: "기대", c: 3 }],
    sentiment: { community: [{ w: "기대", p: 1, c: 3 }] },
  },
  {
    date: "2026-09-25",
    observed_at: "2026-09-25T10:00:00Z",
    documents: { blog: 1, cafe: 0 },
    related: [{ w: "우려", c: 2 }],
    sentiment: { community: [{ w: "우려", p: -1, c: 2 }] },
  },
];
const frozen = JSON.stringify(rows);
const cur = buzz.words(
  rows,
  buzz.bounds("2026-09-26", "1주일", 0),
  "community",
);
const prev = buzz.words(
  rows,
  buzz.bounds("2026-09-26", "1주일", 1),
  "community",
);
assert.deepEqual(cur.sentiment, [{ w: "우려", p: -1, c: 2 }]);
assert.equal(cur.documents, 1);
assert.equal(cur.days, 1);
assert.equal(prev.documents, 3);
assert.equal(JSON.stringify(rows), frozen);
const newsOnly = [
  {
    date: "2026-09-19",
    documents: { news: 3, blog: null, cafe: null },
    related: [{ w: "보장", c: 4 }],
    sentiment: { community: null },
  },
];
for (const channel of ["community", "blog", "cafe"]) {
  const comparison = buzz.words(
    newsOnly,
    buzz.bounds("2026-09-26", "1주일", 1),
    channel,
  );
  assert.equal(comparison.days, 0);
  assert.equal(
    comparison.relatedDays,
    1,
    "news-only related comparisons are independent of sentiment coverage",
  );
}
const data = {
  keywords: ["도수치료", "심리상담"],
  subjects: [{ id: "psych", label: "심리상담", keywords: ["심리상담"] }],
  naver: { channel_daily: { 도수치료: [old] }, word_daily: { 도수치료: rows } },
  trend: { dates: ["2026-09-25"], series: { 도수치료: [77] } },
};
const chosen = {
  buzzSubject: "psych",
  buzzSelections: { psych: [], all: ["도수치료"] },
};
assert.deepEqual(
  buzz.selection(data, chosen).keys,
  [],
  "explicit empty choice must not silently select all",
);
assert.deepEqual(buzz.selection(data, { ...chosen, buzzSubject: "all" }).keys, [
  "도수치료",
]);
assert.deepEqual(
  buzz.selection(data, {
    buzzSubject: "psych",
    buzzSelections: { psych: ["심리상담", "도수치료", "obsolete"] },
  }).keys,
  ["심리상담"],
);
assert.match(
  buzz.render(data, { ...chosen, buzzView: "all4" }),
  /선택한 검색어가 없습니다/,
);
assert.deepEqual(
  chosen.buzzSelections.psych,
  [],
  "rendering does not mutate stored choices",
);
let html = buzz.render(data, {
  buzzKw: "도수치료",
  buzzView: "cnt",
  buzzMetric: "nidx",
  buzzPeriod: "전체",
  buzzEnd: "2026-09-26",
});
assert.match(html, /미수집을 0건/);
assert.doesNotMatch(html, />77</);
assert.match(html, /6개월/);
assert.match(html, /1년/);
assert.match(html, /기간 경과로 삭제하지/);
html = buzz.render(data, {
  buzzKw: "도수치료",
  buzzView: "cnt",
  buzzPeriod: "전체",
  buzzEnd: "2026-09-26",
});
assert.match(html, /2025-01-01/);
html = buzz.render(data, {
  buzzKw: "도수치료",
  buzzView: "senti",
  buzzWordPeriod: "1주일",
  buzzEnd: "2026-09-26",
});
assert.match(html, /2026-09-20 ~ 2026-09-26/);
assert.match(html, /2026-09-13 ~ 2026-09-19/);
assert.match(html, /최초 발견일 기준/);
assert.match(html, /우려/);
assert.match(html, /직전 기간 100건당/);
html = buzz.render(data, {
  buzzSubject: "psych",
  buzzView: "senti",
  buzzEnd: "2026-09-26",
});
assert.match(html, /새 수집 상태 미확인/);
assert.match(html, /해당 기간의 단어 관측 자료가 없습니다/);
assert.doesNotMatch(html, /우려/);
const svg = buzz.chart(
  ["2026-09-24", "2026-09-25", "2026-09-26"],
  [{ name: "x", values: [1, null, 3] }],
  "건",
);
assert.match(svg, / M[^L]+ M/);
assert.doesNotMatch(svg, /NaN|undefined/);
const hostile = buzz.render(
  {
    keywords: ["<script>"],
    naver: {
      word_daily: {
        "<script>": [
          {
            date: "2026-09-26",
            related: [{ w: "<img src=x>", c: 1 }],
            documents: { blog: 1 },
            sentiment: { community: [] },
          },
        ],
      },
    },
  },
  { buzzView: "senti", buzzEnd: "2026-09-26" },
);
assert.doesNotMatch(hostile, /<img src=x>|<script>/);
assert.match(hostile, /&lt;img/);
console.log(
  "buzz view: date ranges, permanent display, gaps, provider separation, words, escaping passed",
);
