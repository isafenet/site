// iSafeNet feedback board (feedback.html). Talks to the feedback API Worker (feedback-api/).
// No accounts and no tracking: this browser keeps a random voter ID, the ideas it follows and the ideas it
// suggested, in localStorage only. Turnstile loads only when someone opens a form to post.
import { personalDetails } from "./feedback-personal.js";

const root = document.getElementById("board");
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const API = LOCAL ? "http://127.0.0.1:8787" : root.dataset.api;
const SITEKEY = LOCAL ? "1x00000000000000000000AA" : root.dataset.sitekey; // Cloudflare's test key locally

const APPS = {
  airreveal: { name: "AirReveal", icon: "assets/img/apps/airreveal-icon.png" },
  glpmgr: { name: "GLPMGR", icon: "assets/img/apps/glpmgr-icon.png" },
  udapt: { name: "Udapt", icon: "assets/img/apps/udapt-icon.png" },
  general: { name: "General", icon: "assets/img/mark.png" },
};
const STATUS = {
  open: "Open", considering: "Under consideration", planned: "Planned",
  started: "In progress", shipped: "Shipped", declined: "Not planned",
};
const ROADMAP = ["considering", "planned", "started"];
const WARN = {
  dose: "a dose or amount of medicine",
  health: "details about your own health",
  contact: "an email address or phone number",
};

// ---------------------------------------------------------------- browser-only memory

const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem("fb." + key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem("fb." + key, JSON.stringify(value)); } catch { /* private mode: fine */ } },
};
let voter = store.get("voter", null);
if (!voter) { voter = crypto.randomUUID(); store.set("voter", voter); }
let follows = store.get("follows", {});   // idea id -> updated_at last seen
let mine = store.get("mine", []);         // ids this browser suggested, until they're published
let voted = new Set();

const state = { ideas: [], loaded: false, error: "", app: "all", sort: "top", status: "active", q: "" };

// ---------------------------------------------------------------- helpers

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

const ICONS = {
  up: '<path d="m6 15 6-6 6 6"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  back: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  share: '<path d="M12 3v13"/><path d="m7 8 5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
};
function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true"); s.innerHTML = ICONS[name];
  return s;
}

const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
function ago(iso) {
  if (!iso) return "";
  const days = Math.round((Date.parse(iso) - Date.now()) / 864e5);
  if (days > -1) return "today";
  if (days > -30) return rtf.format(days, "day");
  if (days > -365) return rtf.format(Math.round(days / 30), "month");
  return rtf.format(Math.round(days / 365), "year");
}
const fullDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

async function api(path, body) {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function announce(text) {
  const live = document.getElementById("fb-live");
  live.textContent = "";
  setTimeout(() => { live.textContent = text; }, 50);
}

const appTag = (app) => h("span", { class: "fb-app" },
  h("img", { src: APPS[app].icon, alt: "", width: 18, height: 18 }), APPS[app].name);
const statusTag = (status) => status === "open" ? null : h("span", { class: `fb-status s-${status}` }, STATUS[status]);

// ---------------------------------------------------------------- Turnstile (loaded on demand)

let turnstileReady;
function loadTurnstile() {
  turnstileReady ??= new Promise((resolve, reject) => {
    window.onFbTurnstile = () => resolve(window.turnstile);
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onFbTurnstile";
    s.async = true;
    s.onerror = () => { turnstileReady = null; reject(new Error("The spam check couldn't load. Please check your connection.")); };
    document.head.append(s);
  });
  return turnstileReady;
}

/** Renders a Turnstile check into `box`; returns a function that gives the current token (or ""). */
function humanCheck(box) {
  let token = "", id = null;
  loadTurnstile().then((ts) => {
    id = ts.render(box, {
      sitekey: SITEKEY, action: "feedback", appearance: "interaction-only",
      callback: (t) => { token = t; }, "expired-callback": () => { token = ""; },
    });
  }).catch((e) => box.replaceChildren(h("p", { class: "fb-error" }, e.message)));
  return {
    token: () => token,
    reset: () => { token = ""; if (id !== null) window.turnstile?.reset(id); },
  };
}

// ---------------------------------------------------------------- loading

async function load() {
  try {
    const [list, votes] = await Promise.all([api("/api/ideas"), api("/api/votes/mine", { voter })]);
    state.ideas = list.ideas;
    voted = new Set(votes.ideas);
    state.error = "";
  } catch (e) {
    state.error = e.message;
  }
  state.loaded = true;
  render();
}

// ---------------------------------------------------------------- votes and follows

function follow(idea, on = true) {
  if (on) follows[idea.id] = idea.updated_at; else delete follows[idea.id];
  store.set("follows", follows);
}
function seen(idea) {
  if (idea.id in follows) { follows[idea.id] = idea.updated_at; store.set("follows", follows); }
}

async function toggleVote(idea, button) {
  const on = !voted.has(idea.id);
  button.disabled = true;
  try {
    const r = await api(`/api/ideas/${idea.id}/vote`, { voter, on });
    idea.votes = r.votes;
    if (on) { voted.add(idea.id); if (!(idea.id in follows)) follow(idea); } else voted.delete(idea.id);
    announce(on ? `Voted. ${plural(r.votes, "vote")}. You'll see updates to this idea here.` : `Vote removed. ${plural(r.votes, "vote")}.`);
    const fresh = voteButton(idea, button.classList.contains("big"));
    button.replaceWith(fresh);
    fresh.focus();
  } catch (e) {
    announce(e.message);
    button.disabled = false;
  }
}

function voteButton(idea, big = false) {
  const on = voted.has(idea.id);
  const closed = idea.status === "shipped" || idea.status === "declined";
  const b = h("button", {
    class: `fb-vote${on ? " on" : ""}${big ? " big" : ""}`, type: "button", "aria-pressed": String(on),
    disabled: closed, "aria-label": `${on ? "Remove your vote for" : "Vote for"} ${idea.title}. ${plural(idea.votes, "vote")}.`,
  }, icon("up"), h("span", {}, idea.votes));
  b.addEventListener("click", () => toggleVote(idea, b));
  return b;
}

// ---------------------------------------------------------------- views

function render() {
  const route = location.hash.slice(1) || "ideas";
  const m = route.match(/^idea-(\d+)$/);
  document.querySelectorAll(".fb-tabs a").forEach((a) => {
    const here = a.hash.slice(1) === route || (m && a.hash === "#ideas");
    if (here) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const view = document.getElementById("fb-view");
  if (!state.loaded) return view.replaceChildren(h("p", { class: "fb-empty" }, "Loading ideas…"));
  if (state.error) {
    return view.replaceChildren(h("div", { class: "fb-empty" },
      h("p", {}, `We couldn't load the board. ${state.error}`),
      h("button", { class: "btn light", type: "button", onclick: () => { state.loaded = false; render(); load(); } }, "Try again")));
  }
  renderNews();
  if (m) return renderIdea(view, +m[1]);
  const title = (text) => h("h2", { class: "sr" }, text);
  if (route === "roadmap") return view.replaceChildren(title("Roadmap"), appFilter(), roadmap());
  if (route === "shipped") return view.replaceChildren(title("Shipped"), appFilter(), shipped());
  view.replaceChildren(title("Ideas"), toolbar(), ideaList());
}

function renderNews() {
  const box = document.getElementById("fb-news");
  const byId = new Map(state.ideas.map((i) => [i.id, i]));
  const live = mine.filter((id) => byId.has(id));
  if (live.length) {
    mine = mine.filter((id) => !byId.has(id)); store.set("mine", mine);
    for (const id of live) if (!(id in follows)) follow(byId.get(id)); // hear when its status changes
  }
  const updated = state.ideas.filter((i) => i.id in follows && follows[i.id] < i.updated_at);
  const items = [
    ...live.map((id) => ({ idea: byId.get(id), text: "Your idea is now on the board" })),
    ...updated.map((i) => ({ idea: i, text: `Now ${STATUS[i.status].toLowerCase()}` })),
  ];
  const waiting = mine.length;
  if (!items.length && !waiting) return box.replaceChildren();
  box.replaceChildren(h("div", { class: "fb-news", role: "region", "aria-label": "Your updates" },
    icon("bell"),
    h("div", {},
      items.length ? h("p", {}, h("strong", {}, "News on ideas you follow")) : null,
      items.length ? h("ul", {}, items.map(({ idea, text }) =>
        h("li", {}, h("a", { href: `#idea-${idea.id}` }, idea.title), ` · ${text}`))) : null,
      waiting ? h("p", {}, `${plural(waiting, "idea")} you suggested ${waiting === 1 ? "is" : "are"} waiting for review. We read every one.`) : null)));
}

function appFilter() {
  const opts = [["all", "All apps"], ...Object.entries(APPS).map(([k, a]) => [k, a.name])];
  return h("div", { class: "fb-chips", role: "group", "aria-label": "Filter by app" },
    opts.map(([k, label]) => h("button", {
      type: "button", "data-app": k, "aria-pressed": String(state.app === k),
      onclick: () => { state.app = k; render(); document.querySelector(`.fb-chips [data-app=${k}]`)?.focus(); },
    }, k === "all" ? null : h("img", { src: APPS[k].icon, alt: "", width: 18, height: 18 }), label)));
}

function toolbar() {
  const search = h("input", { type: "search", id: "fb-q", placeholder: "Search ideas", value: state.q, "aria-label": "Search ideas" });
  search.addEventListener("input", () => {
    state.q = search.value;
    document.getElementById("fb-list").replaceWith(ideaList());
  });
  const sel = (id, label, value, options, key) => h("label", { class: "fb-select" }, h("span", {}, label),
    h("select", { id, onchange: (e) => { state[key] = e.target.value; render(); document.getElementById(id)?.focus(); } },
      options.map(([v, t]) => h("option", { value: v, selected: v === value }, t))));
  return h("div", { class: "fb-toolbar" },
    appFilter(),
    h("div", { class: "fb-row" }, search,
      sel("fb-sort", "Sort", state.sort, [["top", "Most votes"], ["trending", "Trending"], ["new", "Newest"], ["updated", "Recently updated"]], "sort"),
      sel("fb-status", "Show", state.status, [["active", "Open and planned"], ["all", "Everything"], ...Object.entries(STATUS)], "status")));
}

const words = (s) => s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];

function filtered() {
  const q = words(state.q);
  let list = state.ideas.filter((i) =>
    (state.app === "all" || i.app === state.app) &&
    (state.status === "all" ? true : state.status === "active" ? !["shipped", "declined"].includes(i.status) : i.status === state.status) &&
    (!q.length || q.every((w) => (i.title + " " + i.body).toLowerCase().includes(w))));
  const by = {
    top: (a, b) => b.pinned - a.pinned || b.votes - a.votes || b.id - a.id,
    trending: (a, b) => b.recent - a.recent || b.votes - a.votes || b.id - a.id,
    new: (a, b) => (b.published_at > a.published_at ? 1 : -1),
    updated: (a, b) => (b.updated_at > a.updated_at ? 1 : -1),
  }[state.sort];
  return list.sort(by);
}

function ideaCard(i) {
  return h("li", { class: "fb-card" },
    voteButton(i),
    h("div", { class: "fb-card-body" },
      h("h3", {}, h("a", { href: `#idea-${i.id}` }, i.title)),
      i.body ? h("p", { class: "fb-snippet" }, i.body.length >= 280 ? i.body.replace(/\s+\S*$/, "…") : i.body) : null,
      h("p", { class: "fb-meta" }, appTag(i.app), statusTag(i.status),
        i.pinned ? h("span", { class: "fb-pin" }, "Pinned") : null,
        h("span", {}, ago(i.published_at)),
        i.comments ? h("span", { class: "fb-count" }, icon("chat"), h("span", { class: "sr" }, "Comments: "), i.comments) : null)));
}

function ideaList() {
  const list = filtered();
  if (!list.length) {
    return h("div", { id: "fb-list", class: "fb-empty" },
      h("p", {}, state.ideas.length ? "No ideas match that." : "No ideas yet. Be the first!"),
      h("button", { class: "btn", type: "button", onclick: () => openForm(state.q) }, icon("plus"), "Share an idea"));
  }
  return h("ol", { id: "fb-list", class: "fb-list", "aria-label": `${plural(list.length, "idea")}` }, list.map(ideaCard));
}

function roadmap() {
  const ideas = state.ideas.filter((i) => state.app === "all" || i.app === state.app);
  const blurb = { considering: "We're looking into these.", planned: "We intend to build these.", started: "Being built now." };
  return h("div", { class: "fb-roadmap" }, ROADMAP.map((s) => {
    const col = ideas.filter((i) => i.status === s).sort((a, b) => b.votes - a.votes);
    return h("section", { class: `fb-col c-${s}`, "aria-labelledby": `col-${s}` },
      h("h2", { id: `col-${s}` }, STATUS[s], h("span", { class: "fb-n" }, col.length)),
      h("p", { class: "fb-blurb" }, blurb[s]),
      col.length
        ? h("ul", {}, col.map((i) => h("li", {},
            h("a", { href: `#idea-${i.id}` }, i.title),
            h("p", { class: "fb-meta" }, appTag(i.app), h("span", {}, plural(i.votes, "vote"))))))
        : h("p", { class: "fb-none" }, "Nothing here right now."));
  }));
}

function shipped() {
  const done = state.ideas.filter((i) => i.status === "shipped" && (state.app === "all" || i.app === state.app))
    .sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
  if (!done.length) return h("p", { class: "fb-empty" }, "Nothing shipped from the board yet. It's coming.");
  return h("ol", { class: "fb-shipped" }, done.map((i) => h("li", {},
    h("p", { class: "fb-meta" }, appTag(i.app), h("span", {}, i.version ? `Version ${i.version}` : "Shipped"), h("span", {}, fullDate(i.updated_at))),
    h("h3", {}, h("a", { href: `#idea-${i.id}` }, i.title)),
    i.note ? h("p", {}, i.note) : null,
    h("p", { class: "fb-thanks" }, `Thanks to the ${plural(i.votes, "person", "people")} who voted for it.`))));
}

// ---------------------------------------------------------------- one idea

async function renderIdea(view, id) {
  view.replaceChildren(h("p", { class: "fb-empty" }, "Loading…"));
  let data;
  try {
    data = await api(`/api/ideas/${id}`);
  } catch (e) {
    return view.replaceChildren(h("div", { class: "fb-empty" }, h("p", {}, e.message), h("a", { href: "#ideas" }, "Back to all ideas")));
  }
  if (data.merged_into) { location.replace(`#idea-${data.merged_into}`); return; }
  const idea = state.ideas.find((i) => i.id === id) || data.idea;
  Object.assign(idea, data.idea);
  seen(idea);
  const following = idea.id in follows;
  const back = h("a", { class: "fb-back", href: "#ideas" }, icon("back"), "All ideas");
  const followBtn = h("button", { class: `fb-ghost${following ? " on" : ""}`, type: "button", "aria-pressed": String(following),
    onclick: () => {
      const on = !(idea.id in follows);
      follow(idea, on);
      followBtn.classList.toggle("on", on);
      followBtn.setAttribute("aria-pressed", String(on));
      followBtn.lastChild.textContent = on ? "Following" : "Follow";
      announce(on ? "Following. News about this idea will show at the top of the board." : "Stopped following.");
    } },
    icon("bell"), h("span", {}, following ? "Following" : "Follow"));
  const shareBtn = h("button", { class: "fb-ghost", type: "button", onclick: async () => {
    const url = `${location.origin}${location.pathname}#idea-${id}`;
    try {
      if (navigator.share) await navigator.share({ title: idea.title, url });
      else { await navigator.clipboard.writeText(url); announce("Link copied."); }
    } catch { /* cancelled */ }
  } }, icon("share"), "Share");

  const timeline = [
    { status: "posted", note: "", created_at: idea.published_at },
    ...data.events,
  ];
  view.replaceChildren(h("article", { class: "fb-detail" },
    back,
    h("div", { class: "fb-detail-head" },
      voteButton(idea, true),
      h("div", {},
        h("p", { class: "fb-meta" }, appTag(idea.app), statusTag(idea.status), idea.version && idea.status === "shipped" ? h("span", {}, `Version ${idea.version}`) : null),
        h("h2", { tabindex: "-1", id: "fb-title" }, idea.title),
        h("p", { class: "fb-by" }, idea.by_team ? "From the iSafeNet team" : `Suggested by ${idea.author || "someone"}`, ` · ${fullDate(idea.published_at)}`),
        h("div", { class: "fb-actions" }, followBtn, shareBtn))),
    idea.body ? h("div", { class: "fb-text" }, idea.body) : null,
    idea.why ? h("div", { class: "fb-why" }, h("h3", {}, "What it would help with"), h("p", { class: "fb-text" }, idea.why)) : null,
    idea.note ? h("div", { class: `fb-reply s-${idea.status}` }, h("h3", {}, `From us · ${STATUS[idea.status]}`), h("p", { class: "fb-text" }, idea.note)) : null,
    h("section", { "aria-labelledby": "fb-tl" }, h("h3", { id: "fb-tl" }, "History"),
      h("ol", { class: "fb-timeline" }, timeline.map((e) => h("li", {},
        h("strong", {}, e.status === "posted" ? "Posted" : STATUS[e.status] + (e.version ? ` · version ${e.version}` : "")),
        h("span", {}, fullDate(e.created_at)),
        e.note && e.status !== "posted" && e.note !== idea.note ? h("p", {}, e.note) : null)))),
    h("section", { "aria-labelledby": "fb-cm" },
      h("h3", { id: "fb-cm" }, `Comments (${data.comments.length})`),
      data.comments.length
        ? h("ol", { class: "fb-comments" }, data.comments.map((c) => h("li", { class: c.by_team ? "team" : "" },
            h("p", { class: "fb-by" }, h("strong", {}, c.by_team ? "iSafeNet team" : c.author || "Someone"), ` · ${ago(c.created_at)}`),
            h("p", { class: "fb-text" }, c.body))))
        : h("p", { class: "fb-none" }, "No comments yet. How would you use this?"),
      commentForm(idea))));
  document.getElementById("fb-title").focus({ preventScroll: true });
  view.scrollIntoView({ block: "start" });
}

function commentForm(idea) {
  const body = h("textarea", { id: "fb-c-body", required: true, minlength: 2, maxlength: 1000, rows: 3 });
  const name = h("input", { id: "fb-c-name", maxlength: 40, autocomplete: "nickname" });
  const warn = h("div", { class: "fb-warn", "aria-live": "polite" });
  const box = h("div", { class: "fb-human" });
  const status = h("p", { class: "fb-form-status", role: "status" });
  let check = null;
  const form = h("form", { class: "fb-comment-form", novalidate: true },
    h("label", { for: "fb-c-body" }, "Add a comment"), body, warn,
    h("label", { for: "fb-c-name" }, "Your name ", h("span", { class: "fb-opt" }, "(optional, shown publicly)")), name,
    box, h("button", { class: "btn", type: "submit" }, "Post comment"), status);
  const startCheck = () => { check ??= humanCheck(box); };
  body.addEventListener("focus", startCheck);
  body.addEventListener("input", () => showWarning(warn, body.value));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    startCheck();
    if (body.value.trim().length < 2) { status.textContent = "Please write a comment first."; body.focus(); return; }
    if (!check.token()) { status.textContent = "Just a moment: we're checking you're a person. Try again in a second."; return; }
    form.querySelector("button").disabled = true;
    try {
      await api(`/api/ideas/${idea.id}/comments`, { body: body.value, author: name.value, turnstile: check.token() });
      form.replaceChildren(h("p", { class: "fb-done", role: "status" }, "Thanks! Your comment will appear once we've read it."));
    } catch (err) {
      status.textContent = err.message;
      check.reset();
      form.querySelector("button").disabled = false;
    }
  });
  return form;
}

function showWarning(box, text) {
  const found = personalDetails(text);
  box.replaceChildren(found.length ? h("p", {},
    h("strong", {}, "Heads up: "), `this looks like it might include ${found.map((f) => WARN[f]).join(" and ")}. `,
    "Everything here is public, so please leave out anything personal. We'll remove it if we spot it.") : "");
}

// ---------------------------------------------------------------- suggest an idea

const dialog = document.getElementById("fb-dialog");
let check = null;

function openForm(prefill = "") {
  const form = document.getElementById("fb-form");
  if (!form) { buildForm(); return openForm(prefill); }
  if (prefill && !form.elements.title.value) form.elements.title.value = prefill;
  if (state.app !== "all" && !form.querySelector("input[name=app]:checked")) {
    form.querySelector(`input[name=app][value=${state.app}]`).checked = true;
  }
  check ??= humanCheck(document.getElementById("fb-human"));
  dialog.showModal();
  similar();
}

function buildForm() {
  const f = h("form", { id: "fb-form", method: "dialog", novalidate: true },
    h("div", { class: "fb-dialog-head" },
      h("h2", { id: "fb-dialog-title" }, "Share an idea"),
      h("button", { type: "button", class: "fb-close", "aria-label": "Close", onclick: () => dialog.close() }, icon("x"))),
    h("fieldset", {}, h("legend", {}, "Which app is it for?"),
      h("div", { class: "fb-pick" }, Object.entries(APPS).map(([k, a]) =>
        h("label", {}, h("input", { type: "radio", name: "app", value: k, required: true }),
          h("img", { src: a.icon, alt: "", width: 28, height: 28 }), h("span", {}, a.name))))),
    h("label", { for: "fb-title-in" }, "Your idea in a few words"),
    h("input", { id: "fb-title-in", name: "title", required: true, minlength: 5, maxlength: 120, autocomplete: "off",
      placeholder: "e.g. A widget for today's protein", "aria-describedby": "fb-similar" }),
    h("div", { id: "fb-similar", "aria-live": "polite" }),
    h("label", { for: "fb-body-in" }, "Tell us more ", h("span", { class: "fb-opt" }, "(optional)")),
    h("textarea", { id: "fb-body-in", name: "body", rows: 3, maxlength: 2000, placeholder: "What would it do? Where would you find it?" }),
    h("label", { for: "fb-why-in" }, "What would it help you do? ", h("span", { class: "fb-opt" }, "(optional, but it helps us most)")),
    h("textarea", { id: "fb-why-in", name: "why", rows: 2, maxlength: 1000, placeholder: "e.g. Check my progress without opening the app" }),
    h("div", { id: "fb-warn", class: "fb-warn", "aria-live": "polite" }),
    h("label", { for: "fb-name-in" }, "Your name ", h("span", { class: "fb-opt" }, "(optional, shown publicly)")),
    h("input", { id: "fb-name-in", name: "author", maxlength: 40, autocomplete: "nickname" }),
    h("p", { class: "fb-small" }, "Everything on the board is public, so please don't include health details, medicines or anything personal. ",
      "We read every idea before it goes up."),
    h("div", { id: "fb-human", class: "fb-human" }),
    h("p", { id: "fb-form-status", class: "fb-form-status", role: "status" }),
    h("div", { class: "fb-dialog-foot" },
      h("button", { type: "button", class: "btn light", onclick: () => dialog.close() }, "Cancel"),
      h("button", { type: "submit", class: "btn", value: "send" }, "Send idea")));
  dialog.replaceChildren(f);
  dialog.setAttribute("aria-labelledby", "fb-dialog-title");
  const warnText = () => showWarning(document.getElementById("fb-warn"), [f.elements.title.value, f.elements.body.value, f.elements.why.value, f.elements.author.value].join("\n"));
  f.elements.title.addEventListener("input", () => { similar(); warnText(); });
  for (const n of ["body", "why", "author"]) f.elements[n].addEventListener("input", warnText);
  f.addEventListener("submit", submitIdea);
}

/** "Already suggested?" matches, so people vote instead of posting duplicates. */
function similar() {
  const box = document.getElementById("fb-similar");
  const title = document.getElementById("fb-title-in").value;
  const stop = new Set(["the", "and", "for", "with", "app", "add", "would", "like", "please", "option", "able", "can", "that", "this", "have"]);
  const q = words(title).filter((w) => !stop.has(w));
  if (q.length === 0) return box.replaceChildren();
  const scored = state.ideas.map((i) => {
    const t = new Set(words(i.title + " " + i.body));
    return { i, score: q.filter((w) => [...t].some((x) => x.startsWith(w.slice(0, Math.max(4, w.length - 2))))).length };
  }).filter((x) => x.score >= Math.min(2, q.length)).sort((a, b) => b.score - a.score || b.i.votes - a.i.votes).slice(0, 3);
  box.replaceChildren(scored.length ? h("div", { class: "fb-similar" },
    h("p", {}, h("strong", {}, "Already suggested?"), " If one of these is the same, voting for it counts for more:"),
    h("ul", {}, scored.map(({ i }) => h("li", {},
      h("a", { href: `#idea-${i.id}`, onclick: () => dialog.close() }, i.title),
      h("span", { class: "fb-meta" }, ` · ${APPS[i.app].name} · ${plural(i.votes, "vote")}`))))) : "");
}

async function submitIdea(e) {
  e.preventDefault();
  const f = e.target;
  const status = document.getElementById("fb-form-status");
  const app = f.querySelector("input[name=app]:checked")?.value;
  if (!app) { status.textContent = "Please choose which app it's for."; f.querySelector("input[name=app]").focus(); return; }
  if (f.elements.title.value.trim().length < 5) { status.textContent = "Please describe your idea in a few words."; f.elements.title.focus(); return; }
  if (!check.token()) { status.textContent = "Just a moment: we're checking you're a person. Try again in a second."; return; }
  const send = f.querySelector("button[type=submit]");
  send.disabled = true;
  status.textContent = "Sending…";
  try {
    const r = await api("/api/ideas", {
      app, title: f.elements.title.value, body: f.elements.body.value, why: f.elements.why.value,
      author: f.elements.author.value, turnstile: check.token(),
    });
    mine.push(r.id); store.set("mine", mine);
    check = null;
    dialog.replaceChildren(h("div", { class: "fb-sent" },
      h("h2", { id: "fb-dialog-title", tabindex: "-1" }, "Thanks for your idea!"),
      h("p", {}, "We read every idea before it goes on the board, usually within a few days. ",
        "When it's up, you'll see it at the top of this page on this device."),
      h("div", { class: "fb-dialog-foot" }, h("button", { class: "btn", type: "button", onclick: () => dialog.close() }, "Done"))));
    dialog.querySelector("h2").focus();
    renderNews();
  } catch (err) {
    status.textContent = err.message;
    check.reset();
    send.disabled = false;
  }
}

dialog.addEventListener("close", () => { if (!document.getElementById("fb-form")) dialog.replaceChildren(); });
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
document.querySelectorAll("[data-fb-new]").forEach((b) => b.addEventListener("click", () => openForm()));
document.querySelectorAll("[data-fb-feed]").forEach((a) => { a.href = `${API}/feed.xml`; });
window.addEventListener("hashchange", render);
render();
load();
