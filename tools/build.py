#!/usr/bin/env python3
"""Builds the iSafeNet company website (https://isafenet.app) into this repository.

    python3 tools/make_assets.py         # images, only when the brand pack or the app sites change
    python3 tools/build.py               # every page, sitemap.xml, robots.txt, CNAME, 404.html
    python3 tools/build.py --new-app KEY # start apps/KEY.json for a new app (see README.md)

Each app is one file, apps/<key>.json: its card, its page here, its screenshots and where make_assets.py
copies its images from. Everything that lists the apps (the nav, footer, homepage, "More from iSafeNet",
structured data, sitemap, 404 page, privacy page and the feedback board's app list) is built from those
files, so adding an app never means editing this script.

The company site and the app sites (e.g. udapt.isafenet.app) point at each other the same way: the company
links to each app's page here and deep into each app's own site, and each app's structured data names
https://isafenet.app/#organization as its publisher. The feedback board (feedback.html) is a static page
here; its API is the Worker in feedback-api/.
Needs Pillow (for image sizes). Deterministic: the same inputs make the same files.
"""
import glob, html, json, os, re, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPS_DIR = os.path.join(ROOT, "apps")
BASE = "https://isafenet.app/"
EMAIL = "info@isafenet.app"
ORG_ID = BASE + "#organization"
LASTMOD = "2026-09-25"
YEAR = 2026
FEEDBACK_API = "https://isafenet-feedback.isafenet-feedback.workers.dev"
TURNSTILE_SITE_KEY = "0x4AAAAAAFDmH6KTeIIm11HZ"
NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"]

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
 "adapt": '<path d="M6.5 6.5 4 4M6.5 17.5 4 20M17.5 6.5 20 4M17.5 17.5 20 20"/><rect x="7" y="7" width="10" height="10" rx="2"/>',
 "cup": '<path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><path d="M6 1v3M10 1v3M14 1v3"/>',
 "robot": '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>',
 "plus": '<path d="M12 5v14M5 12h14"/>',
 "rss": '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
}


def icon(name, cls=""):
    c = f' class="{cls}"' if cls else ""
    paths = name if name.startswith("<") else P[name]  # an app may give its own SVG paths
    return (f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
            f'stroke-linejoin="round" aria-hidden="true"{c}>{paths}</svg>')


def esc(s):
    # Attributes are always double-quoted, so apostrophes can stay as they are.
    return html.escape(s, quote=True).replace("&#x27;", "'")


def ld(obj):
    return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "</script>\n"


def names(items, last="and"):
    items = list(items)
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + f" {last} " + items[-1]


def count_word(n):
    return NUMBER_WORDS[n] if n < len(NUMBER_WORDS) else str(n)


# ---------------------------------------------------------------- the apps (apps/*.json)
REQUIRED = ["order", "name", "site", "kind", "category", "os", "tagline", "summary", "blurb", "ticks", "chips",
            "colors", "card_shots", "home_shot", "screens", "footer", "page", "images_from"]
REQUIRED_PAGE = ["title", "description", "lead", "second_button", "hero", "features", "gallery", "platforms_heading",
                 "platforms", "pricing", "good_to_know", "art", "learn_more", "links"]


def load_apps():
    apps = []
    for path in sorted(glob.glob(os.path.join(APPS_DIR, "*.json"))):
        key = os.path.splitext(os.path.basename(path))[0]
        with open(path, encoding="utf-8") as f:
            a = json.load(f)
        a["key"] = key
        a["page_file"] = f"{key}.html"
        a["icon"] = f"assets/img/apps/{key}-icon.png"
        check_app(a, os.path.relpath(path, ROOT))
        apps.append(a)
    if not apps:
        sys.exit("No apps in apps/.")
    return sorted(apps, key=lambda a: (a["order"], a["key"]))


def check_app(a, where):
    """Stops the build with a plain message if an app file is incomplete, so a half-filled one can't ship."""
    problems = [f"missing \"{k}\"" for k in REQUIRED if k not in a]
    problems += [f"missing \"page.{k}\"" for k in REQUIRED_PAGE if k not in a.get("page", {})]
    if "TODO" in json.dumps(a):
        problems.append("still has TODO placeholders")
    if not problems:
        p = a["page"]
        used = a["card_shots"] + [a["home_shot"]] + p["hero"] + p["gallery"] + p["art"]
        used += a.get("framed_screens", [])
        problems += [f"screen \"{s}\" has no alt text in \"screens\"" for s in dict.fromkeys(used) if s not in a["screens"]]
        files = [f"{a['key']}-icon.png"] + [f"{s}.webp" for s in a["screens"]]
        problems += [f"image assets/img/apps/{f} not found (run tools/make_assets.py --apps-only)"
                     for f in files if not os.path.exists(os.path.join(ROOT, "assets", "img", "apps", f))]
        problems += [f"unknown icon \"{i}\"" for i, _, _ in p["features"] if not i.startswith("<") and i not in P]
    if problems:
        sys.exit(f"{where}:\n  " + "\n  ".join(problems))


def link(a, path):
    """A path in an app file is relative to that app's own website, unless it's a full URL."""
    return path if path.startswith(("https://", "http://")) else a["site"] + path


def app_ld(a, with_page=True):
    obj = {"@context": "https://schema.org", "@type": "MobileApplication", "name": a["name"],
           "url": a["site"], "image": BASE + a["icon"], "description": a["summary"],
           "applicationCategory": a["category"], "operatingSystem": a["os"], "inLanguage": "en-GB",
           "publisher": {"@id": ORG_ID}, "author": {"@id": ORG_ID},
           "offers": {"@type": "Offer", "price": a.get("price", "0"), "priceCurrency": "GBP"}}
    if with_page:
        obj["sameAs"] = [BASE + a["page_file"]]
    return obj


def org():
    return {"@context": "https://schema.org", "@type": "Organization", "@id": ORG_ID, "name": "iSafeNet",
            "url": BASE, "logo": BASE + "assets/favicon-192.png", "image": BASE + "assets/img/og.png",
            "email": EMAIL, "slogan": "Create. Ship. Evolve.",
            "description": "iSafeNet is an independent mobile app studio designing and building private, accessible apps for iPhone, iPad and Apple Watch.",
            "sameAs": ["https://github.com/isafenet"],
            "contactPoint": {"@type": "ContactPoint", "email": EMAIL, "contactType": "customer support", "availableLanguage": ["English"]},
            "owns": [{"@type": "MobileApplication", "name": a["name"], "url": a["site"]} for a in APPS]}


def breadcrumbs(trail):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i, "name": n, "item": BASE + p} for i, (n, p) in enumerate(trail, 1)]}


# ---------------------------------------------------------------- shell
def head(title, desc, path, extra="", image="assets/img/og.png"):
    url = BASE + path
    title, desc = esc(title), esc(desc)
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
    links = [("Apps", "index.html#apps", None)] + [(a["name"], a["page_file"], a["key"]) for a in APPS] + \
            [("What we build", "index.html#build", None), ("Approach", "index.html#approach", None)]
    here = ' aria-current="page"'
    items = "".join(f'<a href="{h}"{here if k and current == k else ""}>{esc(t)}</a>' for t, h, k in links)
    return f'''<header class="nav" id="top"><div class="wrap">
  <a class="brand" href="index.html" aria-label="iSafeNet home"><img src="assets/img/mark.png" srcset="assets/img/mark@2x.png 2x" width="24" height="34" alt=""><span>iSafe<span class="net">Net</span></span></a>
  <button class="menu" aria-expanded="false" aria-controls="menu">Menu</button>
  <nav class="nav-links" id="menu" aria-label="Main">{items}<a class="cta" href="index.html#contact">Contact</a></nav>
</div></header>
'''


def footer():
    cols = "".join(f'''
    <div><h2>{esc(a["name"])}</h2><ul>
      <li><a href="{a["page_file"]}">About {esc(a["name"])}</a></li>
      <li><a href="{a["site"]}">{esc(a["name"])} website</a></li>''' +
                   "".join(f'\n      <li><a href="{link(a, u)}">{esc(t)}</a></li>' for t, u in a["footer"]) +
                   "\n    </ul></div>" for a in APPS)
    return f'''<footer class="footer"><div class="wrap">
  <div class="foot-grid" style="--cols:{len(APPS) + 1}">
    <div>
      <a class="brand" href="index.html"><img src="assets/img/mark.png" srcset="assets/img/mark@2x.png 2x" width="24" height="34" alt=""><span>iSafe<span class="net">Net</span></span></a>
      <p class="tag">An independent mobile app studio. We design, build and look after private, accessible apps for iPhone, iPad and Apple Watch.</p>
      <p style="margin-top:14px"><a href="mailto:{EMAIL}">{EMAIL}</a></p>
    </div>{cols}
    <div><h2>iSafeNet</h2><ul>
      <li><a href="index.html#apps">Our apps</a></li>
      <li><a href="index.html#build">What we build</a></li>
      <li><a href="index.html#approach">How we work</a></li>
      <li><a href="index.html#contact">Contact</a></li>
      <li><a href="feedback.html">Feedback and ideas</a></li>
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


_sizes = {}


def img_size(name):
    if name not in _sizes:
        _sizes[name] = Image.open(os.path.join(ROOT, "assets", "img", "apps", f"{name}.webp")).size
    return _sizes[name]


def shot(a, name, cls="", eager=False):
    lazy = "" if eager else ' loading="lazy"'
    w, h = img_size(name)
    return f'<img class="{cls}" src="assets/img/apps/{name}.webp" width="{w}" height="{h}" alt="{esc(a["screens"][name])}"{lazy} decoding="async">'


def framed(a, name):
    """Screens listed in "framed_screens" already show a device frame, so they're shown as they are."""
    return name in a.get("framed_screens", [])


def phone(a, name, cls):
    # Plain screenshots get the site's phone frame; framed ones don't.
    panel = " panel" if framed(a, name) else ""
    return f'<div class="phone{panel} {cls}">{shot(a, name, eager=True)}</div>'


def write(name, content):
    with open(os.path.join(ROOT, name), "w", encoding="utf-8") as f:
        f.write(content)


def app_card(a, flip=False):
    ticks = "".join(f"<li>{icon('check')}<span>{esc(t)}</span></li>" for t in a["ticks"])
    chips = "".join(f"<li>{esc(c)}</li>" for c in a["chips"])
    shots = "".join(shot(a, s) for s in a["card_shots"])
    c1, c2 = a["colors"]
    return f'''<article class="app-card{" flip" if flip else ""} rv" id="{a["key"]}" style="--shots-from:{c1};--shots-to:{c2}">
  <div class="info">
    <div class="top"><img src="{a["icon"]}" width="68" height="68" alt="{esc(a["name"])} app icon"><div><h3>{esc(a["name"])}</h3><span>{esc(a["kind"])}</span></div></div>
    <p class="tagline">{esc(a["tagline"])}</p>
    <p class="desc">{esc(a["summary"])}</p>
    <ul class="ticks">{ticks}</ul>
    <ul class="chips" aria-label="Platforms and features">{chips}</ul>
    <div class="actions"><a class="btn" href="{a["page_file"]}">Explore {esc(a["name"])} {icon("arrow")}</a><a class="btn light" href="{a["site"]}">{esc(a["name"])} website {icon("out")}</a></div>
  </div>
  <div class="shots">{shots}</div>
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

    n = len(APPS)
    everyone = "it is" if n == 1 else "both are" if n == 2 else f"all {count_word(n).lower()} are"
    hero = "\n    ".join(phone(a, a["home_shot"], f"p{i}") for i, a in enumerate(APPS[:3], 1))
    cards = "\n  ".join(app_card(a, flip=i % 2 == 1) for i, a in enumerate(APPS))
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
    {hero}
  </div>
</div></section>

<section id="apps"><div class="wrap">
  <div class="sec-head rv"><span class="eyebrow">Our apps</span>
    <h2>{count_word(n)} new app{"" if n == 1 else "s"}, made with care.</h2>
    <p>Each one solves a real, everyday problem, and {everyone} coming soon to the App Store.</p></div>
  {cards}
</div></section>

<section class="alt" aria-label="iSafeNet in numbers"><div class="wrap">
  <div class="stats">
    <div class="stat rv"><b>{n}</b><span>app{"" if n == 1 else "s"} in the portfolio</span></div>
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
    <p>Questions about our apps, press or partnership enquiries: we read every message and reply personally. Got an idea for one of our apps? Share it on our feedback board.</p>
    <div class="cta-row" style="justify-content:center;margin:0"><a class="btn" href="mailto:{EMAIL}">{icon("mail")} {EMAIL}</a><a class="btn ghost" href="feedback.html">Share an idea</a></div>
  </div>
</div></section>
</main>
{footer()}'''
    extra = ld(org()) + ld({"@context": "https://schema.org", "@type": "WebSite", "@id": BASE + "#website", "name": "iSafeNet",
                            "url": BASE, "inLanguage": "en-GB", "publisher": {"@id": ORG_ID}}) \
        + "".join(ld(app_ld(a)) for a in APPS)
    write("index.html", head("iSafeNet: Mobile App Studio for iPhone, iPad & Apple Watch",
                             "iSafeNet is an independent mobile app studio building private, accessible apps for iPhone, iPad and Apple Watch, including "
                             + names(a["name"] for a in APPS) + ".", "", extra) + body)


# ---------------------------------------------------------------- app pages
def build_app(a):
    p = a["page"]
    name = esc(a["name"])
    feat_html = "".join(f'<article class="card rv"><div class="ico">{icon(i)}</div><h3>{esc(t)}</h3><p>{esc(d)}</p></article>' for i, t, d in p["features"])
    plat_html = "".join(f'<li>{icon("check")}<span><b>{esc(t)}:</b> {esc(d)}</span></li>' for t, d in p["platforms"])
    link_html = "".join(f'<a href="{link(a, u)}"><b>{esc(t)}</b><span>{esc(d)}</span></a>' for u, t, d in p["links"])
    gal_html = "".join(shot(a, s) for s in p["gallery"])
    phones = "".join(phone(a, s, f"p{i}") for i, s in enumerate(p["hero"], 1))
    art_cls = "art" + (" pair" if len(p["art"]) > 1 else "") + (" panels" if all(framed(a, s) for s in p["art"]) else "")
    art = f'<div class="{art_cls}">' + "".join(shot(a, s) for s in p["art"]) + "</div>"
    note = ""
    if p.get("links_note"):
        n = p["links_note"]
        items = ", ".join(f'<a href="{link(a, u)}"' + (f' hreflang="{rest[0]}"' if rest else "") + f">{esc(t)}</a>" for u, t, *rest in n["links"])
        note = f'\n  <p style="margin-top:22px;color:var(--ink-2)">{esc(n["text"])} {items}{esc(n["end"])}</p>'
    others = [o for o in APPS if o["key"] != a["key"]]
    more = "\n".join(f'''  <div class="more rv"{' style="margin-bottom:18px"' if i < len(others) - 1 else ""}><img src="{o["icon"]}" width="72" height="72" alt="{esc(o["name"])} app icon">
    <div><h3>{esc(o["name"])}</h3><p>{esc(o["blurb"])}</p></div>
    <a class="btn" href="{o["page_file"]}">Explore {esc(o["name"])} {icon("arrow")}</a></div>''' for i, o in enumerate(others))
    second_url, second_label = p["second_button"]

    body = f'''{nav(current=a["key"])}
<main id="main">
<section class="hero app-hero"><div class="wrap hero-grid">
  <div>
    <p class="crumbs"><a href="index.html">iSafeNet</a> / <a href="index.html#apps">Apps</a> / {name}</p>
    <div class="app-id" style="margin-top:22px"><img src="{a["icon"]}" width="84" height="84" alt="{name} app icon"><div><span class="soon">Coming soon to the App Store</span><div class="kind" style="margin-top:8px">{esc(a["kind"])}</div></div></div>
    <h1>{name}: <span class="grad">{esc(a["tagline"])}</span></h1>
    <p class="lead">{esc(p["lead"])}</p>
    <div class="cta-row"><a class="btn" href="{a["site"]}">Visit the {name} website {icon("out")}</a><a class="btn ghost" href="{link(a, second_url)}">{esc(second_label)}</a></div>
    <ul class="chips" aria-label="Platforms and features">{"".join(f"<li>{esc(c)}</li>" for c in a["chips"])}</ul>
  </div>
  <div class="devices" aria-label="Screens from {name}">{phones}</div>
</div></section>

<section><div class="wrap">
  <div class="sec-head rv"><span class="eyebrow">Highlights</span><h2>What {name} does.</h2></div>
  <div class="grid">{feat_html}</div>
</div></section>

<section class="alt" aria-label="{name} screens" style="padding-bottom:70px"><div class="wrap">
  <div class="sec-head rv"><span class="eyebrow">Screens</span><h2>A closer look.</h2><p>Swipe through the real app.</p></div></div>
  <div class="rail" role="group" aria-label="{name} screenshots" tabindex="0">{gal_html}</div>
</section>

<section><div class="wrap split">
  <div class="rv">
    <span class="eyebrow">Made for Apple devices</span>
    <h2 style="font-size:clamp(1.9rem,3.4vw,2.6rem);margin:12px 0 18px">{esc(p["platforms_heading"])}</h2>
    <ul class="ticks">{plat_html}</ul>
    <p style="color:var(--ink-2);margin-top:6px"><b>Pricing:</b> {esc(p["pricing"])}</p>
    <p style="color:var(--ink-2);margin-top:12px"><b>Good to know:</b> {esc(p["good_to_know"])}</p>
  </div>
  {art}
</div></section>

<section class="alt"><div class="wrap">
  <div class="sec-head rv"><span class="eyebrow">Learn more</span><h2>Guides, help and details.</h2>
    <p>{esc(p["learn_more"])}</p></div>
  <div class="links rv">{link_html}</div>{note}
</div></section>
''' + (f'''
<section><div class="wrap">
  <div class="sec-head rv"><span class="eyebrow">More from iSafeNet</span></div>
{more}
</div></section>
''' if others else "") + f'''</main>
{footer()}'''
    extra = ld(org()) + ld(app_ld(a)) + ld(breadcrumbs([("iSafeNet", ""), ("Apps", "index.html#apps"), (a["name"], a["page_file"])]))
    write(a["page_file"], head(p["title"], p["description"], a["page_file"], extra) + body)


# ---------------------------------------------------------------- privacy, feedback, 404, sitemap
def build_privacy():
    policies = names(f'<a href="{a["site"]}privacy.html">{esc(a["name"])} Privacy Policy</a>' for a in APPS)
    body = f'''{nav()}
<main id="main">
<div class="page-hero"><div class="wrap">
  <p class="crumbs"><a href="index.html">iSafeNet</a> / Website privacy</p>
  <h1>Website privacy</h1>
  <p>This page covers the iSafeNet company website, isafenet.app. Each app has its own Privacy Policy, linked below.</p>
</div></div>
<section><div class="wrap prose">
  <h2>What this website collects</h2>
  <p>Very little. This website has no cookies, no analytics, no advertising and no tracking. Apart from the feedback board below, it doesn't ask for or store any personal information, and its fonts and images are served from this site rather than from third parties.</p>
  <h2>Hosting</h2>
  <p>The site is a set of static pages hosted by GitHub Pages. Like any web host, GitHub may keep standard server logs (such as IP addresses) to keep the service secure and running; see GitHub's own privacy statement for details.</p>
  <h2>If you email us</h2>
  <p>If you write to <a href="mailto:{EMAIL}">{EMAIL}</a>, we use your message and email address only to reply to you, and we don't share them.</p>
  <h2>Feedback board</h2>
  <p>Our <a href="feedback.html">feedback board</a> runs on our own small service hosted by Cloudflare. It has no accounts and doesn't ask for your email. What you post there (your idea or comment, and a name if you give one) is public once we've reviewed it. We never store your IP address: it's only used, in a scrambled form that changes every day, to limit how much one connection can post. Your browser keeps a random ID so your votes count once, and a list of the ideas you follow; both stay on your device. Forms use Cloudflare Turnstile to stop spam; it loads only when you open a form, and Cloudflare handles that check under <a href="https://www.cloudflare.com/turnstile-privacy-policy/">its Turnstile privacy addendum</a>. To have something you posted removed, email us.</p>
  <h2>Our apps</h2>
  <p>Each app explains exactly how it handles your data: {policies}.</p>
  <h2>Changes</h2>
  <p>If this ever changes, we'll update this page. Last updated 25 September 2026.</p>
</div></section>
</main>
{footer()}'''
    extra = ld(breadcrumbs([("iSafeNet", ""), ("Website privacy", "privacy.html")]))
    write("privacy.html", head("Website Privacy: iSafeNet", "The iSafeNet website has no cookies, analytics or tracking. Links to the "
                               + names(a["name"] for a in APPS) + " privacy policies.", "privacy.html", extra) + body)


def build_feedback():
    # The board's app list, shared by the page (assets/feedback.js) and the API (feedback-api/src/index.js).
    board_apps = {a["key"]: {"name": a["name"], "icon": a["icon"]} for a in APPS}
    board_apps["general"] = {"name": "General", "icon": "assets/img/mark.png"}
    write("assets/feedback-apps.js", "// Generated by tools/build.py from apps/*.json. Don't edit by hand.\n"
          "// Used by the board (assets/feedback.js) and its API (feedback-api/): redeploy the API after adding an app.\n"
          f"export const APPS = {json.dumps(board_apps, ensure_ascii=False, indent=2)};\n")

    health = [a["name"] for a in APPS if a["category"] == "HealthApplication"]
    health_line = "" if not health else f' {names(health)} {"is a health app" if len(health) == 1 else "are health apps"}, so this matters.'
    app_names = names((a["name"] for a in APPS), "or")
    plus, rss = icon("plus"), icon("rss")
    body = f'''{nav()}
<main id="main">
<div class="page-hero"><div class="wrap">
  <p class="crumbs"><a href="index.html">iSafeNet</a> / Feedback and ideas</p>
  <h1>Feedback and ideas</h1>
  <p>Tell us what would make {app_names} better, vote for the ideas you want most, and see what we're building next. No account needed.</p>
  <div class="fb-hero-actions"><button class="btn" type="button" data-fb-new>{plus} Share an idea</button><a class="btn ghost" data-fb-feed href="#">{rss} Follow updates (RSS)</a></div>
</div></div>
<section class="fb"><div class="wrap" id="board" data-api="{FEEDBACK_API}" data-sitekey="{TURNSTILE_SITE_KEY}">
  <nav class="fb-tabs" aria-label="Board views"><a href="#ideas">Ideas</a><a href="#roadmap">Roadmap</a><a href="#shipped">Shipped</a></nav>
  <div id="fb-news"></div>
  <div id="fb-view"><noscript><p class="fb-empty">The board needs JavaScript. You can also email ideas to <a href="mailto:{EMAIL}">{EMAIL}</a>.</p></noscript></div>
  <p id="fb-live" class="sr" aria-live="polite"></p>
  <div class="prose" style="margin-top:72px">
    <h2>How it works</h2>
    <ul>
      <li><strong>Share an idea.</strong> Pick the app and say what you'd like it to do, and what it would help you do. One idea per post makes voting fairer.</li>
      <li><strong>Vote.</strong> Votes are anonymous and help us decide what to build next. Voting for an idea also follows it: when its status changes, you'll see it at the top of this page.</li>
      <li><strong>We read everything.</strong> Every idea and comment is read by a person before it appears, and we explain what we decide.</li>
    </ul>
    <h2>Keep it public-safe</h2>
    <p>Everything on the board is public. Please don't include health details, medicines, doses, measurements or anything else personal.{health_line} We edit out anything personal before an idea goes up. If something isn't working, or your question is about your own data, email <a href="mailto:{EMAIL}">{EMAIL}</a> instead.</p>
    <h2>Your privacy</h2>
    <p>The board is our own, not a third-party service. There's no account, and we don't ask for your email. Your browser keeps a random ID so your votes count once, plus the ideas you follow; these stay on your device. To stop spam, forms use Cloudflare Turnstile, which loads only when you open one to post. Your IP address is never stored, only used to limit how much one connection can post in a day. See <a href="privacy.html">website privacy</a> for details.</p>
  </div>
</div></section>
<dialog id="fb-dialog" class="fb-dialog"></dialog>
<script type="module" src="assets/feedback.js"></script>
</main>
{footer()}'''
    extra = ('<link rel="stylesheet" href="assets/feedback.css">\n'
             f'<link rel="alternate" type="application/atom+xml" title="iSafeNet feedback: roadmap updates" href="{FEEDBACK_API}/feed.xml">\n'
             + ld(breadcrumbs([("iSafeNet", ""), ("Feedback and ideas", "feedback.html")])))
    write("feedback.html", head("Feedback and Ideas: iSafeNet", f"Suggest ideas for {names(a['name'] for a in APPS)}, "
                                "vote for the ones you want, and see our roadmap. No account needed.", "feedback.html", extra) + body)


def build_extras():
    write("CNAME", "isafenet.app")
    write(".nojekyll", "")
    pages = [("", "1.0")] + [(a["page_file"], "0.9") for a in APPS] + [("feedback.html", "0.5"), ("privacy.html", "0.3")]
    sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + \
         "".join(f"  <url><loc>{BASE}{p}</loc><lastmod>{LASTMOD}</lastmod><priority>{pr}</priority></url>\n" for p, pr in pages) + "</urlset>\n"
    write("sitemap.xml", sm)
    write("robots.txt", f"User-agent: *\nAllow: /\nSitemap: {BASE}sitemap.xml\n")
    buttons = "".join(f'<a class="btn ghost" href="{a["page_file"]}">{esc(a["name"])}</a>' for a in APPS)
    body = f'''{nav()}
<main id="main"><div class="page-hero" style="padding:110px 0 130px;text-align:center"><div class="wrap">
  <p class="crumbs">404</p><h1>That page isn't here</h1>
  <p style="margin:0 auto 28px">The link may be out of date. Try our apps instead.</p>
  <div class="cta-row" style="justify-content:center"><a class="btn" href="index.html">iSafeNet home</a>{buttons}</div>
</div></div></main>
{footer()}'''
    # 404 must use absolute paths: GitHub serves it at whatever URL was missing.
    page = head("Page not found: iSafeNet", "That page doesn't exist.", "404.html") + body
    page = re.sub(r'\b(href|src|srcset)="(?!https?:|mailto:|#|/)', r'\1="/', page)
    write("404.html", page)


# ---------------------------------------------------------------- a new app
TEMPLATE_NOTE = "Fill in every TODO, then see README.md, 'Adding an app'."


def new_app(key):
    if not re.fullmatch(r"[a-z][a-z0-9-]{1,30}", key):
        sys.exit("The key is the app's short name in lower case, e.g. 'udapt'. It becomes the page name (udapt.html) and image prefix.")
    path = os.path.join(APPS_DIR, f"{key}.json")
    if os.path.exists(path):
        sys.exit(f"apps/{key}.json already exists.")
    with open(os.path.join(APPS_DIR, "udapt.json"), encoding="utf-8") as f:
        example = json.load(f)
    order = max(json.load(open(p, encoding="utf-8"))["order"] for p in glob.glob(os.path.join(APPS_DIR, "*.json"))) + 1
    t = "TODO"
    shots = [f"{key}-screen-1", f"{key}-screen-2", f"{key}-screen-3"]
    template = {
        "_note": TEMPLATE_NOTE,
        "order": order, "name": t, "site": f"https://{key}.isafenet.app/", "kind": "TODO: category · devices, e.g. Health & Fitness · iPhone & Apple Watch",
        "category": "TODO: a schema.org category, e.g. HealthApplication, TravelApplication, LifestyleApplication",
        "os": "TODO: e.g. iOS, watchOS", "price": "0",
        "tagline": "TODO: one short line", "summary": "TODO: two sentences for the homepage card",
        "blurb": "TODO: tagline plus one sentence, for 'More from iSafeNet'",
        "ticks": ["TODO"] * 4, "chips": ["TODO"], "colors": ["#1f8f7a", "#0e151a"],
        "framed_screens": [],
        "card_shots": shots, "home_shot": shots[0],
        "screens": {s: "TODO: alt text describing what the screen shows" for s in shots},
        "footer": [["TODO: link text", "support.html"]],
        "page": {k: example["page"][k] if k in ("art",) else t for k in REQUIRED_PAGE},
        "images_from": {"folder": f"../{key}-web", "files": {f"{key}-icon.png": "TODO: path to a 512px+ app icon PNG in that folder",
                                                            **{f"{s}.webp": "TODO: path to the screenshot" for s in shots}}},
    }
    template["page"].update({"second_button": ["support.html", "Get help"], "hero": shots, "gallery": shots, "art": [shots[0]],
                             "features": [["star", "TODO: feature", "TODO: one sentence"]] * 3,
                             "platforms": [["TODO: device", "TODO: what it does there"]],
                             "links": [["", f"TODO website", "TODO: one line"], ["support.html", "Support", "TODO: one line"]]})
    with open(path, "w", encoding="utf-8") as f:
        json.dump(template, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Created apps/{key}.json. {TEMPLATE_NOTE}")


if __name__ == "__main__":
    if "--new-app" in sys.argv:
        new_app(sys.argv[sys.argv.index("--new-app") + 1])
        sys.exit()
    APPS = load_apps()
    build_index()
    for app in APPS:
        build_app(app)
    build_privacy()
    build_feedback()
    build_extras()
    print("site built into", ROOT, "with", names(a["name"] for a in APPS))
