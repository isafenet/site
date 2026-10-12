import { test } from "node:test";
import assert from "node:assert/strict";
import { askSkyLink } from "../src/index.js";

const answer = (status, headers = {}) => ({ status, ok: status < 400, headers: new Headers(headers) });

test("a 'too many requests' from SkyLink is waited out and asked again", async () => {
  const replies = [answer(429), answer(200)];
  const waits = [];
  const res = await askSkyLink("/flight_status/LS1828", { SKYLINK_API_KEY: "k" },
    { fetchImpl: async () => replies.shift(), sleep: async (ms) => waits.push(ms) });
  assert.equal(res.status, 200);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 1000);
});

test("Retry-After is followed when SkyLink sends it", async () => {
  const replies = [answer(429, { "retry-after": "2" }), answer(200)];
  const waits = [];
  await askSkyLink("/x", {}, { fetchImpl: async () => replies.shift(), sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(waits, [2100]);
});

test("it gives up after a few tries, returning the last answer", async () => {
  let calls = 0;
  const res = await askSkyLink("/x", {}, { fetchImpl: async () => { calls++; return answer(429); }, sleep: async () => {} });
  assert.equal(res.status, 429);
  assert.equal(calls, 4);
});

test("other answers come straight back", async () => {
  let calls = 0;
  const res = await askSkyLink("/x", {}, { fetchImpl: async () => { calls++; return answer(404); }, sleep: async () => {} });
  assert.equal(res.status, 404);
  assert.equal(calls, 1);
});
