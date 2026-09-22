import test from "node:test";
import assert from "node:assert/strict";
import { contentDOM } from "./helpers/dom.mjs";
import { autoPlan, getProfileContext } from "../server/server.mjs";

test("full code flow previews missing education, fills after one confirmation, and reads back every value", async (t) => {
  const env = contentDOM(`<form><h2>教育经历</h2><div id="rows"></div><button id="add" type="button">添加</button><button type="submit">保存</button></form>`);
  t.after(() => env.dom.window.close());
  let count = 0;
  const add = () => {
    const row = env.document.createElement("div");
    row.innerHTML = `<label>学校<input id="education[${count}].school"></label><label>专业<input id="education[${count}].major"></label>`;
    env.document.getElementById("rows").append(row); count++;
  };
  env.document.getElementById("add").onclick = add;
  add();
  const analyzed = await env.message({ type: "RECRUITMENT_ANALYZE" });
  const result = await autoPlan({ profileId: "ai_product_general", page: analyzed.page }, { askModel: async (_system, user) => {
    const request = JSON.parse(user);
    return request.fields.map((field) => ({ fieldId: field.fieldId, action: "map", path: `education.${field.profileRecordIndex}.${field.suggestedKey}`, approved: true, confidence: "high" }));
  } });
  const { profile } = await getProfileContext("ai_product_general");
  assert.equal(count, 1, "planning must not mutate the page");
  assert.equal(result.plan.length, profile.education.length * 2);
  assert.ok(result.plan.every((item) => item.verified && !item.needsConfirmation));
  const applied = await env.message({ type: "RECRUITMENT_APPLY_AGENT_PLAN", items: result.plan, additions: result.additions });
  assert.ok(applied.results.every((item) => item.ok), JSON.stringify(applied.results));
  assert.equal(count, profile.education.length);
  for (let index = 0; index < count; index++) {
    assert.equal(env.document.getElementById(`education[${index}].school`).value, profile.education[index].school);
    assert.equal(env.document.getElementById(`education[${index}].major`).value, profile.education[index].major);
  }
  const rescan = await env.message({ type: "RECRUITMENT_ANALYZE" });
  const second = await autoPlan({ profileId: "ai_product_general", page: rescan.page }, { askModel: async (_system, user) => JSON.parse(user).fields.map((field) => ({ fieldId: field.fieldId, action: "map", path: `education.${field.profileRecordIndex}.${field.suggestedKey}`, approved: true, confidence: "high" })) });
  assert.equal(second.plan.length, 0, "running again should not duplicate or rewrite correct education");
  assert.equal(second.additions.length, 0);
});
