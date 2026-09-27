const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const builderDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(builderDir, "_buildboard.cjs"),
  "utf8",
);
function buildBoard(fixtures = {}) {
  let output = "";
  const writes = [];
  const extra = {};
  const wordsDir = path.join(builderDir, "_news/buzz_archive/words");
  const fakeFs = {
    readFileSync(p, encoding) {
      if (fixtures.__words && p.startsWith(wordsDir + "/"))
        return JSON.stringify(fixtures.__words[path.basename(p)]);
      if (
        ["_news/buzz_keywords.json", "buzz_view.js", "buzz_chart.js"].some(
          (file) => p === path.join(builderDir, file),
        )
      ) {
        return fs.readFileSync(p, encoding);
      }
      const name = path.basename(p);
      if (p === "_news/" + name && Object.hasOwn(fixtures, name))
        return JSON.stringify(fixtures[name]);
      throw new Error("fixture absent: " + p);
    },
    readdirSync(p) {
      if (p === wordsDir && fixtures.__words)
        return Object.keys(fixtures.__words);
      throw new Error("no directory: " + p);
    },
    mkdirSync() {},
    writeFileSync(p, value) {
      writes.push(p);
      if (p === "웹/board/index.html") output = value;
      else extra[p] = value;
    },
  };
  const context = {
    require(name) {
      assert.equal(name, "fs");
      return fakeFs;
    },
    __dirname: builderDir,
    Date,
    URL,
    process: { env: {} },
    console: { log() {} },
  };
  vm.runInNewContext(
    source + "\nglobalThis.result = DATA; globalThis.sourceBuzz = buzz;",
    context,
  );
  for (const match of output.matchAll(
    /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g,
  )) {
    if (match[1].trim()) new vm.Script(match[1]);
  }
  assert.deepEqual(
    writes.filter((p) => !p.startsWith("웹/board/buzzwords/")),
    ["웹/board/index.html"],
    "builder never writes source datasets",
  );
  return {
    output,
    data: context.result,
    sourceBuzz: context.sourceBuzz,
    extra,
  };
}

if (require.main === module) {
  const fixture = {
    "ko.json": [
      {
        title: "같은 제목",
        url: "https://a.kr/news?idxno=1",
        pin: true,
        img: "curated.jpg",
      },
    ],
    "press.json": [
      { title: "같은 제목", url: "https://b.kr/news?idxno=1" },
      { title: "다른 기사", url: "https://a.kr/news?id=2" },
      { title: "또 다른 기사", url: "https://a.kr/news?id=3" },
    ],
    "insure.json": [],
    "psych.json": [
      {
        title: "재수집",
        url: "https://a.kr/news?idxno=1&utm_source=x",
        topics: ["psych", "pharm"],
      },
    ],
    "pharm.json": [{ title: "재수집", url: "https://a.kr/news?idxno=1" }],
    "buzz_recovered.json": {},
  };
  const { output, data } = buildBoard(fixture);
  const articles = data.articles;
  assert.equal(articles.length, 4);
  const curated = articles.find((a) => a.ch === "ko");
  assert.equal(curated.pin, true);
  assert.equal(curated.img, "curated.jpg");
  assert.deepEqual(Array.from(curated.channels).sort(), [
    "ko",
    "pharm",
    "psych",
  ]);
  assert.match(output, /심리상담/);
  assert.match(output, /정책 찬반·직역 지지율이 아닙니다/);
  assert.match(output, /최초 발견일 기준/);
  assert.match(output, /button\(\s*["']buzzsubject["']/);
  assert.match(output, /PTBuzz\.render\(DATA\.buzz/);
  const attack = "</script><script>globalThis.untrustedExecuted=true</script>";
  const archived = {
    keywords: [attack],
    naver: {
      history: [{ date: "2020-01-01", raw: "retained" }],
      samples: { raw: "retained" },
    },
  };
  const safe = buildBoard({ "buzz.json": archived });
  assert.ok(
    !safe.output.includes(attack),
    "untrusted text cannot terminate the data script",
  );
  assert.ok(
    safe.data.buzz.keywords.includes(attack),
    "source value is preserved",
  );
  assert.equal(
    safe.data.buzz.naver.history,
    undefined,
    "raw archive is not duplicated into display payload",
  );
  assert.equal(
    JSON.stringify(safe.sourceBuzz),
    JSON.stringify(archived),
    "display projection never deletes archival data",
  );
  const synd = buildBoard({
    "press.json": [
      {
        title: "약 배송 반대 집회",
        url: "https://c.kr/1",
        dt: "2026-09-20T10:00:00+09:00",
      },
      {
        title: "물리치료 다른 기사",
        url: "https://c.kr/2",
        dt: "2026-09-20T09:00:00+09:00",
      },
    ],
    "pharm.json": [
      {
        title: "약 배송 반대 집회",
        url: "https://d.kr/1",
        dt: "2026-09-20T12:00:00+09:00",
      },
      {
        title: "약 배송, 반대 집회!",
        url: "https://e.kr/1",
        dt: "2026-09-20T08:00:00+09:00",
      },
    ],
  }).data.articles;
  const same = synd.filter(
    (a) => a.title.replace(/[^0-9A-Za-z가-힣]/g, "") === "약배송반대집회",
  );
  assert.equal(same.length, 1, "syndicated headline shows once");
  assert.equal(same[0].url, "https://d.kr/1", "latest outlet is kept");
  assert.deepEqual(
    Array.from(same[0].channels).sort(),
    ["pharm", "press"],
    "tabs of hidden copies are kept",
  );
  assert.equal(synd.length, 2);
  const bigRelated = {};
  for (let i = 0; i < 400; i++) bigRelated["단어" + i] = 1000 - i;
  const worded = buildBoard({
    "buzz.json": { keywords: ["심리상담"] },
    __words: {
      "2026-09-20.json": {
        심리상담: {
          first_seen: {
            documents: { blog: 3 },
            related: bigRelated,
            sentiment: { blog: { 부담: [2, -1] } },
            coverage: ["blog", "news"],
            observed_at: null,
          },
        },
      },
      "2026-09-21.json": {
        심리상담: {
          publication_date_backfill: {
            documents: { news: 2 },
            related: { 바우처: 2 },
            sentiment: {},
            coverage: ["news"],
            status: { news: "partial" },
            observed_at: null,
          },
        },
      },
    },
  });
  const url = worded.data.buzz.word_files["심리상담"];
  assert.match(url, /^buzzwords\/k\d+\.json\?v=[0-9a-f]+$/);
  const file = JSON.parse(worded.extra["웹/board/" + url.split("?")[0]]);
  assert.equal(file.rows.length, 2);
  const [seen, filled] = file.rows;
  assert.deepEqual(seen.documents, { news: 0, blog: 3, cafe: null });
  assert.equal(
    seen.related.length,
    150,
    "display rows keep each day's top words",
  );
  assert.deepEqual(seen.related[0], { w: "단어0", c: 1000 });
  assert.deepEqual(seen.sentiment.community, [{ w: "부담", c: 2, p: -1 }]);
  assert.equal(
    seen.sentiment.cafe,
    null,
    "uncovered channel is unknown, not zero",
  );
  assert.equal(filled.basis, "publication_date_backfill");
  assert.deepEqual(filled.status, { news: "partial" });
  assert.ok(
    !worded.output.includes("단어399"),
    "word rows are not embedded in the page",
  );
  console.log(
    "allied board: URL identity, source preservation, membership, UI and generated JS passed",
  );
}

module.exports = { buildBoard };
