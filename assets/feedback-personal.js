// Spots text that looks like someone's own health or contact details, so the board can warn before
// posting and flag it in the review queue. It never blocks: every post is reviewed by a person anyway.
// Shared by the page (assets/feedback.js) and the API (feedback-api/src/index.js).

const DOSE = /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|ug|iu|units?|mmol(?:\/l)?)\b/i;
const FIRST_PERSON = /\b(?:i|i'm|im|i've|ive|i'd|my|me|mine)\b/i;
const HEALTH = new RegExp("\\b(?:" + [
  "diagnos\\w*", "diabet\\w*", "pregnan\\w*", "postpartum", "surgery", "cancer", "tumou?r",
  "heart attack", "heart condition", "stroke", "angina", "arrhythmia", "blood pressure", "hypertension",
  "a1c", "hba1c", "depress\\w*", "anxiety", "eating disorder", "bulimi\\w*", "anorexi\\w*", "adhd",
  "prescri\\w*", "insulin",
  "mounjaro", "wegovy", "ozempic", "zepbound", "saxenda", "rybelsus", "tirzepatide", "semaglutide",
  "liraglutide", "metformin", "bisoprolol", "atenolol", "propranolol", "beta.?blockers?", "statins?",
  "sertraline", "fluoxetine", "my doctor", "my gp", "my consultant",
].join("|") + ")\\b", "i");
// Says something about their own body, not about a feature ("I've lost 3 stone", "I weigh 90 kg").
const OWN_BODY = /\bi(?:'ve| have)? (?:weigh|lost|gained|put on)\b|\bmy (?:weight|bmi) is\b/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE = /(?:\+?\d[\s-]?){9,}\d/;

/** Returns why the text may be personal: any of "dose", "health", "contact". Empty when it looks fine. */
export function personalDetails(text) {
  const reasons = new Set();
  const t = String(text || "");
  if (DOSE.test(t)) reasons.add("dose");
  for (const sentence of t.split(/[.!?\n]+/)) {
    if ((FIRST_PERSON.test(sentence) && HEALTH.test(sentence)) || OWN_BODY.test(sentence)) reasons.add("health");
  }
  if (EMAIL.test(t) || PHONE.test(t)) reasons.add("contact");
  return [...reasons];
}
