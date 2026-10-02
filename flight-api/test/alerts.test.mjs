import { test } from "node:test";
import assert from "node:assert/strict";
import { cellOf, cellsAround, classify, countryOf, matchAlerts, parseSubscription, payload, signJWT } from "../src/alerts.js";
import EMERGENCY from "../src/emergency-aircraft.json" with { type: "json" };

const token = "a".repeat(64);
const subscription = { token, environment: "production", latitude: 51.50123, longitude: -0.12789, radiusKm: 8.05, services: ["police", "ambulance"], units: "mi" };

test("a subscription is checked and its location rounded to about a kilometre", () => {
  const s = parseSubscription(subscription);
  assert.equal(s.latitude, 51.5);
  assert.equal(s.longitude, -0.13);
  assert.deepEqual(s.services, ["police", "ambulance"]);
  assert.equal(parseSubscription({ ...subscription, token: "xyz" }), null);
  assert.equal(parseSubscription({ ...subscription, environment: "staging" }), null);
  assert.equal(parseSubscription({ ...subscription, radiusKm: 500 }), null);
  assert.equal(parseSubscription({ ...subscription, latitude: 95 }), null);
  assert.equal(parseSubscription({ ...subscription, services: ["police", "spies"] }), null);
  assert.equal(parseSubscription({ ...subscription, units: "nm" }), null);
  assert.notEqual(parseSubscription({ ...subscription, services: ["military"] }), null);   // kept, alerted by the app
});

test("cells around a point include its own, and wrap at the date line", () => {
  assert.ok(cellsAround(51.5, -0.13).includes(cellOf(51.5, -0.13)));
  assert.ok(cellsAround(51.5, -0.13).includes("52:0"));
  assert.ok(cellsAround(10, 179.5).includes("10:-180"));
  assert.ok(cellsAround(70, 20).length > cellsAround(0, 20).length);   // degrees of longitude shrink near the poles
});

test("known emergency aircraft and the national squawks are recognised; the rest aren't", () => {
  const [hex, service] = Object.entries(EMERGENCY).find(([, s]) => s === "police");
  assert.equal(classify({ hex, flight: "GPOLA   ", t: "EC45", lat: 51.5, lon: -0.1, alt_baro: 1500 }).service, service);
  assert.equal(classify({ hex: "407d36", flight: "HLE80", t: "A169", lat: 51.5, lon: -0.1, alt_baro: 900, squawk: "0020" }).service, "ambulance");
  assert.equal(classify({ hex: "407d36", flight: "HLE80", t: "A169", lat: 51.5, lon: -0.1, alt_baro: 900, squawk: "0020" }).name, "HLE80 (A169)");
  assert.equal(classify({ hex: "a12345", lat: 40, lon: -74, alt_baro: 900, squawk: "0020" }), null);   // not a US squawk
  assert.equal(classify({ hex: "407d36", lat: 51.5, lon: -0.1, alt_baro: "ground", squawk: "0020" }), null);
  assert.equal(classify({ hex: "4ca123", flight: "RYR1", lat: 51.5, lon: -0.1, alt_baro: 30000 }), null);
  assert.equal(countryOf("400a64"), "GB");
});

test("alerts go to subscribers within their distance, for their services, once", () => {
  const subscriber = { token, environment: "production", latitude: 51.5, longitude: -0.13, radius_km: 8.05, services: "police,ambulance", units: "mi" };
  const nearAmbulance = { hex: "407d36", service: "ambulance", name: "HLE80 (A169)", lat: 51.53, lon: -0.10 };   // ~2.5 mi NE
  const farPolice = { hex: "400a64", service: "police", name: "GPOLA (EC45)", lat: 51.9, lon: -0.13 };          // ~28 mi N
  const nearFire = { hex: "3c0001", service: "fire", name: "FIRE1", lat: 51.5, lon: -0.12 };
  const alerts = matchAlerts([subscriber], [nearAmbulance, farPolice, nearFire], new Set());
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].hex, "407d36");
  assert.equal(alerts[0].bodyKey, "sky.alert.body.ne");
  assert.deepEqual(alerts[0].args, ["HLE80 (A169)", "2 mi"]);
  assert.equal(matchAlerts([{ ...subscriber, units: "km" }], [nearAmbulance], new Set())[0].args[1], "4 km");
  assert.equal(matchAlerts([subscriber], [nearAmbulance], new Set([`${token}|407d36`])).length, 0);   // already told
});

test("the push is worded by the app's own translations", () => {
  const p = payload({ hex: "407d36", service: "ambulance", bodyKey: "sky.alert.body.ne", args: ["HLE80 (A169)", "2 mi"] });
  assert.equal(p.aps.alert["title-loc-key"], "sky.alert.title.ambulance");
  assert.equal(p.aps.alert["loc-key"], "sky.alert.body.ne");
  assert.deepEqual(p.aps.alert["loc-args"], ["HLE80 (A169)", "2 mi"]);
  assert.equal(p.hex, "407d36");
});

test("the APNs token is an ES256 JWT that verifies with the key's public half", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----`;
  const jwt = await signJWT(pem, "ABC123DEFG", "5L66N8999D", 1790912973);
  const [header, claims, signature] = jwt.split(".");
  const decode = (s) => JSON.parse(Buffer.from(s, "base64url").toString());
  assert.deepEqual(decode(header), { alg: "ES256", kid: "ABC123DEFG" });
  assert.deepEqual(decode(claims), { iss: "5L66N8999D", iat: 1790912973 });
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey,
    Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${claims}`));
  assert.ok(valid);
});
