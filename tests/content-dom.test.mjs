import test from "node:test";
import assert from "node:assert/strict";
import { contentDOM, plain } from "./helpers/dom.mjs";

function setup(t, html) {
  const env = contentDOM(html);
  t.after(() => env.dom.window.close());
  return env;
}

test("scan ignores hidden templates, disabled fieldsets and non-resume controls", (t) => {
  const { api } = setup(t, `<h2>基本信息</h2><label>姓名<input id="name"></label>
    <div style="display:none"><input id="old-email" aria-label="邮箱"></div>
    <div style="visibility:hidden"><input id="hidden"></div>
    <fieldset disabled><input id="disabled"></fieldset><input type="password" id="password">
    <input type="reset"><input type="image"><input type="file"><input type="submit">`);
  assert.deepEqual(plain(api.discover().map(({ domId, label, key }) => ({ domId, label, key }))), [{ domId: "name", label: "姓名", key: "name" }]);
});

test("readonly custom selects and input-free comboboxes remain discoverable", (t) => {
  const { api } = setup(t, `<h2>教育经历</h2>
    <div class="ant-select"><input readonly aria-label="学历" aria-required="true"><span class="ant-select-selection-item">硕士</span></div>
    <div role="combobox" aria-label="学校"><span>请选择</span></div>`);
  const fields = api.discover();
  assert.equal(fields.length, 2);
  assert.equal(fields[0].readOnly, false);
  assert.equal(fields[0].value, "硕士");
  assert.equal(fields[0].required, true);
  assert.equal(fields[1].control, "custom-select");
});

test("native select exposes human-readable selected text", (t) => {
  const { api } = setup(t, `<label>学历<select><option value="3" selected>硕士</option></select></label>`);
  assert.equal(api.discover()[0].value, "硕士");
  assert.equal(api.discover()[0].label, "学历");
});

test("phone verification codes are excluded before semantic phone matching", (t) => {
  const { api } = setup(t, `<label>手机验证码<input id="phone-code"></label><input aria-label="OTP" autocomplete="one-time-code">`);
  assert.equal(api.discover().length, 0);
});

test("structured field names work without IDs and containing blocks do not override headings", (t) => {
  const { api } = setup(t, `<div><h2>教育经历</h2><label>学校<input name="education[2].school"></label><label>学习形式<input name="education[2].educationType"></label></div>`);
  const fields = api.discover();
  assert.ok(fields.every((field) => field.section === "education" && field.recordIndex === 2));
  assert.equal(fields[1].key, "educationType");
});

test("radio groups with the same name in separate forms are independent", async (t) => {
  const { api, document } = setup(t, `<h2>基本信息</h2>
    <form><label><input type="radio" name="gender" value="male" aria-label="性别">男</label><label><input type="radio" name="gender" value="female">女</label></form>
    <form><label><input type="radio" name="gender" value="male" aria-label="性别">男</label><label><input type="radio" name="gender" value="female">女</label></form>`);
  const fields = api.discover();
  assert.equal(fields.length, 2);
  const result = await api.executePlan([{ ...fields[1], fieldId: fields[1].id, value: "女" }]);
  assert.equal(result[0].ok, true);
  assert.equal(document.forms[0].querySelector(":checked"), null);
  assert.equal(document.forms[1].querySelector(":checked").value, "female");
});

test("record relocation never substitutes a different semantic field", async (t) => {
  const { api, document } = setup(t, `<h2>教育经历</h2><div data-record-index="0"><input id="education[0].school" aria-label="学校"><input id="education[0].major" aria-label="专业"></div>`);
  const school = api.discover().find((field) => field.key === "school");
  document.getElementById("education[0].school").remove();
  const results = await api.executePlan([{ ...school, fieldId: school.id, value: "深圳大学" }]);
  assert.equal(results[0].ok, false);
  assert.equal(document.querySelector("input").value, "");
});

test("user edits after preview are preserved", async (t) => {
  const { api, document } = setup(t, `<label>姓名<input id="name"></label>`);
  const field = api.discover()[0];
  document.querySelector("input").value = "用户刚刚修改";
  const results = await api.executePlan([{ ...field, fieldId: field.id, currentValue: "", value: "简历姓名" }]);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /已变化/);
  assert.equal(document.querySelector("input").value, "用户刚刚修改");
});

test("truncated framework writes are reported as failures", async (t) => {
  const { api, document } = setup(t, `<label>姓名<input id="name"></label>`);
  const input = document.querySelector("input");
  input.addEventListener("input", () => { input.value = input.value.slice(0, 1); });
  const field = api.discover()[0];
  const results = await api.executePlan([{ ...field, fieldId: field.id, value: "完整姓名" }]);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /截断/);
});

test("edited values over maxlength are refused before writing", async (t) => {
  const { api, document } = setup(t, `<input aria-label="姓名" maxlength="2">`);
  const field = api.discover()[0];
  const results = await api.executePlan([{ ...field, fieldId: field.id, value: "三个字" }]);
  assert.equal(results[0].ok, false);
  assert.equal(document.querySelector("input").value, "");
});

test("date and month writes do not emit Enter or submit", async (t) => {
  const { api, document } = setup(t, `<form><h2>教育经历</h2><input type="date" id="education[0].start"><input type="month" id="education[0].end"><button>提交</button></form>`);
  let unsafe = 0;
  document.addEventListener("keydown", () => unsafe++);
  document.addEventListener("submit", (event) => { event.preventDefault(); unsafe++; });
  const results = await api.executePlan(api.discover().map((field) => ({ ...field, fieldId: field.id, value: "2024.09" })));
  assert.ok(results.every((result) => result.ok));
  assert.deepEqual([...document.querySelectorAll("input")].map((input) => input.value), ["2024-09-01", "2024-09"]);
  assert.equal(unsafe, 0);
});

test("searchable school select waits for remote options and chooses the unique match", async (t) => {
  const { api, document } = setup(t, `<h2>教育经历</h2><div class="ant-select"><input readonly aria-label="学校"></div>`);
  const root = document.querySelector(".ant-select");
  root.onclick = () => {
    if (document.querySelector(".ant-select-dropdown")) return;
    const dropdown = document.createElement("div");
    dropdown.className = "ant-select-dropdown";
    dropdown.innerHTML = `<input aria-label="搜索学校"><div role="listbox"></div>`;
    document.body.append(dropdown);
    dropdown.querySelector("input").addEventListener("input", (event) => {
      if (event.target.value !== "深圳大学") return;
      const option = document.createElement("div");
      option.className = "ant-select-item-option"; option.setAttribute("role", "option"); option.textContent = "深圳大学";
      option.onclick = () => { const selected = document.createElement("span"); selected.className = "ant-select-selection-item"; selected.textContent = "深圳大学"; root.append(selected); dropdown.remove(); };
      dropdown.querySelector("[role=listbox]").replaceChildren(option);
    });
  };
  const field = api.discover()[0];
  const results = await api.executePlan([{ ...field, fieldId: field.id, value: "深圳大学" }]);
  assert.equal(results[0].ok, true);
  assert.equal(api.discover()[0].value, "深圳大学");
});

test("month picker commits the exact month cell exposed by the popup", async (t) => {
  const { api, document } = setup(t, `<h2>教育经历</h2><div class="ant-picker"><input readonly id="education[0].start"></div>`);
  const input = document.querySelector("input");
  input.onclick = () => {
    if (document.querySelector(".ant-picker-dropdown")) return;
    const popup = document.createElement("div"); popup.className = "ant-picker-dropdown";
    popup.innerHTML = `<input><div role="gridcell" title="2024年9月"><span class="ant-picker-cell-inner">09月</span></div>`;
    popup.querySelector("[role=gridcell]").onclick = () => { input.value = "2024-09"; popup.remove(); };
    document.body.append(popup);
  };
  const field = api.discover()[0];
  const results = await api.executePlan([{ ...field, fieldId: field.id, value: "2024-09" }]);
  assert.equal(results[0].ok, true);
  assert.equal(input.value, "2024-09");
});

for (const dateValue of ["2024-05", "2026-06-30", "2026-02-13", "2025-04-20"]) {
test(`ByteDance month picker commits and verifies resume date ${dateValue}`, async (t) => {
  const { api, document } = setup(t, `<h2>项目经历</h2><div class="throne-biz-date-range-picker-wrapper"><input id="project[0].start"></div>`);
  const input = document.querySelector("input");
  input.onclick = () => {
    if (document.querySelector(".throne-biz-date-range-picker-panel")) return;
    let year = 2026;
    const panel = document.createElement("div");
    panel.className = "throne-biz-date-range-picker-panel";
    panel.innerHTML = `<div class="ud__picker-panel-header"><span class="ud__picker-panel-header-btn">2026年</span>
      <button type="button" class="ud__picker-panel-header-icon"><svg data-icon="LeftBoldOutlined"></svg></button>
      <button type="button" class="ud__picker-panel-header-icon"><svg data-icon="RightBoldOutlined"></svg></button></div>
      <div class="months">${Array.from({ length: 12 }, (_, index) => `<div class="ud__picker__cell ud__picker-month-panel-cell"><div class="ud__picker__cell-interactive-area">${String(index + 1).padStart(2, "0")}月</div></div>`).join("")}</div>`;
    const header = panel.querySelector(".ud__picker-panel-header-btn");
    const [previous, next] = panel.querySelectorAll("button");
    previous.onclick = () => { year -= 1; header.textContent = `${year}年`; };
    next.onclick = () => { year += 1; header.textContent = `${year}年`; };
    panel.querySelectorAll(".ud__picker-month-panel-cell").forEach((cell, index) => {
      cell.onclick = () => { input.value = `${year}-${String(index + 1).padStart(2, "0")}`; panel.remove(); };
    });
    document.body.append(panel);
  };
  const field = api.discover()[0];
  const results = await api.executePlan([{ ...field, fieldId: field.id, value: dateValue }]);
  assert.equal(results[0].ok, true);
  assert.equal(input.value, dateValue.slice(0, 7));
  assert.equal(document.querySelector(".throne-biz-date-range-picker-panel"), null);
});
}

test("full resume dates keep day precision for day controls and month precision for month controls", async (t) => {
  const { api, document } = setup(t, `<h2>项目经历</h2><input type="date" id="project[0].start"><input type="month" id="project[0].end">`);
  const results = await api.executePlan(api.discover().map((field) => ({ ...field, fieldId: field.id, value: "2025-06-29" })));
  assert.ok(results.every((result) => result.ok));
  assert.deepEqual([...document.querySelectorAll("input")].map((input) => input.value), ["2025-06-29", "2025-06"]);
});

test("day controls must not report a different day in the same month as successful", async (t) => {
  const { api, document } = setup(t, `<h2>项目经历</h2><input type="date" id="project[0].start">`);
  const input = document.querySelector("input");
  input.onchange = () => { input.value = "2025-06-01"; };
  const field = api.discover()[0];
  const results = await api.executePlan([{ ...field, fieldId: field.id, value: "2025-06-29" }]);
  assert.equal(results[0].ok, false);
});

test("repeater scan refuses implicit submit buttons and navigation links", (t) => {
  const { api } = setup(t, `<form><h2>教育经历</h2><button>添加</button><button type="submit">新增</button><a href="/save">继续添加</a><button type="button" disabled>新增教育经历</button></form>`);
  assert.equal(api.discoverRepeaters().length, 0);
});

test("a nonresponsive add button is clicked only once", async (t) => {
  const { api, document } = setup(t, `<h2>教育经历</h2><button type="button">添加</button>`);
  let clicks = 0;
  document.querySelector("button").onclick = () => clicks++;
  await assert.rejects(api.ensureRecords({ education: 2 }), /停止重复点击/);
  assert.equal(clicks, 1);
});

test("safe add creates exactly the missing records without save or submit", async (t) => {
  const { api, document } = setup(t, `<form><h2>教育经历</h2><div id="records"></div><button type="button" id="add">添加</button><button id="save" type="submit">保存</button></form>`);
  let count = 0;
  let saves = 0;
  document.getElementById("save").onclick = () => saves++;
  document.getElementById("add").onclick = () => {
    const input = document.createElement("input"); input.id = `education[${count++}].school`; document.getElementById("records").append(input);
  };
  const result = await api.ensureRecords({ education: 3 });
  assert.equal(result.added.length, 3);
  assert.equal(count, 3);
  assert.equal(saves, 0);
});

test("Tencent-style add buttons bootstrap empty internship and project sections", async (t) => {
  const { api, document } = setup(t, `<form>
    <section><h2>实习经历</h2><div id="internships"></div><button type="button" id="add-internship">添加实习经历</button></section>
    <section><h2>项目经历</h2><div id="projects"></div><button type="button" id="add-project">添加项目经历</button></section>
    <button type="submit" id="submit">提交简历</button>
  </form>`);
  let submits = 0;
  document.forms[0].addEventListener("submit", (event) => { event.preventDefault(); submits++; });
  document.getElementById("add-internship").onclick = () => {
    document.getElementById("internships").innerHTML = `<div><label>公司<input name="experience[0].company"></label><label>职位<input name="experience[0].role"></label></div>`;
  };
  document.getElementById("add-project").onclick = () => {
    document.getElementById("projects").innerHTML = `<div><label>项目名称<input name="project[0].name"></label><label>项目角色<input name="project[0].role"></label></div>`;
  };

  const repeaters = api.discoverRepeaters();
  assert.deepEqual(plain(repeaters.map(({ section, currentCount }) => ({ section, currentCount }))), [
    { section: "experience", currentCount: 0 },
    { section: "project", currentCount: 0 }
  ]);
  const result = await api.ensureRecords({ experience: 1, project: 1 });
  assert.deepEqual(plain(result.added), ["experience", "project"]);
  assert.equal(result.fields.filter((field) => field.section === "experience").length, 2);
  assert.equal(result.fields.filter((field) => field.section === "project").length, 2);
  assert.equal(submits, 0);
});

test("messages from a stale page URL cannot fill the current page", async (t) => {
  const { api, message, document } = setup(t, `<input aria-label="姓名">`);
  const field = api.discover()[0];
  const result = await message({ type: "RECRUITMENT_EXECUTE_PLAN", expectedUrl: "https://careers.example.test/old", items: [{ ...field, fieldId: field.id, value: "旧页面方案" }] });
  assert.equal(result.ok, false);
  assert.equal(document.querySelector("input").value, "");
});

function repeatingForm(t, { changeLabel = false, attemptSubmit = false } = {}) {
  const env = setup(t, `<form><h2>教育经历</h2><div id="records"><div><label>学校<input id="education[0].school"></label><label>专业<input id="education[0].major"></label></div></div><button type="button" id="add">添加</button><button type="submit" id="save">保存</button></form>`);
  let count = 1; let submits = 0; let clicks = 0;
  env.document.forms[0].addEventListener("submit", (event) => { event.preventDefault(); submits++; });
  env.document.getElementById("add").onclick = () => {
    clicks++;
    if (attemptSubmit) env.document.forms[0].requestSubmit();
    const row = env.document.createElement("div");
    row.innerHTML = `<label>${changeLabel ? "意向学校" : "学校"}<input id="education[${count}].school"></label><label>专业<input id="education[${count}].major"></label>`;
    env.document.getElementById("records").append(row); count++;
  };
  const template = env.api.discover().find((field) => field.key === "school");
  const virtual = (index, value) => ({ ...template, fieldId: `virtual${index}`, domId: "", recordIndex: index, value, currentValue: "", virtual: true, addId: "add:education" });
  return { ...env, virtual, stats: () => ({ count, submits, clicks }), additions: [{ fieldId: "add:education", section: "education", fromCount: 1, desired: 3 }] };
}

test("one confirmed agent message adds, binds and fills all new records", async (t) => {
  const { message, virtual, additions, document, stats } = repeatingForm(t);
  const result = await message({ type: "RECRUITMENT_APPLY_AGENT_PLAN", items: [virtual(1, "第二所学校"), virtual(2, "第三所学校")], additions });
  assert.equal(result.ok, true);
  assert.ok(result.results.every((item) => item.ok));
  assert.equal(document.getElementById("education[1].school").value, "第二所学校");
  assert.equal(document.getElementById("education[2].school").value, "第三所学校");
  assert.equal(result.results[0].fieldId, "virtual1");
  assert.deepEqual(stats(), { count: 3, submits: 0, clicks: 2 });
});

test("a changed new-record schema is an exception and is never filled by guess", async (t) => {
  const { message, virtual, additions, document } = repeatingForm(t, { changeLabel: true });
  const result = await message({ type: "RECRUITMENT_APPLY_AGENT_PLAN", items: [virtual(1, "不应填入")], additions });
  assert.equal(result.results[0].ok, false);
  assert.match(result.results[0].error, /模板不一致/);
  assert.equal(document.getElementById("education[1].school").value, "");
});

test("agent execution never adds records without selected virtual content", async (t) => {
  const { message, additions, stats } = repeatingForm(t);
  await message({ type: "RECRUITMENT_APPLY_AGENT_PLAN", items: [], additions });
  assert.equal(stats().clicks, 0);
});

test("unapproved virtual records cannot trigger add clicks", async (t) => {
  const { message, virtual, stats } = repeatingForm(t);
  const result = await message({ type: "RECRUITMENT_APPLY_AGENT_PLAN", items: [virtual(1, "学校")], additions: [] });
  assert.equal(result.results[0].ok, false);
  assert.equal(stats().clicks, 0);
});

test("record identity changes stop all fields in the affected row", async (t) => {
  const { api, document } = setup(t, `<h2>教育经历</h2><label>学校<input id="education[0].school" value="另一所学校"></label><label>专业<input id="education[0].major"></label>`);
  const major = api.discover().find((item) => item.key === "major");
  const result = await api.executePlan([{ ...major, fieldId: major.id, value: "不应填入", recordIdentity: [{ key: "school", value: "原来的学校" }] }]);
  assert.equal(result[0].ok, false);
  assert.equal(document.getElementById("education[0].major").value, "");
});

test("native submit events caused indirectly by add handlers are cancelled", async (t) => {
  const { message, virtual, additions, stats } = repeatingForm(t, { attemptSubmit: true });
  const result = await message({ type: "RECRUITMENT_APPLY_AGENT_PLAN", items: [virtual(1, "学校")], additions });
  assert.ok(result.results.every((item) => item.ok));
  assert.equal(stats().submits, 0);
});

test("two content-script mutation messages cannot execute concurrently", async (t) => {
  const { message, virtual, additions, stats } = repeatingForm(t);
  const first = message({ type: "RECRUITMENT_APPLY_AGENT_PLAN", items: [virtual(1, "学校")], additions });
  const second = await message({ type: "RECRUITMENT_APPLY_AGENT_PLAN", items: [virtual(1, "学校")], additions });
  assert.equal(second.ok, false);
  assert.match(second.error, /进行中/);
  await first;
  assert.equal(stats().clicks, 1);
});

test("final readback catches an earlier field reset by a later control", async (t) => {
  const { api, document } = setup(t, `<label>姓名<input id="name"></label><label>邮箱<input id="email"></label>`);
  const inputs = [...document.querySelectorAll("input")];
  inputs[1].addEventListener("input", () => { inputs[0].value = ""; });
  const results = await api.executePlan(api.discover().map((field) => ({ ...field, fieldId: field.id, value: field.key === "name" ? "示例姓名" : "test@example.test" })));
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /回读/);
  assert.equal(results[1].ok, true);
});
