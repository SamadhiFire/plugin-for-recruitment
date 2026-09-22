import test from "node:test";
import assert from "node:assert/strict";
import { candidatePlan as autoPlan, buildAlignment, getProfileContext, profilePathFor } from "../server/server.mjs";

const basics = (id, key, value = "") => ({ id, label: key, section: "basics", key, value, type: "text", control: "input" });
test("partial text is not treated as a complete resume match", async () => {
  const { profile } = await getProfileContext("ai_product_general");
  const result = await autoPlan({ profileId: "ai_product_general", page: { fields: [basics("name", "name", profile.basics.name.slice(0, 1)), basics("phone", "phone", "1")] } });
  assert.equal(result.plan.length, 2);
  assert.equal(result.plan[0].value, profile.basics.name);
});

test("unknown fields survive Qwen errors alongside deterministic answers", async () => {
  const result = await autoPlan({ profileId: "ai_product_general", page: { fields: [basics("name", "name"), basics("unknown", "unknown")] } }, { askModel: async () => { throw new Error("network down"); } });
  assert.equal(result.plan.length, 2);
  assert.equal(result.plan[0].source, "resume");
  assert.equal(result.plan[1].source, "missing");
  assert.equal(result.plan[1].needsConfirmation, true);
  assert.equal(result.warnings.length, 1);
});

test("Qwen mappings need confirmation, and duplicate IDs are ignored", async () => {
  const result = await autoPlan({ profileId: "ai_product_general", page: { fields: [basics("x", "unknown")] } }, { askModel: async () => [null, { fieldId: "x", path: "basics.name", confidence: "low" }, { fieldId: "x", value: "另一个答案" }] });
  assert.equal(result.plan.length, 1);
  assert.equal(result.plan[0].needsConfirmation, true);
  assert.equal(result.plan[0].source, "qwen-map");
});

test("Qwen cannot map a repeated field to a different resume record", async () => {
  const fields = [{ id: "school", label: "学校", section: "education", recordIndex: 0, key: "school", value: "深圳大学" }, { id: "x", label: "未知", section: "education", recordIndex: 0, key: "unknown", value: "" }];
  const result = await autoPlan({ profileId: "ai_product_general", page: { fields } }, { askModel: async () => [{ fieldId: "x", path: "education.1.major" }] });
  assert.equal(result.plan.find((item) => item.fieldId === "x").source, "missing");
});

test("records without identity but with existing content are preserved", () => {
  const alignment = buildAlignment([{ section: "education", recordIndex: 0, key: "school", value: "" }, { section: "education", recordIndex: 0, key: "major", value: "用户已有专业" }], { education: [{ school: "新学校" }] });
  assert.deepEqual(alignment.mapping.education, { 1: 0 });
  assert.equal(alignment.targets.education, 2);
});

test("sparse record indexes do not fabricate reusable page rows", () => {
  const alignment = buildAlignment([{ section: "education", recordIndex: 2, key: "school", value: "" }], { education: [{ school: "甲" }, { school: "乙" }] });
  assert.deepEqual(alignment.mapping.education, { 2: 0, 3: 1 });
});

test("portfolio paths do not depend on unrelated record alignment", () => {
  assert.equal(profilePathFor({ section: "works", key: "link", recordIndex: 0 }, { mapping: {} }), "basics.portfolio");
});

test("phone verification controls cannot receive a phone number", async () => {
  const field = { ...basics("code", "phone"), label: "手机验证码" };
  const result = await autoPlan({ profileId: "ai_product_general", page: { fields: [field] } }, { askModel: async () => { throw new Error("must not call model"); } });
  assert.equal(result.plan.length, 0);
});

test("shortened factual values require confirmation instead of automatic selection", async () => {
  const field = { ...basics("phone", "phone"), maxLength: 3 };
  const result = await autoPlan({ profileId: "ai_product_general", page: { fields: [field] } });
  assert.equal(result.plan[0].needsConfirmation, true);
  assert.match(result.plan[0].reason, /字数上限/);
});

test("a vague record name is not a deterministic identity match", () => {
  const alignment = buildAlignment([{ section: "education", recordIndex: 0, key: "school", value: "大学" }], { education: [{ school: "深圳大学" }] });
  assert.deepEqual(alignment.mapping.education, { 1: 0 });
});

test("stale body metrics cause an in-place update rather than a duplicate record", () => {
  const fields = [
    { section: "experience", recordIndex: 0, key: "company", value: "示例公司" },
    { section: "experience", recordIndex: 0, key: "role", value: "产品实习生" },
    { section: "experience", recordIndex: 0, key: "description", value: "1. 提升15倍" }
  ];
  const alignment = buildAlignment(fields, { experience: [{ company: "示例公司", role: "产品实习生", bullets: ["提升1.5倍"] }] });
  assert.deepEqual(alignment.mapping.experience, { 0: 0 });
  assert.equal(alignment.targets.experience, 1);
});
