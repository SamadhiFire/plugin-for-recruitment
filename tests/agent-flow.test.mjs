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

test("Didi-style empty internship and project rows produce plans for every resume record", async (t) => {
  const { profile } = await getProfileContext("ai_product_general");
  const rows = (section, count, fields) => `<div class="section-title">${section}</div>${Array.from({ length: count }, (_, index) =>
    `<div class="resume-row" data-row="${section}-${index}">${fields.map(([label, name]) =>
      `<div class="form-item"><div class="form-item-label">${label}</div><div class="form-item-control"><input name="${name}"></div></div>`).join("")}</div>`).join("")}`;
  const env = contentDOM(`<form>
    <div class="section-title">个人信息</div><div class="form-item"><div class="form-item-label">工作经验</div><div class="form-item-control"><input name="workYears"></div></div>
    ${rows("实习经历", profile.experience.length, [["公司名称", "company"], ["职位名称", "role"], ["工作职责", "description"]])}
    ${rows("项目经历", profile.projects.length, [["项目名称", "projectName"], ["项目描述", "description"]])}
    <button type="submit">保存</button>
  </form>`, "https://campus.didiglobal.com/campus_apply/didiglobal/96064#/candidateHome/resume");
  t.after(() => env.dom.window.close());
  const fields = env.api.discover();
  assert.equal(fields.find((field) => field.label === "工作经验").section, "basics");
  const result = await autoPlan({ profileId: "ai_product_general", page: { host: "campus.didiglobal.com", fields } }, {
    askModel: async () => { throw new Error("offline"); }
  });
  for (const [section, list, key] of [["experience", profile.experience, "company"], ["project", profile.projects, "projectName"]]) {
    for (let index = 0; index < list.length; index += 1) {
      const item = result.plan.find((entry) => entry.section === section && entry.recordIndex === index && entry.key === key);
      assert.ok(item, `${section} #${index + 1} missing ${key}`);
      assert.equal(item.needsConfirmation, false);
      assert.ok(item.value);
    }
  }
  assert.ok(result.plan.some((item) => item.section === "experience" && item.key === "description" && !item.needsConfirmation));
  assert.ok(result.plan.some((item) => item.section === "project" && item.key === "description" && !item.needsConfirmation));
});

test("four year/month controls map to one education record and keep each date part", async (t) => {
  const env = contentDOM(`<form><h2>教育经历</h2><div class="resume-row">
    <div class="form-item"><div class="form-item-label">学校名称</div><input id="school"></div>
    <div class="form-item"><div class="form-item-label">起止时间</div>
      <select id="startYear"><option value=""></option><option>2024年</option></select>
      <select id="startMonth"><option value=""></option><option>9月</option></select>
      <select id="endYear"><option value=""></option><option>2027年</option></select>
      <select id="endMonth"><option value=""></option><option>6月</option></select>
    </div>
  </div><button type="submit">保存</button></form>`, "https://campus.didiglobal.com/campus_apply/didiglobal/96064#/candidateHome/resume");
  t.after(() => env.dom.window.close());
  const fields = env.api.discover();
  assert.deepEqual(Array.from(fields.filter((field) => field.domId.endsWith("Year") || field.domId.endsWith("Month")), (field) => field.key),
    ["startYear", "startMonth", "endYear", "endMonth"]);
  const result = await autoPlan({ profileId: "ai_product_general", page: { host: "campus.didiglobal.com", fields } }, {
    askModel: async () => { throw new Error("offline"); }
  });
  const planned = result.plan.filter((item) => /^(start|end)(Year|Month)$/.test(item.key));
  assert.deepEqual(planned.map((item) => item.value), ["2024年", "9月", "2027年", "6月"]);
  assert.ok(planned.every((item) => !item.needsConfirmation));
  const applied = await env.message({ type: "RECRUITMENT_APPLY_AGENT_PLAN", items: planned, additions: [] });
  assert.ok(applied.results.every((item) => item.ok), JSON.stringify(applied.results));
  assert.deepEqual(planned.map((item) => env.document.getElementById(item.domId).selectedOptions[0].textContent),
    ["2024年", "9月", "2027年", "6月"]);
});
