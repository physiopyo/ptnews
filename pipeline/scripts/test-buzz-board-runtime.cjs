const assert = require("node:assert/strict");
const { JSDOM, VirtualConsole } = require("jsdom");
const { buildBoard } = require("./test-allied-board.cjs");

const END = "2026-09-27";
const OLD = "2025-07-01";
const keys = ["도수치료", "관리급여", "실손보험", "체외충격파", "물리치료사"];
const daily = (date, news, blog = 0, cafe = 0) => ({ date, news, blog, cafe });
const word = (date, count) => ({
  date,
  observed_at: { utc: date + "T03:00:00Z", kst: date + "T12:00:00+09:00" },
  documents: { news: 1, blog: 4, cafe: 1 },
  related: [{ w: "지원", c: count }],
  sentiment: {
    community: [
      { w: "개선", c: count, p: 1 },
      { w: "우려", c: 1, p: -1 },
    ],
    blog: [{ w: "개선", c: count, p: 1 }],
    cafe: [{ w: "우려", c: 1, p: -1 }],
  },
});
const buzz = {
  keywords: keys,
  updated: "2026-09-27 12:00 KST",
  trend: { dates: [END], series: { 도수치료: [73] } },
  naver: {
    channel_daily: {
      도수치료: [
        daily(OLD, 91),
        daily("2026-09-25", 1, 2, 3),
        daily("2026-09-26", null, 4, 5),
        daily(END, 3, 4, 5),
      ],
      관리급여: [daily("2026-09-26", 10), daily(END, 20)],
    },
    sentiment: { 도수치료: [{ w: "기존감성", c: 9, p: 1 }] },
  },
};
let pagesPassed = 0;
let checkboxActivations = 0;
let detailChanges = 0;

function runPage(input, check, recovered = {}) {
  const built = buildBoard({
    "buzz.json": input,
    "buzz_recovered.json": recovered,
  });
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM(built.output, {
    url: "https://example.test/board/#opin",
    runScripts: "outside-only",
    virtualConsole,
  });
  const { window } = dom;
  const document = window.document;
  try {
    for (const script of document.querySelectorAll("script:not([src])"))
      window.eval(script.textContent);
    const center = () => document.getElementById("center");
    const text = () => center().textContent;
    const click = (selector) => {
      const element = document.querySelector(selector);
      assert.ok(element, "missing control: " + selector);
      if (element.matches("[data-buzz-key], [data-buzz-all]"))
        checkboxActivations += 1;
      element.click();
      assert.equal(errors.length, 0, errors.map((e) => e.message).join("\n"));
    };
    const changeEnd = (value) => {
      const input = document.querySelector("[data-buzz-end]");
      input.value = value;
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
      assert.equal(document.querySelector("[data-buzz-end]").value, value);
    };
    const changeDetail = (keyword) => {
      const select = center().querySelector("select[data-buzz-detail]");
      assert.ok(select, "missing focused-keyword select");
      assert.ok(
        [...select.options].some((option) => option.value === keyword),
        "detail keyword must be selected: " + keyword,
      );
      select.focus();
      select.value = keyword;
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
      assert.equal(center().querySelector("[data-buzz-detail]").value, keyword);
      assert.equal(errors.length, 0, errors.map((e) => e.message).join("\n"));
      detailChanges += 1;
    };
    const countRows = () => {
      const detail = [...center().querySelectorAll("details")].find(
        (element) =>
          element.querySelector(":scope > summary")?.textContent ===
          "날짜별 수치 보기",
      );
      assert.ok(detail, "missing source-specific count table");
      return [...detail.querySelectorAll("tbody tr")];
    };
    const nav = (section) => {
      click('#topnav [data-nav="' + section + '"]');
      window.dispatchEvent(new window.Event("hashchange"));
      assert.equal(window.location.hash, "#" + section);
    };
    check({
      window,
      document,
      center,
      text,
      click,
      changeEnd,
      changeDetail,
      countRows,
      nav,
      built,
    });
    assert.equal(errors.length, 0, errors.map((e) => e.message).join("\n"));
    pagesPassed += 1;
  } finally {
    window.close();
  }
}

runPage(
  buzz,
  ({
    document,
    center,
    text,
    click,
    changeEnd,
    changeDetail,
    countRows,
    nav,
  }) => {
    changeEnd(END);
    for (const [subject, keyword] of [
      ["psych", "심리상담"],
      ["pharm", "약사"],
    ]) {
      click('[data-act="buzzsubject"][data-subject="' + subject + '"]');
      assert.equal(
        document.querySelector('[data-act="buzzsubject"].active').dataset
          .subject,
        subject,
      );
      assert.ok(document.querySelector('[data-buzz-key="' + keyword + '"]'));
      assert.equal(document.querySelector('[data-buzz-key="도수치료"]'), null);
      assert.match(text(), /미수집을 0건으로 표시하지 않습니다/);
      assert.equal(center().querySelector('svg[role="img"]'), null);
      click('[data-act="buzzview"][data-view="cnt"]');
      changeDetail(keyword);
      assert.match(text(), /새 수집 상태 미확인/);
      assert.equal(center().querySelectorAll("tbody tr").length, 0);
      click('[data-act="buzzview"][data-view="all4"]');
    }
    click('[data-act="buzzsubject"][data-subject="all"]');
    for (const keyword of ["도수치료", "심리상담", "약사"])
      assert.ok(document.querySelector('[data-buzz-key="' + keyword + '"]'));
    click('[data-act="buzzview"][data-view="cnt"]');
    changeDetail("도수치료");
    const periods = [
      ["1일", 1],
      ["1주일", 7],
      ["1개월", 30],
      ["3개월", 90],
      ["6개월", 180],
      ["1년", 365],
      ["전체", null],
    ];
    for (const [period, days] of periods) {
      click('[data-act="buzzper"][data-per="' + period + '"]');
      const start = days
        ? new Date(Date.parse(END + "T00:00:00Z") - (days - 1) * 86400000)
            .toISOString()
            .slice(0, 10)
        : "";
      assert.equal(
        center().querySelector("h3").textContent,
        (start || "최초 기록") + " ~ " + END,
      );
      const visibleDates = countRows().map((row) => row.cells[0].textContent);
      assert.deepEqual(
        visibleDates,
        buzz.naver.channel_daily.도수치료
          .filter((row) => (!start || row.date >= start) && row.date <= END)
          .map((row) => row.date),
      );
      assert.equal(visibleDates.includes(OLD), period === "전체");
    }
    click('[data-act="buzzmetric"][data-met="nidx"]');
    assert.equal(
      document.querySelector('[data-act="buzzmetric"].active').dataset.met,
      "nidx",
    );
    assert.equal(center().querySelector('svg[role="img"]'), null);
    assert.match(text(), /다른 공급자의 값으로 빈 지수를 대체하지 않습니다/);
    click('[data-act="buzzmetric"][data-met="gidx"]');
    assert.ok(
      [...center().querySelectorAll("svg circle title")].some(
        (title) => title.textContent === END + " · 도수치료 73지수",
      ),
    );
    click('[data-act="buzzmetric"][data-met="cnt"]');
    click('[data-act="buzzper"][data-per="1주일"]');
    assert.ok(
      countRows().some((row) =>
        [...row.cells].some((cell) => cell.textContent === "미수집"),
      ),
    );
    const newsPath = center().querySelector(
      '.pt-chart-line[data-series-index="0"]',
    );
    assert.ok(newsPath, "missing news series path");
    assert.equal(
      (newsPath.getAttribute("d").match(/M/g) || []).length,
      2,
      "null count breaks the path",
    );
    assert.equal((newsPath.getAttribute("d").match(/L/g) || []).length, 0);
    click('[data-act="buzzview"][data-view="all4"]');
    const points = [...center().querySelectorAll("svg circle title")];
    const xOf = (title) => {
      const point = points.find((point) => point.textContent === title);
      assert.ok(point, "missing actual sample: " + title);
      return point.parentElement.getAttribute("cx");
    };
    assert.equal(
      xOf(END + " · 도수치료 12건"),
      xOf(END + " · 관리급여 20건"),
      "keywords share the same calendar x axis",
    );
    assert.equal(
      points.some((point) =>
        point.textContent.includes("2026-09-26 · 도수치료"),
      ),
      false,
      "partial total is not zero",
    );
    nav("notice");
    assert.ok(center().querySelector("[data-nopen]"));
    click("#center [data-nopen]");
    assert.doesNotMatch(text(), /undefined|subjectTabs/);
    nav("news");
    click('[data-chan="psych"]');
    assert.ok(center().querySelector('[data-chan="psych"].active'));
    nav("labor");
    click('[data-labor-view="list"]');
    const region = center().querySelector("[data-labor-region]");
    region.dispatchEvent(
      new document.defaultView.Event("change", { bubbles: true }),
    );
    assert.ok(center().querySelector("[data-labor-directory]"));
    nav("opin");
    assert.ok(center().querySelector('[aria-label="여론 이력"]'));
  },
);

const collected = JSON.parse(JSON.stringify(buzz));
collected.collection = {
  "mentions:도수치료:blog": { status: "ok", success_at: 1790478000 },
  "mentions:도수치료:cafe": { status: "error" },
};
collected.naver.word_daily = {
  도수치료: [word("2026-09-20", 1), word("2026-09-26", 2), word(END, 4)],
};
const recovered = {
  note: "복구 표본은 합산하지 않음",
  naver: {
    channel_daily: {
      도수치료: [
        daily(END, 999),
        daily("2024-01-01", 2),
        daily("2030-01-01", 8),
      ],
    },
    hourly: {
      도수치료: [
        { t: "2026-09-27 12:00", news: 999 },
        { t: "2030-01-01 12:00", news: 8 },
      ],
    },
    related_weeks: {
      도수치료: [{ key: "2026-39", items: [{ w: "복구", c: 99 }] }],
    },
    legacy_snapshots: {
      도수치료: [
        {
          recorded_at: "2026-09-20T12:00:00+09:00",
          sentiment: [{ w: "회복", c: 1, p: 1 }],
          related: [{ w: "과거", c: 1 }],
        },
        {
          recorded_at: "2026-09-27T12:00:00+09:00",
          sentiment: [{ w: "회복", c: 2, p: 1 }],
          related: [{ w: "과거", c: 2 }],
        },
      ],
    },
  },
};
collected.naver.hourly = { 도수치료: [{ t: "2026-09-27 12:00", news: null }] };
collected.naver.related_weeks = {
  도수치료: [{ key: "2026-39", items: [{ w: "현재", c: 3 }] }],
};
runPage(
  collected,
  ({ document, center, text, click, changeEnd, changeDetail, built }) => {
    const nv = built.data.buzz.naver;
    assert.equal(
      nv.channel_daily.도수치료.find((row) => row.date === END).news,
      3,
    );
    assert.ok(
      nv.channel_daily.도수치료.some((row) => row.date === "2030-01-01"),
    );
    assert.equal(
      nv.hourly.도수치료.find((row) => row.t === "2026-09-27 12:00").news,
      null,
    );
    assert.ok(nv.hourly.도수치료.some((row) => row.t === "2030-01-01 12:00"));
    assert.equal(nv.related_weeks.도수치료.length, 1);
    assert.equal(nv.related_weeks.도수치료[0].items[0].w, "현재");
    assert.equal(
      JSON.stringify(nv.legacy_snapshots),
      JSON.stringify(recovered.naver.legacy_snapshots),
    );
    assert.match(built.data.buzz.note, /복구 표본은 합산하지 않음/);
    assert.equal(
      JSON.stringify(built.sourceBuzz),
      JSON.stringify(collected),
      "in-memory merge leaves source object unchanged",
    );
    changeEnd(END);
    click('[data-act="buzzview"][data-view="senti"]');
    changeDetail("도수치료");
    assert.match(text(), /일부 미수집\/실패/);
    assert.match(text(), /복구된 과거 저장 시점 비교/);
    assert.match(text(), /직전 기간 저장본: 2026-09-20/);
    assert.match(text(), /2026-09-27T12:00:00\+09:00/);
    assert.doesNotMatch(text(), /\[object Object\]/);
    for (const [period, days] of [
      ["1일", 1],
      ["1주일", 7],
      ["1개월", 30],
      ["3개월", 90],
    ]) {
      click('[data-act="buzzwordper"][data-period="' + period + '"]');
      const shift = (delta) =>
        new Date(Date.parse(END + "T00:00:00Z") + delta * 86400000)
          .toISOString()
          .slice(0, 10);
      assert.equal(
        document.querySelector('[data-act="buzzwordper"].active').dataset
          .period,
        period,
      );
      assert.ok(
        text().includes("긍·부정 표현 · " + shift(1 - days) + " ~ " + END),
      );
      assert.ok(
        text().includes(
          "직전 동일 길이 기간: " + shift(1 - 2 * days) + " ~ " + shift(-days),
        ),
      );
    }
    click('[data-act="buzzwordper"][data-period="1일"]');
    const cells = [...center().querySelector("table tbody tr").cells].map(
      (cell) => cell.textContent,
    );
    assert.deepEqual(cells.slice(1, 6), [
      "개선",
      "긍정 표현",
      "4",
      "80.0",
      "40.0",
    ]);
    assert.match(text(), /기존 자료 원형 보기/);
    click('[data-act="buzzsent"][data-sch="cafe"]');
    assert.equal(
      center().querySelector("table tbody tr").cells[1].textContent,
      "우려",
    );
    changeEnd("2026-09-26");
    assert.ok(text().includes("긍·부정 표현 · 2026-09-26 ~ 2026-09-26"));
  },
  recovered,
);

runPage({}, ({ text, click, changeEnd, changeDetail, center }) => {
  changeEnd(END);
  assert.match(text(), /미수집을 0건으로 표시하지 않습니다/);
  click('[data-act="buzzview"][data-view="senti"]');
  changeDetail("심리상담");
  assert.match(text(), /해당 기간의 단어 관측 자료가 없습니다/);
  assert.equal(center().querySelectorAll("tbody tr").length, 0);
});
const subjectCases = [
  {
    id: "pt",
    label: "물리치료 전체",
    keywords: ["도수치료", "관리급여", "실손보험"],
  },
  {
    id: "psych",
    label: "심리상담 전체",
    keywords: ["심리상담", "임상심리사", "정신건강전문요원"],
  },
  {
    id: "pharm",
    label: "약사 전체",
    keywords: ["약사", "약사회", "대한약사회"],
  },
];
const selectionBuzz = { naver: { channel_daily: {}, word_daily: {} } };
for (const [subjectIndex, subject] of subjectCases.entries()) {
  for (const [keywordIndex, keyword] of subject.keywords.entries()) {
    const count = (subjectIndex + 1) * 10 + keywordIndex + 1;
    selectionBuzz.naver.channel_daily[keyword] = [daily(END, count)];
    selectionBuzz.naver.word_daily[keyword] = [word(END, count)];
  }
}
runPage(
  selectionBuzz,
  ({
    window,
    document,
    center,
    text,
    click,
    changeEnd,
    changeDetail,
    countRows,
    built,
    nav,
  }) => {
    changeEnd(END);
    const picker = () => center().querySelector("details.pt-buzz-picker");
    const all = () => picker().querySelector("input[data-buzz-all]");
    const selected = () =>
      [...picker().querySelectorAll("input[data-buzz-key]:checked")].map(
        (input) => input.dataset.buzzKey,
      );
    const openPicker = () => {
      if (!picker().open) click(".pt-buzz-picker > summary");
      assert.equal(picker().open, true, "native summary opens the picker");
    };
    const toggle = (selector) => {
      openPicker();
      document.querySelector(selector).focus();
      click(selector);
      assert.equal(
        picker().open,
        true,
        "checkbox rerender keeps the dropdown open",
      );
      assert.equal(
        document.activeElement,
        document.querySelector(selector),
        "focus follows the replaced checkbox",
      );
    };
    const toggleKey = (keyword) => toggle('[data-buzz-key="' + keyword + '"]');
    const pointTitles = () =>
      [...center().querySelectorAll("svg circle title")]
        .map((title) => title.textContent)
        .sort();
    const expectSamples = (keywords) => {
      const expected = keywords
        .flatMap((keyword) =>
          (selectionBuzz.naver.channel_daily[keyword] || []).map(
            (row) => row.date + " · " + keyword + " " + row.news + "건",
          ),
        )
        .sort();
      assert.deepEqual(
        pointTitles(),
        expected,
        "comparison includes exactly the selected observed keyword samples",
      );
    };
    const expectEmpty = () => {
      assert.deepEqual(selected(), []);
      assert.equal(all().checked, false);
      assert.equal(all().indeterminate, false);
      assert.match(text(), /선택한 검색어가 없습니다/);
      assert.equal(
        center().querySelector('svg[role="img"]'),
        null,
        "empty selection does not invent a chart",
      );
      assert.equal(
        center().querySelectorAll("tbody tr").length,
        0,
        "empty selection does not invent observations",
      );
      assert.equal(center().querySelector("[data-buzz-detail]"), null);
    };
    const cases = subjectCases.concat({
      id: "all",
      label: "전체 검색어",
      keywords: ["도수치료", "심리상담", "약사"],
    });
    const remembered = new Map();
    for (const subject of cases) {
      click('[data-act="buzzsubject"][data-subject="' + subject.id + '"]');
      const available =
        subject.id === "all"
          ? Array.from(built.data.buzz.keywords)
          : Array.from(
              built.data.buzz.subjects.find((item) => item.id === subject.id)
                .keywords,
            );
      assert.equal(all().type, "checkbox");
      assert.equal(all().closest("label").textContent.trim(), subject.label);
      assert.equal(
        picker().querySelector("summary").getAttribute("aria-label"),
        "검색어 선택",
      );
      for (const input of picker().querySelectorAll("[data-buzz-key]")) {
        assert.equal(input.type, "checkbox");
        assert.equal(
          input.closest("label").textContent.trim(),
          input.dataset.buzzKey,
        );
      }
      expectSamples(available);
      toggleKey(subject.keywords[0]);
      const mixed = available.filter(
        (keyword) => keyword !== subject.keywords[0],
      );
      assert.deepEqual(selected(), mixed);
      assert.equal(all().checked, false);
      assert.equal(all().indeterminate, true);
      expectSamples(mixed);
      toggle("[data-buzz-all]");
      assert.deepEqual(
        selected(),
        available,
        "mixed master checkbox selects the entire subject",
      );
      assert.equal(all().checked, true);
      assert.equal(all().indeterminate, false);
      expectSamples(available);
      toggle("[data-buzz-all]");
      expectEmpty();
      toggleKey(subject.keywords[0]);
      assert.deepEqual(selected(), [subject.keywords[0]]);
      expectSamples([subject.keywords[0]]);
      toggleKey(subject.keywords[0]);
      expectEmpty();
      toggle("[data-buzz-all]");
      assert.deepEqual(
        selected(),
        available,
        "all can recover from a truly empty selection",
      );
      expectSamples(available);
      toggle("[data-buzz-all]");
      for (const keyword of subject.keywords.slice(0, 2)) toggleKey(keyword);
      remembered.set(subject.id, subject.keywords.slice(0, 2));
      assert.deepEqual(selected(), remembered.get(subject.id));
      expectSamples(remembered.get(subject.id));
    }
    for (const subject of cases) {
      click('[data-act="buzzsubject"][data-subject="' + subject.id + '"]');
      assert.deepEqual(
        selected(),
        remembered.get(subject.id),
        "each subject retains its own subset",
      );
      expectSamples(remembered.get(subject.id));
    }
    click('[data-act="buzzsubject"][data-subject="pt"]');
    toggleKey("실손보험");
    for (const view of ["all4", "cnt", "senti"]) {
      click('[data-act="buzzview"][data-view="' + view + '"]');
      const dateRow = center()
        .querySelector("[data-buzz-end]")
        .closest(".pt-buzz-dates");
      const action = view === "senti" ? "buzzwordper" : "buzzper";
      const periods = [
        ...center().querySelectorAll('[data-act="' + action + '"]'),
      ];
      assert.ok(
        dateRow,
        "date input belongs to the shared date/period row in " + view,
      );
      assert.ok(periods.length > 0);
      for (const period of periods)
        assert.equal(period.closest(".pt-buzz-dates"), dateRow);
      assert.equal(center().querySelectorAll(".pt-buzz-dates").length, 1);
      if (view === "all4") {
        assert.equal(center().querySelector("[data-buzz-detail]"), null);
        expectSamples(subjectCases[0].keywords);
        continue;
      }
      assert.deepEqual(
        [...center().querySelector("[data-buzz-detail]").options].map(
          (option) => option.value,
        ),
        subjectCases[0].keywords,
      );
      changeDetail("관리급여");
      assert.match(text(), /관리급여 · 새 수집 상태 미확인/);
      if (view === "cnt") {
        assert.deepEqual(
          countRows().map((row) =>
            [...row.cells].slice(0, 4).map((cell) => cell.textContent),
          ),
          [[END, "12", "0", "0"]],
        );
        assert.deepEqual(
          pointTitles(),
          [
            END + " · 뉴스 12건",
            END + " · 블로그 0건",
            END + " · 카페 0건",
          ].sort(),
        );
      } else {
        assert.equal(
          center().querySelector("table tbody tr").cells[3].textContent,
          "12",
        );
      }
      toggleKey("관리급여");
      const detail = center().querySelector("[data-buzz-detail]");
      assert.deepEqual(
        [...detail.options].map((option) => option.value),
        ["도수치료", "실손보험"],
      );
      assert.equal(
        detail.value,
        "도수치료",
        "unchecking the focused keyword chooses a remaining selected keyword",
      );
      assert.match(text(), /도수치료 · 새 수집 상태 미확인/);
      if (view === "cnt")
        assert.equal(countRows()[0].cells[1].textContent, "11");
      else
        assert.equal(
          center().querySelector("table tbody tr").cells[3].textContent,
          "11",
        );
      toggleKey("관리급여");
    }
    openPicker();
    document.querySelector('[data-buzz-key="도수치료"]').focus();
    const escape = new window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.activeElement.dispatchEvent(escape);
    assert.equal(escape.defaultPrevented, true);
    assert.equal(picker().open, false);
    assert.equal(
      document.activeElement,
      picker().querySelector("summary"),
      "Escape restores summary focus",
    );
    click('[data-act="buzzview"][data-view="cnt"]');
    assert.equal(picker().open, false, "Escape updates state across rerenders");
    openPicker();
    picker()
      .querySelector("summary")
      .dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
    assert.equal(
      picker().open,
      true,
      "inside pointerdown does not dismiss the dropdown",
    );
    document
      .querySelector("#topnav")
      .dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
    assert.equal(
      picker().open,
      false,
      "outside pointerdown closes the dropdown",
    );
    click('[data-act="buzzview"][data-view="all4"]');
    assert.equal(
      picker().open,
      false,
      "outside dismissal updates state across rerenders",
    );
    toggle("[data-buzz-all]");
    assert.equal(all().checked, true);
    toggle("[data-buzz-all]");
    for (const view of ["cnt", "senti", "all4"]) {
      click('[data-act="buzzview"][data-view="' + view + '"]');
      expectEmpty();
    }
    click('[data-act="buzzsubject"][data-subject="psych"]');
    assert.deepEqual(selected(), remembered.get("psych"));
    click('[data-act="buzzsubject"][data-subject="pt"]');
    expectEmpty();
    nav("news");
    nav("opin");
    expectEmpty();
    toggle("[data-buzz-all]");
    expectSamples(
      Array.from(
        built.data.buzz.subjects.find((subject) => subject.id === "pt")
          .keywords,
      ),
    );
  },
);
console.log(
  "buzz board runtime: " +
    pagesPassed +
    " generated pages, " +
    checkboxActivations +
    " native checkbox activations, " +
    detailChanges +
    " detail changes passed; subject subsets, empty/all recovery, dropdown focus/dismissal, shared date row, source-specific indices, gaps, words, legacy, notices and recovered merge",
);
