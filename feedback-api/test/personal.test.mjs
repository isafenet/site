import { test } from "node:test";
import assert from "node:assert/strict";
import { personalDetails } from "../../assets/feedback-personal.js";

test("ordinary feature requests are not flagged", () => {
  for (const text of [
    "Add a dark mode to the flight map",
    "I'd like my weight chart to show a 7-day average",
    "Support for Mounjaro KwikPen dose steps",
    "Let me log 2.5 kg plates on the barbell",
    "I want reminders for water",
    "A home screen widget for today's protein",
  ]) assert.deepEqual(personalDetails(text), [], text);
});

test("own health details are flagged", () => {
  assert.deepEqual(personalDetails("I'm on Mounjaro and the app should remind me"), ["health"]);
  assert.deepEqual(personalDetails("I was diagnosed with type 2 last year"), ["health"]);
  assert.deepEqual(personalDetails("I've lost 3 stone so far"), ["health"]);
  assert.deepEqual(personalDetails("my weight is 92"), ["health"]);
  assert.ok(personalDetails("my dose went up to 7.5mg").includes("dose"));
});

test("contact details are flagged", () => {
  assert.deepEqual(personalDetails("email me at someone@example.com"), ["contact"]);
  assert.deepEqual(personalDetails("call 07700 900123"), ["contact"]);
});
