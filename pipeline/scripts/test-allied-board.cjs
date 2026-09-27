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
  const fakeFs = {
    readFileSync(p, encoding) {
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
    mkdirSync() {},
    writeFileSync(p, value) {
      writes.push(p);
      output = value;
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
    writes,
    ["웹/board/index.html"],
    "builder never writes source datasets",
  );
  return { output, data: context.result, sourceBuzz: context.sourceBuzz };
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
  console.log(
    "allied board: URL identity, source preservation, membership, UI and generated JS passed",
  );
}

module.exports = { buildBoard };
