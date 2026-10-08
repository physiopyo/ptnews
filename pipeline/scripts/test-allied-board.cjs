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
      if (fixtures.__guides && p.includes("/../guide/") && Object.hasOwn(fixtures.__guides, name))
        return JSON.stringify(fixtures.__guides[name]);
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
  const dataTag = /<script src="data\.js\?v=[0-9a-f]+"><\/script>/;
  assert.match(output, dataTag, "page loads data from a separate script");
  assert.ok(!/var DATA=/.test(output), "data is not inlined in the page");
  // Tests run the page as one document, so put the data script back in place.
  output = output.replace(dataTag, () => "<script>" + extra["웹/board/data.js"] + "</script>");
  for (const match of output.matchAll(
    /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g,
  )) {
    if (!match[1].trim()) continue;
    if (/type="application\/ld\+json"/.test(match[0])) JSON.parse(match[1]);
    else new vm.Script(match[1]);
  }
  assert.deepEqual(
    writes.filter((p) => !p.startsWith("웹/board/buzzwords/") && !p.startsWith("웹/board/guide/")),
    ["웹/board/data.js", "웹/board/index.html", "웹/board/sitemap.xml", "웹/board/llms.txt", "웹/board/404.html"],
    "builder writes only generated site files",
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
  assert.match(
    output,
    /<footer class="credit"><strong>© 2026 PTJoin \(PT뉴스\)<\/strong> · 대표 김경표 · 문의 <a href="mailto:onpta@ptjoin\.com">onpta@ptjoin\.com<\/a> · <a href="\/about\/">소개 · About<\/a> · <a href="\/privacy\/">개인정보처리방침<\/a><\/footer>/,
  );
  assert.doesNotMatch(output, /학생부대표|전국임상물리치료사연대가 운영|run by 전국임상물리치료사연대/);
  const org = JSON.parse(
    output.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1],
  );
  assert.equal(org.name, "PTJoin");
  assert.equal(org.email, "onpta@ptjoin.com");
  assert.equal(org.founder.name, "김경표");
  assert.ok(!JSON.stringify(org).includes("전국임상물리치료사연대"), "organization metadata names PTJoin only");
  assert.match(output, /<title>PTJoin · PT뉴스/);
  assert.match(output, /<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="\/">/, "board at /news/ resolves assets from the site root");
  assert.match(output, /<link rel="canonical" href="https:\/\/ptjoin\.com\/news\/">/);
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
  const stat = buildBoard({
    "press.json": [
      { title: "정적 <기사>", url: "javascript:alert(1)", dt: "2026-09-20T10:00:00+09:00", chip: "언론" },
      { title: "두번째 기사", url: "https://x.kr/2", dt: "2026-09-20T09:00:00+09:00", chip: "매체" },
    ],
    "psych.json": [{ title: "심리 전용 기사", url: "https://y.kr/1", dt: "2026-09-20T11:00:00+09:00" }],
    __guides: {
      "dosu-patient.sections.json": {
        title: "환자 <안내>",
        sections: [{ h: "개요", html: "<p>요약 문장</p>" }, { h: "1. 비용", html: "<p>본문</p>" }],
      },
    },
  });
  const staticBody = stat.output.slice(stat.output.indexOf("<body>"), stat.output.indexOf('<div id="lb">'));
  assert.match(staticBody, /<h1>PTJoin \(PT뉴스\)/, "page has a static heading");
  assert.match(staticBody, /수집 기사 3건/, "static facts count every article");
  assert.match(staticBody, /정적 &lt;기사&gt;/, "titles are escaped in static list");
  assert.ok(!staticBody.includes("javascript:"), "non-web links are not rendered");
  assert.match(staticBody, /<a href="https:\/\/x\.kr\/2" rel="nofollow noopener"/);
  assert.ok(!staticBody.includes("심리 전용 기사"), "static list shows physical-therapy channels only");
  assert.match(staticBody, /<a href="\/guide\/dosu-patient\/">환자 &lt;안내&gt;<\/a>/);
  const guidePage = stat.extra["웹/board/guide/dosu-patient/index.html"];
  assert.match(guidePage, /<title>환자 &lt;안내&gt; · PTJoin<\/title>/);
  assert.match(guidePage, /<link rel="canonical" href="https:\/\/ptjoin\.com\/guide\/dosu-patient\/">/);
  assert.match(guidePage, /<meta name="description" content="요약 문장">/);
  assert.match(guidePage, /<h2>1\. 비용<\/h2><p>본문<\/p>/);
  assert.match(guidePage, /개인정보처리방침/);
  const sitemap = stat.extra["웹/board/sitemap.xml"];
  for (const loc of ["/", "/news/", "/about/", "/privacy/", "/guide/dosu-patient/"])
    assert.ok(sitemap.includes("<loc>https://ptjoin.com" + loc + "</loc>"), "sitemap lists " + loc);
  assert.ok(!sitemap.includes("eswt-patient"), "missing guides are not listed");
  const llms = stat.extra["웹/board/llms.txt"];
  assert.match(llms, /^# PTJoin \(PT뉴스\)\n\n> /, "llms.txt opens with the site name and a summary");
  assert.match(llms, /How we use Claude/, "llms.txt states how Claude is used");
  assert.match(llms, /: 3 articles as of \d{4}-\d{2}-\d{2} \d{2}:\d{2} KST\./, "llms.txt counts every article");
  assert.match(llms, /^- \[환자 <안내>\]\(https:\/\/ptjoin\.com\/guide\/dosu-patient\/\)$/m, "llms.txt links each guide");
  assert.ok(!llms.includes("eswt-patient"), "llms.txt skips missing guides");
  assert.match(llms, /^- \[두번째 기사\]\(https:\/\/x\.kr\/2\): 매체/m, "llms.txt links publisher articles");
  assert.ok(!llms.includes("javascript:") && !llms.includes("정적 <기사>"), "llms.txt drops non-web links");
  assert.ok(!llms.includes("심리 전용 기사"), "llms.txt lists physical-therapy channels only");
  const notFound = stat.extra["웹/board/404.html"];
  assert.match(notFound, /<meta name="robots" content="noindex">/, "404 page is not indexed");
  assert.match(notFound, /<a href="\/guide\/dosu-patient\/">환자 &lt;안내&gt;<\/a>/, "404 page links guides");
  assert.ok(!/<script/i.test(notFound), "404 page needs no JavaScript");
  console.log(
    "allied board: URL identity, source preservation, membership, UI and generated JS passed",
  );
}

module.exports = { buildBoard };
