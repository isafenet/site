import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSpotter, parseSpotter, sighting, spotterPayload, typesForRun } from "../src/spotter.js";
import { cellOf, cellsAround } from "../src/alerts.js";

const token = "b".repeat(64);
const sub = { token, environment: "production", latitude: 51.47123, longitude: -0.45456, radiusKm: 80, types: ["a388", "B748"], units: "mi" };

test("a spotter subscription is checked, its types upper-cased and its location rounded", () => {
  const s = parseSpotter(sub);
  assert.deepEqual(s.types, ["A388", "B748"]);
  assert.equal(s.latitude, 51.47);
  assert.equal(parseSpotter({ ...sub, types: [] }), null);
  assert.equal(parseSpotter({ ...sub, types: ["A380; DROP"] }), null);
  assert.equal(parseSpotter({ ...sub, types: Array.from({ length: 13 }, (_, i) => `T${i}`) }), null);
  assert.equal(parseSpotter({ ...sub, radiusKm: 400 }), null);
  assert.equal(parseSpotter({ ...sub, token: "nope" }), null);
});

test("a run asks about every type when there are few, and takes turns when there are many", () => {
  assert.deepEqual(typesForRun(["B748", "A388", "A388"], 0), ["A388", "B748"]);
  const many = Array.from({ length: 20 }, (_, i) => `T${String(i).padStart(2, "0")}`);
  const seen = new Set([0, 1, 2].flatMap((run) => typesForRun(many, run)));
  assert.equal(typesForRun(many, 0).length, 8);
  assert.equal(seen.size, 20);   // three runs cover all twenty
});

test("airborne aircraft with a type are sightings; on the ground they aren't", () => {
  assert.deepEqual(sighting({ hex: "4CA123", flight: "UAE1  ", t: "A388", lat: 51.6, lon: -0.2, alt_baro: 12000 }),
    { hex: "4ca123", type: "A388", name: "UAE1 (A388)", lat: 51.6, lon: -0.2 });
  assert.equal(sighting({ hex: "4ca123", t: "A388", lat: 51.6, lon: -0.2, alt_baro: "ground" }), null);
  assert.equal(sighting({ hex: "4ca123", lat: 51.6, lon: -0.2 }), null);
});

test("subscribers hear about watched types within their distance, once per quiet period", () => {
  const s = { ...parseSpotter(sub), radius_km: 80, types: "A388,B748" };
  const a380 = { hex: "4ca123", type: "A388", name: "UAE1 (A388)", lat: 51.9, lon: -0.45 };
  const far = { ...a380, hex: "far", lat: 53.5 };
  const a320 = { ...a380, hex: "boring", type: "A320" };
  const alerts = matchSpotter([s], [a380, far, a320], new Set());
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].bodyKey, "sky.alert.body.n");
  assert.deepEqual(alerts[0].args, ["UAE1 (A388)", "30 mi"]);
  assert.equal(matchSpotter([s], [a380], new Set([`${token}|4ca123`])).length, 0);
  assert.equal(spotterPayload(alerts[0]).aps.alert["title-loc-key"], "sky.spotter.title");
});

test("cells reach far enough for a 100-mile radius, and emergency alerts' cells don't change", () => {
  assert.ok(cellsAround(51.5, -0.13, 161).includes("53:0"));
  assert.equal(cellsAround(51.5, -0.13).filter((c) => c.startsWith("53:")).length, 0);
  assert.ok(cellsAround(51.5, -0.13).includes(cellOf(51.5, -0.13)));
});
