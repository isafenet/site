import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGE_SIZE, parseBatch, shapeChanges } from "../src/sky-routes.js";

const heathrow = { icao: "EGLL", iata: "LHR", city: "London", latitude: 51.4706, longitude: -0.46194 };

test("a batch of changed routes and airports is accepted", () => {
  const batch = parseBatch({ changedAt: 1790900000, routes: [["BAW117", "EGLL-KJFK"], ["CPA450", "VHHH-RCTP-RJAA"], ["XYZ1", ""]], airports: [heathrow] });
  assert.deepEqual(batch.routes, [["BAW117", "EGLL-KJFK"], ["CPA450", "VHHH-RCTP-RJAA"], ["XYZ1", ""]]);
  assert.deepEqual(batch.airports, [heathrow]);
  assert.deepEqual(parseBatch({ changedAt: 1, routes: [], airports: [{ ...heathrow, iata: null }] }).airports[0].iata, null);
});

test("a malformed batch is refused whole", () => {
  const ok = { changedAt: 1790900000, routes: [["BAW117", "EGLL-KJFK"]], airports: [heathrow] };
  assert.notEqual(parseBatch(ok), null);
  assert.equal(parseBatch(null), null);
  assert.equal(parseBatch({ ...ok, changedAt: "yesterday" }), null);
  assert.equal(parseBatch({ ...ok, routes: [["baw 117", "EGLL-KJFK"]] }), null);       // not a callsign
  assert.equal(parseBatch({ ...ok, routes: [["BAW117", "EGLL"]] }), null);             // one airport isn't a route
  assert.equal(parseBatch({ ...ok, routes: [["BAW117", "EGLL-'; DROP"]] }), null);
  assert.equal(parseBatch({ ...ok, airports: [{ ...heathrow, latitude: "51" }] }), null);
  assert.equal(parseBatch({ ...ok, airports: [{ ...heathrow, iata: "LONDON" }] }), null);
  assert.equal(parseBatch({ ...ok, routes: Array(2001).fill(["BAW117", "EGLL-KJFK"]) }), null);
});

test("changes are pairs, with a cursor only when the page is full", () => {
  const some = shapeChanges(1790900000, [{ callsign: "BAW117", airports: "EGLL-KJFK" }, { callsign: "XYZ1", airports: "" }], [heathrow]);
  assert.deepEqual(some, { version: 1790900000, routes: [["BAW117", "EGLL-KJFK"], ["XYZ1", ""]], airports: [heathrow], next: null });
  const full = Array.from({ length: PAGE_SIZE }, (_, i) => ({ callsign: `AAA${i}`, airports: "EGLL-KJFK" }));
  assert.equal(shapeChanges(1, full, []).next, `AAA${PAGE_SIZE - 1}`);
});
