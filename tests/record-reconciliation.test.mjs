import test from "node:test";
import assert from "node:assert/strict";
import { buildAlignment, autoPlan } from "../server/server.mjs";

const row = (section, recordIndex, values) => Object.entries(values).map(([key, value]) => ({ id: `${section}:${recordIndex}:${key}`, label: key, section, recordIndex, key, value }));
test("same company with old role/body but matching dates reuses the existing record", () => {
  const fields = row("experience", 0, { company: "示例公司", role: "产品助理", start: "2025-06", description: "旧版正文" });
  const result = buildAlignment(fields, { experience: [{ company: "示例公司", role: "AI产品实习生", start: "2025-06", bullets: ["新版正文"] }] });
  assert.deepEqual(result.mapping.experience, { 0: 0 });
  assert.equal(result.targets.experience, 1);
  assert.equal(result.recordActions[0].mode, "reuse");
});

test("same-company internships at different dates are kept separate", () => {
  const fields = [
    ...row("experience", 0, { company: "示例公司", role: "销售实习生", start: "2024-06" }),
    ...row("experience", 1, { company: "示例公司", role: "产品实习生", start: "2025-06" })
  ];
  const result = buildAlignment(fields, { experience: [
    { company: "示例公司", role: "产品实习生", start: "2025-06" },
    { company: "示例公司", role: "销售实习生", start: "2024-06" }
  ] });
  assert.deepEqual(result.mapping.experience, { 0: 1, 1: 0 });
  assert.equal(result.targets.experience, 2);
});

test("a weak first profile cannot steal a row that clearly belongs to a later profile", () => {
  const fields = row("education", 0, { school: "示例大学", degree: "硕士", start: "2024-09" });
  const result = buildAlignment(fields, { education: [
    { school: "示例大学", degree: "本科", start: "2024-09" },
    { school: "示例大学", degree: "硕士", start: "2024-09" }
  ] });
  assert.equal(result.mapping.education[0], 1);
  assert.equal(result.mapping.education[1], 0);
});

test("an ambiguous same-company record is preserved and a confirmed resume record is added", () => {
  const result = buildAlignment(row("experience", 0, { company: "示例公司", role: "销售实习生", start: "2022-01" }), {
    experience: [{ company: "示例公司", role: "产品实习生", start: "2025-06" }]
  });
  assert.deepEqual(result.mapping.experience, { 1: 0 });
  assert.equal(result.targets.experience, 2);
  assert.equal(result.recordIssues[0].kind, "ambiguous");
});

test("identical duplicate records are preserved and coverage takes priority over guessing", () => {
  const fields = [0, 1].flatMap((index) => row("education", index, { school: "示例大学", degree: "硕士" }));
  const result = buildAlignment(fields, { education: [{ school: "示例大学", degree: "硕士" }] });
  assert.deepEqual(result.mapping.education, { 2: 0 });
  assert.equal(result.targets.education, 3);
  assert.equal(result.recordIssues[0].kind, "ambiguous");
});

test("missing records use an actual blank row before adding another", () => {
  const fields = [...row("project", 0, { projectName: "旧项目", description: "已填写" }), ...row("project", 1, { projectName: "", description: "" })];
  const result = buildAlignment(fields, { projects: [{ name: "新项目" }] });
  assert.deepEqual(result.mapping.project, { 1: 0 });
  assert.equal(result.targets.project, 2);
  assert.equal(result.recordActions[0].mode, "fill");
  assert.equal(result.recordIssues[0].kind, "preserved");
});

test("an identity typo with multiple matching anchors is preserved rather than overwritten", () => {
  const fields = row("education", 0, { school: "示例大學", degree: "硕士", start: "2024-09" });
  const result = buildAlignment(fields, { education: [{ school: "示例大学", degree: "硕士", start: "2024-09" }] });
  assert.deepEqual(result.mapping.education, { 1: 0 });
  assert.equal(result.recordIssues[0].kind, "ambiguous");
});

test("the public agent exposes absent sections instead of claiming full coverage", async () => {
  const result = await autoPlan({ profileId: "ai_product_general", page: { fields: [] } }, { askModel: async () => [] });
  assert.ok(result.coverage.some((section) => section.total > 0 && section.existing === 0 && section.plannedNew === 0));
  assert.ok(result.warnings.some((warning) => warning.includes("尚未填写")));
});
