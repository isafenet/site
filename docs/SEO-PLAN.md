# Search plan for all four sites (29 September 2026)

## Where things stand
- **On-page basics are in good shape on all four sites.** Every page has a unique title and description, one H1, a canonical address, Open Graph tags and structured data, and is listed in the sitemap. The pages are small, static and fast. GLPMGR has a test that guards all of this (`tools/test_site_seo.py`).
- **The sites are barely indexed.** A web search for "GLPMGR GLP-1 tracker" didn't return glpmgr.isafenet.app. For Udapt and AirReveal, the GitHub repos appeared instead of the websites. The sites are new, and very little links to them.
- **Google Search Console is verified** for isafenet.app through a DNS TXT record. A domain property covers every subdomain.

## Done today
- **GitHub repos:** each repo now links to its website. glpmgr-legal still pointed at the dead glpmgr.jaywales.com. Each repo also has a description naming its site.
- **404 pages:** now `noindex` on GLPMGR and isafenet.app.
- **IndexNow:** every URL on all four sites (51 in total) was sent. Bing, Yandex, Seznam and Naver all accepted.

## Owner actions (only you can do these; roughly in order of impact)
1. **Search Console:**
   - Submit the four sitemaps: `https://glpmgr.isafenet.app/sitemap.xml`, `https://isafenet.app/sitemap.xml`, `https://udapt.isafenet.app/sitemap.xml` and `https://airreveal.isafenet.app/sitemap.xml`.
   - Use URL Inspection → Request indexing on each home page, and on GLPMGR's glp-1-app, faq and mounjaro/ozempic/wegovy injection-site pages.
   - Check Indexing → Pages for anything marked "Discovered/Crawled – currently not indexed".
2. **Bing Webmaster Tools:** add the sites with "Import from Google Search Console". Bing also feeds DuckDuckGo, Ecosia and ChatGPT search.
3. **App Store Connect:** set GLPMGR's Marketing URL to https://glpmgr.isafenet.app/. Do the same for Udapt and AirReveal once each has a store page. Apple's pages are high-authority links, and Google indexes them.
4. **Listings that link back:**
   - AlternativeTo: list GLPMGR as an alternative to Shotsy and MeAgain.
   - Product Hunt: launch GLPMGR on the 1.8 release day.
   - Indie Hackers or a "Show HN" style post: the story of an independent UK developer who built a private GLP-1 tracker.
   - BetaList: Udapt, before launch.
5. **People, not adverts:**
   - Answer questions as yourself in UK GLP-1 communities, and link only where it answers the question. Most groups ban promotion.
   - Pitch to UK health-tech and Apple-accessibility writers. 1.8's Audio Graphs are a real story (AppleVis, and accessibility podcasts).

## Honest expectations
- **Brand searches** (GLPMGR, Udapt, AirReveal, iSafeNet): page 1 within weeks of indexing. There's almost no competition for these names.
- **Long-tail searches:** page 1 is achievable in a few months. Examples:
  - a medicine's injection sites plus a place ("mounjaro injection sites thigh uk")
  - "glp-1 pill tracker" / "orforglipron tracker" (wide open)
  - "private glp-1 tracker no account"
  - "what am I flying over app offline"
- **Head terms** ("glp-1 tracker app", "flight tracker app"): these are held by apps with tens of thousands of ratings and years of links. They take months of links and content, and no one can promise page 1 for them. Paid Apple Search Ads is the faster, measurable way into those searches.

## Next content (ranked by chance of page 1)
1. **GLPMGR: a "GLP-1 pill tracker" page for orforglipron.** App Store searches for it are almost empty. Quote only the verified leaflet data the app already uses (docs/pill-label-check.md), the way the injection-site pages do.
2. **GLPMGR: one "[medicine] tracker" section per medicine page** (the dose steps the leaflet lists, and what GLPMGR tracks for it). This goes on the existing injection-site pages, not new thin pages, so each page answers both "mounjaro tracker" and "mounjaro injection sites".
3. **AirReveal: make "what am I flying over" the strongest page for that question.** Add a worked example (a real route, with what you'd see out of the window) and a short FAQ with matching structured data.
4. **Udapt, at launch:** "training readiness app for iPhone and Apple Watch" and "log my physio exercise plan" pages, using the science page's sources.
