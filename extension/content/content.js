(() => {
  if (window.__recruitmentCopilotV2) return;
  window.__recruitmentCopilotV2 = true;

  const FIELD_SELECTOR = "input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable=true]";
  const SECTION_NAMES = ["个人信息", "基本信息", "教育经历", "实习经历", "工作经历", "工作/实习经历", "项目经历", "公司内部亲属关系", "英语能力", "其他外语能力", "计算机能力", "获奖情况", "证书", "作品", "语言能力", "自我评价", "个人优势", "其他技能/证书"];
  let highlighted;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value = "") => String(value).replace(/\s+/g, " ").trim();
  const norm = (value = "") => clean(value).toLowerCase().replace(/[：:*＊（）()【】\[\]·、，,。.!！?？\s]/g, "");

  function directText(element) {
    return clean([...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(" "));
  }

  function parseStructuredId(id = "") {
    const match = id.match(/^(education|internship|experience|work|project|works|language)\[(\d+)]\.(.+)$/i);
    if (!match) return {};
    const map = { internship: "experience", experience: "experience", work: "work", education: "education", project: "project", works: "works", language: "language" };
    return { section: map[match[1].toLowerCase()], recordIndex: Number(match[2]), rawKey: match[3] };
  }

  function explicitLabel(element) {
    const id = element.id;
    const label = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
    const labelled = element.getAttribute("aria-labelledby")?.split(/\s+/).map((key) => document.getElementById(key)?.textContent || "").join(" ");
    if (label?.textContent || labelled) return clean(label?.textContent || labelled);
    const formilyLabel = element.closest(".ud-formily-item")?.querySelector(".ud-formily-item-label,.ud-formily-item-label-content");
    if (formilyLabel?.textContent) return clean(formilyLabel.textContent);
    let cursor = element;
    for (let depth = 0; depth < 9 && cursor; depth += 1, cursor = cursor.parentElement) {
      const className = String(cursor.className || "");
      if (/form-item|formily-item|field|control/i.test(className)) {
        const candidates = [...cursor.querySelectorAll("label,[class*=label],[class*=title]")]
          .map((node) => clean(node.textContent)).filter((text) => text && text.length < 80);
        if (candidates.length) return candidates[0];
        const own = directText(cursor);
        if (own && own.length < 80) return own;
      }
    }
    return clean(element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.name || element.id || "");
  }

  function headingItems() {
    return [...document.querySelectorAll("h1,h2,h3,h4,h5,p,div,[role=heading],.module-title,.applyFormModuleWrapper-title,[class*=title]")]
      .map((node) => ({ node, text: clean(node.textContent) }))
      .filter((item) => item.text.length <= 60 && SECTION_NAMES.some((name) => item.text === name || item.text.includes(name)));
  }

  function sectionFromText(text) {
    if (/工作\/实习|实习/.test(text)) return "experience";
    if (/工作经历/.test(text)) return location.hostname.includes("vivo.com") ? "experience" : "work";
    if (/教育/.test(text)) return "education";
    if (/项目/.test(text)) return "project";
    if (/作品/.test(text)) return "works";
    if (/英语能力|其他外语能力|语言/.test(text)) return "language";
    if (/计算机能力|证书/.test(text)) return "skills";
    if (/亲属|获奖/.test(text)) return "other";
    if (/个人信息|基本/.test(text)) return "basics";
    if (/自我评价|个人优势/.test(text)) return "summary";
    if (/技能/.test(text)) return "skills";
    return "other";
  }

  function nearestSection(element) {
    const parsed = parseStructuredId(element.id);
    if (parsed.section) return parsed.section;
    let match = "";
    for (const item of headingItems()) if (item.node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) match = item.text;
    return sectionFromText(match);
  }

  function semanticKey(element, label, parsed) {
    const dateRange = element.closest(".throne-biz-date-range-picker-wrapper");
    if (dateRange) {
      const inputs = [...dateRange.querySelectorAll("input")];
      return inputs.indexOf(element) === 0 ? "start" : "end";
    }
    const source = norm(`${parsed.rawKey || ""} ${element.id || ""} ${element.name || ""} ${label}`);
    if (element.type === "checkbox" && (/至今|目前|在职/.test(optionText(element)) ||
      (location.hostname.includes("vivo.com") && /结束时间/.test(label)))) return "current";
    if (/导师|advisor|supervisor/.test(source)) return "advisor";
    if (/firstname|fullname|姓名|^name$/.test(source) && !/学校|项目/.test(source)) return "name";
    if (/国家区号|手机区号|电话区号|countrycode/.test(source)) return "phoneCountry";
    if (/mobile|phone|手机|联系电话/.test(source)) return /^\d{6,}$/.test(String(element.value || "").replace(/\D/g, "")) ? "phoneNumber" : "phone";
    if (/email|邮箱/.test(source)) return "email";
    if (/gender|性别/.test(source)) return "gender";
    if (/birth|出生/.test(source)) return "birthDate";
    if (/\d{15,}/.test(String(element.value || "")) || /idcard|证件号码|身份证号码/.test(source)) return "idNumber";
    if (/证件类型|个人证件|idtype|identificationtype|identification/.test(source)) return "idType";
    if (/nationality|国籍|国家地区/.test(source)) return "nationality";
    if (/籍贯|家乡|hometown/.test(source)) return "hometown";
    if (/意向面试地点|面试地点/.test(source)) return "interviewLocation";
    if (/学校所在地|院校所在地/.test(source)) return "schoolLocation";
    if (/school|学校|院校/.test(source)) return "school";
    if (/所在院系|研究所|学院|院系|college|department/.test(source)) return "college";
    if (/专业类别|专业大类/.test(source)) return "majorCategory";
    if (/fieldofstudy|major|专业/.test(source)) return "major";
    if (/educationtype|学历类型|受教育类型|培养方式/.test(source)) return "educationType";
    if (/degree|学历/.test(source) && !/类型/.test(source)) return "degree";
    if (/联合办学|jointprogram/.test(source)) return "jointProgram";
    if (/交流学习|exchange/.test(source)) return "exchange";
    if (/gpa|cgpa/.test(source)) return "gpa";
    if (/年级成绩排名|成绩排名|ranking/.test(source)) return "rank";
    if (/是否国家重点实验室|国家重点实验室/.test(source)) return "nationalKeyLab";
    if (/实验室/.test(source)) return "laboratory";
    if (/company|公司/.test(source)) return "company";
    if (/projectname|项目名称/.test(source)) return "projectName";
    if (/projectrole|项目角色/.test(source)) return "projectRole";
    if (/position|title|职位|岗位|职务/.test(source)) return "role";
    if (/link|url|链接|作品集/.test(source)) return "link";
    if (/description|desc|描述|职责|内容/.test(source)) return "description";
    if (/startendtime|起止时间|daterange/.test(source)) return "dateRange";
    if (/start|开始时间/.test(source)) return "start";
    if (/end|结束时间/.test(source)) return "end";
    if (/summary|自我评价|个人优势/.test(source)) return "summary";
    if (/skill|技能/.test(source)) return "skills";
    return parsed.rawKey || norm(label || element.id || element.name).slice(0, 60) || "unknown";
  }

  function fieldValue(element) {
    if (element.type === "radio") {
      const group = element.name ? [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(element.name)}"]`)] : [element];
      const checked = group.find((item) => item.checked);
      return checked ? optionText(checked) : "";
    }
    if (element.type === "checkbox") return element.checked ? (optionText(element) || "是") : "否";
    const selected = customSelectedText(element);
    if (selected) return selected;
    return element.value ?? element.textContent ?? "";
  }

  function recordCardFor(element) {
    if (location.hostname.includes("vivo.com")) {
      const form = element.closest(".ux-standard-form");
      if (form) return form.parentElement?.parentElement?.parentElement || form;
    }
    return element.closest(".register-form-group-wrapper,[class*=form-array-card-content],[class*=array-card-content],.form-part");
  }

  function customSelectRoot(element) {
    return element.closest(".atsx-select-selection,.ant-select,.semi-select,.el-select,.ud__select,[role=combobox]");
  }

  function customSelectedText(element) {
    const root = customSelectRoot(element);
    if (!root) return "";
    const selected = root.querySelector("[data-cy=selectedValue],.atsx-select-selection-selected-value,.ant-select-selection-item,.semi-select-selection-text,.el-select__selected-item,.ud__select__selector__content");
    return clean(selected?.textContent || "");
  }

  function optionText(element) {
    const associated = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
    const wrapped = element.closest("label");
    const nearby = element.parentElement;
    return clean(associated?.textContent || wrapped?.textContent || element.getAttribute("aria-label") || nearby?.textContent || element.value || "");
  }

  function discover() {
    const seenRadioGroups = new Set();
    const elements = [...document.querySelectorAll(FIELD_SELECTOR)].filter((element) => {
      if (element.closest(".resumeEditForm-hiddenField,[aria-hidden=true]")) return false;
      if (element.closest(".phoenix-unmodeled-layer")) return false;
      if (element.type === "search" && !element.id && !element.getAttribute("aria-label")) return false;
      if (element.type === "radio" && element.name) {
        if (seenRadioGroups.has(element.name)) return false;
        seenRadioGroups.add(element.name);
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0 || Boolean(element.id) || ["radio", "checkbox"].includes(element.type);
    });
    const recordCards = new Map();
    const fields = elements.map((element, order) => {
      element.dataset.recruitmentId ||= `recruitment-${Date.now()}-${order}`;
      const parsed = parseStructuredId(element.id);
      const label = explicitLabel(element);
      const section = parsed.section || nearestSection(element);
      let recordIndex = Number.isInteger(parsed.recordIndex) ? parsed.recordIndex : null;
      if (recordIndex == null && ["education", "experience", "work", "project", "works", "language"].includes(section)) {
        const card = recordCardFor(element);
        if (card) {
          if (!recordCards.has(section)) recordCards.set(section, []);
          const cards = recordCards.get(section);
          if (!cards.includes(card)) cards.push(card);
          recordIndex = cards.indexOf(card);
        }
      }
      return {
        id: element.dataset.recruitmentId,
        domId: element.id || "",
        label,
        type: element.tagName.toLowerCase() === "textarea" ? "textarea" : element.type || element.tagName.toLowerCase(),
        value: fieldValue(element),
        section,
        recordIndex,
        key: semanticKey(element, label, parsed),
        required: element.required || /\*/.test(label),
        maxLength: element.maxLength > 0 ? element.maxLength : null,
        readOnly: element.readOnly || element.disabled || Boolean(element.closest(".ud__select__selector-readOnly,[aria-readonly=true]"))
      };
    });
    const occurrence = new Map();
    for (const field of fields) {
      const compound = `${field.section}:${field.key}`;
      const index = occurrence.get(compound) || 0;
      if (field.recordIndex == null && ["education", "experience", "work", "project", "works", "language"].includes(field.section)) field.recordIndex = field.key === "dateRange" ? index : index;
      occurrence.set(compound, index + 1);
    }
    return fields;
  }

  function sectionForButton(button) {
    let text = "";
    for (const item of headingItems()) if (item.node.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) text = item.text;
    return sectionFromText(text);
  }

  function discoverRepeaters(fields = discover()) {
    const counts = {};
    for (const field of fields) if (field.recordIndex != null) counts[field.section] = Math.max(counts[field.section] || 0, field.recordIndex + 1);
    const candidates = [...document.querySelectorAll("button,[role=button],a,span,div")].filter((element) => {
      const text = clean(element.textContent);
      return /^(\+\s*)?(添加|新增)\s*(一条|经历|教育|项目|教育经历|实习经历|工作经历|项目经历)?$/.test(text) && element.getBoundingClientRect().width > 0;
    }).filter((element) => ![...element.children].some((child) => /添加|新增/.test(clean(child.textContent))));
    const repeaters = [];
    for (const candidate of candidates) {
      const button = candidate.closest("button,[role=button],a") || candidate;
      const section = /教育经历|实习经历|工作经历|项目经历/.test(clean(button.textContent)) ? sectionFromText(clean(button.textContent)) : sectionForButton(button);
      if (section === "other" || repeaters.some((item) => item.section === section)) continue;
      button.dataset.recruitmentAddId ||= `recruitment-add-${repeaters.length}-${Date.now()}`;
      repeaters.push({ id: button.dataset.recruitmentAddId, section, currentCount: counts[section] || 0, label: clean(button.textContent) || "添加" });
    }
    return repeaters;
  }

  function nativeSetter(element, value) {
    const prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter ? setter.call(element, value) : (element.value = value);
    ["input", "change", "blur"].forEach((type) => element.dispatchEvent(new Event(type, { bubbles: true })));
  }

  async function setValue(element, value) {
    const text = Array.isArray(value) ? value.map((item, index) => `${index + 1}. ${item}`).join("\n") : String(value ?? "");
    if (element.type === "radio") {
      const group = element.name ? [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(element.name)}"]`)] : [element];
      const wanted = norm(text);
      const option = group.find((item) => {
        const candidate = norm(optionText(item));
        return candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate) || norm(item.value) === wanted;
      });
      if (!option) throw new Error(`单选项中未找到“${text}”`);
      if (!option.checked) option.click();
      option.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (element.type === "checkbox") {
      const shouldCheck = /^(是|true|1|yes|选中)$/i.test(text.trim());
      if (element.checked !== shouldCheck) element.click();
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const customRoot = customSelectRoot(element);
    if (customRoot) {
      const wantedParts = text.split(/\s*(?:\/|／|,|，)\s*/).map(clean).filter(Boolean);
      const current = norm(customSelectedText(element));
      if (current && wantedParts.every((part) => current.includes(norm(part)))) return;
      const isOpen = customRoot.getAttribute("aria-expanded") === "true" || /(?:^|\s)(?:atsx|ant|semi|el)-select-open(?:\s|$)/.test(String(customRoot.parentElement?.className || ""));
      if (!isOpen) customRoot.click();
      await delay(100);
      for (let partIndex = 0; partIndex < wantedParts.length; partIndex += 1) {
        const part = wantedParts[partIndex];
        const options = [...document.querySelectorAll("[role=option],[role=treeitem],.atsx-select-dropdown-menu-item,.atsx-tree-node-content-wrapper,.ant-select-item-option,.semi-select-option,.el-select-dropdown__item,.ud__select-option,.ud__select__option")]
          .filter((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; });
        const wanted = norm(part);
        const option = options.find((node) => norm(node.textContent) === wanted)
          || options.find((node) => norm(node.textContent).includes(wanted) || wanted.includes(norm(node.textContent)));
        if (!option) throw new Error(`下拉框中未找到“${part}”`);
        const treeItem = option.matches("[role=treeitem]") ? option : option.closest("[role=treeitem]");
        if (treeItem && partIndex < wantedParts.length - 1) {
          const switcher = treeItem.querySelector(".atsx-tree-switcher_close,.ant-select-tree-switcher_close,[aria-label*=caret]");
          if (switcher) switcher.click();
          else (treeItem.querySelector(".atsx-tree-node-content-wrapper,.ant-select-tree-node-content-wrapper") || treeItem).click();
        } else {
          (treeItem?.querySelector(".atsx-tree-node-content-wrapper,.ant-select-tree-node-content-wrapper") || option).click();
        }
        await delay(120);
      }
      const chosen = norm(customSelectedText(element));
      const finalPart = norm(wantedParts.at(-1)).replace(/(特别行政区|自治区|省|市)$/g, "");
      const chosenComparable = chosen.replace(/(特别行政区|自治区|省|市)$/g, "");
      if (!chosenComparable || !chosenComparable.includes(finalPart)) throw new Error("下拉框选中值未稳定写入");
      return;
    }
    if (element.tagName === "SELECT") {
      const option = [...element.options].find((item) => norm(item.textContent) === norm(text) || item.value === text);
      if (!option) throw new Error("下拉框没有完全匹配的选项");
      element.value = option.value; element.dispatchEvent(new Event("change", { bubbles: true })); return;
    }
    if (element.isContentEditable) {
      element.focus(); document.execCommand("selectAll", false, null); document.execCommand("insertText", false, text);
      element.dispatchEvent(new Event("input", { bubbles: true })); return;
    }
    nativeSetter(element, text);
    await delay(0);
    const actual = norm(fieldValue(element));
    const expected = norm(text);
    if (!(actual === expected || (actual && expected && (actual.includes(expected) || expected.includes(actual))))) throw new Error("网页控件拒绝了普通文本赋值");
  }

  async function ensureRecords(targets = {}) {
    const added = [];
    for (const [section, desired] of Object.entries(targets)) {
      for (let guard = 0; guard < 12; guard += 1) {
        const fields = discover();
        const current = Math.max(0, ...fields.filter((field) => field.section === section && field.recordIndex != null).map((field) => field.recordIndex + 1));
        if (current >= desired) break;
        const repeater = discoverRepeaters(fields).find((item) => item.section === section);
        const button = repeater && document.querySelector(`[data-recruitment-add-id="${CSS.escape(repeater.id)}"]`);
        if (!button) throw new Error(`未找到“${section}”区块的添加按钮`);
        button.click(); added.push(section); await delay(200);
      }
    }
    const fields = discover();
    return { added, fields, repeaters: discoverRepeaters(fields) };
  }

  async function executePlan(items = []) {
    const results = [];
    for (const item of items) {
      const element = document.querySelector(`[data-recruitment-id="${CSS.escape(item.fieldId)}"]`);
      if (!element) { results.push({ fieldId: item.fieldId, ok: false, error: "字段不存在" }); continue; }
      try { await setValue(element, item.value); results.push({ fieldId: item.fieldId, ok: true }); }
      catch (error) { results.push({ fieldId: item.fieldId, ok: false, error: error.message }); }
    }
    return results;
  }

  // Kept inside Chrome's isolated content-script world for real-site compatibility tests.
  window.__recruitmentCopilotTest = { discover, discoverRepeaters, ensureRecords, executePlan };

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    (async () => {
      if (message.type === "RECRUITMENT_ANALYZE" || message.type === "RECRUITMENT_DISCOVER") {
        const fields = discover();
        return { ok: true, page: { url: location.href, title: document.title, host: location.host, fields, repeaters: discoverRepeaters(fields) }, fields };
      }
      if (message.type === "RECRUITMENT_ENSURE_RECORDS") return { ok: true, ...(await ensureRecords(message.targets || {})) };
      if (message.type === "RECRUITMENT_EXECUTE_PLAN") return { ok: true, results: await executePlan(message.items || []) };
      if (message.type === "RECRUITMENT_HIGHLIGHT") {
        highlighted?.style.removeProperty("outline");
        highlighted = document.querySelector(`[data-recruitment-id="${CSS.escape(message.id)}"]`);
        if (highlighted) { highlighted.style.outline = "2px solid #2563eb"; highlighted.scrollIntoView({ behavior: "smooth", block: "center" }); }
        return { ok: Boolean(highlighted) };
      }
      if (message.type === "RECRUITMENT_FILL") {
        const results = await executePlan([{ fieldId: message.id, value: message.value }]);
        return { ok: Boolean(results[0]?.ok), error: results[0]?.error, results };
      }
      return { ok: false, error: "未知消息" };
    })().then(respond).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  });
})();
