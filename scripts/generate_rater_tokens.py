#!/usr/bin/env python3
"""
generate_rater_tokens.py

Assigns a unique peer_token to every active roster member that doesn't
already have one, and prints/saves the personal peer-appraisal link for
each person to distribute.

Run this the same way you run sync_master.py — same environment variables:

    export SUPABASE_URL="https://xxxx.supabase.co"
    export SUPABASE_SERVICE_KEY="your-service-role-key"
    python3 generate_rater_tokens.py

Safe to re-run: people who already have a peer_token are left untouched
and just reprinted, so this never invalidates a link someone already has.
"""

import os
import sys
import csv
import secrets
import urllib.request
import json

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
BASE_FORM_URL = "https://planariastudio.github.io/planaria-people-system/peer_appraisal.html"
OUTPUT_CSV = "rater_links.csv"

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("ERROR: set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables first (same ones used for sync_master.py).")
    sys.exit(1)


def sb_request(method, path, body=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode() or "null")


def main():
    roster = sb_request("GET", "roster?active=eq.true&select=id,name,peer_token&order=name")
    if not roster:
        print("No active roster rows found — check the roster table / active flag.")
        return

    rows_out = []
    assigned = 0

    for person in roster:
        token = person.get("peer_token")
        if not token:
            token = secrets.token_urlsafe(9)  # short, URL-safe, ~12 chars
            sb_request("PATCH", f"roster?id=eq.{person['id']}", {"peer_token": token})
            assigned += 1
        link = f"{BASE_FORM_URL}?t={token}"
        rows_out.append({"name": person["name"], "token": token, "link": link})

    with open(OUTPUT_CSV, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["name", "token", "link"])
        writer.writeheader()
        writer.writerows(rows_out)

    print(f"\n{assigned} new token(s) assigned, {len(rows_out) - assigned} already had one.\n")
    print(f"{'Name':<25} Link")
    print("-" * 90)
    for r in rows_out:
        print(f"{r['name']:<25} {r['link']}")
    print(f"\nFull list also saved to {OUTPUT_CSV} in this folder.")


if __name__ == "__main__":
    main()
