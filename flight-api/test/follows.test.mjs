import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, parseFollow, payload } from "../src/follows.js";

const token = "b".repeat(64);
const now = 1_800_000_000;
const follow = (extra = {}) => ({ token, environment: "production", hex: "4ca123", label: "BAW117", destination: "New York",
  last_alt: 35000, last_rate: 0, last_seen_at: now - 60, created_at: now - 3600, ...extra });

test("a follow is checked and tidied", () => {
  const f = parseFollow({ token, environment: "production", hex: "4CA123", label: " BAW117 ", destination: "New York" });
  assert.deepEqual(f, { token, environment: "production", hex: "4ca123", label: "BAW117", destination: "New York" });
  assert.equal(parseFollow({ token, environment: "production", hex: "xyz", label: "A" }), null);
  assert.equal(parseFollow({ token, environment: "production", hex: "4ca123", label: "" }), null);
  assert.equal(parseFollow({ token: "nope", environment: "production", hex: "4ca123", label: "A" }), null);
  assert.equal(parseFollow({ token, environment: "production", hex: "4ca123", label: "A" }).destination, null);
});

test("on the ground, or slow and low, it has landed", () => {
  assert.equal(judge(follow(), { alt_baro: "ground", gs: 20 }, now).kind, "landed");
  assert.equal(judge(follow(), { alt_baro: 300, gs: 45 }, now).kind, "landed");
});

test("still flying: what it's doing is remembered", () => {
  assert.deepEqual(judge(follow(), { alt_baro: 2800, gs: 160, baro_rate: -700 }, now), { kind: "flying", alt: 2800, rate: -700 });
  // Low but fast is a take-off or an approach, not a landing.
  assert.equal(judge(follow(), { alt_baro: 300, gs: 150 }, now).kind, "flying");
});

test("going quiet low and descending is a landing; going quiet at cruise is just out of reach", () => {
  assert.equal(judge(follow({ last_alt: 1800, last_rate: -600, last_seen_at: now - 10 * 60 }), null, now).kind, "landed");
  assert.equal(judge(follow({ last_alt: 1800, last_rate: -600, last_seen_at: now - 2 * 60 }), null, now).kind, "waiting");
  assert.equal(judge(follow({ last_alt: 37000, last_rate: 0, last_seen_at: now - 2 * 3600 }), null, now).kind, "waiting");
  // Climbing away low (just after take-off) and then lost isn't a landing.
  assert.equal(judge(follow({ last_alt: 2500, last_rate: 1800, last_seen_at: now - 20 * 60 }), null, now).kind, "waiting");
});

test("a day after the follow it's let go", () => {
  assert.equal(judge(follow({ created_at: now - 25 * 3600 }), { alt_baro: 35000 }, now).kind, "expired");
});

test("the push is worded by the app, with or without where it landed", () => {
  const p = payload(follow());
  assert.equal(p.aps.alert["title-loc-key"], "sky.landed.title");
  assert.deepEqual(p.aps.alert["title-loc-args"], ["BAW117"]);
  assert.equal(p.aps.alert["loc-key"], "sky.landed.body");
  assert.deepEqual(p.aps.alert["loc-args"], ["New York"]);
  assert.equal(payload(follow({ destination: null })).aps.alert["loc-key"], "sky.landed.bodyNoPlace");
});
