import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

async function render(pathname = "/") {
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the Hermes Tools homepage", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Hermes Tools/i);
  assert.match(html, /把麻煩的小事/);
  assert.match(html, /公平抽獎/);
  assert.match(html, /圖片去背/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("server-renders both tool routes", async () => {
  const [lottery, remover] = await Promise.all([render("/tools/lottery"), render("/tools/background-remover")]);
  assert.equal(lottery.status, 200); assert.equal(remover.status, 200);
  assert.match(await lottery.text(), /開始公平抽獎/);
  assert.match(await remover.text(), /把圖片拖到這裡/);
});
