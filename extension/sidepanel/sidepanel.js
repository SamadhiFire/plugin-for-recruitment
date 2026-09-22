const API = "http://127.0.0.1:8787";
const state = { profiles: [], profile: null, profileId: "", profileMeta: null, planProfileId: "", directionContextKey: "", selectedFieldId: null, fields: [], page: null, plan: [], additions: [], agentReport: null, recordIssues: [], activeTabKey: "", revision: 0, building: false, executing: false };
const sectionLabels = { basics: "基本信息", education: "教育经历", experience: "实习经历", project: "项目经历", summary: "个人介绍", skills: "技能", works: "作品", other: "其他", language: "语言", work: "工作经历" };
const $ = (id) => document.getElementById(id);
const connection = $("connection");

function setConnection(text, error = false) {
  connection.textContent = error ? "未连接" : "已连接";
  connection.title = text;
  connection.classList.toggle("error", error);
}
function countChars() { $("charCount").textContent = `${$("draft").value.length} 字`; }
function activeTab() { return chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab); }
function keyForTab(tab) { return tab?.id ? `${tab.id}:${tab.url || ""}` : ""; }
function contextKeyForTab(tab) {
  try { return tab?.id ? `${tab.id}:${new URL(tab.url || "").origin}` : ""; }
  catch { return ""; }
}
function selectedProfileMeta() { return state.profiles.find((profile) => profile.id === state.profileId) || null; }
function directionReady() { return selectedProfileMeta()?.status === "ready"; }
function originPattern(tab) {
  try { const url = new URL(tab?.url || ""); return /^https?:$/.test(url.protocol) ? `${url.protocol}//${url.host}/*` : ""; }
  catch { return ""; }
}
async function ensurePageAccess(tab, requestAccess = false) {
  const origin = originPattern(tab);
  if (!origin) return false;
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return requestAccess ? chrome.permissions.request({ origins: [origin] }) : false;
}
function resetPageState(message = "正在读取当前页面…") {
  state.revision += 1;
  state.selectedFieldId = null; state.fields = []; state.page = null; state.plan = []; state.planProfileId = "";
  state.additions = []; state.agentReport = null; state.recordIssues = [];
  $("draft").value = ""; countChars();
  $("fields").replaceChildren(); $("plan").replaceChildren();
  $("pageInfo").textContent = message; $("planStatus").textContent = "";
  $("planCount").textContent = ""; $("planCount").hidden = true; $("executePlan").disabled = true;
  $("fillBar").hidden = true; $("planDiagnostics").hidden = true; $("planDiagnostics").open = false;
  $("planDiagnosticsText").textContent = "";
}
function updateDirectionUI() {
  const meta = selectedProfileMeta();
  const selected = Boolean(meta);
  const ready = meta?.status === "ready";
  $("refreshPage").disabled = !selected || state.building || state.executing;
  $("buildPlan").disabled = !ready || state.building || state.executing;
  const selectedCount = state.plan.filter((item) => item.selected && (item.clear || String(item.value || "").trim())).length;
  $("executePlan").disabled = !ready || !selectedCount || state.building || state.executing;
  $("fillBar").hidden = !state.plan.length;
  $("selectionCount").textContent = selectedCount ? `已选 ${selectedCount} 项` : "选择要填入的内容";
  $("executePlan").textContent = state.executing ? "正在填入…" : "确认填入";
  $("buildPlan").className = state.plan.length ? "quiet" : "primary";
  $("buildPlan").textContent = state.building ? "正在分析…" : state.plan.length ? "重新分析" : "分析当前页面";
  $("plan").setAttribute("aria-busy", String(state.building || state.executing));
  $("profileDirection").disabled = state.executing;
  $("compose").disabled = !ready;
  $("reloadProfile").disabled = !selected;
  $("profileEditor").disabled = !selected;
  $("saveProfile").disabled = !selected;
  $("directionStatus").hidden = !selected || ready;
  $("directionStatus").textContent = selected && !ready ? "此方向的简历待补充" : "";
}
async function clearDirection(message = "请先选择当前公司的投递方向。") {
  state.profileId = ""; state.profileMeta = null; state.profile = null; state.directionContextKey = "";
  $("profileDirection").value = ""; $("profileEditor").value = ""; $("profileStatus").textContent = "";
  resetPageState(message); updateDirectionUI();
}
async function sendToPage(type, payload = {}, targetTab = null) {
  const tab = targetTab || await activeTab();
  if (!tab?.id) throw new Error("未找到当前页面");
  const message = { type, expectedUrl: tab.url, ...payload };
  let result;
  try { result = await chrome.tabs.sendMessage(tab.id, message); }
  catch (error) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(error.message || "")) throw error;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/content.js"] });
    result = await chrome.tabs.sendMessage(tab.id, message);
  }
  if (!result?.ok) throw new Error(result?.error || "页面操作失败");
  return result;
}
function operationContext() { return { revision: state.revision, profileId: state.profileId, tabKey: state.activeTabKey }; }
function isCurrent(context) { return context.revision === state.revision && context.profileId === state.profileId && context.tabKey === state.activeTabKey; }
async function assertCurrent(context) {
  const tab = await activeTab();
  if (!isCurrent(context) || keyForTab(tab) !== context.tabKey) throw new Error("页面或简历方向已变化，请重新扫描");
}
async function request(url, options = {}) {
  const { timeoutMs = 30000, ...fetchOptions } = options;
  let response;
  try { response = await fetch(`${API}${url}`, { headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(timeoutMs), ...fetchOptions }); }
  catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new Error(`本地分析超过 ${Math.round(timeoutMs / 1000)} 秒，已停止等待；请重试，精确字段仍会由本地规则兜底`);
    throw error;
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "本地服务请求失败");
  return body;
}
function renderFields() {
  const holder = $("fields"); holder.replaceChildren();
  const host = state.page?.host ? `${state.page.host} · ` : "";
  $("pageInfo").textContent = state.fields.length ? `${host}发现 ${state.fields.length} 个可填写字段` : "未发现字段。请确认当前页为招聘表单并已登录。";
  state.fields.forEach((field) => {
    const button = document.createElement("button");
    button.className = `field ${field.id === state.selectedFieldId ? "selected" : ""}`;
    const suggestion = field.suggestion ? ` · 建议：${field.suggestion.label || field.suggestion.path}` : "";
    button.textContent = `${field.section}${field.recordIndex != null ? ` #${field.recordIndex + 1}` : ""} · ${field.label || "未命名字段"} · ${field.required ? "必填" : "选填"}${field.readOnly ? " · 只读" : ""}${field.maxLength ? ` · 最多${field.maxLength}字` : ""} · ${field.control}${suggestion}${field.value ? ` · 当前：${field.value.slice(0, 28)}` : ""}`;
    button.title = field.label || "未命名字段";
    button.onclick = async () => {
      state.selectedFieldId = field.id;
      if (field.suggestion?.value && !$("draft").value.trim()) { $("draft").value = Array.isArray(field.suggestion.value) ? field.suggestion.value.join("\n") : field.suggestion.value; countChars(); }
      await sendToPage("RECRUITMENT_HIGHLIGHT", { id: field.id }); renderFields();
    };
    holder.append(button);
  });
}
async function discover({ requestAccess = false } = {}) {
  try {
    const tab = await activeTab();
    if (!tab?.id) throw new Error("未找到当前页面");
    if (!state.profileId || state.directionContextKey !== contextKeyForTab(tab)) {
      await clearDirection();
      return;
    }
    const nextKey = keyForTab(tab);
    if (state.activeTabKey !== nextKey) { state.activeTabKey = nextKey; resetPageState(); }
    const context = operationContext();
    if (!await ensurePageAccess(tab, requestAccess)) {
      $("pageInfo").textContent = "点击右上角刷新图标，授权读取此网站。";
      return;
    }
    const result = await sendToPage("RECRUITMENT_ANALYZE", {}, tab);
    await assertCurrent(context);
    state.page = result.page; state.fields = result.page?.fields || result.fields || []; renderFields(); updateDirectionUI();
  }
  catch (error) { $("pageInfo").textContent = `无法读取页面：${error.message}`; updateDirectionUI(); }
}

function renderPlan() {
  const holder = $("plan"); holder.replaceChildren();
  const pendingCount = state.plan.filter((item) => item.needsConfirmation).length;
  const automaticCount = state.plan.length - pendingCount;
  $("planCount").hidden = !state.plan.length && !state.recordIssues.length;
  $("planCount").textContent = [automaticCount ? `${automaticCount} 项可填入` : "", pendingCount ? `${pendingCount} 项待补充` : "",
    state.recordIssues.length ? `${state.recordIssues.length} 条记录提示` : ""].filter(Boolean).join(" · ");
  if (state.recordIssues.length) {
    const notices = document.createElement("details"); notices.className = "diagnostics";
    const summary = document.createElement("summary"); summary.textContent = "查看记录提示"; notices.append(summary);
    for (const issue of state.recordIssues) {
      const notice = document.createElement("p"); notice.className = "record-issue";
      notice.textContent = `${sectionLabels[issue.section] || "其他"} · ${issue.identity || "记录"}：${issue.reason}`;
      notices.append(notice);
    }
    holder.append(notices);
  }
  const issues = document.createElement("div"); issues.className = "plan-list";
  const automatic = document.createElement("details"); automatic.className = "agent-ready";
  const automaticSummary = document.createElement("summary"); automaticSummary.textContent = `查看已准备内容（${automaticCount}）`;
  automatic.append(automaticSummary);
  const automaticItems = document.createElement("div"); automaticItems.className = "plan-list"; automatic.append(automaticItems);
  if (pendingCount) holder.append(issues);
  if (automaticCount) holder.append(automatic);
  const groups = new Map();
  state.plan.forEach((item, index) => {
    const groupKey = `${Boolean(item.needsConfirmation)}:${item.section}:${item.recordIndex ?? ""}`;
    if (!groups.has(groupKey)) {
      const group = document.createElement("section"); group.className = "plan-section";
      const heading = document.createElement("h3");
      heading.textContent = `${sectionLabels[item.section] || "其他"}${item.recordIndex != null ? ` · ${item.recordIndex + 1}` : ""}${item.virtual ? " · 新增" : ""}`;
      group.append(heading); (item.needsConfirmation ? issues : automaticItems).append(group); groups.set(groupKey, group);
    }
    const card = document.createElement("details"); card.className = `plan-item ${item.needsConfirmation ? "confirm" : ""}`;
    const head = document.createElement("summary"); head.className = "plan-head";
    const fieldLabel = item.label && item.label !== "unknown" ? item.label : "未识别字段";
    const checkbox = document.createElement("input"); checkbox.type = "checkbox";
    checkbox.checked = item.selected ?? (!item.needsConfirmation && (Boolean(item.value) || item.clear || item.action === "addRecords"));
    checkbox.setAttribute("aria-label", `填入${fieldLabel}`);
    checkbox.onclick = (event) => event.stopPropagation();
    checkbox.onchange = () => { item.selected = checkbox.checked; updateDirectionUI(); };
    item.selected = checkbox.checked;
    const label = document.createElement("div"); label.className = "plan-label"; label.textContent = fieldLabel;
    const preview = document.createElement("span"); preview.className = "plan-preview";
    preview.textContent = item.value || (item.clear ? "清空旧值" : ""); label.append(preview);
    const badge = document.createElement("span"); badge.className = "badge";
    badge.textContent = item.needsConfirmation ? (item.value ? "待核对" : "待补充") : item.replacesExisting ? "更新" : "";
    head.append(checkbox, label, badge); card.append(head);
    if (item.currentValue) {
      const previous = document.createElement("p"); previous.className = "muted";
      previous.textContent = `当前：${String(item.currentValue).slice(0, 180)}`; card.append(previous);
    }
    if (item.action !== "addRecords") {
      const value = document.createElement("textarea"); value.className = "plan-value"; value.value = item.value || "";
      value.rows = /description|summary|skills/.test(item.key || "") ? 4 : 2;
      value.setAttribute("aria-label", `编辑${fieldLabel}`);
      value.placeholder = item.clear ? "将清空旧值" : "填写内容，或留空跳过";
      value.oninput = () => {
        item.value = value.value; item.clear = false;
        checkbox.checked = Boolean(value.value.trim()); item.selected = checkbox.checked;
        preview.textContent = value.value;
        badge.textContent = value.value.trim() ? "已编辑" : "待补充";
        updateDirectionUI();
      };
      card.append(value);
    }
    if (item.reason) {
      const explanation = document.createElement("details"); explanation.className = "diagnostics";
      const summary = document.createElement("summary"); summary.textContent = "查看原因";
      const reason = document.createElement("p"); reason.textContent = item.reason;
      explanation.append(summary, reason); card.append(explanation);
    }
    groups.get(groupKey).append(card);
  });
  updateDirectionUI();
}

async function buildAutoPlan() {
  if (state.building || state.executing) return false;
  const status = $("planStatus");
  let context;
  let progressTimer;
  const startedAt = Date.now();
  let progressStep = "1/3 · 读取页面";
  const showProgress = () => {
    if (!context || !isCurrent(context)) return;
    status.textContent = `${progressStep} · ${Math.floor((Date.now() - startedAt) / 1000)} 秒`;
  };
  try {
    if (!state.profileId) throw new Error("请先选择简历方向");
    if (!directionReady()) throw new Error(`“${selectedProfileMeta()?.label || "当前方向"}”内容仍待补充`);
    status.className = "muted";
    state.building = true; state.revision += 1; state.plan = []; state.planProfileId = ""; state.recordIssues = []; renderPlan();
    $("planDiagnostics").hidden = true; $("planDiagnosticsText").textContent = "";
    context = operationContext();
    showProgress();
    progressTimer = setInterval(showProgress, 1000);
    const profileId = context.profileId;
    $("buildPlan").textContent = "正在分析…";
    const tab = await activeTab();
    if (!tab?.id) throw new Error("未找到当前页面");
    if (!isCurrent(context) || contextKeyForTab(tab) !== state.directionContextKey) throw new Error("页面或方向已切换，请重新选择方向");
    state.activeTabKey = keyForTab(tab); context = operationContext();
    await assertCurrent(context);
    if (!await ensurePageAccess(tab, true)) throw new Error("未获得当前招聘网站的页面访问权限");
    let analyzed = await sendToPage("RECRUITMENT_ANALYZE", {}, tab);
    await assertCurrent(context);
    state.page = analyzed.page;
    let page = analyzed.page;
    // Empty repeatable sections have an add button but no field template. The
    // older workflow correctly created the missing blank rows first and then
    // scanned their real schema. Restore that behavior: the user prefers extra
    // removable rows over omitted resume records. This still never saves or
    // submits the website.
    progressStep = "2/3 · 检查并补齐经历"; showProgress();
    const alignment = await request("/api/align-form", { method: "POST", body: JSON.stringify({ profileId, fields: page.fields }) });
    await assertCurrent(context);
    const repeaters = new Map((page.repeaters || []).map((item) => [item.section, item]));
    const targets = Object.fromEntries(Object.entries(alignment.targets || {}).filter(([section, desired]) => {
      const repeater = repeaters.get(section);
      return repeater && desired > (repeater.currentCount || 0);
    }));
    if (Object.keys(targets).length) {
      await sendToPage("RECRUITMENT_ENSURE_RECORDS", { targets }, tab);
      await assertCurrent(context);
      analyzed = await sendToPage("RECRUITMENT_ANALYZE", {}, tab);
      await assertCurrent(context);
      state.page = analyzed.page;
      page = analyzed.page;
    }
    $("buildPlan").textContent = "正在分析…";
    progressStep = "3/3 · 匹配内容与复核"; showProgress();
    const result = await request("/api/auto-plan", { method: "POST", timeoutMs: 60000, body: JSON.stringify({ profileId, page, instruction: $("autoInstruction").value }) });
    clearInterval(progressTimer); progressTimer = null;
    await assertCurrent(context);
    if (result.agentVersion !== 2) throw new Error("本地服务仍是旧版，请关闭旧服务窗口并重新启动助手");
    state.plan = result.plan || []; state.additions = result.additions || []; state.agentReport = result.report || null; state.recordIssues = result.recordIssues || []; state.planProfileId = result.profile?.id || profileId;
    state.fields = page.fields; renderFields();
    renderPlan();
    const confirms = state.plan.filter((item) => item.needsConfirmation).length;
    const ready = state.plan.length - confirms;
    const newRecords = new Set(state.plan.filter((item) => item.virtual && !item.needsConfirmation).map((item) => `${item.section}:${item.recordIndex}`)).size;
    status.textContent = (result.warnings || []).some((warning) => /超时|不可用|失败|异常/.test(warning))
      ? "部分内容需补充，已准备的内容可先填入。" : state.plan.length ? "" : "检查完成，无需补填。";
    $("planDiagnosticsText").textContent = [
      `已准备 ${ready} 项，待补充 ${confirms} 项。`,
      `拟新增 ${newRecords} 条经历，更新 ${result.report?.replacements || 0} 个字段。`,
      result.report?.locallyVerified ? `${result.report.locallyVerified} 项通过本地校验（含已填写项）。` : "",
      ...(result.warnings || [])
    ].filter(Boolean).join("\n");
    $("planDiagnostics").hidden = false;
    return true;
  } catch (error) { if (!context || isCurrent(context)) { status.textContent = `生成计划失败：${error.message}`; status.className = "error"; } return false; }
  finally { if (progressTimer) clearInterval(progressTimer); state.building = false; $("buildPlan").textContent = "分析当前页面"; updateDirectionUI(); }
}

async function executeAutoPlan() {
  if (state.executing || state.building) return;
  if (!state.profileId || state.planProfileId !== state.profileId) return alert("简历方向已经变化，请重新刷新并生成填表计划。");
  const additions = state.additions;
  const items = state.plan.filter((item) => item.selected && (item.clear || String(item.value || "").trim())).map(({ fieldId, domId, label, key, type, control, section, recordIndex, value, clear, currentValue, maxLength, virtual, addId, recordIdentity }) => ({ fieldId, domId, label, key, type, control, section, recordIndex, value, clear, currentValue, maxLength, virtual, addId, recordIdentity }));
  if (!items.length) return alert("没有已准备或已确认的内容。");
  const context = operationContext();
  try {
    state.executing = true; updateDirectionUI();
    const tab = await activeTab();
    await assertCurrent(context);
    $("planStatus").className = "muted";
    $("planStatus").textContent = "正在填入并检查结果…";
    const result = await sendToPage("RECRUITMENT_APPLY_AGENT_PLAN", { items, additions }, tab);
    const outcomes = new Map((result.results || []).map((item) => [item.fieldId, item]));
    const failures = items.map((item) => outcomes.get(item.fieldId) || { fieldId: item.fieldId, ok: false, error: "网页未返回此字段的填写结果" }).filter((item) => !item.ok);
    await assertCurrent(context);
    const failedIds = new Map(failures.map((failure) => [failure.fieldId, failure.error]));
    const attemptedIds = new Set(items.map((item) => item.fieldId));
    state.plan = state.plan.filter((item) => !attemptedIds.has(item.fieldId) || failedIds.has(item.fieldId))
      .map((item) => failedIds.has(item.fieldId) ? { ...item, selected: false, needsConfirmation: true, reason: failedIds.get(item.fieldId) } : item);
    $("planStatus").textContent = `已填入 ${items.length - failures.length} 项${failures.length ? `，${failures.length} 项未成功` : ""}。${state.plan.length ? `仍有 ${state.plan.length} 项未执行。` : ""}`;
    if (!state.plan.length) { state.planProfileId = ""; state.additions = []; } renderPlan();
    await discover();
  } catch (error) { if (isCurrent(context)) $("planStatus").textContent = `填入失败：${error.message}。请检查页面并重新扫描。`; }
  finally { state.executing = false; updateDirectionUI(); }
}

async function rememberCurrentPage() {
  try {
    if (!state.profileId) throw new Error("请先选择简历方向");
    const context = operationContext();
    const tab = await activeTab();
    await assertCurrent(context);
    $("planStatus").className = "muted";
    const analyzed = await sendToPage("RECRUITMENT_ANALYZE", {}, tab);
    await assertCurrent(context);
    const reusableSections = new Set(["basics", "summary", "skills", "other", "works", "language"]);
    const entries = (analyzed.page?.fields || []).filter((field) => reusableSections.has(field.section) && field.label && String(field.value || "").trim()).map(({ label, value, section }) => ({ label, value, section }));
    const result = await request("/api/memory", { method: "PUT", body: JSON.stringify({ profileId: context.profileId, entries }) });
    await assertCurrent(context);
  $("planStatus").textContent = `已记住 ${entries.length} 项补充内容。`;
  } catch (error) { $("planStatus").textContent = `保存补充答案失败：${error.message}`; }
}
async function loadProfile() {
  if (!state.profileId) return;
  const context = operationContext();
  const result = await request(`/api/profile?profileId=${encodeURIComponent(state.profileId)}`);
  if (!isCurrent(context)) return;
  state.profile = result.profile;
  state.profileMeta = result.profileMeta;
  $("profileEditor").value = JSON.stringify(result.profile, null, 2);
  $("profileStatus").className = "helper";
  $("profileStatus").textContent = `${result.profileMeta.label} · ${result.profileMeta.status === "ready" ? "已就绪" : "待补充"} · 版本 ${result.profile.meta.version} · 更新于 ${result.profile.meta.updatedAt}`;
  setConnection(`本地服务已连接 · ${result.model} · ${result.profileMeta.label}`);
  updateDirectionUI();
}
async function loadProfiles() {
  const result = await request("/api/profiles");
  state.profiles = result.profiles || [];
  const select = $("profileDirection");
  select.replaceChildren(new Option("请选择投递方向", ""));
  for (const profile of state.profiles) {
    const suffix = profile.status === "ready" ? "" : "（待补充）";
    select.append(new Option(`${profile.label}${suffix}`, profile.id));
  }
}
async function loadConfig() {
  const config = await request("/api/config");
  $("model").value = config.model || "qwen3.8-max";
  $("keyStatus").textContent = config.hasApiKey ? "已配置密钥" : "尚未配置密钥";
  setConnection(`本地服务已连接 · ${config.model || "qwen3.8-max"} · 请选方向`);
}
$("compose").onclick = async () => {
  const context = operationContext();
  try {
    if (!state.profileId || !directionReady()) throw new Error("请先选择一个已就绪的简历方向");
    $("compose").disabled = true; $("compose").textContent = "生成中…";
    const result = await request("/api/compose", { method: "POST", body: JSON.stringify({ profileId: state.profileId, task: $("task").value, instruction: $("instruction").value }) });
    await assertCurrent(context);
    $("draft").value = result.text; countChars();
  } catch (error) { alert(`生成失败：${error.message}`); }
  finally { $("compose").textContent = "用千问生成候选文案"; updateDirectionUI(); }
};
$("draft").oninput = countChars;
$("copy").onclick = () => navigator.clipboard.writeText($("draft").value);
$("fillDraft").onclick = async () => {
  if (state.executing || state.building || !directionReady()) return;
  if (!state.selectedFieldId) return alert("请先在“页面字段”中选一个目标字段。");
  if (!$("draft").value.trim()) return alert("候选文案为空。");
  try {
    const context = operationContext();
    const tab = await activeTab();
    await assertCurrent(context);
    const selected = state.fields.find((field) => field.id === state.selectedFieldId) || {};
    const result = await sendToPage("RECRUITMENT_FILL", { id: state.selectedFieldId, field: { ...selected, currentValue: selected.value }, value: $("draft").value }, tab);
    if (!result?.ok) throw new Error(result?.error || "填写失败");
    await discover();
  } catch (error) { alert(`未填写：${error.message}`); }
};
$("discover").onclick = buildAutoPlan;
$("refreshPage").onclick = async () => { state.activeTabKey = ""; resetPageState("正在刷新当前页面…"); await discover({ requestAccess: true }); };
$("buildPlan").onclick = buildAutoPlan;
$("executePlan").onclick = executeAutoPlan;
$("rememberPage").onclick = rememberCurrentPage;
$("reloadProfile").onclick = loadProfile;
$("profileDirection").onchange = async () => {
  const profileId = $("profileDirection").value;
  if (!profileId) return clearDirection();
  resetPageState("正在切换方向…");
  const revision = state.revision;
  const tab = await activeTab();
  if (revision !== state.revision) return;
  state.profileId = profileId;
  state.profileMeta = selectedProfileMeta();
  state.directionContextKey = contextKeyForTab(tab);
  state.activeTabKey = keyForTab(tab);
  resetPageState("选择方向后可直接分析页面。");
  updateDirectionUI();
  try { await loadProfile(); }
  catch (error) { $("profileStatus").textContent = `读取失败：${error.message}`; $("profileStatus").className = "error"; }
};
$("saveProfile").onclick = async () => {
  const context = operationContext();
  try {
    if (!state.profileId) throw new Error("请先选择简历方向");
    const profile = JSON.parse($("profileEditor").value);
    const result = await request("/api/profile", { method: "PUT", body: JSON.stringify({ profileId: state.profileId, profile }) });
    if (!isCurrent(context)) return;
    resetPageState("简历已更新，请重新扫描生成方案。"); updateDirectionUI();
    state.profile = result.profile; $("profileEditor").value = JSON.stringify(result.profile, null, 2);
    $("profileStatus").className = "helper";
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

let pageSyncTimer;
function schedulePageSync(message = "页面已变化，请确认方向后刷新。") {
  clearTimeout(pageSyncTimer);
  resetPageState(message); updateDirectionUI();
  pageSyncTimer = setTimeout(async () => {
    const tab = await activeTab();
    const nextContext = contextKeyForTab(tab);
    if (state.directionContextKey && nextContext !== state.directionContextKey) await clearDirection("已切换公司或标签页，请重新选择投递方向。");
    else { resetPageState(message); updateDirectionUI(); }
  }, 250);
}
chrome.tabs.onActivated.addListener(() => schedulePageSync());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === "complete" || changeInfo.url)) schedulePageSync("页面已更新，可重新分析。");
});
Promise.all([loadProfiles(), loadConfig()]).then(() => { resetPageState("请先选择投递方向。"); updateDirectionUI(); }).catch((error) => setConnection(`本地服务不可用：${error.message}。请双击“启动助手.cmd”后刷新。`, true));
