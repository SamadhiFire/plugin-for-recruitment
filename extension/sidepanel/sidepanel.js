const API = "http://127.0.0.1:8787";
const state = { profile: null, selectedFieldId: null, fields: [], page: null, plan: [] };
const $ = (id) => document.getElementById(id);
const connection = $("connection");

function setConnection(text, error = false) {
  connection.textContent = text;
  connection.classList.toggle("error", error);
}
function countChars() { $("charCount").textContent = `${$("draft").value.length} 字`; }
function activeTab() { return chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab); }
async function sendToPage(type, payload = {}) {
  const tab = await activeTab();
  if (!tab?.id) throw new Error("未找到当前页面");
  try { return await chrome.tabs.sendMessage(tab.id, { type, ...payload }); }
  catch (error) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(error.message || "")) throw error;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/content.js"] });
    return chrome.tabs.sendMessage(tab.id, { type, ...payload });
  }
}
async function request(url, options = {}) {
  const response = await fetch(`${API}${url}`, { headers: { "Content-Type": "application/json" }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "本地服务请求失败");
  return body;
}
function renderFields() {
  const holder = $("fields"); holder.replaceChildren();
  $("pageInfo").textContent = state.fields.length ? `发现 ${state.fields.length} 个可填写字段；请选择一个字段后填入。` : "未发现字段。请确认当前页为招聘表单并已登录。";
  state.fields.forEach((field) => {
    const button = document.createElement("button");
    button.className = `field ${field.id === state.selectedFieldId ? "selected" : ""}`;
    const suggestion = field.suggestion ? ` · 建议：${field.suggestion.label || field.suggestion.path}` : "";
    button.textContent = `${field.label || "未命名字段"} · ${field.type}${suggestion}${field.value ? ` · 当前：${field.value.slice(0, 28)}` : ""}`;
    button.title = field.label || "未命名字段";
    button.onclick = async () => {
      state.selectedFieldId = field.id;
      if (field.suggestion?.value && !$("draft").value.trim()) { $("draft").value = Array.isArray(field.suggestion.value) ? field.suggestion.value.join("\n") : field.suggestion.value; countChars(); }
      await sendToPage("RECRUITMENT_HIGHLIGHT", { id: field.id }); renderFields();
    };
    holder.append(button);
  });
}
async function discover() {
  try {
    const result = await sendToPage("RECRUITMENT_ANALYZE");
    state.page = result.page; state.fields = result.page?.fields || result.fields || []; renderFields();
  }
  catch (error) { $("pageInfo").textContent = `无法读取页面：${error.message}`; }
}

function renderPlan() {
  const holder = $("plan"); holder.replaceChildren();
  $("planCount").textContent = `${state.plan.length} 项建议`;
  state.plan.forEach((item, index) => {
    const card = document.createElement("details");
    card.className = `plan-item ${item.needsConfirmation ? "confirm" : ""}`;
    card.open = Boolean(item.needsConfirmation);
    const head = document.createElement("summary"); head.className = "plan-head";
    const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = !item.needsConfirmation && Boolean(item.value); checkbox.style.width = "auto";
    checkbox.onchange = () => { item.selected = checkbox.checked; };
    item.selected = checkbox.checked;
    const label = document.createElement("div"); label.className = "plan-label";
    label.textContent = `${item.section || "其他"}${item.recordIndex != null ? ` #${item.recordIndex + 1}` : ""} · ${item.label || "未命名字段"}`;
    const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = item.needsConfirmation ? "待确认" : (item.source || "已映射");
    head.append(checkbox, label, badge);
    const value = document.createElement("textarea"); value.className = "plan-value"; value.value = item.value || "";
    value.placeholder = item.needsConfirmation ? "请确认、修改或补充后勾选" : "";
    value.oninput = () => { item.value = value.value; if (value.value.trim()) { checkbox.checked = true; item.selected = true; } };
    const reason = document.createElement("p"); reason.className = "muted"; reason.textContent = item.reason || "";
    card.append(head, value, reason); holder.append(card);
  });
  $("executePlan").disabled = !state.plan.length;
}

async function buildAutoPlan() {
  const status = $("planStatus");
  try {
    status.className = "muted";
    $("buildPlan").disabled = true; $("buildPlan").textContent = "正在扫描并补齐区块…";
    let analyzed = await sendToPage("RECRUITMENT_ANALYZE");
    state.page = analyzed.page;
    const alignment = await request("/api/align-form", { method: "POST", body: JSON.stringify({ fields: state.page.fields }) });
    const availableSections = new Set((state.page.repeaters || []).map((item) => item.section));
    const targets = Object.fromEntries(Object.entries(alignment.targets || {}).filter(([section, desired]) => availableSections.has(section) && desired > 0));
    if (Object.keys(targets).length) {
      await sendToPage("RECRUITMENT_ENSURE_RECORDS", { targets });
      analyzed = await sendToPage("RECRUITMENT_ANALYZE"); state.page = analyzed.page;
    }
    $("buildPlan").textContent = "正在让千问识别字段…";
    const result = await request("/api/auto-plan", { method: "POST", body: JSON.stringify({ page: state.page, variant: $("variant").value, instruction: $("autoInstruction").value }) });
    state.plan = result.plan || [];
    renderPlan();
    const confirms = state.plan.filter((item) => item.needsConfirmation).length;
    status.textContent = `已识别 ${state.page.fields.length} 个页面字段，生成 ${state.plan.length} 项建议${confirms ? `；其中 ${confirms} 项需要你确认` : ""}。`;
  } catch (error) { status.textContent = `生成计划失败：${error.message}`; status.className = "error"; }
  finally { $("buildPlan").disabled = false; $("buildPlan").textContent = "① 扫描页面并生成填表计划"; }
}

async function executeAutoPlan() {
  const items = state.plan.filter((item) => item.selected && String(item.value || "").trim()).map(({ fieldId, value }) => ({ fieldId, value }));
  if (!items.length) return alert("没有已勾选且有内容的项目。");
  try {
    $("planStatus").className = "muted";
    const result = await sendToPage("RECRUITMENT_EXECUTE_PLAN", { items });
    const failures = (result.results || []).filter((item) => !item.ok);
    $("planStatus").textContent = failures.length ? `已填入 ${items.length - failures.length} 项，${failures.length} 项因网页控件限制需要手动填写。网站尚未保存。` : `已填入 ${items.length} 项；请在网页中检查，网站尚未保存。`;
    await discover();
  } catch (error) { $("planStatus").textContent = `填入失败：${error.message}`; }
}

async function rememberCurrentPage() {
  try {
    $("planStatus").className = "muted";
    const analyzed = await sendToPage("RECRUITMENT_ANALYZE");
    const reusableSections = new Set(["basics", "summary", "skills", "other", "works", "language"]);
    const entries = (analyzed.page?.fields || []).filter((field) => reusableSections.has(field.section) && field.label && String(field.value || "").trim()).map(({ label, value, section }) => ({ label, value, section }));
    const result = await request("/api/memory", { method: "PUT", body: JSON.stringify({ entries }) });
    $("planStatus").textContent = `已保存 ${entries.length} 个补充答案；本地答案库版本 ${result.version}。`;
  } catch (error) { $("planStatus").textContent = `保存补充答案失败：${error.message}`; }
}
async function matchFields(withAI = false) {
  if (!state.fields.length) await discover();
  if (!state.fields.length) return;
  try {
    const tab = await activeTab();
    const endpoint = withAI ? "/api/ai-match-fields" : "/api/match-fields";
    const candidates = withAI ? state.fields.filter((field) => !field.suggestion) : state.fields;
    if (!candidates.length) return;
    const result = await request(endpoint, { method: "POST", body: JSON.stringify({ pageUrl: tab.url, fields: candidates.map(({ id, label, type }) => ({ id, label, type })) }) });
    const suggestions = new Map((result.suggestions || []).filter((item) => item.confidence !== "none").map((item) => [item.fieldId, item]));
    state.fields = state.fields.map((field) => suggestions.has(field.id) ? { ...field, suggestion: suggestions.get(field.id) } : field);
    renderFields();
  } catch (error) { $("pageInfo").textContent = `匹配失败：${error.message}`; }
}
async function loadProfile() {
  const result = await request("/api/profile");
  state.profile = result.profile;
  $("profileEditor").value = JSON.stringify(result.profile, null, 2);
  $("profileStatus").textContent = `版本 ${result.profile.meta.version} · 更新于 ${result.profile.meta.updatedAt}`;
  setConnection(`本地服务已连接 · ${result.model}`);
}
async function loadConfig() {
  const config = await request("/api/config");
  $("model").value = config.model || "qwen3.8-max";
  $("keyStatus").textContent = config.hasApiKey ? "已配置密钥" : "尚未配置密钥";
}
$("compose").onclick = async () => {
  try {
    $("compose").disabled = true; $("compose").textContent = "生成中…";
    const result = await request("/api/compose", { method: "POST", body: JSON.stringify({ variant: $("variant").value, task: $("task").value, instruction: $("instruction").value }) });
    $("draft").value = result.text; countChars();
  } catch (error) { alert(`生成失败：${error.message}`); }
  finally { $("compose").disabled = false; $("compose").textContent = "用千问生成候选文案"; }
};
$("draft").oninput = countChars;
$("copy").onclick = () => navigator.clipboard.writeText($("draft").value);
$("fillDraft").onclick = async () => {
  if (!state.selectedFieldId) return alert("请先在“页面字段”中选一个目标字段。");
  if (!$("draft").value.trim()) return alert("候选文案为空。");
  try {
    const result = await sendToPage("RECRUITMENT_FILL", { id: state.selectedFieldId, value: $("draft").value });
    if (!result?.ok) throw new Error(result?.error || "填写失败");
    await discover();
  } catch (error) { alert(`未填写：${error.message}`); }
};
$("discover").onclick = discover;
$("buildPlan").onclick = buildAutoPlan;
$("executePlan").onclick = executeAutoPlan;
$("rememberPage").onclick = rememberCurrentPage;
$("matchFields").onclick = () => matchFields(false);
$("aiMatchFields").onclick = () => matchFields(true);
$("reloadProfile").onclick = loadProfile;
$("saveProfile").onclick = async () => {
  try {
    const profile = JSON.parse($("profileEditor").value);
    const result = await request("/api/profile", { method: "PUT", body: JSON.stringify({ profile }) });
    state.profile = result.profile; $("profileEditor").value = JSON.stringify(result.profile, null, 2);
    $("profileStatus").textContent = `已保存版本 ${result.profile.meta.version} · ${result.profile.meta.updatedAt}`;
  } catch (error) { $("profileStatus").textContent = `保存失败：${error.message}`; $("profileStatus").className = "error"; }
};
$("saveConfig").onclick = async () => {
  try {
    const result = await request("/api/config", { method: "PUT", body: JSON.stringify({ apiKey: $("apiKey").value, model: $("model").value }) });
    $("apiKey").value = "";
    $("keyStatus").textContent = result.hasApiKey ? "已配置密钥" : "尚未配置密钥";
    setConnection(`本地服务已连接 · ${result.model}`);
  } catch (error) { $("keyStatus").textContent = `保存失败：${error.message}`; $("keyStatus").className = "error"; }
};
Promise.all([loadProfile(), loadConfig()]).then(discover).catch((error) => setConnection(`本地服务不可用：${error.message}。请双击“启动助手.cmd”后刷新。`, true));
