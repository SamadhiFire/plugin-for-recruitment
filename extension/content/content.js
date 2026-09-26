(() => {
  if (window.__recruitmentCopilotV080) return;
  window.__recruitmentCopilotV080 = true;

  const FIELD_SELECTOR = "input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=password]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable=true], [role=textbox]:not(input):not(textarea), [role=combobox]:not(input):not(select)";
  const SECTION_NAMES = ["个人信息", "基本信息", "基础信息", "个人资料", "求职意向", "教育经历", "教育背景", "学习经历", "实习经历", "工作经历", "工作经验", "工作/实习经历", "校园经历", "校园实践", "社团经历", "项目经历", "项目经验", "实践经历", "AI应用技能", "AI能力", "AI工具与模型", "公司内部亲属关系", "英语能力", "其他外语能力", "计算机能力", "专业技能", "获奖情况", "荣誉奖励", "证书", "作品", "语言能力", "语言/证书/技能", "个人特长", "兴趣爱好", "自我评价", "自我介绍", "个人优势", "其他技能/证书"];
  const SECTION_PATTERNS = [
    { section: "skills", pattern: /AI应用技能|AI能力|AI工具|AI协作|计算机能力|专业技能|证书|其他技能|技能|skills?|certifications?/i },
    { section: "summary", pattern: /个人特长|兴趣爱好|自我评价|自我介绍|个人简介|个人优势|核心竞争力|AIGC.*产品经理|summary|about\s*me|self-evaluation|interests?/i },
    { section: "experience", pattern: /工作\/实习|实习经历|实习经验|实习|internship|internships/i },
    { section: "work", pattern: /全职工作|正式工作|工作经历|工作经验|工作履历|任职经历|work\s*experience|employment\s*history|employment/i },
    { section: "education", pattern: /教育经历|教育背景|学习经历|教育信息|学历信息|education|academic\s*background|academic/i },
    { section: "campus", pattern: /校园经历|校园实践|社团经历|学生工作|campus\s*experience/i },
    { section: "project", pattern: /项目经历|项目经验|实践经历|项目|projects?|project\s*experience/i },
    { section: "works", pattern: /作品|作品集|portfolio/i },
    { section: "language", pattern: /英语能力|其他外语能力|语言能力|语言\/证书\/技能|外语|languages?/i },
    { section: "other", pattern: /亲属|获奖|荣誉|求职意向|求职期望|期望职位|意向职位|awards?|honors?|job\s*intention|preferences?/i },
    { section: "basics", pattern: /个人信息|个人资料|基本信息|基础信息|基本资料|basic\s*info|personal\s*information|personal\s*details|contact\s*info/i }
  ];
  let highlighted;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value = "") => String(value).replace(/\s+/g, " ").trim();
  const norm = (value = "") => clean(value).toLowerCase().replace(/[：:*＊（）()【】\[\]·、，,。.!！?？\s]/g, "");

  function querySelectorAllDeep(selector, root = document) {
    const list = [...root.querySelectorAll(selector)];
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (node.shadowRoot) list.push(...querySelectorAllDeep(selector, node.shadowRoot));
      }
    } catch {
      const all = root.querySelectorAll("*");
      for (const el of all) {
        if (el.shadowRoot) list.push(...querySelectorAllDeep(selector, el.shadowRoot));
      }
    }
    return list;
  }

  function findElementByRecruitmentAttr(attr, val, root = document) {
    if (!val) return null;
    const direct = root.querySelector(`[${attr}="${CSS.escape(val)}"]`);
    if (direct) return direct;
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (node.shadowRoot) {
          const found = findElementByRecruitmentAttr(attr, val, node.shadowRoot);
          if (found) return found;
        }
      }
    } catch {
      const all = root.querySelectorAll("*");
      for (const el of all) {
        if (el.shadowRoot) {
          const found = findElementByRecruitmentAttr(attr, val, el.shadowRoot);
          if (found) return found;
        }
      }
    }
    return null;
  }

  function findRecruitmentElement(id) {
    return findElementByRecruitmentAttr("data-recruitment-id", id);
  }

  function findRecruitmentAddButton(addId) {
    return findElementByRecruitmentAttr("data-recruitment-add-id", addId);
  }

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
    const wrappedLabel = element.closest("label");
    if (wrappedLabel && !["radio", "checkbox"].includes(element.type)) {
      const copy = wrappedLabel.cloneNode(true);
      copy.querySelectorAll("input,select,textarea,[role=combobox]").forEach((node) => node.remove());
      const wrappedText = clean(copy.textContent);
      // ATS select widgets wrap the current choice (e.g. "2027") in a label.
      // That is a value, not the field title above the date row.
      if (wrappedText && norm(wrappedText) !== norm(fieldValue(element))
        && !/^\d+$/.test(wrappedText)) return wrappedText;
    }
    const formilyLabel = element.closest(".ud-formily-item")?.querySelector(".ud-formily-item-label,.ud-formily-item-label-content");
    if (formilyLabel?.textContent) return clean(formilyLabel.textContent);
    let cursor = element;
    let fallbackText = "";
    for (let depth = 0; depth < 9 && cursor; depth += 1, cursor = cursor.parentElement) {
      const className = String(cursor.className || "");
      if (/form-item|formily-item|field|control/i.test(className)) {
        const candidates = [...cursor.querySelectorAll("label,[class*=label],[class*=title],[class*=filedName]")]
          .filter((node) => !node.contains(element) && !node.closest("[role=listbox],[role=option],[class*=select-selector],[class*=dropdown]"))
          .filter((node) => Boolean(node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))
          .map((node) => clean(node.textContent)).filter((text) => text && text.length < 80 && norm(text) !== norm(fieldValue(element)));
        if (candidates.length) return candidates[0];
        const own = directText(cursor);
        if (!fallbackText && !/control|select|picker|dropdown/i.test(className)
          && own && own.length < 80 && norm(own) !== norm(fieldValue(element))) fallbackText = own;
      }
    }
    const described = element.getAttribute("aria-describedby")?.split(/\s+/).map((key) => document.getElementById(key)?.textContent || "").join(" ");
    const ariaLabel = element.getAttribute("aria-label") || "";
    return clean((ariaLabel && norm(ariaLabel) !== norm(fieldValue(element)) ? ariaLabel : "")
      || fallbackText || described || element.getAttribute("placeholder") || element.name || element.id || "");
  }

  function headingItems() {
    return [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,legend,dt,p,div,[role=heading],.module-title,.applyFormModuleWrapper-title,[class*=title],[class*=Title]")]
      .filter((node) => !node.querySelector(FIELD_SELECTOR))
      .filter((node) => !node.closest("label,nav,aside,[role=navigation],[class*=sidebar],[class*=sideBar],[class*=side-bar],[class*=form-item],[class*=formItem],[class*=FormItem],[class*=field-item],[class*=fieldItem],.ud-formily-item"))
      .map((node) => {
        // Some ATS pages put the title, add button and a long warning in the
        // same block. Read the title element itself before applying the length
        // limit, or the entire internship section disappears from the scan.
        const className = String(node.className || "");
        const title = /blockTitle|sectionHeader|section-header/i.test(className)
          ? node.querySelector(":scope > div > span:first-child, :scope > span:first-child, :scope > div > h2, :scope > h2")
          : null;
        return { node, text: clean(title?.textContent || node.textContent) };
      })
      .filter((item) => item.text.length <= 60 && (SECTION_NAMES.includes(item.text)
        || ((/^(H[1-6]|LEGEND|DT)$/.test(item.node.tagName) || item.node.getAttribute("role") === "heading" || /title|heading/i.test(String(item.node.className || "")))
          && (SECTION_NAMES.some((name) => item.text.startsWith(name)) || SECTION_PATTERNS.some((p) => p.pattern.test(item.text))))));
  }

  function sectionFromText(text, headings = null) {
    if (!text) return "other";
    if (/AI应用技能|AI能力|AI工具|AI协作/i.test(text)) return "skills";
    if (/个人特长|兴趣爱好/i.test(text)) return "summary";
    if (/工作\/实习|实习/i.test(text)) return "experience";
    if (/工作经历|工作经验|工作履历|任职经历/i.test(text)) {
      const hasSeparateInternshipSection = (headings || headingItems()).some((item) => /实习经历|实习经验|实习|internship/i.test(item.text));
      return location.hostname.includes("vivo.com") || !hasSeparateInternshipSection ? "experience" : "work";
    }
    if (/教育|学习经历|学历/i.test(text)) return "education";
    if (/校园经历|校园实践|社团经历/i.test(text)) return "campus";
    if (/项目|实践经历/i.test(text)) return "project";
    if (/作品/i.test(text)) return "works";
    if (/英语能力|其他外语能力|语言/i.test(text)) return "language";
    if (/计算机能力|专业技能|证书/i.test(text)) return "skills";
    if (/亲属|获奖|荣誉/i.test(text)) return "other";
    if (/个人信息|个人资料|基本|基础/i.test(text)) return "basics";
    if (/求职意向|求职期望/i.test(text)) return "other";
    if (/自我评价|自我介绍|个人简介|个人优势|核心竞争力|AIGC.*产品经理/i.test(text)) return "summary";
    if (/技能/i.test(text)) return "skills";
    for (const { section, pattern } of SECTION_PATTERNS) {
      if (pattern.test(text)) {
        if (section === "work") {
          const hasSeparateInternship = (headings || headingItems()).some((item) => /internship|实习/i.test(item.text));
          return location.hostname.includes("vivo.com") || !hasSeparateInternship ? "experience" : "work";
        }
        return section;
      }
    }
    return "other";
  }

  function nearestSection(element, headings = headingItems()) {
    const parsed = parseStructuredId(element.id || element.name);
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
    const dateName = `${parsed.rawKey || ""} ${element.id || ""} ${element.name || ""}`;
    if (/(start|begin|end).*year/i.test(dateName)) return /end/i.test(dateName) ? "endYear" : "startYear";
    if (/(start|begin|end).*month/i.test(dateName)) return /end/i.test(dateName) ? "endMonth" : "startMonth";
    // Some recruitment forms render a single labelled date range as two
    // controls, or as four separate year/month controls. Give each control a
    // distinct meaning before the generic "起止时间" fallback is considered.
    const dateRow = element.closest(".form-item,.ant-form-item,.el-form-item,[class*=form-item],[class*=formItem],[class*=FormItem],[class*=apply-field],.ud-formily-item");
    const dateLabel = dateRow && /起止时间|起止日期|就读时间|开始时间|起始时间|结束时间|毕业时间|入学时间/.test(label)
      ? label : clean(dateRow?.textContent || "").slice(0, 100);
    if (dateRow && /起止时间|起止日期|就读时间|开始时间|起始时间|结束时间|毕业时间|入学时间/.test(dateLabel)) {
      const controls = [...dateRow.querySelectorAll(FIELD_SELECTOR)].filter((candidate) =>
        candidate.type !== "checkbox" && !(candidate.getAttribute("role") === "combobox" && candidate.querySelector("input,select")));
      const index = controls.indexOf(element);
      if (index >= 0 && controls.length === 2) {
        if (/开始|起始|入学/.test(dateLabel)) return index === 0 ? "startYear" : "startMonth";
        if (/结束|毕业/.test(dateLabel)) return index === 0 ? "endYear" : "endMonth";
        return index === 0 ? "start" : "end";
      }
      if (index >= 0 && controls.length === 4 && /起止|就读/.test(dateLabel)) {
        return ["startYear", "startMonth", "endYear", "endMonth"][index];
      }
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
    // Repeated enterprise forms frequently reuse generic ids such as `name`
    // for school/company/project names. Prefer the visible field label over
    // that generic id so an education identity cannot become applicant name.
    if (/学校所在地|院校所在地|目前就读地|就读城市/.test(source)) return "schoolLocation";
    if (/school|学校|院校|毕业院校|毕业学校|就读学校|就读院校|院校名称|毕业院校名称|最高学历学校|institution|university/.test(source)) return "school";
    if (/所在院系|研究所|学院|院系|二级学院|所在学院|所在院系所|college|department|faculty/.test(source)) return "college";
    if (((/firstname|fullname|姓名|^name$/.test(source)) || element.id === "name") && !/学校|院校|项目|公司|单位|学院|院系|employer|organization|school|university/.test(source)) return "name";
    if (/国家区号|手机区号|电话区号|countrycode/.test(source)) return "phoneCountry";
    if (/mobile|phone|手机|联系电话|联系方式/.test(source)) return /^\d{6,}$/.test(String(element.value || "").replace(/\D/g, "")) ? "phoneNumber" : "phone";
    if (/email|邮箱/.test(source)) return "email";
    if (/gender|性别/.test(source)) return "gender";
    if (/birth|出生/.test(source)) return "birthDate";
    if (/idcard|证件号码|身份证号码/.test(source)) return "idNumber";
    if (/证件类型|个人证件|idtype|identificationtype|identification/.test(source)) return "idType";
    if (/nationality|国籍|国家地区/.test(source)) return "nationality";
    if (/籍贯|家乡|hometown/.test(source)) return "hometown";
    if (/意向面试地点|面试地点|面试城市/.test(source)) return "interviewLocation";
    if (/常用.*ai.*工具|ai工具.*模型|ai应用技能|常用大模型|人工智能工具|大模型使用经验/i.test(source)) return "aiToolsModels";
    if (/与ai协作|ai协作.*项目|ai协作.*任务|使用ai完成|ai实践项目/i.test(source)) return "aiCollaborationProjects";
    if (/为什么.*aigc.*产品经理|为什么.*应聘.*aigc|选择.*aigc.*原因|aigc.*岗位动机/i.test(source)) return "whyAigcProductManager";
    if (/个人优势|核心竞争力|岗位胜任力|为什么选择你/.test(source)) return "coreStrengths";
    if (/自我介绍|个人简介|请介绍一下自己/.test(source)) return "selfIntroduction";
    if (/个人特长|能力特长|核心特长/.test(source)) return "personalStrengths";
    if (/兴趣爱好|兴趣与爱好|个人爱好/.test(source)) return "hobbies";
    if (/自我评价|个人评价|综合评价|自我鉴定/.test(source)) return "selfEvaluation";
    if (/专业类别|专业大类/.test(source)) return "majorCategory";
    if (/fieldofstudy|major|专业|主修专业|所学专业|专业名称|majorname/.test(source) && !/排名/.test(source)) return "major";
    if (/educationtype|学历类型|受教育类型|培养方式|学习形式/.test(source)) return "educationType";
    if (/是否最高学历/.test(source)) return "isHighestDegree";
    if (/degree|学历|学位|最高学历|当前学历|学历层次|文化程度|degreelevel|educationlevel/.test(source) && !/类型/.test(source)) return "degree";
    if (/联合办学|jointprogram/.test(source)) return "jointProgram";
    if (/交流学习|exchange/.test(source)) return "exchange";
    if (/gpa|cgpa|绩点|平均绩点/.test(source) && !/满绩/.test(source)) return "gpa";
    if (/年级成绩排名|成绩排名|ranking|年级排名|班级排名|专业排名/.test(source)) return "rank";
    if (/是否国家重点实验室|国家重点实验室/.test(source)) return "nationalKeyLab";
    if (/实验室/.test(source)) return "laboratory";
    if (/company|公司|单位名称|实习单位|工作单位|任职单位|雇主|就职公司|所属公司|企业名称|公司名称|employer|organization/.test(source)) return "company";
    if (/projectname|项目名称|项目名|projecttitle/.test(source)) return "projectName";
    if (/projectrole|项目角色|项目中担任的角色|担任角色|项目中担任职务/.test(source)) return "projectRole";
    if (/position|title|职位|岗位|职务|任职角色|担任职务|任职岗位|岗位名称|职位名称|jobtitle|jobposition/.test(source)) return "role";
    if (/link|url|链接|作品集/.test(source)) return "link";
    if (/description|desc|描述|职责|内容|主要工作|工作成果|工作业绩|项目介绍|工作职责|工作内容|工作描述|职责描述|岗位职责|主要职责|jobdescription|responsibilities/.test(source)) return "description";
    if (/startendtime|起止时间|起止年月|起止日期|daterange/.test(source)) return "dateRange";
    if (/start|开始时间|开始日期|起始时间|起始日期|入学时间|入职时间|入学年月|入职年月|开始年月|起始年月|startdate|startperiod/.test(source)) return "start";
    if (/end|结束时间|结束日期|截止时间|截止日期|毕业时间|离职时间|毕业年月|离职年月|结束年月|截止年月|enddate|endperiod/.test(source)) return "end";
    if (/summary|自我评价|自我介绍|个人优势|个人简介/.test(source)) return "summary";
    if (/skill|技能/.test(source)) return "skills";
    return parsed.rawKey || norm(label || element.id || element.name).slice(0, 60) || "unknown";
  }

  function fieldValue(element) {
    if (element.type === "radio") {
      const group = radioGroup(element);
      const checked = group.find((item) => item.checked);
      return checked ? optionText(checked) : "";
    }
    if (element.type === "checkbox") return element.checked ? (optionText(element) || "是") : "否";
    if (element.tagName === "SELECT") return element.value ? element.selectedOptions[0]?.textContent?.trim() || "" : "";
    const selected = customSelectedText(element);
    if (selected) return selected;
    return element.value ?? element.textContent ?? "";
  }

  function recordCardFor(element) {
    if (location.hostname.includes("join.qq.com")) return element.closest(".info_list");
    // P&G puts every field of one repeatable entry inside an `apply-fields`
    // container. The inner `apply-field` nodes are individual questions, while
    // `apply-block` contains the whole section. Keep all date parts and the
    // identity field on the same record index, even when only one entry exists.
    if (location.hostname === "recruit.pg.com.cn") {
      const card = element.closest('[class*="apply-fields"]');
      if (card && card.querySelectorAll(FIELD_SELECTOR).length >= 2) return card;
    }
    if (location.hostname.includes("vivo.com")) {
      const form = element.closest(".ux-standard-form");
      if (form) return form.parentElement?.parentElement?.parentElement || form;
    }
    const known = element.closest([
      ".register-form-group-wrapper", "[class*=form-array-card-content]", "[class*=array-card-content]", ".form-part",
      "[data-record-index]", "[data-item-index]", "[class*=educationItem]",
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
      // A single visible entry has no matching sibling yet. Explicit row/card
      // containers still define one record; waiting for a second sibling makes
      // the first entry's date parts look like several different records.
      if (/(?:^|[\s_-])(?:resume|experience|education|project)[-_]?(?:row|record|entry|item|card)(?:[\s_-]|$)|(?:^|[\s_-])(?:record|entry)[-_]?(?:row|item|card)(?:[\s_-]|$)/i.test(className)
        && !cursor.querySelector("button,[role=button]")
        && [...cursor.children].filter((child) => child.querySelectorAll?.(FIELD_SELECTOR).length).length >= 2) return cursor;
      const siblings = [...cursor.parentElement.children].filter((node) =>
        node.tagName === cursor.tagName && String(node.className || "") === className &&
        node.querySelectorAll?.(FIELD_SELECTOR).length >= 2
      );
      if (siblings.length >= 2) return cursor;
    }
    return null;
  }

  function assignRecordIndexes(drafts) {
    const repeatedSections = new Set(["education", "experience", "work", "project", "works", "language"]);
    for (const section of repeatedSections) {
      const sectionDrafts = drafts.filter((draft) => draft.section === section && !Number.isInteger(draft.recordIndex));
      if (!sectionDrafts.length) continue;
      const groups = new Map();
      for (const draft of sectionDrafts) {
        if (!draft._recordCard) continue;
        if (!groups.has(draft._recordCard)) groups.set(draft._recordCard, []);
        groups.get(draft._recordCard).push(draft);
      }
      const validCards = [...groups.entries()]
        .filter(([, members]) => members.length >= 2 && new Set(members.map((member) => member.key)).size >= 2)
        .sort((left, right) => Math.min(...left[1].map((item) => item._order)) - Math.min(...right[1].map((item) => item._order)));
      const cardIndexes = new Map(validCards.map(([card], index) => [card, index]));
      const occurrences = new Map();
      for (const draft of sectionDrafts.sort((left, right) => left._order - right._order)) {
        if (cardIndexes.has(draft._recordCard)) {
          draft.recordIndex = cardIndexes.get(draft._recordCard);
          continue;
        }
        const index = occurrences.get(draft.key) || 0;
        draft.recordIndex = index;
        occurrences.set(draft.key, index + 1);
      }
    }
    return drafts;
  }

  function customSelectRoot(element) {
    const known = element.closest(".atsx-select-selection,.ant-select,.ant-cascader-picker,.semi-select,.el-select,.arco-select,.arco-select-view,.ud__select,[class*=select-selector],[role=combobox]");
    if (known) return known;
    const generic = element.closest("[class*='-select']:not([class*='user-select']):not([class*='-selected']):not([class*='-selection']),[class*='_select']:not([class*='_selected']):not([class*='_selection']),[class*='select-view'],[class*='cascader']");
    if (generic && element.readOnly) return generic;
    return null;
  }

  function customSelectedText(element) {
    const root = customSelectRoot(element);
    if (!root) return "";
    const selected = root.querySelector("[data-cy=selectedValue],.atsx-select-selection-selected-value,.ant-select-selection-item,.ant-cascader-picker-label,.semi-select-selection-text,.el-select__selected-item,.arco-select-view-value,.ud__select__selector__content,[class*=select-selection-item]");
    return clean(selected?.textContent || "");
  }

  function optionText(element) {
    const associated = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
    const wrapped = element.closest("label");
    const nearby = element.parentElement;
    return clean(associated?.textContent || wrapped?.textContent || element.getAttribute("aria-label") || nearby?.textContent || element.value || "");
  }

  function radioGroup(element) {
    const scope = element.name ? (element.form || document) :
      (element.closest('[role=radiogroup],fieldset,[class*=fieldItem],.form-item,.ud-formily-item') || element.parentElement);
    return [...scope.querySelectorAll('input[type=radio]')].filter((candidate) => candidate.name === element.name && candidate.form === element.form);
  }

  function discoverable(element) {
    if (element.matches(":disabled") || element.closest('[hidden],[inert],[aria-hidden=true],[aria-disabled=true],.resumeEditForm-hiddenField,.phoenix-unmodeled-layer')) return false;
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
    if (visibleElement(element)) return true;
    // Styled radio/checkbox inputs may be zero-sized but have a visible label.
    return ["radio", "checkbox"].includes(element.type) && visibleElement(element.closest("label") || element.parentElement);
  }

  function discover() {
    const seenRadioGroups = new Set();
    const headings = headingItems();
    const elements = querySelectorAllDeep(FIELD_SELECTOR).filter((element) => {
      if (!discoverable(element)) return false;
      if (/验证码|短信码|密码|captcha|verification.?code|one.?time.?code/i.test(`${explicitLabel(element)} ${element.name} ${element.autocomplete}`)) return false;
      if (element.getAttribute("role") === "combobox" && element.querySelector("input,select")) return false;
      if (element.parentElement?.closest('[contenteditable=true]')) return false;
      if (element.type === "search" && !element.id && !element.getAttribute("aria-label")) return false;
      if (element.type === "radio") {
        const radioKey = radioGroup(element)[0];
        if (seenRadioGroups.has(radioKey)) return false;
        seenRadioGroups.add(radioKey);
      }
      return true;
    });
    const drafts = elements.map((element, order) => {
      element.dataset.recruitmentId ||= `recruitment-${Date.now()}-${order}`;
      const parsed = parseStructuredId(element.id || element.name);
      const rawLabel = explicitLabel(element);
      const section = parsed.section || nearestSection(element, headings);
      const key = semanticKey(element, rawLabel, parsed);
      const datePartLabels = { startYear: "开始年份", startMonth: "开始月份", endYear: "结束年份", endMonth: "结束月份" };
      const label = (/^\d+$/.test(rawLabel) || rawLabel === element.id || rawLabel === element.name
        || /^(请选择|please select)$/i.test(rawLabel))
        && datePartLabels[key] ? datePartLabels[key] : rawLabel;
      const recordIndex = Number.isInteger(parsed.recordIndex) ? parsed.recordIndex : null;
      const customRoot = customSelectRoot(element);
      return {
        id: element.dataset.recruitmentId,
        domId: element.id || "",
        label,
        type: element.tagName.toLowerCase() === "textarea" ? "textarea" : element.type || element.tagName.toLowerCase(),
        value: fieldValue(element),
        section,
        recordIndex,
        key,
        required: element.required || element.getAttribute("aria-required") === "true" || /[*＊]/.test(label),
        maxLength: element.maxLength > 0 ? element.maxLength : null,
        options: element.tagName === "SELECT" ? [...element.options].filter((option) => !option.disabled).map((option) => clean(option.textContent)) : element.type === "radio" ? radioGroup(element).map(optionText) : [],
        context: {
          placeholder: element.getAttribute("placeholder") || "",
          name: element.name || "",
          ariaLabel: element.getAttribute("aria-label") || "",
          description: clean((element.getAttribute("aria-describedby") || "").split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")).slice(0, 300),
          sectionHeading: headings.filter((item) => item.node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1)?.text || "",
          recordSource: recordIndex != null ? "structured" : recordCardFor(element) ? "container" : "occurrence"
        },
        readOnly: element.disabled || (element.readOnly && !customRoot && !["start", "end", "birthDate", "dateRange"].includes(key)) || Boolean(element.closest(".ud__select__selector-readOnly,[aria-readonly=true]")),
        control: customRoot ? "custom-select" : (element.type === "radio" ? "radio" : (element.type === "checkbox" ? "checkbox" : element.tagName.toLowerCase())),
        _recordCard: recordIndex == null ? recordCardFor(element) : null,
        _order: order
      };
    });
    assignRecordIndexes(drafts);
    return drafts.map(({ _recordCard, _order, ...field }) => field);
  }

  function sectionForButton(button, headings = headingItems()) {
    const localTitle = clean(button.previousElementSibling?.textContent || "");
    const localSection = sectionFromText(localTitle, headings);
    if (localSection !== "other") return localSection;
    let text = "";
    for (const item of headings) if (item.node.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) text = item.text;
    return sectionFromText(text, headings);
  }

  function discoverRepeaters(fields = discover()) {
    const headings = headingItems();
    const counts = {};
    for (const field of fields) if (field.recordIndex != null) counts[field.section] = Math.max(counts[field.section] || 0, field.recordIndex + 1);
    const ADD_TEXT_REGEX = /^(\+\s*)?(添加|新增|继续添加|add|add\s+more|add\s+new|add\s+another|add\s+a|add\s+an)\s*(一条|一项|更多|记录|经历|教育|学历|项目|教育经历|实习经历|工作经历|工作经验|项目经历|项目经验|education|experience|internship|project|work|record|entry|item)?$/i;
    // Recruitment sites often render one control as "+ 添加 / Add". Match each
    // language segment, while still rejecting labels with unrelated actions.
    const isAddText = (value) => {
      const parts = clean(value).split(/\s*[/／|｜]\s*/).filter(Boolean);
      return parts.length > 0 && parts.length <= 2 && parts.every((part) => ADD_TEXT_REGEX.test(part));
    };
    const candidates = [...document.querySelectorAll("button,[role=button],a,span,div")].filter((element) => {
      const text = clean(element.textContent);
      const ariaLabel = clean(element.getAttribute("aria-label") || "");
      const matchedText = isAddText(text) || (ariaLabel && isAddText(ariaLabel));
      const isIconOnly = /^\+\s*$/.test(text) && element.closest("[class*=repeat],[class*=array],[class*=record],[class*=list],[class*=card],[class*=section]");
      return (matchedText || isIconOnly) && element.getBoundingClientRect().width > 0;
    }).filter((element) => ![...element.children].some((child) => /添加|新增|add/i.test(clean(child.textContent))));
    const repeaters = [];
    for (const candidate of candidates) {
      const button = candidate.closest("button,[role=button],a") || candidate;
      if (!safeAddButton(button)) continue;
      const combinedLabel = clean(`${button.textContent} ${button.getAttribute("aria-label") || ""}`);
      const section = /学历|教育|education/i.test(combinedLabel)
        ? (/学历/.test(combinedLabel) ? "education" : sectionFromText(combinedLabel, headings))
        : /实习经历|实习经验|实习|internship/i.test(combinedLabel)
          ? "experience"
          : /工作经历|工作经验|工作|work/i.test(combinedLabel)
            ? sectionFromText(combinedLabel, headings)
            : /项目经历|项目经验|项目|project/i.test(combinedLabel)
              ? "project"
              : sectionForButton(button, headings);
      if (section === "other" || repeaters.some((item) => item.section === section)) continue;
      button.dataset.recruitmentAddId ||= `recruitment-add-${repeaters.length}-${Date.now()}`;
      repeaters.push({ id: button.dataset.recruitmentAddId, section, currentCount: counts[section] || 0, label: clean(button.textContent || button.getAttribute("aria-label")) || "添加" });
    }
    return repeaters;
  }

  function safeAddButton(button) {
    if (!discoverable(button)) return false;
    // A button without type defaults to submit when placed inside a form.
    if (button.tagName === "BUTTON" && button.form && button.type !== "button") return false;
    if (button.tagName === "A" && button.getAttribute("href") && button.getAttribute("href") !== "#") return false;
    return !/保存|提交|下一步|申请|完成|save|submit|next|apply/i.test(clean(`${button.textContent} ${button.getAttribute("aria-label") || ""}`));
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

  function isMonthControl(element) {
    // These controls accept year/month even when the resume includes a day.
    // Do not infer month precision merely from the value currently displayed.
    return element?.type === "month" || Boolean(element?.closest(
      ".throne-biz-date-range-picker-wrapper,.el-date-editor--month,.el-date-editor--monthrange"
    ));
  }

  function dateAtControlPrecision(value, key, element) {
    const date = normalizedDate(value, key);
    return date && isMonthControl(element) ? `${date.slice(0, 7)}-01` : date;
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
    if (fallbackElement?.isConnected) return fieldValue(fallbackElement);
    const candidates = discover().filter((candidate) => fieldMatchesPlanItem(candidate, item, true));
    const field = candidates.find((candidate) => candidate.id === item.fieldId) || (candidates.length === 1 ? candidates[0] : null);
    return field ? field.value : "";
  }

  async function dismissDatePicker() {
    const pickerContainers = [...document.querySelectorAll([
      ".ant-calendar-picker-container",
      ".ant-picker-dropdown",
      ".el-picker-panel",
      ".arco-picker-container",
      ".semi-portal",
      ".throne-biz-date-range-picker-panel",
      ".ud__dropdown .ud__picker-date-panel"
    ].join(","))];
    const visibleEditors = [...document.querySelectorAll([
      ".ant-calendar-picker-container .ant-calendar-input",
      ".ant-picker-dropdown input",
      ".el-picker-panel input",
      ".arco-picker-container input",
      ".semi-portal input",
      ".throne-biz-date-range-picker-panel input"
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

  function matchingDateCell(date, monthOnly = false, root = document) {
    const titles = [
      `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`,
      `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月`,
      `${date.slice(0, 4)}-${date.slice(5, 7)}`,
      date
    ];
    const titled = [...root.querySelectorAll("[role=gridcell][title],td[title],[role=button][title]")]
      .find((candidate) => visibleElement(candidate) && titles.includes(candidate.getAttribute("title"))
        && (!monthOnly || !/日$/.test(candidate.getAttribute("title") || "")) && candidate.getAttribute("aria-disabled") !== "true");
    if (titled) return titled;
    if (!monthOnly) return null;
    const monthText = `${date.slice(5, 7)}月`;
    return [...root.querySelectorAll([
      ".ud__picker-month-panel-cell",
      ".ant-picker-month-panel .ant-picker-cell",
      ".arco-picker-cell",
      ".el-month-table td",
      ".semi-datepicker-month-grid-month"
    ].join(","))].find((candidate) => visibleElement(candidate)
      && clean(candidate.textContent) === monthText
      && candidate.getAttribute("aria-disabled") !== "true"
      && !/(?:^|\s)(?:disabled|.*-disabled)(?:\s|$)/i.test(String(candidate.className || "")));
  }

  function visibleUniverseMonthPanel() {
    return [...document.querySelectorAll(".throne-biz-date-range-picker-panel")].filter((candidate) => visibleElement(candidate)).at(-1) || null;
  }

  async function alignUniversePickerYear(panel, targetYear) {
    if (!panel) return;
    for (let guard = 0; guard < 20; guard += 1) {
      const header = panel.querySelector(".ud__picker-panel-header-btn");
      const currentYear = Number((header?.textContent || "").match(/\d{4}/)?.[0]);
      if (!Number.isFinite(currentYear)) throw new Error("无法读取字节月份控件的当前年份");
      if (currentYear === targetYear) return;
      const buttons = [...panel.querySelectorAll(".ud__picker-panel-header-icon")].filter((button) => visibleElement(button) && !button.disabled);
      const button = buttons.find((candidate) => candidate.querySelector(`svg[data-icon="${currentYear > targetYear ? "LeftBoldOutlined" : "RightBoldOutlined"}"]`))
        || buttons[currentYear > targetYear ? buttons.length - 2 : buttons.length - 1];
      if (!button) throw new Error("无法操作字节月份控件的年份导航");
      button.click();
      await delay(100);
    }
    throw new Error("字节月份控件的目标年份超出自动导航范围");
  }

  async function setDatePickerValue(element, value, item = {}) {
    const date = dateAtControlPrecision(value, item.key, element);
    if (!date) throw new Error(`日期格式无效：“${value}”`);
    const monthOnly = isMonthControl(element) || !/^\s*\d{4}[./-]\d{1,2}[./-]\d{1,2}\s*$/.test(String(value));
    const editorText = monthOnly ? date.slice(0, 7) : date;
    if (normalizedDate(freshFieldValue(item, element), item.key) === date) { await dismissDatePicker(); return; }

    // Some Ant Design versions keep the previous picker mounted and route
    // subsequent keystrokes to it. Always close any prior popup first.
    await dismissDatePicker();
    element.scrollIntoView({ block: "center", inline: "nearest" });
    await delay(100);
    // HTMLElement.click() alone does not move focus like a real mouse click.
    // Ant Design binds the shared popup to the focused picker, so explicitly
    // focus the target row before opening it.
    element.focus({ preventScroll: true });
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, buttons: 1 }));
    element.click();
    await delay(120);
    const popupSelectors = [
      ".ant-calendar-picker-container:not(.ant-calendar-picker-container-hidden) .ant-calendar-input",
      ".ant-picker-dropdown:not(.ant-picker-dropdown-hidden) input",
      ".el-picker-panel:not([style*='display: none']) input",
      ".arco-picker-container:not(.arco-trigger-popup-hidden) input",
      ".semi-portal:not([style*='display: none']) input"
    ];
    const findEditor = () => popupSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]).filter((candidate) => visibleElement(candidate)).at(-1);
    let editor = findEditor();
    const sameDateText = (left, right) => {
      const leftDate = normalizedDate(left, item.key);
      const rightDate = normalizedDate(right, item.key);
      return leftDate && rightDate ? leftDate === rightDate : norm(left) === norm(right);
    };
    // Confirm that the shared popup actually belongs to this row before
    // typing. If it still displays the preceding row's value, close/reopen it.
    for (let retry = 0; editor && !sameDateText(editor.value, freshFieldValue(item, element)) && retry < 2; retry += 1) {
      await dismissDatePicker();
      element.focus({ preventScroll: true });
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, buttons: 1 }));
      element.click();
      await delay(180);
      editor = findEditor();
    }
    if (editor && !sameDateText(editor.value, freshFieldValue(item, element))) throw new Error("日期弹层仍绑定在上一条记录，已停止写入以避免错位");
    if (editor) {
      editor.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter ? setter.call(editor, editorText) : (editor.value = editorText);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: editorText }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      await delay(180);
      // Text entry changes the calendar view, but some Ant Design builds keep
      // shared popup state alive. Clicking the exact day commits through the
      // active picker's own onSelect handler and closes the correct record.
      const exactCell = matchingDateCell(date, monthOnly);
      if (exactCell) {
        (exactCell.querySelector(".ant-calendar-date,.ant-picker-cell-inner") || exactCell).click();
        await delay(650);
      }
      if (normalizedDate(freshFieldValue(item, element), item.key) === date) { await dismissDatePicker(); return; }
      // Searchable enterprise date widgets often commit typed month values
      // only through the popup editor's own Enter handler. The surrounding
      // mutation lock captures submit events, so this cannot submit the form.
      for (const type of ["keydown", "keypress", "keyup"]) editor.dispatchEvent(new KeyboardEvent(type, {
        key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true
      }));
      await delay(350);
      if (normalizedDate(freshFieldValue(item, element), item.key) === date) { await dismissDatePicker(); return; }
    }

    const universePanel = visibleUniverseMonthPanel();
    if (universePanel && monthOnly) {
      await alignUniversePickerYear(universePanel, Number(date.slice(0, 4)));
      const universeCell = matchingDateCell(date, true, universePanel);
      if (!universeCell) throw new Error("字节月份控件中未找到目标月份");
      (universeCell.querySelector(".ud__picker__cell-interactive-area") || universeCell).click();
      await delay(350);
      if (normalizedDate(freshFieldValue(item, element), item.key) === date) { await dismissDatePicker(); return; }
      throw new Error("字节月份控件未稳定写入目标月份");
    }

    const cell = matchingDateCell(date, monthOnly);
    if (cell) {
      (cell.querySelector(".ant-calendar-date,.ant-picker-cell-inner") || cell).click();
      await delay(160);
      if (normalizedDate(freshFieldValue(item, element), item.key) === date) { await dismissDatePicker(); return; }
    }

    const wasReadOnly = element.readOnly;
    if (wasReadOnly) element.removeAttribute("readonly");
    nativeSetter(element, editorText);
    if (wasReadOnly) element.setAttribute("readonly", "");
    await delay(80);
    if (normalizedDate(freshFieldValue(item, element), item.key) !== date) throw new Error("网页日期控件拒绝写入，请手动选择日期");
    await dismissDatePicker();
  }

  async function setValue(element, value, item = {}) {
    const text = Array.isArray(value) ? value.map((item, index) => `${index + 1}. ${item}`).join("\n") : String(value ?? "");
    const datePart = /^(start|end)(Year|Month)$/.test(item.key || "");
    if (!discoverable(element) || element.getAttribute("aria-readonly") === "true") throw new Error("字段不可编辑");
    if (element.maxLength > 0 && text.length > element.maxLength) throw new Error(`内容超过字段上限 ${element.maxLength} 字，请缩短后重试`);
    if (["date", "month"].includes(element.type)) {
      const date = normalizedDate(text, item.key);
      if (!date) throw new Error(`日期格式无效：“${text}”`);
      nativeSetter(element, element.type === "month" ? date.slice(0, 7) : date);
      if (!element.validity.valid) throw new Error("日期不符合网页限制，请手动选择");
      return;
    }
    const dateLike = !datePart && (["start", "end", "birthDate", "dateRange"].includes(item.key) || /日期|起止时间|date|calendar/i.test(`${item.label || ""} ${element.placeholder || ""} ${element.className || ""}`));
    if (dateLike && (element.readOnly || element.type === "date" || element.closest("[class*=date],.ant-calendar-picker,.ant-picker,.el-date-editor,.arco-picker,.throne-biz-date-range-picker-wrapper"))) {
      await setDatePickerValue(element, text, item);
      return;
    }
    if (element.type === "radio") {
      const group = radioGroup(element);
      const wanted = norm(text);
      const option = group.find((item) => {
        const candidate = norm(optionText(item));
        return !item.disabled && (candidate === wanted || norm(item.value) === wanted);
      });
      if (!option) throw new Error(`单选项中未找到“${text}”`);
      if (!option.checked) option.click();
      option.dispatchEvent(new Event("change", { bubbles: true }));
      await delay(300);
      if (norm(freshFieldValue(item, option)) !== wanted) throw new Error("单选项未稳定写入");
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
      if (!wantedParts.length) throw new Error("该下拉框不支持自动清空");
      const current = norm(customSelectedText(element));
      if (current && wantedParts.every((part) => datePart
        ? Number(current.replace(/[年月]/g, "")) === Number(part)
        : current.includes(norm(part)))) return;
      const isOpen = customRoot.getAttribute("aria-expanded") === "true" || /(?:^|\s)(?:atsx|ant|semi|el)-select-open(?:\s|$)/.test(String(customRoot.parentElement?.className || ""));
      if (!isOpen) customRoot.click();
      await delay(150);
      const visibleOptions = () => [...document.querySelectorAll("[role=option],[role=treeitem],.atsx-select-dropdown-menu-item,.atsx-tree-node-content-wrapper,.ant-select-item-option,.ant-cascader-menu-item,.semi-select-option,.el-select-dropdown__item,.arco-select-option,.ud__select-option,.ud__select__option")]
        .filter((node) => visibleElement(node));
      const matchingOption = (nodes, part) => {
        const wanted = norm(part);
        const aliases = new Set([wanted]);
        if (wanted === norm("应用经济学")) ["经济学", "经济学相关类"].forEach((alias) => aliases.add(norm(alias)));
        if (wanted === norm("硕士（Master）")) aliases.add(norm("硕士"));
        const samePart = (candidate) => datePart && /^\d{1,4}$/.test(wanted) &&
          Number(norm(candidate).replace(/[年月]/g, "")) === Number(wanted);
        const exact = nodes.find((node) => node.getAttribute("aria-disabled") !== "true" && !node.matches(":disabled,[class*=disabled]") &&
          (aliases.has(norm(node.textContent)) || samePart(node.textContent)));
        if (exact) return exact;
        const partial = nodes.filter((node) => node.getAttribute("aria-disabled") !== "true" && !node.matches(":disabled,[class*=disabled]")
          && [...aliases].some((alias) => alias.length >= 3 && norm(node.textContent).includes(alias)));
        return partial.length === 1 ? partial[0] : null;
      };
      for (let partIndex = 0; partIndex < wantedParts.length; partIndex += 1) {
        const part = wantedParts[partIndex];
        let options = visibleOptions();
        let option = matchingOption(options, part);
        if (!option) {
          // School/company selectors frequently fetch options only after text
          // input. Type into the visible popup search box and wait for its
          // asynchronous result list instead of declaring a false failure.
          const searchInputs = [...document.querySelectorAll(".atsx-select-dropdown input,.ant-select-dropdown input,.ant-cascader-menus input,.semi-portal input,.el-select-dropdown input,.arco-trigger-popup input,[role=listbox] input")]
            .filter((input) => visibleElement(input) && !input.disabled);
          let search = searchInputs.at(-1);
          if (!search && element.tagName === "INPUT" && !element.readOnly) search = element;
          if (search) {
            search.focus();
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            setter ? setter.call(search, part) : (search.value = part);
            search.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: part }));
            search.dispatchEvent(new Event("change", { bubbles: true }));
            search.dispatchEvent(new KeyboardEvent("keyup", { key: part.at(-1) || "", bubbles: true }));
            for (let wait = 0; wait < 12 && !option; wait += 1) {
              await delay(150);
              options = visibleOptions();
              option = matchingOption(options, part);
            }
          }
        }
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
      await delay(450);
      const chosen = norm(freshFieldValue(item, element));
      const finalPart = norm(wantedParts.at(-1)).replace(/(特别行政区|自治区|省|市)$/g, "");
      const chosenComparable = chosen.replace(/(特别行政区|自治区|省|市)$/g, "");
      const accepted = chosenComparable && ((datePart && Number(chosenComparable.replace(/[年月]/g, "")) === Number(finalPart))
        || chosenComparable.includes(finalPart) || finalPart.includes(chosenComparable)
        || (norm(text) === norm("应用经济学") && chosenComparable.includes(norm("经济学")))
        || (norm(text) === norm("硕士（Master）") && chosenComparable === norm("硕士")));
      if (!accepted) throw new Error("下拉框选中值未稳定写入");
      return;
    }
    if (element.tagName === "SELECT") {
      const option = [...element.options].find((item) => !item.disabled && !item.closest("optgroup[disabled]") &&
        (norm(item.textContent) === norm(text) || item.value === text ||
          (datePart && Number(norm(item.textContent).replace(/[年月]/g, "")) === Number(text))));
      if (!option) throw new Error("下拉框没有完全匹配的选项");
      element.value = option.value; element.dispatchEvent(new Event("change", { bubbles: true })); return;
    }
    if (element.isContentEditable) {
      element.focus(); document.execCommand("selectAll", false, null); document.execCommand("insertText", false, text);
      element.dispatchEvent(new Event("input", { bubbles: true })); return;
    }
    if (element.readOnly) throw new Error("字段只读，请手动填写");
    nativeSetter(element, text);
    await delay(350);
    const actual = clean(freshFieldValue(item, element));
    const expected = clean(text);
    if (actual !== expected) throw new Error("网页控件拒绝或截断了普通文本赋值");
  }

  async function ensureRecords(targets = {}, expectedUrl = location.href) {
    const added = [];
    for (const [section, desired] of Object.entries(targets)) {
      for (let guard = 0; guard < 12; guard += 1) {
        if (location.href !== expectedUrl) throw new Error("页面已跳转，停止添加记录");
        const fields = discover();
        const current = Math.max(0, ...fields.filter((field) => field.section === section && field.recordIndex != null).map((field) => field.recordIndex + 1));
        if (current >= desired) break;
        const repeater = discoverRepeaters(fields).find((item) => item.section === section);
        const button = repeater && (findRecruitmentAddButton(repeater.id) || document.querySelector(`[data-recruitment-add-id="${CSS.escape(repeater.id)}"]`));
        if (!button || !safeAddButton(button)) throw new Error(`未找到“${section}”区块的安全添加按钮`);
        button.click(); added.push(section);
        let increased = false;
        for (let wait = 0; wait < 20; wait += 1) {
          await delay(150);
          const count = Math.max(0, ...discover().filter((field) => field.section === section && field.recordIndex != null).map((field) => field.recordIndex + 1));
          if (count > current) { increased = true; break; }
        }
        if (!increased) throw new Error(`添加“${section}”后未出现新字段，已停止重复点击；请手动展开记录后重新扫描`);
      }
      const count = Math.max(0, ...discover().filter((field) => field.section === section && field.recordIndex != null).map((field) => field.recordIndex + 1));
      if (count < desired) throw new Error(`“${section}”记录尚未补齐，请检查后重新扫描`);
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
      const direct = findRecruitmentElement(directField.id);
      if (direct) return { element: direct, fieldId: directField.id, relocated: false };
    }

    const candidates = currentFields.map((field) => {
      if (item.section && field.section !== item.section) return { field, score: -1 };
      if (Number.isInteger(item.recordIndex) && field.recordIndex !== item.recordIndex) return { field, score: -1 };
      if (field.readOnly || !fieldMatchesPlanItem(field, item, true)) return { field, score: -1 };
      if ((!item.key || item.key === "unknown") && !item.label) return { field, score: -1 };
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
    const element = findRecruitmentElement(field.id);
    return element ? { element, fieldId: field.id, relocated: true } : null;
  }

  async function executePlan(items = [], expectedUrl = location.href) {
    const results = [];
    const blockedRows = new Set();
    const initial = discover();
    const rowKey = (item) => `${item.section}:${item.recordIndex}`;
    for (const item of items) {
      if ((item.recordIdentity || []).some((identity) => {
        const matches = initial.filter((field) => field.section === item.section && field.recordIndex === item.recordIndex && field.key === identity.key);
        return matches.length !== 1 || clean(matches[0].value) !== clean(identity.value);
      })) blockedRows.add(rowKey(item));
    }
    for (const item of items) {
      if (location.href !== expectedUrl || blockedRows.has(rowKey(item))) {
        results.push({ fieldId: item.fieldId, ok: false, error: "页面或经历身份已变化，已停止该记录的填写" }); continue;
      }
      const resolved = resolvePlanElement(item);
      if (!resolved) { results.push({ fieldId: item.fieldId, ok: false, error: "页面更新后无法唯一定位字段" }); continue; }
      try {
        const current = discover().find((field) => field.id === resolved.fieldId);
        if (current?.readOnly) throw new Error("字段已变为只读");
        if (item.currentValue != null && clean(current?.value) !== clean(item.currentValue) && clean(current?.value) !== clean(item.value)) throw new Error("字段内容自预览后已变化，请重新生成方案");
        await setValue(resolved.element, item.value, item);
        results.push({ fieldId: item.fieldId, resolvedFieldId: resolved.fieldId, relocated: resolved.relocated, ok: true });
        // Date pickers in some enterprise form stacks share transition state
        // across repeated rows. Give that state time to settle before touching
        // the next record; otherwise both rows can receive the next date.
        await delay(["start", "end", "birthDate", "dateRange"].includes(item.key) ? 1100 : 120);
      }
      catch (error) { results.push({ fieldId: item.fieldId, ok: false, error: error.message }); }
    }
    // A later widget change can reset an earlier React/Vue field. Re-read all
    // successful writes after the batch before reporting them as completed.
    const finalFields = discover();
    for (const result of results.filter((entry) => entry.ok)) {
      const item = items.find((entry) => entry.fieldId === result.fieldId);
      const candidates = finalFields.filter((field) => fieldMatchesPlanItem(field, item, true));
      const field = candidates.find((candidate) => candidate.id === result.resolvedFieldId) || (candidates.length === 1 ? candidates[0] : null);
      let matches = field && clean(field.value) === clean(item.value);
      if (field && /^(start|end)(Year|Month)$/.test(item.key || "")) {
        const actualPart = clean(field.value).replace(/[年月]/g, "");
        const expectedPart = clean(item.value).replace(/[年月]/g, "");
        matches = /^\d{1,4}$/.test(actualPart) && /^\d{1,4}$/.test(expectedPart)
          && Number(actualPart) === Number(expectedPart);
      }
      if (field && ["start", "end", "birthDate"].includes(item.key)) {
        const element = findRecruitmentElement(field.id);
        const expectedDate = dateAtControlPrecision(item.value, item.key, element);
        matches = Boolean(expectedDate) && dateAtControlPrecision(field.value, item.key, element) === expectedDate;
      }
      if (!matches) { result.ok = false; result.error = "填写后回读发现内容变化或未保留，请检查此项"; }
    }
    return results;
  }

  async function applyAgentPlan(items = [], additions = [], expectedUrl = location.href) {
    const targets = {};
    const failures = [];
    const pending = [];
    for (const item of items) {
      if (!item.virtual) { pending.push(item); continue; }
      const addition = additions.find((entry) => entry.fieldId === item.addId && entry.section === item.section);
      if (!addition || !Number.isInteger(item.recordIndex) || item.recordIndex < addition.fromCount || item.recordIndex >= addition.desired) {
        failures.push({ fieldId: item.fieldId, ok: false, error: "新增记录不在已确认方案中" }); continue;
      }
      targets[item.section] = Math.max(targets[item.section] || 0, item.recordIndex + 1);
      pending.push(item);
    }
    const blockedSections = new Set();
    for (const [section, desired] of Object.entries(targets)) {
      if (location.href !== expectedUrl) throw new Error("页面已跳转，停止添加记录");
      try { await ensureRecords({ [section]: desired }, expectedUrl); }
      catch (error) { blockedSections.add(section); failures.push(...pending.filter((item) => item.virtual && item.section === section).map((item) => ({ fieldId: item.fieldId, ok: false, error: error.message }))); }
    }
    const currentFields = discover();
    const unsafeRows = new Set();
    for (const item of pending.filter((entry) => entry.virtual)) {
      const row = currentFields.filter((field) => field.section === item.section && field.recordIndex === item.recordIndex);
      for (const identity of row.filter((field) => ["school", "company", "projectName"].includes(field.key) && clean(field.value))) {
        const expected = pending.find((entry) => entry.virtual && entry.section === item.section && entry.recordIndex === item.recordIndex && entry.key === identity.key);
        if (!expected || clean(expected.value) !== clean(identity.value)) unsafeRows.add(`${item.section}:${item.recordIndex}`);
      }
    }
    const bound = [];
    for (const item of pending) {
      if (!item.virtual) { bound.push(item); continue; }
      if (blockedSections.has(item.section)) continue;
      if (unsafeRows.has(`${item.section}:${item.recordIndex}`)) {
        failures.push({ fieldId: item.fieldId, ok: false, error: "新增记录带有其他经历的身份，已停止整条记录的填写" }); continue;
      }
      const matches = currentFields.filter((field) => field.section === item.section && field.recordIndex === item.recordIndex
        && field.key === item.key && norm(field.label) === norm(item.label) && field.control === item.control && field.type === item.type && !field.readOnly);
      if (matches.length !== 1 || (matches[0].maxLength && String(item.value).length > matches[0].maxLength)
        || (clean(matches[0].value) && clean(matches[0].value) !== clean(item.value))) {
        failures.push({ fieldId: item.fieldId, ok: false, error: "新增字段与预览模板不一致或已有内容，已跳过" }); continue;
      }
      bound.push({ ...item, originalFieldId: item.fieldId, fieldId: matches[0].id, domId: matches[0].domId, currentValue: matches[0].value });
    }
    const executed = await executePlan(bound, expectedUrl);
    return [...failures, ...executed.map((result, index) => ({ ...result, fieldId: bound[index]?.originalFieldId || result.fieldId }))];
  }

  // Kept inside Chrome's isolated content-script world for real-site compatibility tests.
  window.__recruitmentCopilotTest = { discover, discoverRepeaters, ensureRecords, executePlan, applyAgentPlan, semanticKey, assignRecordIndexes, querySelectorAllDeep, findRecruitmentElement, findRecruitmentAddButton, sectionFromText, customSelectRoot };

  let mutationBusy = false;
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    (async () => {
      if (message.expectedUrl && message.expectedUrl !== location.href) throw new Error("页面已跳转，请重新扫描");
      if (["RECRUITMENT_APPLY_AGENT_PLAN", "RECRUITMENT_ENSURE_RECORDS", "RECRUITMENT_EXECUTE_PLAN", "RECRUITMENT_FILL"].includes(message.type)) {
        if (mutationBusy) throw new Error("已有填表操作进行中，请勿重复执行");
        mutationBusy = true;
        // Cancel native submit events caused indirectly by a widget's click handler.
        const preventSubmit = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
        window.addEventListener("submit", preventSubmit, true);
        try {
          if (message.type === "RECRUITMENT_APPLY_AGENT_PLAN") return { ok: true, results: await applyAgentPlan(message.items || [], message.additions || [], message.expectedUrl || location.href) };
          if (message.type === "RECRUITMENT_ENSURE_RECORDS") return { ok: true, ...(await ensureRecords(message.targets || {})) };
          const items = message.type === "RECRUITMENT_FILL" ? [{ ...(message.field || {}), fieldId: message.id, value: message.value }] : message.items || [];
          const results = await executePlan(items, message.expectedUrl || location.href);
          return { ok: message.type !== "RECRUITMENT_FILL" || Boolean(results[0]?.ok), error: results[0]?.error, results };
        } finally { mutationBusy = false; window.removeEventListener("submit", preventSubmit, true); }
      }
      if (message.type === "RECRUITMENT_ANALYZE" || message.type === "RECRUITMENT_DISCOVER") {
        const fields = discover();
        return { ok: true, page: { url: location.href, title: document.title, host: location.host, fields, repeaters: discoverRepeaters(fields) }, fields };
      }
      if (message.type === "RECRUITMENT_HIGHLIGHT") {
        highlighted?.style.removeProperty("outline");
        highlighted = findRecruitmentElement(message.id);
        if (highlighted) { highlighted.style.outline = "2px solid #2563eb"; highlighted.scrollIntoView({ behavior: "smooth", block: "center" }); }
        return { ok: Boolean(highlighted) };
      }
      return { ok: false, error: "未知消息" };
    })().then(respond).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  });
})();
