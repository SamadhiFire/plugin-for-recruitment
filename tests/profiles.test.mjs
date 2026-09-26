import test from "node:test";
import assert from "node:assert/strict";
import { candidatePlan as autoPlan, getProfileCatalog, getProfileContext } from "../server/server.mjs";

test("profile catalog exposes four ready directions", async () => {
  const catalog = await getProfileCatalog();
  assert.deepEqual(catalog.profiles.map(({ id, status }) => ({ id, status })), [
    { id: "ai_product_general", status: "ready" },
    { id: "ai_product_aigc", status: "ready" },
    { id: "tech_sales", status: "ready" },
    { id: "mkt_marketing", status: "ready" }
  ]);
  assert.match(catalog.profiles.find((profile) => profile.id === "mkt_marketing").advice.positioning, /产品市场/);
});

test("general direction resolves to the current complete resume", async () => {
  const { entry, profile } = await getProfileContext("ai_product_general", { requireReady: true });
  assert.equal(entry.label, "AI产品｜应用与商业化");
  assert.equal(profile.basics.name, "陈炀");
  assert.equal(profile.experience[0].company, "深圳市万声音乐文化");
  assert.match(profile.experience[0].bullets[0], /150 万级 DAU/);
  assert.match(profile.basics.summary[0], /AI 产品 & 独立开发者/);
  assert.match(profile.experience[0].bullets[1], /实现生态促活/);
  assert.match(profile.experience[1].bullets[0], /形成申请方案的决策链路/);
  assert.equal(profile.projects[0].description.split("\n").length, 3);
  assert.match(profile.projects[0].description, /^1\./);
});

test("AIGC direction resolves the updated resume while keeping projects in 1/2/3 format", async () => {
  const { entry, profile } = await getProfileContext("ai_product_aigc", { requireReady: true });
  assert.equal(entry.label, "AIGC产品｜内容与创作");
  assert.match(profile.experience[0].bullets[0], /AI 音乐产品 0[—-]1/);
  assert.match(profile.basics.summary[0], /AI 产品 & 独立开发者 \+ AIGC 实战/);
  assert.match(profile.applicationAnswers.aiToolsModels, /Runway Gen-3/);
  assert.match(profile.applicationAnswers.selfIntroduction, /AIGC 产品和独立开发/);
  assert.match(profile.applicationAnswers.whyAigcProductManager, /角色一致性/);
  assert.equal(profile.projects[0].description.split("\n").length, 3);
  assert.match(profile.projects[0].description, /^1\./);
  assert.match(profile.projects[0].description, /精细化 ROI 投放与内容种草/);
});

test("updating the AIGC resume does not overwrite the general direction", async () => {
  const { profile } = await getProfileContext("ai_product_general", { requireReady: true });
  assert.doesNotMatch(profile.projects[0].description, /精细化 ROI 投放与内容种草/);
  assert.match(profile.experience[0].bullets[0], /AI 音乐产品 0[—-]1/);
  assert.match(profile.projects[0].description, /亲密关系中隐性操控与沟通内耗/);
});

test("AIGC open questions map directly to the approved answer bank", async () => {
  const result = await autoPlan({
    profileId: "ai_product_aigc",
    page: {
      fields: [
        { id: "strengths", label: "个人优势", key: "coreStrengths", section: "summary", type: "textarea", control: "textarea", value: "" },
        { id: "intro", label: "自我介绍", key: "selfIntroduction", section: "summary", type: "textarea", control: "textarea", value: "" },
        { id: "motivation", label: "为什么选择AIGC产品经理", key: "whyAigcProductManager", section: "summary", type: "textarea", control: "textarea", value: "" }
      ]
    }
  });
  assert.deepEqual(result.plan.map((item) => item.path), [
    "applicationAnswers.coreStrengths",
    "applicationAnswers.selfIntroduction",
    "applicationAnswers.whyAigcProductManager"
  ]);
  assert.ok(result.plan.every((item) => item.source === "resume" && item.needsConfirmation === false));
});

test("tech-sales direction resolves the commercial resume without altering AI product directions", async () => {
  const { entry, profile } = await getProfileContext("tech_sales", { requireReady: true });
  assert.equal(entry.label, "AI解决方案｜售前与商业化");
  assert.match(profile.basics.summary[0], /科技商业化实战/);
  assert.match(profile.experience[0].bullets[0], /商业化破局 0[—-]1/);
  assert.match(profile.experience[1].bullets[0], /金融数字化方案落地/);
  assert.match(profile.experience[1].bullets[1], /政企数字化方案采购交付/);
  assert.match(profile.projects[0].description, /9\.9 元\/季 Pro/);
  assert.equal(profile.projects[2].description.split("\n").length, 3);
});

test("MKT direction resolves the market resume without altering other directions", async () => {
  const { entry, profile } = await getProfileContext("mkt_marketing", { requireReady: true });
  assert.equal(entry.label, "产品市场｜GTM与增长");
  assert.match(profile.basics.summary[0], /科技产品营销实战/);
  assert.match(profile.experience[0].bullets[0], /出海渠道 GTM 落地/);
  assert.match(profile.experience[1].bullets[1], /客观信任背书/);
  assert.match(profile.experience[2].bullets[1], /四因子归因模型/);
  assert.match(profile.projects[0].description, /获客转化链路/);
  assert.equal(profile.projects[2].description.split("\n").length, 3);
});

test("missing profile direction is rejected", async () => {
  await assert.rejects(autoPlan({ page: { fields: [] } }), /请先选择简历方向/);
});
