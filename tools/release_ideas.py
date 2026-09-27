#!/usr/bin/env python3
"""Put an app release's new features on the feedback board (https://isafenet.app/feedback.html).

  python3 tools/release_ideas.py post tools/releases/glpmgr-1.5.1.json   # add them, as "started"
  python3 tools/release_ideas.py ship glpmgr 1.5.1                        # once live: mark them shipped

`post` adds each idea in the file as a published team idea with the file's status, note and version,
skipping any whose title is already on the board for that app, so it's safe to run twice. `ship` marks
every idea with that app and version as shipped, with the note "Now Shipped in <version>", the same
way the 1.5 items were done by hand. Add --dry-run to either to see what it would do.

The admin key (the Worker's ADMIN_TOKEN secret) comes from FEEDBACK_ADMIN_TOKEN, or is asked for.
Run it in your own terminal so the key never ends up in a chat transcript or shell history.
"""

import argparse
import getpass
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://isafenet-feedback.isafenet-feedback.workers.dev/api/admin"


def call(token, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": "iSafeNet release_ideas.py",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} failed: {e.code} {e.read().decode(errors='replace')}")


def board(token, app):
    return [i for i in call(token, "GET", "/ideas")["ideas"] if i["app"] == app and i["state"] != "merged"]


def post(token, release, dry_run):
    app = release["app"]
    existing = {i["title"].strip().lower() for i in board(token, app)}
    for idea in release["ideas"]:
        if idea["title"].strip().lower() in existing:
            print(f"  already on the board: {idea['title']}")
            continue
        body = {
            "app": app,
            "title": idea["title"],
            "body": idea.get("body", ""),
            "author": release.get("author", "iSafeNet"),
            "status": idea.get("status", release.get("status", "started")),
            "note": idea.get("note", release.get("note", "")),
            "version": release["version"],
        }
        if dry_run:
            print(f"  would add: {idea['title']}")
        else:
            print(f"  added #{call(token, 'POST', '/ideas', body)['id']}: {idea['title']}")


def ship(token, app, version, note, dry_run):
    for idea in board(token, app):
        if idea["version"] != version or idea["status"] == "shipped":
            continue
        if dry_run:
            print(f"  would ship #{idea['id']}: {idea['title']}")
        else:
            call(token, "POST", f"/ideas/{idea['id']}", {"status": "shipped", "note": note or f"Now Shipped in {version}"})
            print(f"  shipped #{idea['id']}: {idea['title']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("post", help="add a release's ideas")
    p.add_argument("file")
    p.add_argument("--dry-run", action="store_true")
    s = sub.add_parser("ship", help="mark a release's ideas shipped")
    s.add_argument("app")
    s.add_argument("version")
    s.add_argument("--note", default="")
    s.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    token = os.environ.get("FEEDBACK_ADMIN_TOKEN") or getpass.getpass("Feedback board admin key: ")
    if not token:
        sys.exit("No admin key.")

    if args.command == "post":
        with open(args.file) as f:
            release = json.load(f)
        post(token, release, args.dry_run)
    else:
        ship(token, args.app, args.version, args.note, args.dry_run)


if __name__ == "__main__":
    main()
