import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCallsign, airport, shape } from "../src/index.js";

test("callsigns are normalized or rejected", () => {
  assert.equal(normalizeCallsign(" baw 117 "), "BAW117");
  assert.equal(normalizeCallsign("DLH4A"), "DLH4A");
  assert.equal(normalizeCallsign("BA117"), null);
  assert.equal(normalizeCallsign("BAW"), null);
  assert.equal(normalizeCallsign("BAW12345"), null);
});

test("ICAO airports map to IATA", () => {
  assert.deepEqual(airport("egll"), { icao: "EGLL", iata: "LHR" });
  assert.deepEqual(airport("LHR"), { icao: null, iata: "LHR" });
  assert.equal(airport(""), null);
});

test("a high-confidence answer becomes one route", () => {
  const r = shape("BAW117", { confidence: "high", departure_icao: "EGLL", arrival_icao: "KJFK" });
  assert.equal(r.found, true);
  assert.equal(r.confidence, "high");
  assert.equal(r.departure.iata, "LHR");
  assert.equal(r.arrival.iata, "JFK");
});

test("a low-confidence answer keeps up to three suggestions, skipping unknown airports", () => {
  const r = shape("BAW999", { confidence: "low", routes: [
    { departure: "ZZZZ", arrival: "EGLL", duration_min: 60 },
    { departure: "EGLL", arrival: "LIRF", duration_min: 150 },
    { departure: "EGLL", arrival: "LFPG", duration_min: 70 },
    { departure: "EGLL", arrival: "EDDF", duration_min: 90 },
    { departure: "EGLL", arrival: "RJTT", duration_min: 800 },
  ] });
  assert.equal(r.confidence, "low");
  assert.equal(r.suggestions.length, 3);
  assert.equal(r.departure.iata, "LHR");
  assert.equal(r.arrival.iata, "FCO");
});

test("nothing usable is not found", () => {
  assert.equal(shape("BAW1", null).found, false);
  assert.equal(shape("BAW1", { confidence: "high", departure_icao: "ZZZZ", arrival_icao: "YYYY" }).found, false);
});
