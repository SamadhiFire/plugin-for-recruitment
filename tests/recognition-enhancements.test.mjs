import test from "node:test";
import assert from "node:assert/strict";
import { contentDOM, plain } from "./helpers/dom.mjs";
import { autoPlan, buildAlignment, getProfileContext, performSelfCheck, profilePathFor } from "../server/server.mjs";

function setup(t, html, url) {
  const env = contentDOM(html, url);
  t.after(() => env.dom.window.close());
  return env;
}

test("fuzzy and multi-language headings correctly map to sections", (t) => {
  const { api } = setup(t, `
    <h2>Education Background</h2>
    <label>学校<input id="edu-school"></label>
    <h2>工作及实习经历</h2>
    <label>公司<input id="work-comp"></label>
    <h2>Project Experience</h2>
    <label>项目<input id="proj-name"></label>
    <h2>Personal Information</h2>
    <label>姓名<input id="basic-name"></label>
    <h2>Skills & Certificates</h2>
    <label>技能<input id="skill-desc"></label>
  `);
  const fields = api.discover();
  const byId = Object.fromEntries(fields.map((f) => [f.domId, f]));
  assert.equal(byId["edu-school"]?.section, "education");
  assert.equal(byId["work-comp"]?.section, "experience");
  assert.equal(byId["proj-name"]?.section, "project");
  assert.equal(byId["basic-name"]?.section, "basics");
  assert.equal(byId["skill-desc"]?.section, "skills");
});

test("expanded semanticKey dictionary recognizes common enterprise field variants and English names", (t) => {
  const { api } = setup(t, `<div></div>`);
  const fake = (overrides = {}) => ({ id: "", name: "", type: "text", value: "", placeholder: "", className: "", closest: () => null, ...overrides });

  assert.equal(api.semanticKey(fake(), "院校名称", {}), "school");
  assert.equal(api.semanticKey(fake(), "就读学校", {}), "school");
  assert.equal(api.semanticKey(fake(), "University / Institution", {}), "school");

  assert.equal(api.semanticKey(fake(), "工作单位", {}), "company");
  assert.equal(api.semanticKey(fake(), "雇主名称", {}), "company");
  assert.equal(api.semanticKey(fake(), "Employer", {}), "company");

  assert.equal(api.semanticKey(fake(), "任职岗位", {}), "role");
  assert.equal(api.semanticKey(fake(), "职位名称", {}), "role");
  assert.equal(api.semanticKey(fake(), "Job Title", {}), "role");

  assert.equal(api.semanticKey(fake(), "最高学历", {}), "degree");
  assert.equal(api.semanticKey(fake(), "文化程度", {}), "degree");
  assert.equal(api.semanticKey(fake(), "Education Level", {}), "degree");

  assert.equal(api.semanticKey(fake(), "主修专业", {}), "major");
  assert.equal(api.semanticKey(fake(), "Major Name", {}), "major");

  assert.equal(api.semanticKey(fake(), "年级排名", {}), "rank");
  assert.equal(api.semanticKey(fake(), "班级排名", {}), "rank");
  assert.equal(api.semanticKey(fake(), "专业排名", {}), "rank");
  assert.equal(api.semanticKey(fake(), "平均绩点", {}), "gpa");

  assert.equal(api.semanticKey(fake(), "工作职责", {}), "description");
  assert.equal(api.semanticKey(fake(), "主要职责", {}), "description");
  assert.equal(api.semanticKey(fake(), "Responsibilities", {}), "description");

  assert.equal(api.semanticKey(fake(), "入学年月", {}), "start");
  assert.equal(api.semanticKey(fake(), "毕业年月", {}), "end");
  assert.equal(api.semanticKey(fake(), "起止年月", {}), "dateRange");
});

test("multi-language, aria-label and icon-only add buttons are discovered as repeaters", (t) => {
  const { api } = setup(t, `<form>
    <section>
      <h2>Education</h2>
      <button type="button" id="btn-edu">Add Education</button>
    </section>
    <section>
      <h2>Internship</h2>
      <button type="button" id="btn-exp" aria-label="Add Internship"></button>
    </section>
    <div class="record-section">
      <h2>项目经历</h2>
      <button type="button" id="btn-proj">+</button>
    </div>
  </form>`);

  const repeaters = api.discoverRepeaters();
  const bySection = Object.fromEntries(repeaters.map((r) => [r.section, r]));
  assert.ok(bySection.education, "Should discover English 'Add Education'");
  assert.equal(bySection.education.label, "Add Education");
  assert.ok(bySection.experience, "Should discover aria-label 'Add Internship'");
  assert.ok(bySection.project, "Should discover icon-only '+' within section");
});

test("bilingual add controls on a form expose empty internship and work sections", (t) => {
  const { api } = setup(t, `<form>
    <h2>实习经历 / Internship experience</h2><span role="button">+ 添加 / Add</span>
    <h2>工作经历 / Work experience</h2><span role="button">+ 添加 / Add</span>
    <h2>项目经历 / Projects</h2><span role="button">+ 添加 / Add</span>
  </form>`, "https://recruit.pg.com.cn/apply");
  assert.deepEqual(plain(api.discoverRepeaters().map(({ section }) => section)), ["experience", "work", "project"]);
});

test("long warnings beside ATS section titles do not hide internship add buttons", (t) => {
  const note = "请务必如实填写您所有的相关经历，这将是重要的评估依据。任何虚假信息、杜撰或伪造经历，一经查实，公司有权终止招聘流程、撤销录用通知。请珍视您的个人诚信";
  const block = (title) => `<div class="blockTitle-ats"><div class="header"><span>${title}</span><button type="button"><span>添加 / Add</span></button></div><p>${note}</p></div>`;
  const { api } = setup(t, `${block("教育背景 / Education")}${block("实习经历 / Internship experience")}${block("工作经历 / Work experience")}${block("项目经验 / Projects")}`, "https://recruit.pg.com.cn/apply");
  assert.deepEqual(plain(api.discoverRepeaters().map((entry) => entry.section)), ["education", "experience", "work", "project"]);
});

test("split year and month controls use their row heading when a select shows a numeric label", (t) => {
  const { api } = setup(t, `<h2>教育经历</h2><div class="form-item">
    <div>起止时间 / Period</div>
    <div><label>2025<select id="year-start"><option>2025</option></select></label>
    <label>9<select id="month-start"><option>9</option></select></label>
    <label>2027<select id="year-end"><option>2027</option></select></label>
    <label>6<select id="month-end"><option>6</option></select></label></div>
  </div>`);
  const fields = api.discover().filter((field) => field.domId);
  assert.deepEqual(plain(fields.map((field) => field.key)), ["startYear", "startMonth", "endYear", "endMonth"]);
  assert.deepEqual(plain(fields.map((field) => field.label)), ["开始年份", "开始月份", "结束年份", "结束月份"]);
});

test("P&G date widgets use the education or project row title instead of selected numbers", (t) => {
  const dates = `<label><span>2024</span><input id="start-year" value="2024"></label>
    <label><span>9</span><input id="start-month" value="9"></label>
    <label><span>2027</span><input id="end-year" value="2027"></label>
    <label><span>6</span><input id="end-month" value="6"></label>`;
  const { api } = setup(t, `<h2>教育背景</h2><div class="apply-field-ats"><div class="title-ats">就读时间 / Education period</div>${dates}</div>
    <h2>项目经验</h2><div class="apply-field-ats"><div class="title-ats">起止时间 / Period</div>
    ${dates.replaceAll('id="', 'id="project-')}<label>至今<input type="checkbox" id="project-present"></label></div>`);
  const fields = api.discover().filter((field) => /^(start|end)(Year|Month)$/.test(field.key));
  assert.deepEqual(plain(fields.slice(0, 4).map((field) => field.key)), ["startYear", "startMonth", "endYear", "endMonth"]);
  assert.deepEqual(plain(fields.slice(4).map((field) => field.key)), ["startYear", "startMonth", "endYear", "endMonth"]);
  assert.ok(fields.every((field) => !/^\d+$/.test(field.label)));
});

test("one generic resume row is a whole record even before another row is added", (t) => {
  const { api } = setup(t, `<h2>实习经历</h2><div class="resume-row">
    <div class="form-item"><div>起止时间</div><input id="begin-year"><input id="begin-month"><input id="finish-year"><input id="finish-month"></div>
    <div class="form-item"><div>公司名称</div><input id="company"></div>
    <div class="form-item"><div>职位名称</div><input id="role"></div>
  </div>`);
  const fields = api.discover().filter((field) => field.section === "experience");
  assert.equal(fields.length, 6);
  assert.ok(fields.every((field) => field.recordIndex === 0));
  assert.deepEqual(plain(fields.slice(0, 4).map((field) => field.key)), ["startYear", "startMonth", "endYear", "endMonth"]);
});

test("P&G groups all fields in each internship and project entry before counting records", async (t) => {
  const row = (section, index) => `<div class="apply-fields-BzcXI4i2Pm multi-NTCDdF2lci" data-row="${section}-${index}">
    <div class="apply-field-Q2iJ7AtQGX"><div class="title-ats">起止时间 / Period</div>
      <label>2026<input type="text" placeholder="年 / Year"></label>
      <label>5<input type="text" placeholder="月 / Month"></label>
      <label>2026<input type="text" placeholder="年 / Year"></label>
      <label>9<input type="text" placeholder="月 / Month"></label>
      <label>至今<input type="checkbox"></label></div>
    <div class="apply-field-Q2iJ7AtQGX"><div class="title-ats">${section === "experience" ? "公司名称 / Company" : "项目名称 / Project name"}</div><label><input type="text" placeholder="${section === "experience" ? "公司名称 / Company" : "项目名称 / Project name"}"></label></div>
    <div class="apply-field-Q2iJ7AtQGX"><div class="title-ats">${section === "experience" ? "职位名称 / Job title" : "项目描述 / Project description"}</div><label><input type="text"></label></div>
  </div>`;
  const block = (section, title) => `<div class="apply-block-KRDTLLb5hU"><div class="blockTitle-dcmrfhpkg1"><div><span>${title}</span><button type="button" data-add="${section}">添加 / Add</button></div><p>请务必如实填写您所有的相关经历，这将是重要的评估依据。</p></div><div data-rows="${section}">${row(section, 0)}</div></div>`;
  const { api, document } = setup(t, `${block("experience", "实习经历 / Internship experience")}${block("project", "项目经验 / Projects")}`, "https://recruit.pg.com.cn/apply");
  for (const section of ["experience", "project"]) {
    document.querySelector(`[data-add="${section}"]`).onclick = () => {
      const parent = document.querySelector(`[data-rows="${section}"]`);
      parent.insertAdjacentHTML("beforeend", row(section, parent.children.length));
    };
  }
  const inspect = (section) => api.discover().filter((field) => field.section === section);
  for (const section of ["experience", "project"]) {
    const fields = inspect(section);
    assert.ok(fields.length >= 6);
    assert.deepEqual(plain(fields.slice(0, 4).map((field) => field.key)), ["startYear", "startMonth", "endYear", "endMonth"]);
    assert.ok(fields.every((field) => field.recordIndex === 0), `${section} fields should remain in one entry`);
    assert.equal(api.discoverRepeaters().find((item) => item.section === section)?.currentCount, 1);
  }
  document.querySelector('[data-row="experience-0"] input[placeholder="公司名称 / Company"]').value = "深圳市丰巢科技";
  document.querySelector('[data-row="project-0"] input[placeholder="项目名称 / Project name"]').value = "自媒体运营（校园项目负责人）";
  for (const [section, values] of [["experience", ["2026", "5", "2025", "3"]], ["project", ["2026", "5", "2026", "4"]]]) {
    document.querySelectorAll(`[data-row="${section}-0"] [class*="apply-field"] input[type="text"]`)
      .forEach((input, index) => { if (index < 4) input.value = values[index]; });
  }
  const { profile } = await getProfileContext("ai_product_general");
  const alignment = buildAlignment(api.discover(), profile);
  assert.equal(alignment.targets.experience, 3);
  assert.equal(alignment.targets.project, 3);
  const internshipStart = inspect("experience").find((field) => field.key === "startYear");
  const projectEnd = inspect("project").find((field) => field.key === "endMonth");
  assert.equal(profilePathFor(internshipStart, alignment), "experience.2.start");
  assert.equal(profilePathFor(projectEnd, alignment), "projects.2.end");
  const planned = await autoPlan({ profileId: "ai_product_general", page: {
    host: "recruit.pg.com.cn", fields: api.discover(), repeaters: api.discoverRepeaters()
  } }, { askModel: async () => { throw new Error("offline"); } });
  assert.equal(planned.plan.find((item) => item.section === "experience" && item.recordIndex === 0 && item.key === "startYear")?.value, "2025");
  assert.equal(planned.plan.find((item) => item.section === "experience" && item.recordIndex === 0 && item.key === "startMonth")?.value, "11");
  assert.equal(planned.plan.find((item) => item.section === "project" && item.recordIndex === 0 && item.key === "endMonth")?.value, "6");
  const result = await api.ensureRecords({ experience: 3, project: 3 });
  assert.deepEqual(plain(result.added), ["experience", "experience", "project", "project"]);
  for (const section of ["experience", "project"]) {
    assert.deepEqual(plain([...new Set(inspect(section).map((field) => field.recordIndex))]), [0, 1, 2]);
    assert.equal(result.repeaters.find((item) => item.section === section)?.currentCount, 3);
  }
});

test("Shadow DOM input elements are discovered and resolvable by plan execution", async (t) => {
  const { api, document } = setup(t, `<h2>基本信息</h2><div id="host"></div>`);
  const host = document.getElementById("host");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<label>姓名<input id="shadow-name" type="text"></label>`;

  const fields = api.discover();
  const shadowField = fields.find((f) => f.domId === "shadow-name");
  assert.ok(shadowField, "Field inside Shadow DOM should be discovered");
  assert.equal(shadowField.label, "姓名");
  assert.equal(shadowField.key, "name");

  // Plan execution and resolution into Shadow DOM
  const results = await api.executePlan([{ ...shadowField, fieldId: shadowField.id, value: "测试候选人" }]);
  assert.equal(results[0]?.ok, true, "Plan item inside Shadow DOM should execute successfully");
  const shadowInput = shadow.getElementById("shadow-name");
  assert.equal(shadowInput.value, "测试候选人", "Shadow DOM input should receive the value");
});

test("performSelfCheck surfaces actionable diagnostics for missing sections, identity controls and unresolved rates", () => {
  const profile = {
    education: [{ school: "深圳大学", degree: "硕士" }],
    experience: [{ company: "万声音乐", role: "AI产品经理" }],
    projects: [{ name: "恋爱大师" }]
  };

  // Scenario 1: Page only has basic fields, missing education and experience
  const rawFields1 = [{ section: "basics", key: "name", value: "陈炀" }];
  const plan1 = [{ section: "basics", key: "name", value: "陈炀", needsConfirmation: false }];
  const alignment1 = { mapping: {} };
  const diagnostics1 = performSelfCheck(plan1, alignment1, profile, rawFields1);

  assert.ok(diagnostics1.some((d) => d.includes("教育经历") && d.includes("未识别到对应区块")));
  assert.ok(diagnostics1.some((d) => d.includes("实习/工作经历") && d.includes("未识别到对应区块")));

  // Scenario 2: High unconfirmed rate (>60%)
  const plan2 = [
    { section: "other", key: "q1", needsConfirmation: true },
    { section: "other", key: "q2", needsConfirmation: true },
    { section: "other", key: "q3", needsConfirmation: true },
    { section: "other", key: "q4", needsConfirmation: true },
    { section: "other", key: "q5", needsConfirmation: true },
    { section: "other", key: "q6", needsConfirmation: false }
  ];
  const diagnostics2 = performSelfCheck(plan2, alignment1, profile, []);
  assert.ok(diagnostics2.some((d) => d.includes("超过 60% 字段未能高置信自动映射")));

  // Scenario 3: Aligned record is missing school name input
  const rawFields3 = [
    { section: "education", recordIndex: 0, key: "major", value: "新闻传播" }
  ];
  const alignment3 = { mapping: { education: { 0: 0 } } };
  const diagnostics3 = performSelfCheck([], alignment3, profile, rawFields3);
  assert.ok(diagnostics3.some((d) => d.includes("深圳大学") && d.includes("未在对应卡片中识别到学校输入框")));

  // Scenario 4: Virtual card not yet rendered should NOT produce false alarm
  const alignment4 = { mapping: { education: { 1: 0 } } }; // recordIndex 1 doesn't exist on page yet
  const diagnostics4 = performSelfCheck([], alignment4, profile, rawFields3);
  assert.equal(diagnostics4.some((d) => d.includes("深圳大学") && d.includes("未在对应卡片中识别到学校输入框")), false);

  // Scenario 5: Page with 'work' section satisfies 'experience' check
  const rawFields5 = [{ section: "work", key: "company", value: "万声音乐" }];
  const diagnostics5 = performSelfCheck([], { mapping: {} }, { experience: [{ company: "万声音乐" }] }, rawFields5);
  assert.equal(diagnostics5.some((d) => d.includes("实习/工作经历") && d.includes("未识别到对应区块")), false);
});
