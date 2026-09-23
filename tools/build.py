#!/usr/bin/env python3
"""Builds the iSafeNet company website (https://isafenet.app) into this repository.

    python3 tools/make_assets.py   # images, only when the brand pack or the app sites change
    python3 tools/build.py         # every page, sitemap.xml, robots.txt, CNAME, 404.html

Every page shares one header, footer and set of links, so the company site, AirReveal's site
(airreveal.isafenet.app) and GLPMGR's site (glpmgr.isafenet.app) always point at each other the same
way: the company links to each app's page here and deep into each app's own site, and each app's
structured data names https://isafenet.app/#organization as its publisher.
Deterministic: the same inputs make the same files.
"""
import html, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://isafenet.app/"
EMAIL = "info@isafenet.app"
ORG_ID = BASE + "#organization"
LASTMOD = "2026-09-23"
YEAR = 2026

AIR = "https://airreveal.isafenet.app/"
GLP = "https://glpmgr.isafenet.app/"

# ---------------------------------------------------------------- icons (24px stroke)
P = {
 "check": '<path d="M20 6 9 17l-5-5"/>',
 "arrow": '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
 "out": '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
 "mail": '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/>',
 "swift": '<path d="M4 15c3 3 9 4 13 1 2 1 3 3 3 3s1-4-1-7c-1-4-6-8-10-10 2 3 4 6 4 8-3-2-7-5-9-7 2 3 5 6 7 8-2 1-5 1-7 0z"/>',
 "devices": '<rect x="2" y="4" width="13" height="16" rx="2"/><rect x="17" y="8" width="5" height="12" rx="1.5"/><path d="M7 17h3"/>',
 "watch": '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6V3h6v3M9 18v3h6v-3"/><path d="M12 10v2l1.5 1.5"/>',
 "widget": '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/>',
 "shield": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
 "access": '<circle cx="12" cy="4.5" r="1.8"/><path d="M5 8.5 12 10l7-1.5"/><path d="M12 10v5l-3 6M12 15l3 6"/>',
 "offline": '<path d="M2 8.8a15 15 0 0 1 4.2-2.6M9.5 5.3A15 15 0 0 1 22 8.8M5 12.5a10 10 0 0 1 3.4-2M15 10.7a10 10 0 0 1 4 1.8M8.5 16a5 5 0 0 1 7 0"/><path d="m2 2 20 20"/><circle cx="12" cy="20" r="1"/>',
 "globe": '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
 "store": '<path d="M5 7h14l-1 13H6L5 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
 "spark": '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
 "map": '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
 "heart": '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
 "book": '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h8"/>',
 "chart": '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
 "lock": '<rect x="4" y="11" width="16" height="10" rx="3"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
 "bell": '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
 "compass": '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
 "star": '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
 "camera": '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
}


def icon(name, cls=""):
    c = f' class="{cls}"' if cls else ""
    return (f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
            f'stroke-linejoin="round" aria-hidden="true"{c}>{P[name]}</svg>')


def esc(s):
    return html.escape(s, quote=True)


def ld(obj):
    return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "</script>\n"


# ---------------------------------------------------------------- the two apps
APPS = {
    "airreveal": {
        "name": "AirReveal",
        "page": "airreveal.html",
        "site": AIR,
        "icon": "assets/img/apps/airreveal-icon.png",
        "kind": "Travel · iPhone & iPad",
        "category": "TravelApplication",
        "os": "iOS, iPadOS",
        "tagline": "See what you're flying over.",
        "summary": ("A window-seat companion that names the landmarks, cities and natural wonders below your plane, "
                    "tells you which side to look from, and keeps a journal of every flight, even in airplane mode."),
        "ticks": ["Live flight map that works offline, using only GPS",
                  "Landmarks named as you pass, and which window to look from",
                  "Landmark quizzes, Discovery Bingo, achievements and a country passport",
                  "A flight journal that turns your trips into a personal map of the world"],
        "chips": ["iPhone", "iPad", "Widgets", "Live Activities", "Offline maps", "6 languages"],
        "shots": ["airreveal-flight", "airreveal-discover", "airreveal-journal"],
    },
    "glpmgr": {
        "name": "GLPMGR",
        "page": "glpmgr.html",
        "site": GLP,
        "icon": "assets/img/apps/glpmgr-icon.png",
        "kind": "Health & Fitness · iPhone, iPad & Apple Watch",
        "category": "HealthApplication",
        "os": "iOS, iPadOS, watchOS",
        "tagline": "Your GLP-1 journey, tracked privately.",
        "summary": ("A calm, private tracker for people taking GLP-1 medicines such as Mounjaro, Wegovy and Ozempic: "
                    "doses and dose steps, reminders, injection sites, weight, side effects, water and protein."),
        "ticks": ["Dose reminders, dose steps (titration) and low-supply alerts",
                  "Injection areas taken only from each manufacturer's own leaflet",
                  "Weight, side effects, water, protein and blood glucose, gently",
                  "No account and no tracking: everything stays on your device"],
        "chips": ["iPhone", "iPad", "Apple Watch", "Mac", "Widgets", "Apple Health"],
        "shots": ["glpmgr-at-a-glance", "glpmgr-trends", "glpmgr-injection-areas"],
    },
}


def app_ld(key, with_page=True):
    a = APPS[key]
    obj = {"@context": "https://schema.org", "@type": "MobileApplication", "name": a["name"],
           "url": a["site"], "image": BASE + a["icon"], "description": a["summary"],
           "applicationCategory": a["category"], "operatingSystem": a["os"], "inLanguage": "en-GB",
           "publisher": {"@id": ORG_ID}, "author": {"@id": ORG_ID},
           "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"}}
    if with_page:
        obj["sameAs"] = [BASE + a["page"]]
    return obj


ORG = {"@context": "https://schema.org", "@type": "Organization", "@id": ORG_ID, "name": "iSafeNet",
       "url": BASE, "logo": BASE + "assets/favicon-192.png", "image": BASE + "assets/img/og.png",
       "email": EMAIL, "slogan": "Create. Ship. Evolve.",
       "description": "iSafeNet is an independent mobile app studio designing and building private, accessible apps for iPhone, iPad and Apple Watch.",
       "sameAs": ["https://github.com/isafenet"],
       "contactPoint": {"@type": "ContactPoint", "email": EMAIL, "contactType": "customer support", "availableLanguage": ["English"]},
       "owns": [{"@type": "MobileApplication", "name": "AirReveal", "url": AIR},
                {"@type": "MobileApplication", "name": "GLPMGR", "url": GLP}]}


def breadcrumbs(trail):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i, "name": n, "item": BASE + p} for i, (n, p) in enumerate(trail, 1)]}


# ---------------------------------------------------------------- shell
def head(title, desc, path, extra="", image="assets/img/og.png"):
    url = BASE + path
    return f'''<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="theme-color" content="#0a1522">
<link rel="canonical" href="{url}">
<link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png" media="(prefers-color-scheme: light)">
<link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32-dark.png" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/png" sizes="192x192" href="assets/favicon-192.png">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_GB">
<meta property="og:site_name" content="iSafeNet">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{BASE}{image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{BASE}{image}">
<link rel="preload" href="assets/fonts/pjs-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/site.css">
<script>document.documentElement.classList.add("js")</script>
{extra}</head>
<body>
<a class="skip" href="#main">Skip to content</a>
'''


def nav(current=None):
    links = [("Apps", "index.html#apps", None), ("AirReveal", "airreveal.html", "airreveal"),
             ("GLPMGR", "glpmgr.html", "glpmgr"), ("What we build", "index.html#build", None),
             ("Approach", "index.html#approach", None)]
    here = ' aria-current="page"'
    items = "".join(f'<a href="{h}"{here if current == k else ""}>{t}</a>' for t, h, k in links)
    return f'''<header class="nav" id="top"><div class="wrap">
  <a class="brand" href="index.html" aria-label="iSafeNet home"><img src="assets/img/mark.png" srcset="assets/img/mark@2x.png 2x" width="24" height="34" alt=""><span>iSafe<span class="net">Net</span></span></a>
  <button class="menu" aria-expanded="false" aria-controls="menu">Menu</button>
  <nav class="nav-links" id="menu" aria-label="Main">{items}<a class="cta" href="index.html#contact">Contact</a></nav>
</div></header>
'''


def footer():
    return f'''<footer class="footer"><div class="wrap">
  <div class="foot-grid">
    <div>
      <a class="brand" href="index.html"><img src="assets/img/mark.png" srcset="assets/img/mark@2x.png 2x" width="24" height="34" alt=""><span>iSafe<span class="net">Net</span></span></a>
      <p class="tag">An independent mobile app studio. We design, build and look after private, accessible apps for iPhone, iPad and Apple Watch.</p>
      <p style="margin-top:14px"><a href="mailto:{EMAIL}">{EMAIL}</a></p>
    </div>
    <div><h4>AirReveal</h4><ul>
      <li><a href="airreveal.html">About AirReveal</a></li>
      <li><a href="{AIR}">AirReveal website</a></li>
      <li><a href="{AIR}what-am-i-flying-over.html">What am I flying over?</a></li>
      <li><a href="{AIR}user-guide.html">AirReveal user guide</a></li>
      <li><a href="{AIR}support.html">AirReveal support</a></li>
    </ul></div>
    <div><h4>GLPMGR</h4><ul>
      <li><a href="glpmgr.html">About GLPMGR</a></li>
      <li><a href="{GLP}">GLPMGR website</a></li>
      <li><a href="{GLP}guide.html">GLPMGR user guide</a></li>
      <li><a href="{GLP}site-guidance.html">Injection sites by medicine</a></li>
      <li><a href="{GLP}glossary.html">GLP-1 words explained</a></li>
    </ul></div>
    <div><h4>iSafeNet</h4><ul>
      <li><a href="index.html#apps">Our apps</a></li>
      <li><a href="index.html#build">What we build</a></li>
      <li><a href="index.html#approach">How we work</a></li>
      <li><a href="index.html#contact">Contact</a></li>
      <li><a href="privacy.html">Website privacy</a></li>
    </ul></div>
  </div>
  <div class="fine"><span>© {YEAR} iSafeNet. Create. Ship. Evolve.</span><span>Apple, iPhone, iPad, Apple Watch, Mac and App Store are trademarks of Apple Inc. Medicine names are trademarks of their owners.</span></div>
</div></footer>
<script>
(function(){{
  var n=document.querySelector(".nav"),b=n&&n.querySelector(".menu");
  if(b){{b.addEventListener("click",function(){{var o=n.classList.toggle("open");b.setAttribute("aria-expanded",o)}});
    n.querySelectorAll(".nav-links a").forEach(function(a){{a.addEventListener("click",function(){{n.classList.remove("open");b.setAttribute("aria-expanded",false)}})}})}}
  var els=[].slice.call(document.querySelectorAll(".rv"));
  if(!("IntersectionObserver" in window)||/[?&]static/.test(location.search)){{els.forEach(function(e){{e.classList.add("in")}});return}}
  var io=new IntersectionObserver(function(en){{en.forEach(function(x){{if(x.isIntersecting){{x.target.classList.add("in");io.unobserve(x.target)}}}})}},{{rootMargin:"0px 0px -8% 0px",threshold:.05}});
  els.forEach(function(e){{io.observe(e)}});
}})();
</script>
</body></html>
'''


def shot(name, alt, cls="", eager=False, w=600, h=1260):
    lazy = "" if eager else ' loading="lazy"'
    return f'<img class="{cls}" src="assets/img/apps/{name}.webp" width="{w}" height="{h}" alt="{esc(alt)}"{lazy} decoding="async">'


def phone(name, alt, cls, eager=True):
    return f'<div class="phone {cls}">{shot(name, alt, eager=eager)}</div>'


def write(name, content):
    with open(os.path.join(ROOT, name), "w", encoding="utf-8") as f:
        f.write(content)


SHOT_ALT = {
    "airreveal-flight": "AirReveal live flight map showing a plane over Mongolia and the landmark below",
    "airreveal-discover": "AirReveal Discover screen listing landmarks overhead now and coming up",
    "airreveal-journal": "AirReveal flight journal with a live trip from London to Tokyo",
    "airreveal-collection": "AirReveal collection of landmarks discovered on past flights",
    "airreveal-plan": "AirReveal planning a flight from London Heathrow to Barcelona",
    "airreveal-profile": "AirReveal profile with achievements, passport and flights",
    "glpmgr-at-a-glance": "GLPMGR Today screen with next dose, goal, water and protein",
    "glpmgr-trends": "GLPMGR weight trends chart with every dose marked",
    "glpmgr-injection-areas": "GLPMGR injection body map showing the areas the manufacturer lists",
    "glpmgr-titration": "GLPMGR dose steps in the dosing schedule",
    "glpmgr-private-photos": "GLPMGR progress photos locked behind Face ID",
    "glpmgr-reminders": "GLPMGR dose reminder on the lock screen",
    "glpmgr-scan-a-label": "GLPMGR reading the protein figure from a food label",
    "glpmgr-daily-habits": "GLPMGR daily protein totals against a goal",
    "glpmgr-on-your-wrist": "GLPMGR on Apple Watch showing the next dose and weight trend",
}


def app_card(key, flip=False):
    a = APPS[key]
    cls = "air" if key == "airreveal" else "glp"
    ticks = "".join(f"<li>{icon('check')}<span>{esc(t)}</span></li>" for t in a["ticks"])
    chips = "".join(f"<li>{esc(c)}</li>" for c in a["chips"])
    shots = "".join(shot(s, SHOT_ALT[s]) for s in a["shots"])
    return f'''<article class="app-card {cls}{" flip" if flip else ""} rv" id="{key}">
  <div class="info">
    <div class="top"><img src="{a["icon"]}" width="68" height="68" alt="{a["name"]} app icon"><div><h3>{a["name"]}</h3><span>{esc(a["kind"])}</span></div></div>
    <p class="tagline">{esc(a["tagline"])}</p>
    <p class="desc">{esc(a["summary"])}</p>
    <ul class="ticks">{ticks}</ul>
    <ul class="chips" aria-label="Platforms and features">{chips}</ul>
    <div class="actions"><a class="btn" href="{a["page"]}">Explore {a["name"]} {icon("arrow")}</a><a class="btn light" href="{a["site"]}">{a["name"]} website {icon("out")}</a></div>
  </div>
  <div class="shots" aria-hidden="false">{shots}</div>
</article>'''


# ---------------------------------------------------------------- home
def build_index():
    caps = [
        ("swift", "Native Swift & SwiftUI", "Written natively in Swift, with SwiftUI, SwiftData and Swift 6 concurrency, so apps feel fast and at home on every device."),
        ("devices", "iPhone, iPad & Mac", "One codebase that adapts: roomy layouts on iPad, a proper window on Mac, and a comfortable column on iPhone."),
        ("watch", "Apple Watch", "Glanceable watch apps and complications for the moments when your phone isn't in reach."),
        ("widget", "Widgets & Live Activities", "Useful information on the Home Screen and Lock Screen, updating live without opening the app."),
        ("offline", "Offline-first", "GPS, maps and on-device text recognition that keep working in airplane mode or without a signal."),
        ("shield", "Private by design", "No accounts unless they're needed, no advertising, no tracking. Sensitive data stays on the device and is encrypted."),
        ("access", "Accessible to everyone", "Dynamic Type to the largest sizes, VoiceOver, Reduce Motion, clear contrast and plain, kind language."),
        ("store", "App Store launch", "StoreKit 2 subscriptions and free trials, App Store listings, screenshots, websites and user guides."),
    ]
    cap_html = "".join(f'<article class="card rv"><div class="ico">{icon(i)}</div><h3>{t}</h3><p>{d}</p></article>' for i, t, d in caps)

    principles = [
        ("heart", "People first", "We write for real people, not engineers: plain words, gentle tone, and a user guide and jargon buster with every app."),
        ("lock", "Your data is yours", "We don't run servers that collect your information. What you record stays on your device unless you choose to share it."),
        ("book", "Honest by default", "Clear pricing, no dark patterns, and straightforward disclaimers where they matter, such as health and travel safety."),
        ("spark", "Always improving", "Apps are never finished. We listen, refine and ship updates that make each app calmer and more useful."),
    ]
    prin_html = "".join(f'<article class="card rv"><div class="ico">{icon(i)}</div><h3>{t}</h3><p>{d}</p></article>' for i, t, d in principles)

    body = f'''{nav()}
<main id="main">
<section class="hero"><div class="wrap hero-grid">
  <div>
    <span class="pill"><i></i> Independent mobile app studio</span>
    <h1>We build calm, private apps for <span class="grad">iPhone, iPad and Apple&nbsp;Watch.</span></h1>
    <p class="lead">iSafeNet designs, builds and looks after native Apple apps that respect the people using them: beautiful to use, accessible to everyone, and private by design.</p>
    <div class="cta-row"><a class="btn" href="#apps">See our apps {icon("arrow")}</a><a class="btn ghost" href="#contact">Get in touch</a></div>
    <ul class="chips" aria-label="What we work with"><li>Swift</li><li>SwiftUI</li><li>iPhone</li><li>iPad</li><li>Apple Watch</li><li>Mac</li></ul>
  </div>
  <div class="devices" aria-label="Screens from our apps">
    {phone("airreveal-flight", SHOT_ALT["airreveal-flight"], "p1")}
    {phone("glpmgr-at-a-glance", SHOT_ALT["glpmgr-at-a-glance"], "p2")}
    {phone("airreveal-discover", SHOT_ALT["airreveal-discover"], "p3")}
  </div>
</div></section>

<section id="apps"><div class="wrap">
  <div class="sec-head rv"><span class="eyebrow">Our apps</span>
    <h2>Two new apps, made with care.</h2>
    <p>Each one solves a real, everyday problem, and both are coming soon to the App Store.</p></div>
  {app_card("airreveal")}
  {app_card("glpmgr", flip=True)}
</div></section>

<section class="alt" aria-label="iSafeNet in numbers"><div class="wrap">
  <div class="stats">
    <div class="stat rv"><b>2</b><span>apps in the portfolio</span></div>
    <div class="stat rv"><b>4</b><span>Apple platforms: iPhone, iPad, Apple Watch and Mac</span></div>
    <div class="stat rv"><b>6</b><span>languages on AirReveal's website</span></div>
    <div class="stat rv"><b>0</b><span>ads or tracking tools</span></div>
  </div>
</div></section>

<section id="build"><div class="wrap">
  <div class="sec-head rv"><span class="eyebrow">What we build</span>
    <h2>Native mobile apps, end to end.</h2>
    <p>From the first sketch to the App Store and every update after, built with Apple's own frameworks and design guidelines.</p></div>
  <div class="grid four">{cap_html}</div>
</div></section>

<section id="approach" class="alt"><div class="wrap">
  <div class="sec-head center rv"><span class="eyebrow">How we work</span>
    <h2>Create. Ship. Evolve.</h2>
    <p>Three words that describe how every iSafeNet app comes to life, and keeps getting better.</p></div>
  <div class="steps">
    <article class="step rv"><h3><span class="grad">Create</span></h3><p>We start with the person using the app and the problem in front of them, then design something calm and obvious.</p>
      <ul><li>Research and plain-language copy</li><li>SwiftUI prototypes on real devices</li><li>Accessibility from day one</li></ul></article>
    <article class="step rv"><h3><span class="grad">Ship</span></h3><p>We build carefully and test thoroughly, then launch with everything people need to get started.</p>
      <ul><li>Hundreds of automated tests</li><li>App Store listing, screenshots and website</li><li>User guides and support pages</li></ul></article>
    <article class="step rv"><h3><span class="grad">Evolve</span></h3><p>After launch we keep listening, fixing and refining, and we adopt new Apple features as they arrive.</p>
      <ul><li>Regular updates</li><li>New devices and OS releases</li><li>Feedback shapes what comes next</li></ul></article>
  </div>
</div></section>

<section aria-label="Our principles"><div class="wrap">
  <div class="sec-head rv"><span class="eyebrow">What we believe</span>
    <h2>Good apps treat people well.</h2></div>
  <div class="grid four">{prin_html}</div>
</div></section>

<section id="contact" style="padding-top:0"><div class="wrap">
  <div class="contact rv">
    <h2>Let's talk.</h2>
    <p>Questions about our apps, feedback, press or partnership enquiries: we read every message and reply personally.</p>
    <a class="btn" href="mailto:{EMAIL}">{icon("mail")} {EMAIL}</a>
  </div>
</div></section>
</main>
{footer()}'''
    extra = ld(ORG) + ld({"@context": "https://schema.org", "@type": "WebSite", "@id": BASE + "#website", "name": "iSafeNet",
                         "url": BASE, "inLanguage": "en-GB", "publisher": {"@id": ORG_ID}}) \
        + ld(app_ld("airreveal")) + ld(app_ld("glpmgr"))
    write("index.html", head("iSafeNet: Mobile App Studio for iPhone, iPad &amp; Apple Watch",
                             "iSafeNet is an independent mobile app studio building private, accessible apps for iPhone, iPad and Apple Watch, including AirReveal and GLPMGR.",
                             "", extra) + body)


# ---------------------------------------------------------------- app pages
def build_app(key):
    a = APPS[key]
    other = APPS["glpmgr" if key == "airreveal" else "airreveal"]
    if key == "airreveal":
        hero_phones = [("airreveal-plan", "p1"), ("airreveal-flight", "p2"), ("airreveal-journal", "p3")]
        gallery = ["airreveal-flight", "airreveal-discover", "airreveal-journal", "airreveal-collection", "airreveal-plan", "airreveal-profile"]
        lead = ("Ever looked out of the window and wondered what's down there? AirReveal places your plane on a live map using "
                "your device's GPS, names the landmarks, cities and natural wonders below and ahead, and tells you which side to look from. "
                "It works without in-flight Wi-Fi, and keeps every trip in your flight journal.")
        features = [
            ("map", "Live flight map", "Your position from GPS alone, on beautiful maps you download before take-off, so it works in airplane mode."),
            ("compass", "Which side to look", "Know whether a landmark, or the golden-hour sun, is on the left or right of the aircraft."),
            ("globe", "Discover what's below", "Landmarks, cities, coastlines and natural wonders named as you pass over them."),
            ("star", "Quizzes & Discovery Bingo", "Three quick questions about each landmark, bingo for the whole row, achievements and a passport."),
            ("book", "Flight journal", "Save every flight, collect the places you've seen and build a personal map of your travels."),
            ("widget", "Lock Screen & widgets", "Follow your progress at a glance with Live Activities and Home Screen widgets."),
        ]
        platforms = [("iPhone & iPad", "A comfortable view on iPhone and a wide flight map on iPad."),
                     ("Live Activities & widgets", "Flight progress on the Lock Screen and Home Screen."),
                     ("Six languages", "English, Spanish, French, German, Italian and Brazilian Portuguese."),
                     ("Built with", "Swift, SwiftUI, SwiftData, CoreLocation, MapLibre, WeatherKit, CloudKit, WidgetKit, ActivityKit and StoreKit.")]
        ipad = ("airreveal-ipad", "AirReveal on iPad with a wide live flight map", 900, 1200)
        links = [
            (AIR, "AirReveal website", "Everything about the app, with pricing and FAQ."),
            (AIR + "what-am-i-flying-over.html", "What am I flying over?", "How to see and name what's below your plane."),
            (AIR + "user-guide.html", "User guide", "Getting started, tips and a jargon buster."),
            (AIR + "support.html", "Support", "Help, troubleshooting and contact."),
            (AIR + "privacy.html", "Privacy Policy", "How AirReveal handles your data."),
            (AIR + "terms.html", "Terms of Use", "The agreement for using AirReveal."),
        ]
        langs = [("es/", "Español"), ("fr/", "Français"), ("de/", "Deutsch"), ("it/", "Italiano"), ("pt-br/", "Português (Brasil)")]
        lang_html = ('<p style="margin-top:22px;color:var(--ink-2)">AirReveal\'s website is also in ' +
                     ", ".join(f'<a href="{AIR}{p}" hreflang="{p.rstrip("/")}">{n}</a>' for p, n in langs) + ".</p>")
        pricing = "Free to plan and preview flights and to take your first Live-tracked flight. AirReveal Pro unlocks continued Live GPS tracking and the full in-flight experience."
        privacy = "AirReveal uses your location only to place you on the map during a flight. It isn't an official flight-status or aviation-safety service, so always follow your airline and crew."
        title = "AirReveal by iSafeNet: See What You're Flying Over"
        desc = "AirReveal is an offline flight map for iPhone and iPad that names the landmarks below your plane, shows which side to look from, and keeps your flight journal."
    else:
        hero_phones = [("glpmgr-titration", "p1"), ("glpmgr-at-a-glance", "p2"), ("glpmgr-trends", "p3")]
        gallery = ["glpmgr-at-a-glance", "glpmgr-trends", "glpmgr-daily-habits", "glpmgr-scan-a-label", "glpmgr-private-photos",
                   "glpmgr-titration", "glpmgr-injection-areas", "glpmgr-reminders", "glpmgr-on-your-wrist"]
        lead = ("GLPMGR helps people on GLP-1 medicines keep track of their doses, dose steps, weight and how they feel, without an account "
                "and without their data leaving their device. It's written in plain English, with a gentle tone and no judgement, for "
                "Mounjaro, Wegovy, Ozempic and other GLP-1 medicines.")
        features = [
            ("bell", "Doses & reminders", "Record injections or tablets in a few taps, with reminders when a dose is due and when supply runs low."),
            ("chart", "Dose steps", "Enter the steps your prescriber gave you and GLPMGR fills in the right dose each time, up to your maintenance dose."),
            ("map", "Injection sites", "Only the areas each manufacturer lists for your region, with a body map of where you've injected before."),
            ("heart", "Weight & side effects", "A gentle view of your progress, and a diary for how you feel, ready to share with your doctor or nurse."),
            ("camera", "Water, protein & labels", "Log water and protein, and read the protein figure straight from a food label with your camera."),
            ("lock", "Private by design", "No account, no ads, no tracking. Progress photos are encrypted and locked behind Face ID."),
        ]
        platforms = [("iPhone, iPad & Mac", "Native layouts for each, from one Swift codebase."),
                     ("Apple Watch", "Your next dose, weight trend and quick logging on your wrist."),
                     ("Widgets & Live Activities", "Your next dose on the Home Screen and Lock Screen."),
                     ("Built with", "Swift 6, SwiftUI, SwiftData, HealthKit, WidgetKit, ActivityKit, Vision, CryptoKit and StoreKit 2.")]
        ipad = ("glpmgr-ipad", "GLPMGR on iPad showing the Today dashboard", 1000, 1334)
        links = [
            (GLP, "GLPMGR website", "Features, screens, privacy and pricing."),
            (GLP + "guide.html", "User guide", "How to use GLPMGR, one step at a time."),
            (GLP + "glossary.html", "GLP-1 words explained", "Titration, half-life, mg, mmol/L and more, in plain English."),
            (GLP + "site-guidance.html", "Injection sites by medicine", "What each manufacturer says, for the UK, EU and US."),
            (GLP + "faq.html", "Questions and answers", "Everything people ask about GLPMGR."),
            (GLP + "support.html", "Support", "Help with subscriptions, backups and more."),
        ]
        meds = [("mounjaro", "Mounjaro"), ("wegovy", "Wegovy"), ("ozempic", "Ozempic"), ("zepbound", "Zepbound"), ("saxenda", "Saxenda")]
        lang_html = ('<p style="margin-top:22px;color:var(--ink-2)">Injection sites by medicine: ' +
                     ", ".join(f'<a href="{GLP}{s}-injection-sites.html">{n}</a>' for s, n in meds) + ", and more.</p>")
        pricing = "Free to use, with no time limits: doses and dose steps, reminders, weight, side effects, water, blood glucose, the Apple Watch app and backups. Premium adds more ways to see your progress, with a 7-day free trial on the yearly plan."
        privacy = "GLPMGR is a personal tracking tool, not a medical device, and it never suggests a dose or where to inject. Always follow the advice of your doctor, nurse or pharmacist."
        title = "GLPMGR by iSafeNet: Private GLP-1 Tracker for iPhone &amp; Apple Watch"
        desc = "GLPMGR is a private GLP-1 tracker for iPhone, iPad and Apple Watch: doses, dose steps, reminders, injection sites, weight and side effects for Mounjaro, Wegovy, Ozempic and more."

    feat_html = "".join(f'<article class="card rv"><div class="ico">{icon(i)}</div><h3>{t}</h3><p>{d}</p></article>' for i, t, d in features)
    plat_html = "".join(f'<li>{icon("check")}<span><b>{t}:</b> {d}</span></li>' for t, d in platforms)
    link_html = "".join(f'<a href="{u}"><b>{t}</b><span>{d}</span></a>' for u, t, d in links)
    gal_html = "".join(shot(s, SHOT_ALT[s]) for s in gallery)
    phones = "".join(phone(s, SHOT_ALT[s], c) for s, c in hero_phones)
    ipad_img = f'<img src="assets/img/apps/{ipad[0]}.webp" width="{ipad[2]}" height="{ipad[3]}" alt="{esc(ipad[1])}" loading="lazy" decoding="async">'
    art = f'<div class="art pair">{ipad_img}<img src="assets/img/apps/glpmgr-watch.webp" width="416" height="496" alt="GLPMGR on Apple Watch" loading="lazy"></div>' \
        if key == "glpmgr" else f'<div class="art">{ipad_img}</div>'

    body = f'''{nav(current=key)}
<main id="main">
<section class="hero app-hero"><div class="wrap hero-grid">
  <div>
    <p class="crumbs"><a href="index.html">iSafeNet</a> / <a href="index.html#apps">Apps</a> / {a["name"]}</p>
    <div class="app-id" style="margin-top:22px"><img src="{a["icon"]}" width="84" height="84" alt="{a["name"]} app icon"><div><span class="soon">Coming soon to the App Store</span><div class="kind" style="margin-top:8px">{esc(a["kind"])}</div></div></div>
    <h1>{a["name"]}: <span class="grad">{esc(a["tagline"])}</span></h1>
    <p class="lead">{esc(lead)}</p>
    <div class="cta-row"><a class="btn" href="{a["site"]}">Visit the {a["name"]} website {icon("out")}</a><a class="btn ghost" href="{links[2][0]}">{"Read the user guide" if key == "airreveal" else "GLP-1 words explained"}</a></div>
    <ul class="chips" aria-label="Platforms and features">{"".join(f"<li>{esc(c)}</li>" for c in a["chips"])}</ul>
  </div>
  <div class="devices" aria-label="Screens from {a["name"]}">{phones}</div>
</div></section>

<section><div class="wrap">
  <div class="sec-head rv"><span class="eyebrow">Highlights</span><h2>What {a["name"]} does.</h2></div>
  <div class="grid">{feat_html}</div>
</div></section>

<section class="alt" aria-label="{a["name"]} screens" style="padding-bottom:70px"><div class="wrap">
  <div class="sec-head rv"><span class="eyebrow">Screens</span><h2>A closer look.</h2><p>Swipe through the real app.</p></div></div>
  <div class="rail" role="group" aria-label="{a["name"]} screenshots" tabindex="0">{gal_html}</div>
</section>

<section><div class="wrap split">
  <div class="rv">
    <span class="eyebrow">Made for Apple devices</span>
    <h2 style="font-size:clamp(1.9rem,3.4vw,2.6rem);margin:12px 0 18px">Native on every screen it runs on.</h2>
    <ul class="ticks">{plat_html}</ul>
    <p style="color:var(--ink-2);margin-top:6px"><b>Pricing:</b> {esc(pricing)}</p>
    <p style="color:var(--ink-2);margin-top:12px"><b>Good to know:</b> {esc(privacy)}</p>
  </div>
  {art}
</div></section>

<section class="alt"><div class="wrap">
  <div class="sec-head rv"><span class="eyebrow">Learn more</span><h2>Guides, help and details.</h2>
    <p>{a["name"]} has its own website, with a full user guide, support and policies.</p></div>
  <div class="links rv">{link_html}</div>
  {lang_html}
</div></section>

<section><div class="wrap">
  <div class="sec-head rv"><span class="eyebrow">More from iSafeNet</span></div>
  <div class="more rv"><img src="{other["icon"]}" width="72" height="72" alt="{other["name"]} app icon">
    <div><h3>{other["name"]}</h3><p>{esc(other["tagline"])} {esc(other["summary"])}</p></div>
    <a class="btn" href="{other["page"]}">Explore {other["name"]} {icon("arrow")}</a></div>
</div></section>
</main>
{footer()}'''
    extra = ld(ORG) + ld(app_ld(key)) + ld(breadcrumbs([("iSafeNet", ""), ("Apps", "index.html#apps"), (a["name"], a["page"])]))
    image = "assets/img/og.png"
    write(a["page"], head(title, desc, a["page"], extra, image) + body)


# ---------------------------------------------------------------- privacy, 404, sitemap
def build_privacy():
    body = f'''{nav()}
<main id="main">
<div class="page-hero"><div class="wrap">
  <p class="crumbs"><a href="index.html">iSafeNet</a> / Website privacy</p>
  <h1>Website privacy</h1>
  <p>This page covers the iSafeNet company website, isafenet.app. Each app has its own Privacy Policy, linked below.</p>
</div></div>
<section><div class="wrap prose">
  <h2>What this website collects</h2>
  <p>Nothing. This website has no cookies, no analytics, no advertising and no tracking. It doesn't ask for or store any personal information, and its fonts and images are served from this site rather than from third parties.</p>
  <h2>Hosting</h2>
  <p>The site is a set of static pages hosted by GitHub Pages. Like any web host, GitHub may keep standard server logs (such as IP addresses) to keep the service secure and running; see GitHub's own privacy statement for details.</p>
  <h2>If you email us</h2>
  <p>If you write to <a href="mailto:{EMAIL}">{EMAIL}</a>, we use your message and email address only to reply to you, and we don't share them.</p>
  <h2>Our apps</h2>
  <p>Each app explains exactly how it handles your data: <a href="{AIR}privacy.html">AirReveal Privacy Policy</a> and <a href="{GLP}privacy.html">GLPMGR Privacy Policy</a>.</p>
  <h2>Changes</h2>
  <p>If this ever changes, we'll update this page. Last updated 23 September 2026.</p>
</div></section>
</main>
{footer()}'''
    extra = ld(breadcrumbs([("iSafeNet", ""), ("Website privacy", "privacy.html")]))
    write("privacy.html", head("Website Privacy: iSafeNet", "The iSafeNet website has no cookies, analytics or tracking. Links to the AirReveal and GLPMGR privacy policies.", "privacy.html", extra) + body)


def build_extras():
    write("CNAME", "isafenet.app")
    write(".nojekyll", "")
    pages = [("", "1.0"), ("airreveal.html", "0.9"), ("glpmgr.html", "0.9"), ("privacy.html", "0.3")]
    sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + \
         "".join(f"  <url><loc>{BASE}{p}</loc><lastmod>{LASTMOD}</lastmod><priority>{pr}</priority></url>\n" for p, pr in pages) + "</urlset>\n"
    write("sitemap.xml", sm)
    write("robots.txt", f"User-agent: *\nAllow: /\nSitemap: {BASE}sitemap.xml\n")
    body = f'''{nav()}
<main id="main"><div class="page-hero" style="padding:110px 0 130px;text-align:center"><div class="wrap">
  <p class="crumbs">404</p><h1>That page isn't here</h1>
  <p style="margin:0 auto 28px">The link may be out of date. Try our apps instead.</p>
  <div class="cta-row" style="justify-content:center"><a class="btn" href="index.html">iSafeNet home</a><a class="btn ghost" href="airreveal.html">AirReveal</a><a class="btn ghost" href="glpmgr.html">GLPMGR</a></div>
</div></div></main>
{footer()}'''
    # 404 must use absolute asset paths: GitHub serves it at whatever URL was missing.
    page = head("Page not found: iSafeNet", "That page doesn't exist.", "404.html") + body
    page = page.replace('href="assets/', 'href="/assets/').replace('src="assets/', 'src="/assets/').replace('srcset="assets/', 'srcset="/assets/') \
               .replace('href="index.html', 'href="/index.html').replace('href="airreveal.html', 'href="/airreveal.html') \
               .replace('href="glpmgr.html', 'href="/glpmgr.html').replace('href="privacy.html', 'href="/privacy.html') \
               .replace('url(fonts/', 'url(/assets/fonts/')
    write("404.html", page)


if __name__ == "__main__":
    build_index()
    build_app("airreveal")
    build_app("glpmgr")
    build_privacy()
    build_extras()
    print("site built into", ROOT)
