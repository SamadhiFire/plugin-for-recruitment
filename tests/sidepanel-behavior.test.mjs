import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../extension/sidepanel/sidepanel.html", import.meta.url), "utf8");
const script = await readFile(new URL("../extension/sidepanel/sidepanel.js", import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

async function panel(t, options = {}) {
  const dom = new JSDOM(html, { url: "https://extension.test/sidepanel", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const { window } = dom;
  const calls = [];
  const messages = [];
  const events = {};
  const tab = { id: 1, url: "https://careers.example.test/apply" };
  let count = 1;
  const fields = () => Array.from({ length: count }, (_, recordIndex) => ({ id: `f${recordIndex}`, domId: `school${recordIndex}`, key: "school", label: "学校", section: "education", recordIndex, type: "text", control: "input", value: "" }));
  window.alert = () => {};
  window.chrome = {
    tabs: {
      query: async () => [tab],
      onActivated: { addListener(callback) { events.activated = callback; } },
      onUpdated: { addListener(callback) { events.updated = callback; } },
      sendMessage: async (_id, message) => {
        messages.push(message);
        if (options.message) { const override = await options.message(message); if (override) return override; }
        if (message.type === "RECRUITMENT_ENSURE_RECORDS") count = message.targets.education;
        if (message.type === "RECRUITMENT_APPLY_AGENT_PLAN") { count = 3; return { ok: true, results: message.items.map((item) => ({ fieldId: item.fieldId, ok: true })) }; }
        return { ok: true, page: { url: tab.url, host: "careers.example.test", fields: fields(), repeaters: [{ section: "education", currentCount: count }] } };
      }
    }, permissions: { contains: async () => true, request: async () => true }, scripting: { executeScript: async () => {} }
  };
  window.fetch = async (url, request = {}) => {
    const path = new URL(url).pathname;
    const body = request.body ? JSON.parse(request.body) : null;
    calls.push({ path, body });
    let result;
    if (options.request) result = await options.request(path, body);
    if (result === undefined) {
      if (path === "/api/profiles") result = { profiles: [{ id: "general", label: "通用", status: "ready" }, { id: "aigc", label: "AIGC", status: "ready" }, { id: "sales", label: "销售", status: "draft" }] };
      else if (path === "/api/profile") result = { profile: { meta: { version: 1 } }, profileMeta: { label: "方向", status: "ready" } };
      else if (path === "/api/align-form") result = { targets: { education: 3 } };
      else if (path === "/api/auto-plan") result = { agentVersion: 2, profile: { id: body.profileId }, additions: [], report: { corrected: 1 },
        plan: body.page.fields.map((field) => ({ ...field, fieldId: field.id, value: "示例学校", source: "agent-reviewed", verified: true, currentValue: "", virtual: false })) };
      else result = {};
    }
    return { ok: true, json: async () => result };
  };
  window.eval(`${script}\nwindow.panelTest = { state, buildAutoPlan, executeAutoPlan, renderPlan, loadProfile };`);
  await tick();
  const select = window.document.getElementById("profileDirection");
  async function choose(id) { select.value = id; await select.onchange(); }
  await choose("general");
  await window.document.getElementById("refreshPage").onclick();
  return { window, api: window.panelTest, calls, messages, events, tab, choose, $: (id) => window.document.getElementById(id) };
}

test("generating a plan restores the old bootstrap behavior for empty repeated sections", async (t) => {
  const { api, calls, messages } = await panel(t);
  assert.equal(await api.buildAutoPlan(), true);
  assert.equal(messages.filter((message) => message.type === "RECRUITMENT_ENSURE_RECORDS").length, 1);
  assert.equal(messages.find((message) => message.type === "RECRUITMENT_ENSURE_RECORDS").targets.education, 3);
  assert.equal(api.state.additions.length, 0);
  assert.equal(api.state.plan.filter((item) => item.virtual).length, 0);
  assert.ok(calls.filter((call) => call.path === "/api/auto-plan").every((call) => call.body.profileId === "general"));
  assert.equal(calls.filter((call) => call.path === "/api/align-form").length, 1);
});

test("analysis progress follows actual stages and stops updating after completion", async (t) => {
  const readGate = deferred(), alignGate = deferred(), reviewGate = deferred();
  const readStarted = deferred(), alignStarted = deferred(), reviewStarted = deferred();
  let holdRead = false;
  const { api, window, $ } = await panel(t, {
    message: async (message) => {
      if (holdRead && message.type === "RECRUITMENT_ANALYZE") {
        holdRead = false; readStarted.resolve(); await readGate.promise;
      }
    },
    request: async (path) => {
      if (path === "/api/align-form") { alignStarted.resolve(); await alignGate.promise; }
      if (path === "/api/auto-plan") { reviewStarted.resolve(); await reviewGate.promise; }
    }
  });
  const timers = new Map();
  window.setInterval = (callback) => { timers.set(1, callback); return 1; };
  window.clearInterval = (id) => timers.delete(id);
  holdRead = true;
  const build = api.buildAutoPlan();
  await readStarted.promise;
  assert.match($("planStatus").textContent, /1\/3 · 读取页面 · \d+ 秒/);
  readGate.resolve(); await alignStarted.promise;
  assert.match($("planStatus").textContent, /2\/3 · 检查并补齐经历/);
  alignGate.resolve(); await reviewStarted.promise;
  timers.get(1)();
  assert.match($("planStatus").textContent, /3\/3 · 匹配内容与复核 · \d+ 秒/);
  reviewGate.resolve();
  assert.equal(await build, true);
  assert.equal(timers.size, 0);
  assert.doesNotMatch($("planStatus").textContent, /3\/3/);
});

test("one final confirmation sends reviewed content and additions together", async (t) => {
  const { api, messages, $ } = await panel(t);
  await api.buildAutoPlan();
  await api.executeAutoPlan();
  assert.equal(messages.filter((message) => message.type === "RECRUITMENT_ENSURE_RECORDS").length, 1);
  const applied = messages.filter((message) => message.type === "RECRUITMENT_APPLY_AGENT_PLAN");
  assert.equal(applied.length, 1);
  assert.equal(applied[0].items.length, 3);
  assert.equal(applied[0].additions.length, 0);
  assert.match($("planStatus").textContent, /已填入 3 项/);
  assert.equal(api.state.plan.length, 0);
});

test("switching direction discards in-flight plans even after switching back", async (t) => {
  const gate = deferred();
  const started = deferred();
  const { api, choose } = await panel(t, { request: async (path, body) => {
    if (path === "/api/auto-plan") { started.resolve(); await gate.promise; return { profile: { id: body.profileId }, plan: [{ fieldId: "old", value: "旧方向内容" }] }; }
  } });
  const build = api.buildAutoPlan();
  await started.promise;
  await choose("aigc"); await choose("general");
  gate.resolve();
  assert.equal(await build, false);
  assert.equal(api.state.plan.length, 0);
  assert.equal(api.state.planProfileId, "");
});

test("tab activation invalidates plans immediately, before debounce", async (t) => {
  const { api, events, tab } = await panel(t);
  await api.buildAutoPlan();
  tab.id = 2;
  events.activated();
  assert.equal(api.state.plan.length, 0);
  assert.equal(api.state.planProfileId, "");
});

test("content script errors are surfaced and do not claim successful addition", async (t) => {
  const { api, $, messages } = await panel(t, { message: async (message) => message.type === "RECRUITMENT_APPLY_AGENT_PLAN" ? { ok: false, error: "添加按钮不可用" } : undefined });
  await api.buildAutoPlan(); await api.executeAutoPlan();
  assert.match($("planStatus").textContent, /添加按钮不可用/);
  assert.ok(!messages.some((message) => message.type === "RECRUITMENT_EXECUTE_PLAN"));
});

test("draft directions cannot generate plans or retain previous drafts", async (t) => {
  const { api, choose, $ } = await panel(t);
  $("draft").value = "旧方向文案";
  await choose("sales");
  assert.equal($("draft").value, "");
  assert.equal($("buildPlan").disabled, true);
  assert.equal(await api.buildAutoPlan(), false);
  assert.equal(api.state.plan.length, 0);
});

test("rerendering a plan preserves user checkbox decisions", async (t) => {
  const { api, $ } = await panel(t);
  await api.buildAutoPlan();
  const checkbox = $("plan").querySelector("input[type=checkbox]");
  checkbox.checked = false; checkbox.onchange();
  api.renderPlan();
  assert.equal($("plan").querySelector("input[type=checkbox]").checked, false);
});

test("duplicate execution is prevented while an operation is pending", async (t) => {
  const gate = deferred(); const started = deferred();
  const { api, messages } = await panel(t, { message: async (message) => {
    if (message.type === "RECRUITMENT_APPLY_AGENT_PLAN") { started.resolve(); await gate.promise; }
  } });
  await api.buildAutoPlan();
  const first = api.executeAutoPlan(); await started.promise;
  await api.executeAutoPlan(); gate.resolve(); await first;
  assert.equal(messages.filter((message) => message.type === "RECRUITMENT_APPLY_AGENT_PLAN").length, 1);
});

test("automatic analysis is available immediately after selecting a direction", async (t) => {
  const { api, choose, $ } = await panel(t);
  await choose("aigc");
  assert.equal(api.state.page, null);
  assert.equal($("buildPlan").disabled, false);
  assert.equal(await api.buildAutoPlan(), true);
  assert.equal($("matchFields"), null);
  assert.equal($("aiMatchFields"), null);
});

test("compact review keeps pending fields reachable without preselecting them", async (t) => {
  const { api, $ } = await panel(t);
  await api.buildAutoPlan();
  api.state.plan[0].needsConfirmation = true; api.state.plan[0].selected = false;
  api.renderPlan();
  assert.equal($("plan").querySelector(".agent-ready").open, false);
  assert.equal($("plan").querySelector(".plan-item.confirm").open, false);
  assert.equal($("plan").querySelector(".plan-item.confirm input").checked, false);
  const pending = $("plan").querySelector(".plan-item.confirm");
  pending.open = true;
  const editor = pending.querySelector("textarea");
  editor.value = "用户补充的学校"; editor.oninput();
  assert.equal(api.state.plan[0].selected, true);
  assert.equal($("selectionCount").textContent, "已选 3 项");
  editor.value = ""; editor.oninput();
  assert.equal(api.state.plan[0].selected, false);
  assert.equal($("selectionCount").textContent, "已选 2 项");
});

test("field-level failures retain the unsuccessful content as a visible exception", async (t) => {
  const { api, $ } = await panel(t, { message: async (message) => message.type === "RECRUITMENT_APPLY_AGENT_PLAN"
    ? { ok: true, results: message.items.map((item, index) => ({ fieldId: item.fieldId, ok: index !== 1, error: index === 1 ? "字段模板变化" : undefined })) } : undefined });
  await api.buildAutoPlan(); await api.executeAutoPlan();
  assert.equal(api.state.plan.length, 1);
  assert.equal(api.state.plan[0].selected, false);
  assert.equal(api.state.plan[0].reason, "字段模板变化");
  assert.match($("planStatus").textContent, /已填入 2 项/);
});

test("unfilled and unchecked items remain visible after the prepared items execute", async (t) => {
  const { api, $ } = await panel(t);
  await api.buildAutoPlan();
  api.state.plan[1].selected = false; api.state.plan[1].needsConfirmation = true; api.state.plan[1].value = "";
  await api.executeAutoPlan();
  assert.equal(api.state.plan.length, 1);
  assert.equal(api.state.plan[0].fieldId, "f1");
  assert.equal(api.state.plan[0].needsConfirmation, true);
  assert.match($("planStatus").textContent, /仍有 1 项未执行/);
});

test("an old local server cannot bypass the internal review requirement", async (t) => {
  const { api, $ } = await panel(t, { request: async (path) => path === "/api/auto-plan" ? { plan: [{ fieldId: "old", value: "旧规则结果" }] } : undefined });
  assert.equal(await api.buildAutoPlan(), false);
  assert.equal(api.state.plan.length, 0);
  assert.match($("planStatus").textContent, /本地服务仍是旧版/);
});

test("missing per-field results are reported as failures, not assumed successes", async (t) => {
  const { api, $ } = await panel(t, { message: async (message) => message.type === "RECRUITMENT_APPLY_AGENT_PLAN" ? { ok: true, results: [] } : undefined });
  await api.buildAutoPlan(); await api.executeAutoPlan();
  assert.equal(api.state.plan.length, 3);
  assert.match($("planStatus").textContent, /已填入 0 项/);
});
