#!/usr/bin/env python3
"""Put an app release's new features on the feedback board (https://isafenet.app/feedback.html).

  python3 tools/release_ideas.py post tools/releases/glpmgr-1.6.json     # add them, as "started"
  python3 tools/release_ideas.py update tools/releases/glpmgr-1.6.json   # reword ones already posted
  python3 tools/release_ideas.py ship glpmgr 1.6                          # once live: mark them shipped
  python3 tools/release_ideas.py hide glpmgr "A new app icon"             # take a dropped feature off

`post` adds each idea in the file as a published team idea with the file's status, note and version,
skipping any whose title is already on the board for that app, so it's safe to run twice. `update`
brings the description, status and note of ideas already posted (matched by title) in line with the file. `ship` marks
every idea with that app and version as shipped, with the note "Now Shipped in <version>", the same
way the 1.5 items were done by hand. `hide` takes ideas off the public board by exact title (it sets them
to "rejected", as the moderation page does), for a feature dropped before release. Add --dry-run to any
of them to see what it would do.

The admin key (the Worker's ADMIN_TOKEN secret) comes from, in order: FEEDBACK_ADMIN_TOKEN; the macOS Keychain
(service "isafenet-feedback-admin"); or a prompt. Store it in the Keychain once, in your own terminal, so it never
ends up in a chat transcript or shell history (the -w on its own makes `security` ask for it):

  security add-generic-password -s isafenet-feedback-admin -a admin -w
"""

import argparse
import getpass
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

KEYCHAIN_SERVICE = "isafenet-feedback-admin"


def keychain_token() -> "str | None":
    """The admin key from the login Keychain, or None if it isn't stored (or this isn't a Mac)."""
    try:
        found = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
                               capture_output=True, text=True)
    except FileNotFoundError:
        return None
    return (found.stdout.strip() or None) if found.returncode == 0 else None


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


def update(token, release, dry_run):
    """Brings the description, status and note of each idea already on the board in line with the file, matched by title.
    `post` skips ideas already there, so this is how a reworded entry reaches the board."""
    on_board = {i["title"].strip().lower(): i for i in board(token, release["app"])}
    for idea in release["ideas"]:
        current = on_board.get(idea["title"].strip().lower())
        if current is None:
            print(f"  not on the board yet (use post): {idea['title']}")
            continue
        wanted = {
            "body": idea.get("body", ""),
            "status": idea.get("status", release.get("status", "started")),
            "note": idea.get("note", release.get("note", "")),
        }
        changes = {k: v for k, v in wanted.items() if (current.get(k) or "") != v}
        if current.get("status") == "shipped":
            changes.pop("status", None)
            changes.pop("note", None)
        if not changes:
            continue
        if dry_run:
            print(f"  would update #{current['id']} ({', '.join(changes)}): {idea['title']}")
        else:
            call(token, "POST", f"/ideas/{current['id']}", changes)
            print(f"  updated #{current['id']} ({', '.join(changes)}): {idea['title']}")


def ship(token, app, version, note, dry_run):
    for idea in board(token, app):
        if idea["version"] != version or idea["status"] == "shipped":
            continue
        if dry_run:
            print(f"  would ship #{idea['id']}: {idea['title']}")
        else:
            call(token, "POST", f"/ideas/{idea['id']}", {"status": "shipped", "note": note or f"Now Shipped in {version}"})
            print(f"  shipped #{idea['id']}: {idea['title']}")


def hide(token, app, titles, dry_run):
    wanted = {t.strip().lower() for t in titles}
    found = [i for i in board(token, app) if i["title"].strip().lower() in wanted]
    for idea in found:
        if dry_run:
            print(f"  would hide #{idea['id']}: {idea['title']}")
        else:
            call(token, "POST", f"/ideas/{idea['id']}", {"state": "rejected"})
            print(f"  hid #{idea['id']}: {idea['title']}")
    for title in sorted(wanted - {i["title"].strip().lower() for i in found}):
        print(f"  not on the board: {title}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("post", help="add a release's ideas")
    p.add_argument("file")
    p.add_argument("--dry-run", action="store_true")
    u = sub.add_parser("update", help="reword ideas already posted, from the release file")
    u.add_argument("file")
    u.add_argument("--dry-run", action="store_true")
    s = sub.add_parser("ship", help="mark a release's ideas shipped")
    s.add_argument("app")
    s.add_argument("version")
    s.add_argument("--note", default="")
    s.add_argument("--dry-run", action="store_true")
    h = sub.add_parser("hide", help="take ideas off the board by title")
    h.add_argument("app")
    h.add_argument("titles", nargs="+")
    h.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    token = os.environ.get("FEEDBACK_ADMIN_TOKEN") or keychain_token()
    if not token:
        if not sys.stdin.isatty():
            sys.exit(f"No admin key. Store it once with: security add-generic-password -s {KEYCHAIN_SERVICE} -a admin -w")
        token = getpass.getpass("Feedback board admin key: ")
    if not token:
        sys.exit("No admin key.")

    if args.command == "post":
        with open(args.file) as f:
            release = json.load(f)
        post(token, release, args.dry_run)
    elif args.command == "update":
        with open(args.file) as f:
            release = json.load(f)
        update(token, release, args.dry_run)
    elif args.command == "ship":
        ship(token, args.app, args.version, args.note, args.dry_run)
    else:
        hide(token, args.app, args.titles, args.dry_run)


if __name__ == "__main__":
    main()
