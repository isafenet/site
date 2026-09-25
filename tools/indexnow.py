#!/usr/bin/env python3
"""Tells Bing (and the other IndexNow search engines: Yandex, Seznam, Naver) about new or changed pages on
isafenet.app and the app sites, so they're crawled within hours instead of whenever the crawler comes by.

    python3 tools/indexnow.py https://glpmgr.isafenet.app/glp-1-app.html ...   # just these pages
    python3 tools/indexnow.py --site glpmgr.isafenet.app                       # every page in that site's sitemap
    python3 tools/indexnow.py --all                                            # every page on all four sites

Run it after the change is live (GitHub Pages takes a minute or two). Submit pages that changed, not everything
every time: search engines may ignore sites that resubmit unchanged pages. Google doesn't use IndexNow; it reads
the sitemaps submitted in Search Console.

The key is public by design: each site serves it at /<KEY>.txt to prove the submission comes from the site owner.
isafenet-site, udapt-web and airreveal-legal commit that file; glpmgr-legal gets it from GLPMGR/tools/build_site.py.
"""
import json, sys, urllib.parse, urllib.request, xml.etree.ElementTree as ET

KEY = "f9bed6f41d9be09c1f02ae362a7f0111"
SITES = ["isafenet.app", "udapt.isafenet.app", "glpmgr.isafenet.app", "airreveal.isafenet.app"]
ENDPOINT = "https://api.indexnow.org/indexnow"


def sitemap_urls(host):
    with urllib.request.urlopen(f"https://{host}/sitemap.xml", timeout=20) as r:
        tree = ET.fromstring(r.read())
    return [e.text.strip() for e in tree.iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]


def submit(host, urls):
    body = json.dumps({"host": host, "key": KEY, "keyLocation": f"https://{host}/{KEY}.txt", "urlList": urls}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status = r.status
    except urllib.error.HTTPError as e:
        status = e.code
    # 200 = accepted, 202 = accepted while the key is checked. 403 = key file not found yet (is the site deployed?),
    # 422 = a URL isn't on this host, 429 = too many requests (try later).
    meaning = {200: "accepted", 202: "accepted (key being checked)", 403: "key not found: is the key file live?",
               422: "a URL doesn't belong to this site", 429: "too many requests, try later"}.get(status, "unexpected")
    print(f"{host}: {len(urls)} URL(s) -> HTTP {status} {meaning}")
    return status in (200, 202)


def main(args):
    by_host = {}
    if "--all" in args:
        for host in SITES:
            by_host[host] = sitemap_urls(host)
    elif "--site" in args:
        host = args[args.index("--site") + 1]
        by_host[host] = sitemap_urls(host)
    else:
        for url in args:
            host = urllib.parse.urlparse(url).netloc
            if host not in SITES:
                sys.exit(f"{url} isn't on one of our sites ({', '.join(SITES)})")
            by_host.setdefault(host, []).append(url)
    if not by_host:
        sys.exit(__doc__)
    ok = all([submit(host, urls) for host, urls in by_host.items()])
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main(sys.argv[1:])
