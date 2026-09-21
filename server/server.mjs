import { createServer } from "node:http";
import { readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = resolve(root, "data", "resume.profile.json");
const memoryPath = resolve(root, "data", "answers.memory.json");
const envPath = resolve(root, ".env");

async function loadEnv() {
  if (!existsSync(envPath)) return;
  for (const line of (await readFile(envPath, "utf8")).split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index > 0) process.env[line.slice(0, index).trim()] ||= line.slice(index + 1).trim();
  }
}
await loadEnv();

const port = Number(process.env.PORT || 8787);
const baseUrl = (process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
let model = process.env.QWEN_MODEL || "qwen3.8-max";
const rules = [
  "只能依据简历主库中已确认的事实写作；绝不虚构日期、公司、职责、产品、方法、指标或结果。",
  "必须使用中文分点格式，以 1.、2.、3. 开头；每一点遵循 场景/问题 → 动作/方法 → 结果/指标。",
  "保留简历中所有真实量化指标、专业方法和关键词；不能为追求简洁删除关键数字。",
  "不输出标题、注释、免责声明或 Markdown 代码块，只输出可直接填入表单的正文。",
  "如用户要求的信息不在简历中，明确写“【待确认】”，不要猜测。"
].join("\n");

const variants = {
  ai_pm: "目标：AI 产品经理。优先突出 Agent 工作流、RAG、Hybrid 检索、Rerank、Evals、Badcase、0-1 验证、用户旅程、产品机制和数据闭环。",
  product_ops: "目标：产品运营/商业化。优先突出用户分层、转化漏斗、增长实验、A/B 测试、归因、定价、eCPM、GMV、留存与跨团队推进。"
};

const fieldDefinitions = [
  ["basics.name", "姓名", ["姓名", "中文名", "姓名（中文）"]],
  ["basics.gender", "性别", ["性别"]],
  ["basics.birthDate", "出生日期", ["出生日期", "生日"]],
  ["basics.phone", "手机号码", ["手机", "手机号", "联系电话", "移动电话"]],
  ["basics.phoneCountry", "手机国家区号", ["国家区号", "手机区号", "电话区号"]],
  ["basics.phoneNumber", "手机号码（不含区号）", ["号码", "手机号", "手机号码"]],
  ["basics.email", "邮箱", ["邮箱", "电子邮箱", "email", "e-mail"]],
  ["basics.idType", "证件类型", ["证件类型", "个人证件"]],
  ["basics.idNumber", "证件号码", ["证件号码", "身份证号", "身份证号码"]],
  ["basics.nationality", "国籍", ["国籍", "国家/地区", "国籍（国家/地区）"]],
  ["basics.hometownText", "籍贯/家乡", ["籍贯", "家乡"]],
  ["basics.interviewLocation", "意向面试地点", ["意向面试地点", "面试地点"]],
  ["basics.portfolio", "作品集", ["作品集", "个人主页", "个人网站", "portfolio"]],
  ["basics.github", "GitHub", ["github", "github 地址", "代码仓库"]],
  ["basics.summary", "个人优势", ["个人优势", "自我评价", "个人总结", "个人简介"]],
  ["skills", "专业技能", ["专业技能", "技能", "掌握技能", "技术技能"]]
];
const siteAliases = {
  "careers.oppo.com": { "工作内容": ["experience.0.bullets", "experience.1.bullets", "experience.2.bullets"], "项目描述": ["projects.0.description", "projects.1.description", "projects.2.description"] },
  "jobs.bytedance.com": { "工作描述": ["experience.0.bullets", "experience.1.bullets", "experience.2.bullets"] },
  "xiaomi.jobs.f.mioffice.cn": { "工作内容": ["experience.0.bullets", "experience.1.bullets", "experience.2.bullets"] }
};

function getValue(object, path) { return path.split(".").reduce((current, key) => current?.[key], object); }
function profileForModel(profile) {
  return {
    basics: {
      portfolio: profile.basics?.portfolio,
      github: profile.basics?.github,
      summary: profile.basics?.summary
    },
    education: profile.education,
    experience: profile.experience,
    projects: profile.projects,
    skills: profile.skills
  };
}
function flattenCatalog(profile) {
  const catalog = fieldDefinitions.map(([path, label, aliases]) => ({ path, label, aliases, value: getValue(profile, path) }));
  profile.education.forEach((entry, index) => {
    for (const [key, label, aliases] of [
      ["school", "学校", ["学校", "院校", "毕业院校", "学校名称"]],
      ["college", "院系", ["院系", "学院", "所在院系/研究所"]],
      ["locationText", "学校所在地", ["学校所在地", "院校所在地"]],
      ["major", "专业", ["专业", "所学专业"]],
      ["majorCategory", "专业类别", ["专业类别", "专业大类"]],
      ["degree", "学历", ["学历", "学位", "最高学历"]],
      ["educationType", "受教育类型", ["受教育类型", "学历类型"]],
      ["exchange", "交流学习", ["是否交流学习", "该学历是否为交流学习"]],
      ["jointProgram", "联合办学", ["是否联合办学", "该学历是否为联合办学"]],
      ["rank", "成绩排名", ["成绩排名", "年级成绩排名"]],
      ["gpa", "GPA", ["GPA", "GPA/CGPA"]],
      ["advisor", "导师", ["导师", "导师姓名"]],
      ["nationalKeyLab", "国家重点实验室", ["是否国家重点实验室", "国家重点实验室"]],
      ["laboratory", "实验室", ["实验室", "实验室名称"]],
      ["start", "开始时间", ["开始时间", "入学时间"]],
      ["end", "结束时间", ["结束时间", "毕业时间"]]
    ]) {
      catalog.push({ path: `education.${index}.${key}`, label: `${entry.school}${label}`, aliases, value: entry[key] });
    }
  });
  profile.experience.forEach((entry, index) => {
    catalog.push({ path: `experience.${index}.company`, label: `${entry.company}公司`, aliases: ["公司", "任职公司", "工作单位"], value: entry.company });
    catalog.push({ path: `experience.${index}.role`, label: `${entry.company}职位`, aliases: ["职位", "岗位", "职务"], value: entry.role });
    catalog.push({ path: `experience.${index}.bullets`, label: `${entry.company}工作内容`, aliases: ["工作内容", "工作描述", "职责描述", "岗位职责"], value: entry.bullets.map((item, i) => `${i + 1}. ${item}`).join("\n") });
    catalog.push({ path: `experience.${index}.start`, label: `${entry.company}开始时间`, aliases: ["开始时间", "起始时间"], value: entry.start });
    catalog.push({ path: `experience.${index}.end`, label: `${entry.company}结束时间`, aliases: ["结束时间", "离职时间"], value: entry.end });
  });
  profile.projects.forEach((entry, index) => {
    catalog.push({ path: `projects.${index}.name`, label: `${entry.name}项目名称`, aliases: ["项目名称", "项目名"] , value: entry.name });
    catalog.push({ path: `projects.${index}.description`, label: `${entry.name}项目描述`, aliases: ["项目描述", "项目介绍", "项目内容"], value: entry.description });
    catalog.push({ path: `projects.${index}.type`, label: `${entry.name}项目角色`, aliases: ["项目角色", "担任角色"], value: entry.type });
    if (entry.url) catalog.push({ path: `projects.${index}.url`, label: `${entry.name}项目链接`, aliases: ["项目链接", "项目地址"], value: entry.url });
  });
  return catalog.filter((item) => item.value != null);
}
function normalized(value = "") { return String(value).toLowerCase().replace(/[\s：:（）()【】\[\]·、，,。.!！?？]/g, ""); }
function equivalentValue(left, right) {
  const a = normalized(left);
  const b = normalized(right);
  return a === b || (a && b && (a.includes(b) || b.includes(a)));
}
function deterministicMatches(fields, profile, pageUrl) {
  const catalog = flattenCatalog(profile);
  const host = new URL(pageUrl || "https://invalid.local").hostname;
  const overrides = siteAliases[host] || {};
  return fields.map((field) => {
    const label = normalized(field.label);
    let candidates = catalog.map((candidate) => {
      const aliases = [candidate.label, ...candidate.aliases].map(normalized);
      const exact = aliases.some((alias) => alias && alias === label);
      const overlap = aliases.reduce((score, alias) => score + (alias && (label.includes(alias) || alias.includes(label)) ? Math.min(alias.length, label.length) : 0), 0);
      return { ...candidate, score: exact ? 100 : overlap };
    }).filter((candidate) => candidate.score >= 3);
    const overridePaths = Object.entries(overrides).find(([alias]) => normalized(alias) === label)?.[1];
    if (overridePaths) candidates = catalog.filter((candidate) => overridePaths.includes(candidate.path)).map((candidate) => ({ ...candidate, score: 80 }));
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const ambiguous = !best || candidates.filter((item) => item.score === best.score).length > 1;
    return best && !ambiguous ? { fieldId: field.id, path: best.path, label: best.label, value: best.value, confidence: best.score >= 100 ? "high" : "medium", source: "rules" } : { fieldId: field.id, confidence: "none", source: "rules" };
  });
}

function send(request, response, status, body) {
  const origin = request.headers.origin || "";
  const allowedOrigin = origin.startsWith("chrome-extension://") ? origin : "null";
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": allowedOrigin, "Vary": "Origin", "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
  response.end(JSON.stringify(body));
}
async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (Buffer.concat(chunks).length > 1_000_000) throw new Error("请求过大");
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
async function getProfile() { return JSON.parse(await readFile(profilePath, "utf8")); }
async function getMemory() {
  if (!existsSync(memoryPath)) return { version: 1, updatedAt: new Date().toISOString(), answers: [] };
  return JSON.parse(await readFile(memoryPath, "utf8"));
}
async function saveMemory(entries) {
  const memory = await getMemory();
  const accepted = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.label && entry?.value != null && String(entry.value).trim()).map((entry) => ({
    key: normalized(`${entry.section || "other"}:${entry.label}`),
    section: entry.section || "other",
    label: String(entry.label).trim().slice(0, 200),
    value: String(entry.value).trim().slice(0, 12000),
    updatedAt: new Date().toISOString()
  }));
  const byKey = new Map((memory.answers || []).map((entry) => [entry.key, entry]));
  accepted.forEach((entry) => byKey.set(entry.key, entry));
  const next = { version: Number(memory.version || 0) + 1, updatedAt: new Date().toISOString(), answers: [...byKey.values()] };
  const temporaryPath = `${memoryPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temporaryPath, memoryPath);
  return next;
}

const sectionSpecs = {
  education: { list: "education", identityKey: "school", profileIdentity: "school" },
  experience: { list: "experience", identityKey: "company", profileIdentity: "company" },
  project: { list: "projects", identityKey: "projectName", profileIdentity: "name" }
};

function buildAlignment(fields, profile) {
  const mapping = {};
  const targets = {};
  for (const [section, spec] of Object.entries(sectionSpecs)) {
    const sectionFields = fields.filter((field) => field.section === section && Number.isInteger(field.recordIndex));
    const currentCount = sectionFields.length ? Math.max(...sectionFields.map((field) => field.recordIndex)) + 1 : 0;
    const identities = new Map(sectionFields.filter((field) => field.key === spec.identityKey && String(field.value || "").trim()).map((field) => [field.recordIndex, String(field.value)]));
    const used = new Set();
    const profileToPage = {};
    const records = profile[spec.list] || [];
    records.forEach((record, profileIndex) => {
      const wantedValues = [record[spec.profileIdentity], ...(Array.isArray(record.aliases) ? record.aliases : [])].map(normalized).filter(Boolean);
      const match = [...identities.entries()].find(([pageIndex, value]) => {
        const existing = normalized(value);
        const identityMatches = wantedValues.some((wanted) => existing === wanted || existing.includes(wanted) || wanted.includes(existing));
        if (!identityMatches || used.has(pageIndex)) return false;
        if (section !== "experience") return true;
        const pageDescription = sectionFields.find((field) => field.recordIndex === pageIndex && field.key === "description")?.value || "";
        const canonicalDescription = formattedValue(`experience.${profileIndex}.bullets`, record.bullets || [], {});
        const roleValue = sectionFields.find((field) => field.recordIndex === pageIndex && field.key === "role")?.value || "";
        return equivalentValue(roleValue, record.role || "") && normalized(pageDescription) === normalized(canonicalDescription);
      });
      if (match) { profileToPage[profileIndex] = match[0]; used.add(match[0]); }
    });
    const emptyPageIndexes = Array.from({ length: currentCount }, (_, index) => index)
      .filter((pageIndex) => !used.has(pageIndex) && !identities.has(pageIndex));
    let nextIndex = currentCount;
    records.forEach((_record, profileIndex) => {
      if (profileToPage[profileIndex] == null) {
        const reusableIndex = emptyPageIndexes.shift();
        profileToPage[profileIndex] = reusableIndex == null ? nextIndex++ : reusableIndex;
      }
    });
    mapping[section] = Object.fromEntries(Object.entries(profileToPage).map(([profileIndex, pageIndex]) => [pageIndex, Number(profileIndex)]));
    targets[section] = nextIndex;
  }
  return { mapping, targets };
}

function profilePathFor(field, alignment) {
  const basicMap = { name: "basics.name", gender: "basics.gender", birthDate: "basics.birthDate", phone: "basics.phoneNumber", phoneCountry: "basics.phoneCountry", phoneNumber: "basics.phoneNumber", email: "basics.email", idType: "basics.idType", idNumber: "basics.idNumber", nationality: "basics.nationality", hometown: "basics.hometownText", interviewLocation: "basics.interviewLocation", summary: "basics.summary", skills: "skills" };
  if (["basics", "summary", "skills", "other"].includes(field.section) && basicMap[field.key]) return basicMap[field.key];
  const profileIndex = alignment.mapping?.[field.section]?.[field.recordIndex];
  if (profileIndex == null) return null;
  if (field.section === "education") {
    const educationMap = { school: "school", college: "college", schoolLocation: "locationText", major: "major", majorCategory: "majorCategory", degree: "degree", educationType: "educationType", exchange: "exchange", jointProgram: "jointProgram", rank: "rank", gpa: "gpa", advisor: "advisor", nationalKeyLab: "nationalKeyLab", laboratory: "laboratory", start: "start", end: "end" };
    return educationMap[field.key] ? `education.${profileIndex}.${educationMap[field.key]}` : null;
  }
  if (["experience", "work"].includes(field.section)) return ({ company: "company", role: "role", description: "bullets", start: "start", end: "end" }[field.key]) ? `experience.${profileIndex}.${({ company: "company", role: "role", description: "bullets", start: "start", end: "end" })[field.key]}` : null;
  if (field.section === "project") return ({ projectName: "name", projectRole: "type", role: "type", description: "description", link: "url" }[field.key]) ? `projects.${profileIndex}.${({ projectName: "name", projectRole: "type", role: "type", description: "description", link: "url" })[field.key]}` : null;
  if (field.section === "works" && field.key === "link") return "basics.portfolio";
  return null;
}

function formattedValue(path, value, field) {
  let result = value;
  if (Array.isArray(value)) result = value.map((item, index) => `${index + 1}. ${item}`).join("\n");
  if (/\.(start|end)$/.test(path)) result = String(result).replaceAll(".", "-");
  result = String(result ?? "");
  if (field?.maxLength && result.length > field.maxLength) {
    const clipped = result.slice(0, field.maxLength);
    const boundary = Math.max(clipped.lastIndexOf("\n"), clipped.lastIndexOf("。"), clipped.lastIndexOf("；"), clipped.lastIndexOf("！"), clipped.lastIndexOf("？"));
    result = boundary >= Math.floor(field.maxLength * 0.6) ? clipped.slice(0, boundary + 1).trim() : clipped.trim();
  }
  return result;
}

function configuredApiKeys() {
  return [process.env.DASHSCOPE_API_KEY, process.env.DASHSCOPE_API_KEY_FALLBACK]
    .map((key) => String(key || "").trim())
    .filter((key, index, all) => key && key !== "your_dashscope_api_key" && all.indexOf(key) === index);
}

async function qwenRequest(body) {
  const keys = configuredApiKeys();
  if (!keys.length) throw new Error("未配置 DASHSCOPE_API_KEY；请检查 .env 文件。");
  let lastError;
  for (const apiKey of keys) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
      });
      const result = await response.json();
      if (response.ok) return result;
      lastError = new Error(result?.error?.message || `千问接口返回 ${response.status}`);
    } catch (error) { lastError = error; }
  }
  throw new Error(lastError?.name === "TimeoutError" ? "千问请求超时，请检查网络后重试。" : (lastError?.message || "千问请求失败"));
}

async function qwenJson(system, user) {
  const result = await qwenRequest({ model, enable_thinking: false, temperature: 0.1, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
  const raw = result?.choices?.[0]?.message?.content?.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(raw); } catch { throw new Error("千问未返回有效的结构化 JSON"); }
}

async function autoPlan(payload) {
  const profile = await getProfile();
  const memory = await getMemory();
  const fields = Array.isArray(payload.page?.fields) ? payload.page.fields : [];
  const alignment = buildAlignment(fields, profile);
  const plan = [];
  const unresolved = [];
  for (const field of fields.filter((item) => !item.readOnly)) {
    const path = profilePathFor(field, alignment);
    const value = path ? getValue(profile, path) : null;
    if (path && value != null && String(value) !== "待确认") {
      const formatted = formattedValue(path, value, field);
      if (!equivalentValue(formatted, field.value || "")) plan.push({ fieldId: field.id, label: field.label || field.key, section: field.section, recordIndex: field.recordIndex, path, value: formatted, confidence: "high", source: "resume", needsConfirmation: false, reason: "简历主库精确映射" });
      continue;
    }
    const isUnmatchedRepeatedRecord = ["education", "experience", "work", "project"].includes(field.section)
      && Number.isInteger(field.recordIndex)
      && alignment.mapping?.[field.section]?.[field.recordIndex] == null;
    if (isUnmatchedRepeatedRecord) continue;
    const memoryKey = normalized(`${field.section || "other"}:${field.label || field.key}`);
    const remembered = (memory.answers || []).find((entry) => entry.key === memoryKey);
    if (remembered && !String(field.value || "").trim()) {
      plan.push({ fieldId: field.id, label: field.label || field.key, section: field.section, recordIndex: field.recordIndex, value: formattedValue("memory", remembered.value, field), confidence: "high", source: "memory", needsConfirmation: false, reason: "曾在其他表单中保存过" });
    } else if (!String(field.value || "").trim() && (field.required || field.type === "textarea" || ["summary", "skills", "unknown"].includes(field.key))) {
      unresolved.push({ id: field.id, label: field.label, key: field.key, section: field.section, recordIndex: field.recordIndex, type: field.type, maxLength: field.maxLength, required: field.required });
    }
  }

  if (unresolved.length) {
    const catalog = flattenCatalog(profile).map(({ path, label, aliases }) => ({ path, label, aliases }));
    const system = [
      "你是通用招聘表单规划器。根据网页字段语义，将字段映射到简历主库路径，或基于已验证简历事实生成针对性答案。",
      "返回严格 JSON 数组，每项为 {fieldId,path,value,confidence,needsConfirmation,reason}。",
      "path 只能来自候选路径；能映射时只返回 path，不复制值。",
      "只有开放文本字段且可由简历事实合理组织时才生成 value；所有生成 value 必须 needsConfirmation=true。",
      "每个生成的 value 必须严格遵守该字段的 maxLength；适合长文本时用 1.、2.、3. 分点并在句末完整收束。",
      "涉及年龄、证件、地址、政治面貌、薪资等简历未提供的个人事实时，不得猜测，value 为空且 needsConfirmation=true。",
      "confidence 只能是 high、medium、low。不要输出 Markdown。",
      variants[payload.variant] || variants.ai_pm,
      rules
    ].join("\n");
    const aiItems = await qwenJson(system, `网站：${payload.page?.host || "未知"}\n待识别字段：${JSON.stringify(unresolved)}\n候选路径：${JSON.stringify(catalog)}\n简历事实：${JSON.stringify(profileForModel(profile))}\n岗位补充要求：${payload.instruction || "无"}`);
    const validIds = new Set(unresolved.map((item) => item.id));
    const validPaths = new Set(catalog.map((item) => item.path));
    const handled = new Set();
    for (const item of (Array.isArray(aiItems) ? aiItems : [])) {
      if (!validIds.has(item.fieldId)) continue;
      const field = fields.find((candidate) => candidate.id === item.fieldId);
      handled.add(item.fieldId);
      if (item.path && validPaths.has(item.path)) {
        const value = getValue(profile, item.path);
        if (value != null) plan.push({ fieldId: item.fieldId, label: field.label || field.key, section: field.section, recordIndex: field.recordIndex, path: item.path, value: formattedValue(item.path, value, field), confidence: item.confidence || "medium", source: "qwen-map", needsConfirmation: false, reason: item.reason || "千问语义映射" });
      } else {
        plan.push({ fieldId: item.fieldId, label: field.label || field.key, section: field.section, recordIndex: field.recordIndex, value: formattedValue("generated", item.value || "", field), confidence: item.confidence || "low", source: "qwen-generated", needsConfirmation: true, reason: item.reason || "简历无直接字段，需要确认" });
      }
    }
    for (const field of unresolved.filter((item) => !handled.has(item.id))) {
      plan.push({ fieldId: field.id, label: field.label || field.key, section: field.section, recordIndex: field.recordIndex, value: "", confidence: "low", source: "missing", needsConfirmation: true, reason: "简历与千问均未给出可靠答案，请补充并确认" });
    }
  }
  return { alignment, plan };
}
function validateProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("主库必须是 JSON 对象");
  if (!profile.meta || !profile.basics || !Array.isArray(profile.experience)) throw new Error("主库缺少 meta、basics 或 experience 字段");
}
async function saveProfile(profile) {
  validateProfile(profile);
  profile.meta.version = Number(profile.meta.version || 0) + 1;
  profile.meta.updatedAt = new Date().toISOString();
  const temporaryPath = `${profilePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  await rename(temporaryPath, profilePath);
  return profile;
}
async function saveConfig(config) {
  const apiKey = typeof config.apiKey === "string" ? config.apiKey.trim() : "";
  const selectedModel = typeof config.model === "string" ? config.model.trim() : "";
  if (apiKey && !/^sk-[A-Za-z0-9._-]{12,}$/.test(apiKey)) throw new Error("API Key 格式不正确，请粘贴完整的千问 API Key。");
  if (selectedModel && !/^[A-Za-z0-9._-]{2,100}$/.test(selectedModel)) throw new Error("模型名格式不正确。");
  if (apiKey) process.env.DASHSCOPE_API_KEY = apiKey;
  if (selectedModel) { process.env.QWEN_MODEL = selectedModel; model = selectedModel; }
  const keyToPersist = process.env.DASHSCOPE_API_KEY || "";
  const fallbackKeyToPersist = process.env.DASHSCOPE_API_KEY_FALLBACK || "";
  const modelToPersist = process.env.QWEN_MODEL || "qwen3.8-max";
  const content = [
    "# 本地私有配置；由 .gitignore 排除。",
    `DASHSCOPE_API_KEY=${keyToPersist}`,
    `DASHSCOPE_API_KEY_FALLBACK=${fallbackKeyToPersist}`,
    `DASHSCOPE_BASE_URL=${baseUrl}`,
    `QWEN_MODEL=${modelToPersist}`,
    `PORT=${port}`,
    ""
  ].join("\n");
  await writeFile(envPath, content, "utf8");
  return { hasApiKey: Boolean(keyToPersist), model: modelToPersist, baseUrl };
}
function systemPrompt(variant, task, instruction) {
  return [
    "你是严谨的中文求职简历编辑助手。",
    rules,
    variants[variant] || variants.ai_pm,
    `本次字段类型：${task}。`,
    instruction ? `用户补充要求：${instruction}` : "",
    "优先输出 2-3 条；单条 80-220 字。"
  ].filter(Boolean).join("\n");
}
async function compose(payload) {
  const profile = await getProfile();
  const result = await qwenRequest({ model, enable_thinking: false, temperature: 0.25, messages: [
      { role: "system", content: systemPrompt(payload.variant, payload.task, payload.instruction) },
      { role: "user", content: `以下是唯一可使用的简历事实 JSON：\n${JSON.stringify(profileForModel(profile))}\n\n请为当前字段生成候选文案。` }
    ] });
  const text = result?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("千问未返回可用文案");
  return text;
}
async function aiSuggestMappings(payload) {
  const profile = await getProfile();
  const catalog = flattenCatalog(profile).map(({ path, label, aliases }) => ({ path, label, aliases }));
  const fields = Array.isArray(payload.fields) ? payload.fields.map(({ id, label, type }) => ({ id, label, type })) : [];
  if (!fields.length) return [];
  const result = await qwenRequest({ model, enable_thinking: false, temperature: 0, messages: [
      { role: "system", content: "你是招聘表单字段映射器。仅用字段语义进行映射，不要猜测。返回严格 JSON 数组，每项格式为 {fieldId,path,confidence,reason}。path 必须来自候选库；confidence 只能为 high、medium、none。一个含糊字段（如未标明哪个公司/项目的工作内容）必须返回 none。不要输出 Markdown 或其他文字。" },
      { role: "user", content: `招聘站点：${payload.pageUrl || "未知"}\n网页字段（不含用户填写值）：${JSON.stringify(fields)}\n候选简历字段：${JSON.stringify(catalog)}` }
    ] });
  const raw = result?.choices?.[0]?.message?.content?.replace(/^```json\s*|```$/g, "").trim();
  let mapped;
  try { mapped = JSON.parse(raw); } catch { throw new Error("千问未按 JSON 格式返回字段建议"); }
  const validPaths = new Set(catalog.map((item) => item.path));
  const validIds = new Set(fields.map((item) => item.id));
  return (Array.isArray(mapped) ? mapped : []).filter((item) => validIds.has(item.fieldId) && validPaths.has(item.path) && ["high", "medium"].includes(item.confidence)).map((item) => ({ ...item, value: getValue(profile, item.path) }));
}

createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") return send(request, response, 204, {});
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (request.method === "GET" && url.pathname === "/api/health") return send(request, response, 200, { ok: true, model });
    if (request.method === "GET" && url.pathname === "/api/config") return send(request, response, 200, { hasApiKey: configuredApiKeys().length > 0, model: process.env.QWEN_MODEL || model, baseUrl });
    if (request.method === "PUT" && url.pathname === "/api/config") return send(request, response, 200, await saveConfig(await readBody(request)));
    if (request.method === "GET" && url.pathname === "/api/profile") return send(request, response, 200, { profile: await getProfile(), model });
    if (request.method === "PUT" && url.pathname === "/api/profile") return send(request, response, 200, { profile: await saveProfile((await readBody(request)).profile) });
    if (request.method === "POST" && url.pathname === "/api/compose") return send(request, response, 200, { text: await compose(await readBody(request)), model });
    if (request.method === "POST" && url.pathname === "/api/match-fields") {
      const payload = await readBody(request);
      return send(request, response, 200, { suggestions: deterministicMatches(payload.fields || [], await getProfile(), payload.pageUrl) });
    }
    if (request.method === "POST" && url.pathname === "/api/ai-match-fields") {
      const payload = await readBody(request);
      return send(request, response, 200, { suggestions: await aiSuggestMappings(payload) });
    }
    if (request.method === "POST" && url.pathname === "/api/align-form") {
      const payload = await readBody(request);
      return send(request, response, 200, buildAlignment(payload.fields || [], await getProfile()));
    }
    if (request.method === "POST" && url.pathname === "/api/auto-plan") return send(request, response, 200, await autoPlan(await readBody(request)));
    if (request.method === "GET" && url.pathname === "/api/memory") return send(request, response, 200, await getMemory());
    if (request.method === "PUT" && url.pathname === "/api/memory") return send(request, response, 200, await saveMemory((await readBody(request)).entries));
    return send(request, response, 404, { error: "接口不存在" });
  } catch (error) {
    return send(request, response, 400, { error: error instanceof Error ? error.message : "未知错误" });
  }
}).listen(port, "127.0.0.1", () => console.log(`求职简历助手 API: http://127.0.0.1:${port}`));
