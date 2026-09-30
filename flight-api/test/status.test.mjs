import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFlightNumber, shapeStatus, statusParts } from "../src/index.js";

test("flight numbers are normalized or rejected", () => {
  assert.equal(normalizeFlightNumber(" ba 117 "), "BA117");
  assert.equal(normalizeFlightNumber("U28001"), "U28001");
  assert.equal(normalizeFlightNumber("BAW117"), "BAW117");
  assert.equal(normalizeFlightNumber("117"), null);
  assert.equal(normalizeFlightNumber("BA"), null);
});

test("status is reshaped with IATA airports and empty fields as null", () => {
  const r = shapeStatus("BA117", {
    flight_number: "BA 117", airline: "British Airways", status: "En Route",
    departure: { airport: "EGLL", scheduled_time: "10:30", actual_time: "10:35", terminal: "5", gate: "A12", checkin: "" },
    arrival: { airport: "KJFK", scheduled_time: "14:45", estimated_time: "14:50", terminal: "7", gate: "", baggage: "" },
  });
  assert.equal(r.found, true);
  assert.equal(r.status, "En Route");
  assert.equal(r.departure.airport, "LHR");
  assert.equal(r.departure.gate, "A12");
  assert.equal(r.departure.actual, "10:35");
  assert.equal(r.arrival.airport, "JFK");
  assert.equal(r.arrival.estimated, "14:50");
  assert.equal(r.arrival.gate, null);
  assert.equal(r.arrival.baggage, null);
});

test("no body is not found", () => {
  assert.deepEqual(shapeStatus("BA1", null), { flight: "BA1", found: false });
});

test("the live format: 'LHR • London' airports, '--' placeholders, a time in the status", () => {
  const r = shapeStatus("BA117", {
    status: "Departed 08:41",
    departure: { airport: "LHR • London", terminal: "5", gate: "C53", scheduled_time: "08:20", actual_time: "08:41" },
    arrival: { airport: "JFK • New York", terminal: "8", gate: "--", scheduled_time: "11:10", estimated_time: "10:38", baggage: "--" },
  });
  assert.equal(r.departure.airport, "LHR");
  assert.equal(r.arrival.airport, "JFK");
  assert.equal(r.arrival.gate, null);
  assert.equal(r.arrival.baggage, null);
  assert.equal(r.statusWord, "Departed");
  assert.equal(r.statusTime, "08:41");
});

test("status without a time", () => {
  assert.deepEqual(statusParts("En Route"), { statusWord: "En Route", statusTime: null });
  assert.deepEqual(statusParts(null), { statusWord: null, statusTime: null });
});
