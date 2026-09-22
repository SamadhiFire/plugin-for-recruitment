import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../extension/sidepanel/sidepanel.html", import.meta.url), "utf8");
const script = await readFile(new URL("../extension/sidepanel/sidepanel.js", import.meta.url), "utf8");

test("direction is a visible required gate before refresh and plan generation", () => {
  assert.match(html, /id="profileDirection"/);
  assert.match(html, /id="refreshPage"[^>]*disabled/);
  assert.match(html, /id="buildPlan"[^>]*disabled/);
  assert.doesNotMatch(html, /id="variant"/);
});

test("all profile-dependent planning calls carry the selected profile id", () => {
  assert.match(script, /profileId, page, instruction:/);
  assert.match(script, /profileId: state\.profileId, task:/);
  assert.match(script, /state\.planProfileId !== state\.profileId/);
});
