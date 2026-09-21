(() => {
  if (window.__recruitmentCopilotV2) return;
  window.__recruitmentCopilotV2 = true;

  const FIELD_SELECTOR = "input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable=true], [role=textbox]:not(input):not(textarea)";
  const SECTION_NAMES = ["个人信息", "基本信息", "基础信息", "个人资料", "教育经历", "教育背景", "学习经历", "实习经历", "工作经历", "工作经验", "工作/实习经历", "校园经历", "校园实践", "社团经历", "项目经历", "项目经验", "实践经历", "公司内部亲属关系", "英语能力", "其他外语能力", "计算机能力", "专业技能", "获奖情况", "荣誉奖励", "证书", "作品", "语言能力", "语言/证书/技能", "自我评价", "自我介绍", "个人优势", "其他技能/证书"];
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
        const candidates = [...cursor.querySelectorAll("label,[class*=label],[class*=title],[class*=filedName]")]
          .map((node) => clean(node.textContent)).filter((text) => text && text.length < 80);
        if (candidates.length) return candidates[0];
        const own = directText(cursor);
        if (own && own.length < 80) return own;
      }
    }
    const described = element.getAttribute("aria-describedby")?.split(/\s+/).map((key) => document.getElementById(key)?.textContent || "").join(" ");
    return clean(element.getAttribute("aria-label") || described || element.getAttribute("placeholder") || element.name || element.id || "");
  }

  function headingItems() {
    return [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,legend,dt,p,div,[role=heading],.module-title,.applyFormModuleWrapper-title,[class*=title],[class*=Title]")]
      .map((node) => ({ node, text: clean(node.textContent) }))
      .filter((item) => item.text.length <= 60 && SECTION_NAMES.some((name) => item.text === name || item.text.includes(name)));
  }

  function sectionFromText(text, headings = null) {
    if (/工作\/实习|实习/.test(text)) return "experience";
    if (/工作经历|工作经验/.test(text)) {
      const hasSeparateInternshipSection = (headings || headingItems()).some((item) => /实习经历|实习经验/.test(item.text));
      return location.hostname.includes("vivo.com") || !hasSeparateInternshipSection ? "experience" : "work";
    }
    if (/教育|学习经历/.test(text)) return "education";
    if (/校园经历|校园实践|社团经历/.test(text)) return "campus";
    if (/项目|实践经历/.test(text)) return "project";
    if (/作品/.test(text)) return "works";
    if (/英语能力|其他外语能力|语言/.test(text)) return "language";
    if (/计算机能力|专业技能|证书/.test(text)) return "skills";
    if (/亲属|获奖|荣誉/.test(text)) return "other";
    if (/个人信息|个人资料|基本|基础/.test(text)) return "basics";
    if (/自我评价|自我介绍|个人优势/.test(text)) return "summary";
    if (/技能/.test(text)) return "skills";
    return "other";
  }

  function nearestSection(element, headings = headingItems()) {
    const parsed = parseStructuredId(element.id);
    if (parsed.section) return parsed.section;
    let match = "";
    for (const item of headings) if (item.node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) match = item.text;
    return sectionFromText(match, headings);
  }

  function semanticKey(element, label, parsed) {
    const dateRange = element.closest(".throne-biz-date-range-picker-wrapper,[class*=dateRangePicker]");
    if (dateRange) {
      const inputs = [...dateRange.querySelectorAll("input")];
      return inputs.indexOf(element) === 0 ? "start" : "end";
    }
    const source = norm(`${parsed.rawKey || ""} ${element.id || ""} ${element.name || ""} ${label}`);
    if (location.hostname.includes("join.qq.com") && /选择日期/.test(label)) {
      const card = element.closest(".info_list");
      const dates = card ? [...card.querySelectorAll("input")].filter((item) => /选择日期/.test(explicitLabel(item))) : [];
      if (dates.includes(element)) return dates.indexOf(element) === 0 ? "start" : "end";
    }
    if (/紧急联系人.*姓名|姓名.*紧急联系人/.test(source)) return "emergencyContactName";
    if (/紧急联系人.*电话|电话.*紧急联系人/.test(source)) return "emergencyContactPhone";
    if (/所在院校的满绩绩点|满绩/.test(source)) return "gpaScale";
    if (element.type === "radio" && /男|女|性别/.test(source)) return "gender";
    if (element.type === "checkbox" && (/至今|目前|在职/.test(optionText(element)) ||
      (location.hostname.includes("vivo.com") && /结束时间/.test(label)))) return "current";
    if (/导师|advisor|supervisor/.test(source)) return "advisor";
    if (/firstname|fullname|姓名|^name$/.test(source) && !/学校|项目/.test(source) || element.id === "name") return "name";
    if (/国家区号|手机区号|电话区号|countrycode/.test(source)) return "phoneCountry";
    if (/mobile|phone|手机|联系电话|联系方式/.test(source)) return /^\d{6,}$/.test(String(element.value || "").replace(/\D/g, "")) ? "phoneNumber" : "phone";
    if (/email|邮箱/.test(source)) return "email";
    if (/gender|性别/.test(source)) return "gender";
    if (/birth|出生/.test(source)) return "birthDate";
    if (/\d{15,}/.test(String(element.value || "")) || /idcard|证件号码|身份证号码/.test(source)) return "idNumber";
    if (/证件类型|个人证件|idtype|identificationtype|identification/.test(source)) return "idType";
    if (/nationality|国籍|国家地区/.test(source)) return "nationality";
    if (/籍贯|家乡|hometown/.test(source)) return "hometown";
    if (/意向面试地点|面试地点|面试城市/.test(source)) return "interviewLocation";
    if (/学校所在地|院校所在地|目前就读地|就读城市/.test(source)) return "schoolLocation";
    if (/school|学校|院校|毕业院校/.test(source)) return "school";
    if (/所在院系|研究所|学院|院系|college|department/.test(source)) return "college";
    if (/专业类别|专业大类/.test(source)) return "majorCategory";
    if (/fieldofstudy|major|专业/.test(source)) return "major";
    if (/educationtype|学历类型|受教育类型|培养方式/.test(source)) return "educationType";
    if (/是否最高学历/.test(source)) return "isHighestDegree";
    if (/degree|学历/.test(source) && !/类型/.test(source)) return "degree";
    if (/联合办学|jointprogram/.test(source)) return "jointProgram";
    if (/交流学习|exchange/.test(source)) return "exchange";
    if (/gpa|cgpa|绩点/.test(source) && !/满绩/.test(source)) return "gpa";
    if (/年级成绩排名|成绩排名|ranking/.test(source)) return "rank";
    if (/是否国家重点实验室|国家重点实验室/.test(source)) return "nationalKeyLab";
    if (/实验室/.test(source)) return "laboratory";
    if (/company|公司|单位名称|实习单位|工作单位|任职单位|雇主/.test(source)) return "company";
    if (/projectname|项目名称|项目名/.test(source)) return "projectName";
    if (/projectrole|项目角色|项目中担任的角色|担任角色/.test(source)) return "projectRole";
    if (/position|title|职位|岗位|职务|任职角色/.test(source)) return "role";
    if (/link|url|链接|作品集/.test(source)) return "link";
    if (/description|desc|描述|职责|内容|主要工作|工作成果|项目介绍/.test(source)) return "description";
    if (/startendtime|起止时间|daterange/.test(source)) return "dateRange";
    if (/start|开始时间|开始日期|起始时间|起始日期|入学时间|入职时间/.test(source)) return "start";
    if (/end|结束时间|结束日期|截止时间|截止日期|毕业时间|离职时间/.test(source)) return "end";
    if (/summary|自我评价|自我介绍|个人优势|个人简介/.test(source)) return "summary";
    if (/skill|技能/.test(source)) return "skills";
    return parsed.rawKey || norm(label || element.id || element.name).slice(0, 60) || "unknown";
  }

  function fieldValue(element) {
    if (element.type === "radio") {
      const group = element.name ? [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(element.name)}"]`)] :
        [...(element.closest("[class*=fieldItem],.form-item,.ud-formily-item") || element.parentElement).querySelectorAll("input[type=radio]")];
      const checked = group.find((item) => item.checked);
      return checked ? optionText(checked) : "";
    }
    if (element.type === "checkbox") return element.checked ? (optionText(element) || "是") : "否";
    const selected = customSelectedText(element);
    if (selected) return selected;
    return element.value ?? element.textContent ?? "";
  }

  function recordCardFor(element) {
    if (location.hostname.includes("campus.jd.com")) return element.closest("[class*=formGroupItem]");
    if (location.hostname.includes("join.qq.com")) return element.closest(".info_list");
    if (location.hostname.includes("vivo.com")) {
      const form = element.closest(".ux-standard-form");
      if (form) return form.parentElement?.parentElement?.parentElement || form;
    }
    const known = element.closest([
      ".register-form-group-wrapper", "[class*=form-array-card-content]", "[class*=array-card-content]", ".form-part",
      "[data-record-index]", "[data-item-index]", "[class*=formGroupItem]", "[class*=educationItem]",
      "[class*=experienceItem]", "[class*=projectItem]", "[class*=recordItem]", "[class*=resumeItem]"
    ].join(","));
    if (known) return known;

    // Generic fallback: repeated records are usually sibling containers with the same class,
    // while ordinary field rows contain only one control. This avoids relying on a company's CSS name.
    let cursor = element.parentElement;
    for (let depth = 0; cursor && depth < 9; depth += 1, cursor = cursor.parentElement) {
      const controls = cursor.querySelectorAll(FIELD_SELECTOR).length;
      if (controls < 2 || controls > 40 || !cursor.parentElement) continue;
      const className = String(cursor.className || "");
      const siblings = [...cursor.parentElement.children].filter((node) =>
        node.tagName === cursor.tagName && String(node.className || "") === className &&
        node.querySelectorAll?.(FIELD_SELECTOR).length >= 2
      );
      if (siblings.length >= 2) return cursor;
    }
    return null;
  }

  function customSelectRoot(element) {
    return element.closest(".atsx-select-selection,.ant-select,.ant-cascader-picker,.semi-select,.el-select,.arco-select,.arco-select-view,.ud__select,[class*=select-selector],[role=combobox]");
  }

  function customSelectedText(element) {
    const root = customSelectRoot(element);
    if (!root) return "";
    const selected = root.querySelector("[data-cy=selectedValue],.atsx-select-selection-selected-value,.ant-select-selection-item,.ant-cascader-picker-label,.semi-select-selection-text,.el-select__selected-item,.arco-select-view-value,.ud__select__selector__content");
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
    const headings = headingItems();
    const elements = [...document.querySelectorAll(FIELD_SELECTOR)].filter((element) => {
      if (element.closest(".resumeEditForm-hiddenField,[aria-hidden=true]")) return false;
      if (element.closest(".phoenix-unmodeled-layer")) return false;
      if (element.type === "search" && !element.id && !element.getAttribute("aria-label")) return false;
      if (element.type === "radio") {
        const radioKey = element.name || element.closest("[class*=fieldItem],.form-item,.ud-formily-item");
        if (seenRadioGroups.has(radioKey)) return false;
        seenRadioGroups.add(radioKey);
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0 || Boolean(element.id) || ["radio", "checkbox"].includes(element.type);
    });
    const recordCards = new Map();
    const fields = elements.map((element, order) => {
      element.dataset.recruitmentId ||= `recruitment-${Date.now()}-${order}`;
      const parsed = parseStructuredId(element.id);
      const label = explicitLabel(element);
      const section = parsed.section || nearestSection(element, headings);
      const key = semanticKey(element, label, parsed);
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
        key,
        required: element.required || /\*/.test(label),
        maxLength: element.maxLength > 0 ? element.maxLength : null,
        readOnly: element.disabled || (element.readOnly && !["start", "end", "birthDate", "dateRange"].includes(key)) || Boolean(element.closest(".ud__select__selector-readOnly,[aria-readonly=true]"))
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

  function sectionForButton(button, headings = headingItems()) {
    let text = "";
    for (const item of headings) if (item.node.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) text = item.text;
    return sectionFromText(text, headings);
  }

  function discoverRepeaters(fields = discover()) {
    const headings = headingItems();
    const counts = {};
    for (const field of fields) if (field.recordIndex != null) counts[field.section] = Math.max(counts[field.section] || 0, field.recordIndex + 1);
    const candidates = [...document.querySelectorAll("button,[role=button],a,span,div")].filter((element) => {
      const text = clean(element.textContent);
      return /^(\+\s*)?(添加|新增|继续添加)\s*(一条|一项|更多|记录|经历|教育|学历|项目|教育经历|实习经历|工作经历|工作经验|项目经历|项目经验)?$/.test(text) && element.getBoundingClientRect().width > 0;
    }).filter((element) => ![...element.children].some((child) => /添加|新增/.test(clean(child.textContent))));
    const repeaters = [];
    for (const candidate of candidates) {
      const button = candidate.closest("button,[role=button],a") || candidate;
      const section = /学历|教育经历|实习经历|工作经历|工作经验|项目经历|项目经验/.test(clean(button.textContent)) ? (/学历/.test(clean(button.textContent)) ? "education" : sectionFromText(clean(button.textContent), headings)) : sectionForButton(button, headings);
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

  function normalizedDate(value, key) {
    const matched = String(value || "").trim().replace(/[./]/g, "-").match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
    if (!matched) return "";
    const year = Number(matched[1]);
    const month = Number(matched[2]);
    const lastDay = new Date(year, month, 0).getDate();
    // Month-only resume data has no truthful day precision. Use the first day
    // for date pickers that require a complete date instead of inventing a
    // different end-of-month value.
    const day = matched[3] ? Number(matched[3]) : 1;
    const date = new Date(year, month - 1, day);
    if (month < 1 || month > 12 || day < 1 || day > lastDay || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function visibleElement(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function fieldMatchesPlanItem(field, item, strictKey = true) {
    if (!field) return false;
    if (item.section && field.section !== item.section) return false;
    if (Number.isInteger(item.recordIndex) && field.recordIndex !== item.recordIndex) return false;
    if (strictKey && item.key && item.key !== "unknown" && field.key !== item.key) return false;
    if ((!item.key || item.key === "unknown") && item.label && norm(field.label) !== norm(item.label)) return false;
    return true;
  }

  function freshFieldValue(item, fallbackElement) {
    const field = discover().find((candidate) => fieldMatchesPlanItem(candidate, item, true));
    return field ? field.value : fieldValue(fallbackElement);
  }

  async function dismissDatePicker() {
    const pickerContainers = [...document.querySelectorAll([
      ".ant-calendar-picker-container",
      ".ant-picker-dropdown",
      ".el-picker-panel",
      ".arco-picker-container",
      ".semi-portal"
    ].join(","))];
    const visibleEditors = [...document.querySelectorAll([
      ".ant-calendar-picker-container .ant-calendar-input",
      ".ant-picker-dropdown input",
      ".el-picker-panel input",
      ".arco-picker-container input",
      ".semi-portal input"
    ].join(","))].filter((candidate) => visibleElement(candidate));
    if (visibleEditors.length || pickerContainers.length) {
      // Clicking outside commits the value currently shown in the picker and
      // closes it. Avoid Escape/blur: some Ant Design builds restore and then
      // commit an earlier record's value during that combination.
      document.body.click();
      // Ant Design keeps a leaving popup interactive for roughly 300 ms.
      // Wait past that transition so the next record cannot inherit it.
      await delay(650);
    }
  }

  function matchingDateCell(date) {
    const titles = [
      `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`,
      date
    ];
    return [...document.querySelectorAll("[role=gridcell][title],td[title]")]
      .find((candidate) => visibleElement(candidate) && titles.includes(candidate.getAttribute("title")) && candidate.getAttribute("aria-disabled") !== "true");
  }

  async function setDatePickerValue(element, value, item = {}) {
    const date = normalizedDate(value, item.key);
    if (!date) throw new Error(`日期格式无效：“${value}”`);
    if (norm(freshFieldValue(item, element)) === norm(date)) { await dismissDatePicker(); return; }

    // Some Ant Design versions keep the previous picker mounted and route
    // subsequent keystrokes to it. Always close any prior popup first.
    await dismissDatePicker();
    element.scrollIntoView({ block: "center", inline: "nearest" });
    await delay(100);
    element.click();
    await delay(120);
    const popupSelectors = [
      ".ant-calendar-picker-container:not(.ant-calendar-picker-container-hidden) .ant-calendar-input",
      ".ant-picker-dropdown:not(.ant-picker-dropdown-hidden) input",
      ".el-picker-panel:not([style*='display: none']) input",
      ".arco-picker-container:not(.arco-trigger-popup-hidden) input",
      ".semi-portal:not([style*='display: none']) input"
    ];
    const editor = popupSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]).filter((candidate) => visibleElement(candidate)).at(-1);
    if (editor) {
      editor.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter ? setter.call(editor, date) : (editor.value = date);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: date }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      for (const type of ["keydown", "keypress", "keyup"]) editor.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      await delay(180);
      // Text entry changes the calendar view, but some Ant Design builds keep
      // shared popup state alive. Clicking the exact day commits through the
      // active picker's own onSelect handler and closes the correct record.
      const exactCell = matchingDateCell(date);
      if (exactCell) {
        (exactCell.querySelector(".ant-calendar-date,.ant-picker-cell-inner") || exactCell).click();
        await delay(650);
      }
      if (norm(freshFieldValue(item, element)) === norm(date)) { await dismissDatePicker(); return; }
    }

    const cell = matchingDateCell(date);
    if (cell) {
      (cell.querySelector(".ant-calendar-date,.ant-picker-cell-inner") || cell).click();
      await delay(160);
      if (norm(freshFieldValue(item, element)) === norm(date)) { await dismissDatePicker(); return; }
    }

    const wasReadOnly = element.readOnly;
    if (wasReadOnly) element.removeAttribute("readonly");
    nativeSetter(element, date);
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    if (wasReadOnly) element.setAttribute("readonly", "");
    await delay(80);
    if (norm(freshFieldValue(item, element)) !== norm(date)) throw new Error("网页日期控件拒绝写入，请手动选择日期");
    await dismissDatePicker();
  }

  async function setValue(element, value, item = {}) {
    const text = Array.isArray(value) ? value.map((item, index) => `${index + 1}. ${item}`).join("\n") : String(value ?? "");
    const dateLike = ["start", "end", "birthDate", "dateRange"].includes(item.key) || /日期|起止时间|date|calendar/i.test(`${item.label || ""} ${element.placeholder || ""} ${element.className || ""}`);
    if (dateLike && (element.readOnly || element.type === "date" || element.closest("[class*=date],.ant-calendar-picker,.ant-picker,.el-date-editor,.arco-picker"))) {
      await setDatePickerValue(element, text, item);
      return;
    }
    if (element.type === "radio") {
      const group = element.name ? [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(element.name)}"]`)] :
        [...(element.closest("[class*=fieldItem],.form-item,.ud-formily-item") || element.parentElement).querySelectorAll("input[type=radio]")];
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
        const options = [...document.querySelectorAll("[role=option],[role=treeitem],.atsx-select-dropdown-menu-item,.atsx-tree-node-content-wrapper,.ant-select-item-option,.ant-cascader-menu-item,.semi-select-option,.el-select-dropdown__item,.arco-select-option,.ud__select-option,.ud__select__option")]
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

  function resolvePlanElement(item) {
    // Reactive forms frequently replace or reorder DOM nodes after each write.
    // A stale data-recruitment-id may then point at a different record, so an
    // ID hit is trusted only when its current semantic identity still matches.
    const currentFields = discover();
    const directField = item.fieldId && currentFields.find((field) => field.id === item.fieldId);
    if (directField && fieldMatchesPlanItem(directField, item, true)) {
      const direct = document.querySelector(`[data-recruitment-id="${CSS.escape(directField.id)}"]`);
      if (direct) return { element: direct, fieldId: directField.id, relocated: false };
    }

    const candidates = currentFields.map((field) => {
      if (item.section && field.section !== item.section) return { field, score: -1 };
      if (Number.isInteger(item.recordIndex) && field.recordIndex !== item.recordIndex) return { field, score: -1 };
      let score = 0;
      if (item.domId && field.domId === item.domId) score += 50;
      if (item.key && item.key !== "unknown" && field.key === item.key) score += 35;
      if (item.label && norm(field.label) === norm(item.label)) score += 30;
      else if (item.label && (norm(field.label).includes(norm(item.label)) || norm(item.label).includes(norm(field.label)))) score += 12;
      if (item.type && field.type === item.type) score += 8;
      if (item.section && field.section === item.section) score += 10;
      if (Number.isInteger(item.recordIndex) && field.recordIndex === item.recordIndex) score += 20;
      return { field, score };
    }).filter((entry) => entry.score >= 28).sort((a, b) => b.score - a.score);
    if (!candidates.length || (candidates[1] && candidates[0].score === candidates[1].score)) return null;
    const field = candidates[0].field;
    const element = document.querySelector(`[data-recruitment-id="${CSS.escape(field.id)}"]`);
    return element ? { element, fieldId: field.id, relocated: true } : null;
  }

  async function executePlan(items = []) {
    const results = [];
    for (const item of items) {
      const resolved = resolvePlanElement(item);
      if (!resolved) { results.push({ fieldId: item.fieldId, ok: false, error: "页面更新后无法唯一定位字段" }); continue; }
      try {
        await setValue(resolved.element, item.value, item);
        results.push({ fieldId: item.fieldId, resolvedFieldId: resolved.fieldId, relocated: resolved.relocated, ok: true });
        await delay(120);
      }
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
        const results = await executePlan([{ ...(message.field || {}), fieldId: message.id, value: message.value }]);
        return { ok: Boolean(results[0]?.ok), error: results[0]?.error, results };
      }
      return { ok: false, error: "未知消息" };
    })().then(respond).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  });
})();
