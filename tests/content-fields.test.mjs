import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../extension/content/content.js", import.meta.url), "utf8");
const context = {
  window: {},
  location: { hostname: "campus.jd.com", href: "https://campus.jd.com/web/resume" },
  chrome: { runtime: { onMessage: { addListener() {} } } },
  document: { querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; } },
  Node: { TEXT_NODE: 3, DOCUMENT_POSITION_FOLLOWING: 4 },
  CSS: { escape(value) { return String(value); } },
  console,
  setTimeout,
  clearTimeout
};
vm.createContext(context);
vm.runInContext(source, context);
const { semanticKey, assignRecordIndexes } = context.window.__recruitmentCopilotTest;

function fakeElement(overrides = {}) {
  return {
    id: "",
    name: "",
    type: "text",
    value: "",
    placeholder: "",
    className: "",
    closest() { return null; },
    ...overrides
  };
}

test("generic id=name does not override a visible school label", () => {
  assert.equal(semanticKey(fakeElement({ id: "name" }), "学校名称", {}), "school");
  assert.equal(semanticKey(fakeElement({ id: "name" }), "姓名", {}), "name");
});

test("AIGC open questions receive dedicated semantic keys", () => {
  assert.equal(semanticKey(fakeElement(), "个人优势", {}), "coreStrengths");
  assert.equal(semanticKey(fakeElement(), "请介绍一下自己", {}), "selfIntroduction");
  assert.equal(semanticKey(fakeElement(), "为什么选择AIGC产品经理", {}), "whyAigcProductManager");
});

test("one-field JD form groups fall back to per-key occurrence indexes", () => {
  const cards = Array.from({ length: 9 }, () => ({}));
  const drafts = [
    ["start", 0], ["school", 1], ["degree", 2],
    ["start", 3], ["school", 4], ["degree", 5],
    ["start", 6], ["school", 7], ["degree", 8]
  ].map(([key, cardIndex], order) => ({ section: "education", key, recordIndex: null, _recordCard: cards[cardIndex], _order: order }));
  assignRecordIndexes(drafts);
  assert.deepEqual(drafts.map(({ key, recordIndex }) => `${key}:${recordIndex}`), [
    "start:0", "school:0", "degree:0",
    "start:1", "school:1", "degree:1",
    "start:2", "school:2", "degree:2"
  ]);
});

test("real multi-field record cards keep all child fields on the same row", () => {
  const first = {};
  const second = {};
  const drafts = [
    { section: "education", key: "school", recordIndex: null, _recordCard: first, _order: 0 },
    { section: "education", key: "degree", recordIndex: null, _recordCard: first, _order: 1 },
    { section: "education", key: "school", recordIndex: null, _recordCard: second, _order: 2 },
    { section: "education", key: "degree", recordIndex: null, _recordCard: second, _order: 3 }
  ];
  assignRecordIndexes(drafts);
  assert.deepEqual(drafts.map((draft) => draft.recordIndex), [0, 0, 1, 1]);
});
