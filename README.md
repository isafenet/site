# isafenet.app

The iSafeNet company website: https://isafenet.app (GitHub Pages, custom domain in `CNAME`).

```
python3 tools/make_assets.py   # images: the logo mark, favicons, social card and app screens
python3 tools/build.py         # every page, sitemap.xml, robots.txt and 404.html
```

`make_assets.py` reads the iSafeNet brand pack (default `~/Downloads/iSafeNet_Digital_Assets_Pack`, or `--pack`)
and the two app websites checked out beside this repo (`../airreveal-legal`, `../glpmgr-legal`). Re-run it when
either app's screenshots change. `build.py` holds all the page content; both scripts are deterministic.

The company site, https://airreveal.isafenet.app and https://glpmgr.isafenet.app link to each other: every app
page here deep-links into its app's site, each app site's footer links back to iSafeNet and to the other app, and
all three name `https://isafenet.app/#organization` as the publisher in their structured data.
