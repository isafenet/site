#!/usr/bin/env python3
"""
Sends the Worker the routes that changed in Virtual Radar Server's standing data
(https://github.com/vradarserver/standing-data, CC0) since the last commit it has,
so AirReveal can stay current between releases (`src/sky-routes.js`). Run daily
by the GitHub Action `.github/workflows/sky-routes.yml`.

It asks the Worker which commit it's up to date with, diffs that commit against
the latest one (git does the work, and only the changed files are downloaded),
and posts the changed callsigns in batches, then the new commit. A failed run
changes nothing that the next run won't redo: each batch is an upsert, and the
commit is recorded last.

The rules match AirReveal's `Scripts/generate_sky_routes.py`, which builds the
bundled copy: a callsign is 2-8 letters and digits, a route has 2+ airports, and
every airport must be in the standing data's airport list (a route that no longer
qualifies is sent as removed).

Usage:
    SKY_ROUTES_SECRET=… python3 tools/sync_sky_routes.py [--base <commit>] [--dry-run]

--base is needed only the first time, when the Worker has no commit yet: give the
commit in AirReveal's `sky-routes-version.json`, the one the app bundles.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

REPOSITORY = "https://github.com/vradarserver/standing-data.git"
WORKER = os.environ.get("SKY_ROUTES_URL", "https://airreveal-flights.isafenet-feedback.workers.dev")
USER_AGENT = "AirRevealRouteSync/1.0 (https://airreveal.isafenet.app; info@isafenet.app)"
BATCH = 2000
CALLSIGN = re.compile(r"^[A-Z0-9]{2,8}$")
AIRPORT = re.compile(r"^[A-Z0-9]{3,4}$")
# schema-01 columns.
ROUTE_COLUMNS = ["Callsign", "Code", "Number", "AirlineCode", "AirportCodes"]
AIRPORT_COLUMNS = ["Code", "Name", "ICAO", "IATA", "Location", "CountryISO2", "Latitude", "Longitude", "AltitudeFeet"]


def call(method: str, path: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(
        WORKER + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {os.environ['SKY_ROUTES_SECRET']}", "Content-Type": "application/json",
                 "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


def changed_rows(repo: Path, base: str, head: str, folder: str, columns: list[str]) -> tuple[list[dict], list[dict]]:
    """The rows removed and added between two commits, from a zero-context diff of the folder's CSVs."""
    diff = git(repo, "diff", "--unified=0", "--no-renames", base, head, "--", f"{folder}/schema-01")
    removed, added = [], []
    for line in diff.splitlines():
        if line.startswith(("---", "+++")) or not line.startswith(("-", "+")):
            continue
        values = next(csv.reader([line[1:].lstrip("﻿")]))
        if values == columns or len(values) != len(columns):
            continue
        (added if line[0] == "+" else removed).append(dict(zip(columns, values)))
    return removed, added


def airports_at_head(repo: Path) -> dict[str, dict]:
    git(repo, "sparse-checkout", "set", "airports")
    git(repo, "checkout", "-q", "HEAD")
    airports = {}
    for path in sorted((repo / "airports").glob("schema-01/*/*.csv")):
        with path.open(encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                airports[row["Code"].strip().upper()] = row
    return airports


def airport_record(row: dict) -> dict:
    iata = row["IATA"].strip().upper()
    return {
        "icao": row["Code"].strip().upper(),
        "iata": iata if re.fullmatch(r"[A-Z0-9]{3}", iata) else None,
        "city": row["Location"].strip() or row["Name"].strip(),
        "latitude": round(float(row["Latitude"]), 5),
        "longitude": round(float(row["Longitude"]), 5),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", help="the commit to start from, when the Worker has none yet")
    parser.add_argument("--dry-run", action="store_true", help="work out the changes but send nothing")
    args = parser.parse_args()

    state = call("GET", "/v1/admin/sky-routes/state")
    base = state.get("commit") or args.base
    if not base:
        sys.exit("The Worker has no commit yet: run with --base <commit from AirReveal's sky-routes-version.json>.")

    with tempfile.TemporaryDirectory() as temporary:
        repo = Path(temporary) / "standing-data"
        subprocess.run(["git", "clone", "-q", "--filter=blob:none", "--no-checkout", "--sparse", REPOSITORY, str(repo)], check=True)
        head = git(repo, "rev-parse", "HEAD").strip()
        committed_at = int(git(repo, "log", "-1", "--format=%ct", head).strip())
        if head == base:
            if not state.get("commit") and not args.dry_run:   # the first run: record where we start
                call("POST", "/v1/admin/sky-routes/commit", {"commit": head, "committedAt": committed_at})
            print(f"Up to date with {head[:10]}.")
            return

        airports = airports_at_head(repo)
        removed, added = changed_rows(repo, base, head, "routes", ROUTE_COLUMNS)
        routes: dict[str, str] = {}
        for row in removed:
            routes[row["Callsign"].strip().upper()] = ""
        for row in added:
            callsign = row["Callsign"].strip().upper()
            codes = [code.strip().upper() for code in row["AirportCodes"].split("-")]
            valid = CALLSIGN.match(callsign) and len(codes) >= 2 and all(AIRPORT.match(c) and c in airports for c in codes)
            routes[callsign] = "-".join(codes) if valid else ""
        routes = {callsign: codes for callsign, codes in routes.items() if CALLSIGN.match(callsign)}

        # The airports the changed routes use, and any airport whose details changed.
        _, changed_airports = changed_rows(repo, base, head, "airports", AIRPORT_COLUMNS)
        codes = {code for value in routes.values() if value for code in value.split("-")}
        codes |= {row["Code"].strip().upper() for row in changed_airports if row["Code"].strip().upper() in airports}
        airport_records = [airport_record(airports[code]) for code in sorted(codes)]

    print(f"{base[:10]} → {head[:10]}: {len(routes):,} changed routes "
          f"({sum(1 for v in routes.values() if not v):,} removed), {len(airport_records):,} airports")
    if args.dry_run:
        return
    items = sorted(routes.items())
    for start in range(0, max(len(items), len(airport_records)), BATCH):
        call("POST", "/v1/admin/sky-routes", {
            "changedAt": committed_at,
            "routes": [list(item) for item in items[start:start + BATCH]],
            "airports": airport_records[start:start + BATCH],
        })
    call("POST", "/v1/admin/sky-routes/commit", {"commit": head, "committedAt": committed_at})
    print(f"Worker is up to date with {head[:10]}.")


if __name__ == "__main__":
    main()
