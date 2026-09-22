import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";

const contentSource = await readFile(new URL("../../extension/content/content.js", import.meta.url), "utf8");
export function contentDOM(html, url = "https://careers.example.test/apply") {
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.CSS = { escape: (text) => String(text).replace(/["\\]/g, "\\$&") };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { width: this.dataset.zeroSize ? 0 : 120, height: this.dataset.zeroSize ? 0 : 24 };
  };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const timer = window.setTimeout.bind(window);
  window.setTimeout = (callback, _delay) => timer(callback, 0);
  let listener;
  window.chrome = { runtime: { onMessage: { addListener(callback) { listener = callback; } } } };
  window.eval(contentSource);
  return { dom, window, document: window.document, api: window.__recruitmentCopilotTest,
    message: (payload) => new Promise((resolve) => listener(payload, {}, resolve)) };
}
export const plain = (value) => JSON.parse(JSON.stringify(value));
