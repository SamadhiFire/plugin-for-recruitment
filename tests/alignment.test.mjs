import test from "node:test";
import assert from "node:assert/strict";
import { candidatePlan as autoPlan, buildAlignment, profilePathFor } from "../server/server.mjs";

const profile = {
  education: [
    { school: "深圳大学" },
    { school: "香港浸会大学" },
    { school: "湖南工业大学" }
  ],
  experience: [],
  projects: []
};

test("education rows align by school identity even when the old page order differs", () => {
  const fields = [
    { section: "education", recordIndex: 0, key: "school", value: "湖南工业大学" },
    { section: "education", recordIndex: 0, key: "college", value: "传播学院" },
    { section: "education", recordIndex: 1, key: "school", value: "深圳大学" },
    { section: "education", recordIndex: 1, key: "college", value: "传理学院" },
    { section: "education", recordIndex: 2, key: "school", value: "香港浸会大学" },
    { section: "education", recordIndex: 2, key: "college", value: "经济与贸易学院" }
  ];
  const alignment = buildAlignment(fields, profile);
  assert.deepEqual(alignment.mapping.education, { 0: 2, 1: 0, 2: 1 });
  assert.equal(profilePathFor(fields[1], alignment), "education.2.college");
  assert.equal(profilePathFor(fields[3], alignment), "education.0.college");
  assert.equal(profilePathFor(fields[5], alignment), "education.1.college");
});

test("empty repeated rows are reused in deterministic profile order", () => {
  const fields = [0, 1, 2].flatMap((recordIndex) => [
    { section: "education", recordIndex, key: "school", value: "" },
    { section: "education", recordIndex, key: "degree", value: "" }
  ]);
  const alignment = buildAlignment(fields, profile);
  assert.deepEqual(alignment.mapping.education, { 0: 0, 1: 1, 2: 2 });
  assert.equal(alignment.targets.education, 3);
});

test("a mixed JD page is repaired as whole education records and stale text is cleared", async () => {
  const fields = [
    { id: "a-school", label: "学校名称", type: "text", control: "input", section: "education", recordIndex: 0, key: "school", value: "湖南工业大学" },
    { id: "a-start", label: "起止时间", type: "text", control: "input", section: "education", recordIndex: 0, key: "start", value: "2024-09-01" },
    { id: "a-college", label: "学院名称", type: "text", control: "input", section: "education", recordIndex: 0, key: "college", value: "传播学院" },
    { id: "a-degree", label: "学历层次", type: "text", control: "custom-select", section: "education", recordIndex: 0, key: "degree", value: "本科" },
    { id: "a-lab", label: "实验室", type: "text", control: "input", section: "education", recordIndex: 0, key: "laboratory", value: "深圳大学智能传播与数字社会治理实验室" },
    { id: "b-school", label: "学校名称", type: "text", control: "input", section: "education", recordIndex: 1, key: "school", value: "深圳大学" },
    { id: "b-start", label: "起止时间", type: "text", control: "input", section: "education", recordIndex: 1, key: "start", value: "2025-09-01" },
    { id: "b-college", label: "学院名称", type: "text", control: "input", section: "education", recordIndex: 1, key: "college", value: "传理学院" },
    { id: "b-highest", label: "是否最高学历", type: "radio", control: "radio", section: "education", recordIndex: 1, key: "isHighestDegree", value: "否" },
    { id: "b-advisor", label: "导师", type: "text", control: "input", section: "education", recordIndex: 1, key: "advisor", value: "张引" },
    { id: "c-school", label: "学校名称", type: "text", control: "input", section: "education", recordIndex: 2, key: "school", value: "香港浸会大学" },
    { id: "c-start", label: "起止时间", type: "text", control: "input", section: "education", recordIndex: 2, key: "start", value: "2018-09-01" },
    { id: "c-college", label: "学院名称", type: "text", control: "input", section: "education", recordIndex: 2, key: "college", value: "经济与贸易学院" },
    { id: "c-type", label: "学习形式", type: "text", control: "custom-select", section: "education", recordIndex: 2, key: "educationType", value: "非全日制" }
  ];
  const { alignment, plan } = await autoPlan({ profileId: "ai_product_general", page: { host: "campus.jd.com", fields } });
  assert.deepEqual(alignment.mapping.education, { 0: 2, 1: 0, 2: 1 });
  const byId = Object.fromEntries(plan.map((item) => [item.fieldId, item]));
  assert.equal(byId["a-start"].value, "2018-09");
  assert.equal(byId["a-college"].value, "经济与贸易学院");
  assert.equal(byId["a-lab"].clear, true);
  assert.equal(byId["b-start"].value, "2024-09");
  assert.equal(byId["b-college"].value, "传播学院");
  assert.equal(byId["b-highest"].value, "是");
  assert.equal(byId["b-advisor"].value, "巢乃鹏");
  assert.equal(byId["c-start"].value, "2025-09");
  assert.equal(byId["c-college"].value, "传理学院");
  assert.equal(byId["c-type"], undefined, "already-correct values should not be rewritten");
});
