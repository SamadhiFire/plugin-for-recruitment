import test from "node:test";
import assert from "node:assert/strict";
import { autoPlan } from "../server/server.mjs";
import { expandRecords, reviewPlan } from "../server/agent.mjs";

const profile = { basics: { name: "示例姓名", email: "example@example.test" }, education: [{ school: "示例大学", major: "新闻学" }, { school: "另一所大学", major: "经济学" }], applicationAnswers: { summary: "完成3次用户访谈" } };
const catalog = [
  { path: "basics.name", label: "姓名", aliases: ["姓名"] }, { path: "basics.email", label: "邮箱", aliases: ["邮箱"] },
  ...profile.education.flatMap((row, i) => [{ path: `education.${i}.school`, label: `${row.school}学校`, aliases: ["学校"] }, { path: `education.${i}.major`, label: `${row.school}专业`, aliases: ["专业"] }]),
  { path: "applicationAnswers.summary", label: "介绍", aliases: [] }
];
const field = (overrides = {}) => ({ id: "f", key: "name", label: "姓名", section: "basics", type: "text", control: "input", value: "", ...overrides });
const getValue = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
async function run(fields, proposed, respond, extra = {}) {
  const requests = [];
  const result = await reviewPlan({ fields, proposed, profile, catalog, profileFacts: { education: profile.education, applicationAnswers: profile.applicationAnswers },
    alignment: { mapping: { education: { 0: 0, 1: 1 } } }, host: "careers.example.test", directionPrompt: "", instruction: "",
    getValue, formattedValue: (_path, value) => String(value ?? ""), profilePathFor: () => null,
    equivalentValue: (a, b) => a === b,
    askModel: async (_system, user) => { const request = JSON.parse(user); requests.push(request); return respond(request); }, ...extra });
  return { ...result, requests };
}
const decision = (path, extra = {}) => ({ fieldId: "f", action: "map", path, confidence: "high", approved: true, ...extra });

test("agent reviews every rule match and internally corrects the wrong path", async () => {
  const result = await run([field()], [{ fieldId: "f", path: "basics.email", value: "example@example.test" }], () => [decision("basics.name")]);
  assert.equal(result.requests.length, 2);
  assert.equal(result.requests[0].fields[0].suggestedPath, undefined, "independent interpretation must not be anchored by rule proposals");
  assert.equal(result.requests[1].drafts[0].rulePath, "basics.email");
  assert.equal(result.plan[0].value, "示例姓名");
  assert.equal(result.plan[0].needsConfirmation, false);
  assert.equal(result.plan[0].verified, true);
  assert.equal(result.report.corrected, 1);
});

test("independent reviewer can repair an interpretation rejected by local checks", async () => {
  const result = await run([field()], [], (request) => [decision(request.stage === "interpret" ? "basics.email" : "basics.name")]);
  assert.match(result.requests[1].drafts[0].issue, /标签冲突/);
  assert.equal(result.plan[0].value, "示例姓名");
  assert.equal(result.plan[0].needsConfirmation, false);
});

test("two model approvals cannot bypass deterministic field-label constraints", async () => {
  const result = await run([field()], [], () => [decision("basics.email")]);
  assert.equal(result.plan[0].verified, false);
  assert.equal(result.plan[0].needsConfirmation, true);
  assert.match(result.plan[0].reason, /标签冲突/);
});

test("agent receives record identity, options, DOM context and sibling labels", async () => {
  const result = await run([
    field({ id: "school", section: "education", recordIndex: 0, key: "school", label: "学校", value: "示例大学" }),
    field({ section: "education", recordIndex: 0, key: "major", label: "专业", options: ["新闻学", "经济学"], context: { sectionHeading: "教育经历", name: "education[0].major" } })
  ], [], () => [decision("education.0.major")]);
  const envelope = result.requests[0].fields.find((item) => item.fieldId === "f");
  assert.equal(envelope.recordIdentity[0].value, "示例大学");
  assert.deepEqual(envelope.neighborLabels, ["学校", "专业"]);
  assert.equal(envelope.context.name, "education[0].major");
  assert.equal(result.plan.find((item) => item.fieldId === "f").needsConfirmation, false);
});

test("cross-record paths are rejected even when both model calls approve", async () => {
  const result = await run([field({ section: "education", recordIndex: 0, key: "major", label: "专业" })], [], () => [decision("education.1.major")]);
  assert.match(result.plan[0].reason, /记录不一致/);
  assert.equal(result.plan[0].verified, false);
});

test("model outage locally verifies an exact resume candidate", async () => {
  const result = await run([field()], [{ fieldId: "f", path: "basics.name", value: "示例姓名", confidence: "high", source: "resume" }], () => { throw new Error("offline"); });
  assert.equal(result.plan[0].needsConfirmation, false);
  assert.equal(result.plan[0].verified, true);
  assert.equal(result.plan[0].source, "local-verified");
  assert.equal(result.plan[0].value, "示例姓名");
  assert.equal(result.warnings.length, 1);
  assert.equal(result.report.modelCalls, 1);
  assert.equal(result.report.locallyVerified, 1);
});

test("correct prefilled knowledge-base values stay silent during a model outage", async () => {
  const result = await run([field({ value: "示例姓名" })], [], () => { throw new Error("offline"); }, { profilePathFor: () => "basics.name" });
  assert.equal(result.plan.length, 0);
  assert.equal(result.report.unchanged, 1);
  assert.equal(result.report.unresolved, 0);
});

test("an exact knowledge-base path wins when the model omits the field", async () => {
  const result = await run([field()], [], () => [], { profilePathFor: () => "basics.name" });
  assert.equal(result.plan[0].needsConfirmation, false);
  assert.equal(result.plan[0].value, "示例姓名");
  assert.equal(result.plan[0].source, "local-verified");
});

test("model outage does not promote an ambiguous or truncated candidate", async () => {
  const result = await run([field({ options: ["另一人"] })], [{ fieldId: "f", path: "basics.name", value: "示例姓名", confidence: "high", source: "resume" }], () => { throw new Error("offline"); });
  assert.equal(result.plan[0].needsConfirmation, true);
  assert.equal(result.plan[0].verified, false);
});

test("missing and duplicated review decisions are never auto-approved", async () => {
  for (const response of [[], [decision("basics.name"), decision("basics.email")]]) {
    const result = await run([field()], [], () => response);
    assert.equal(result.plan[0].needsConfirmation, true);
    assert.equal(result.plan[0].verified, false);
  }
});

test("reviewed replacements stay in the final plan while existing contact values remain local", async () => {
  const result = await run([field({ value: "用户手动输入" })], [], () => [decision("basics.name")]);
  assert.equal(result.plan[0].needsConfirmation, false);
  assert.equal(result.plan[0].replacesExisting, true);
  assert.equal(result.report.replacements, 1);
  assert.ok(!JSON.stringify(result.requests).includes("用户手动输入"));
  assert.equal(result.plan[0].currentValue, "用户手动输入");
});

test("an already correct field is checked internally without adding review work", async () => {
  const result = await run([field({ value: "示例姓名" })], [], () => [decision("basics.name")]);
  assert.equal(result.requests.length, 2);
  assert.equal(result.plan.length, 0);
  assert.equal(result.report.unchanged, 1);
});

test("verified generated prose can be prepared automatically when supported by cited facts", async () => {
  const result = await run([field({ key: "selfIntroduction", label: "自我介绍", type: "textarea", control: "textarea" })], [], () => [{
    fieldId: "f", action: "generate", value: "我完成了3次用户访谈。", evidencePaths: ["applicationAnswers.summary"], approved: true, confidence: "high"
  }]);
  assert.equal(result.plan[0].needsConfirmation, false);
});

test("generated facts with unsupported numbers are not automatically selected", async () => {
  const result = await run([field({ type: "textarea", control: "textarea", label: "介绍" })], [], () => [{
    fieldId: "f", action: "generate", value: "完成30次用户访谈。", evidencePaths: ["applicationAnswers.summary"], approved: true, confidence: "high"
  }]);
  assert.equal(result.plan[0].needsConfirmation, true);
  assert.match(result.plan[0].reason, /数字/);
});

test("option mismatch, missing facts and length limits survive AI approval", async () => {
  for (const overrides of [{ options: ["其他"] }, { maxLength: 1 }]) {
    const result = await run([field(overrides)], [], () => [decision("basics.name")]);
    assert.equal(result.plan[0].needsConfirmation, true);
  }
});

test("verification fields never enter model requests or executable plans", async () => {
  const result = await run([field({ label: "手机验证码", key: "phone" })], [], () => { throw new Error("should never run"); });
  assert.equal(result.requests.length, 0);
  assert.equal(result.plan.length, 0);
});

test("missing repeated records are previewed with a real field template", () => {
  const result = expandRecords({ fields: [field({ section: "education", key: "school", label: "学校", recordIndex: 0 })], repeaters: [{ section: "education" }] }, { targets: { education: 3 } });
  assert.equal(result.fields.length, 3);
  assert.equal(result.fields[1].virtual, true);
  assert.equal(result.fields[1].recordIndex, 1);
  assert.equal(result.fields[1].domId, "");
  assert.equal(result.additions[0].fromCount, 1);
});

test("the agent does not invent a missing section's field schema", () => {
  const result = expandRecords({ fields: [], repeaters: [{ section: "education" }] }, { targets: { education: 3 } });
  assert.equal(result.fields.length, 0);
  assert.equal(result.additions.length, 0);
  assert.equal(result.warnings.length, 1);
});

test("public auto-plan API uses the agent for deterministic matches too", async () => {
  const calls = [];
  const result = await autoPlan({ profileId: "ai_product_general", page: { fields: [field()] } }, { askModel: async (_system, user) => {
    calls.push(JSON.parse(user).stage); return [decision("basics.name")];
  } });
  assert.deepEqual(calls, ["interpret", "review"]);
  assert.equal(result.agentVersion, 2);
  assert.equal(result.plan[0].source, "agent-reviewed");
  assert.equal(result.plan[0].needsConfirmation, false);
});

test("tech-sales direction can invoke the automated agent", async () => {
  const stages = [];
  const result = await autoPlan({ profileId: "tech_sales", page: { fields: [field()] } }, { askModel: async (_system, user) => {
    const request = JSON.parse(user); stages.push(request.stage);
    return [decision(request.proposed?.[0]?.path || "basics.name")];
  } });
  assert.deepEqual(stages, ["interpret", "review"]);
  assert.ok(["agent-reviewed", "local-verified"].includes(result.plan[0].source));
});

test("model approval cannot turn internship facts into an unrelated full-time record", async () => {
  const result = await run([field({ section: "work", label: "工作描述", key: "description", type: "textarea" })], [], () => [{
    fieldId: "f", action: "generate", value: "完成3次用户访谈", evidencePaths: ["applicationAnswers.summary"], approved: true, confidence: "high"
  }]);
  assert.equal(result.plan[0].verified, false);
  assert.match(result.plan[0].reason, /不能挪用/);
});

test("applicant identity is never used as an emergency contact", async () => {
  const result = await run([field({ label: "紧急联系人姓名" })], [], () => [decision("basics.name")]);
  assert.equal(result.plan[0].verified, false);
  assert.match(result.plan[0].reason, /申请人/);
});
