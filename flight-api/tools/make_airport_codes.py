#!/usr/bin/env python3
"""Builds src/airport-codes.json: ICAO airport code -> IATA code, from OurAirports.

SkyLink answers with ICAO codes (EGLL); AirReveal's bundled airports are keyed by IATA (LHR), which is
also how its airport data was reconciled with OurAirports. Only airports with both codes are kept.

    python3 tools/make_airport_codes.py
"""
import csv
import io
import json
import urllib.request
from pathlib import Path

SOURCE = "https://davidmegginson.github.io/ourairports-data/airports.csv"
OUT = Path(__file__).resolve().parent.parent / "src" / "airport-codes.json"
SCHEDULED_TYPES = {"large_airport", "medium_airport", "small_airport"}

text = urllib.request.urlopen(SOURCE, timeout=60).read().decode("utf-8")
codes = {}
for row in csv.DictReader(io.StringIO(text)):
    iata = row["iata_code"].strip().upper()
    icao = (row.get("icao_code") or row["gps_code"] or row["ident"]).strip().upper()
    if len(iata) != 3 or len(icao) != 4 or not icao.isalnum() or row["type"] not in SCHEDULED_TYPES:
        continue
    # Where two rows share an ICAO code, prefer the one with scheduled service.
    if icao not in codes or row["scheduled_service"] == "yes":
        codes[icao] = iata
OUT.write_text(json.dumps(dict(sorted(codes.items())), separators=(",", ":")) + "\n", encoding="utf-8")
print(f"{len(codes)} airports -> {OUT}")
