#!/usr/bin/env python3
"""Check selected ownership boundaries using disposable fixtures in two test accounts.

Passwords are entered locally without echo. Tokens stay in memory. This script
creates two tags and two saved queries, attempts cross-account access, and cleans
up only those fixtures. It does not change existing library/profile/settings data.
"""

import datetime
import getpass
import json
import re
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = "https://d1wj9jjqzhjpqq.cloudfront.net"
REPORT = ROOT / "deploy/recovery/verification.account_isolation.json"


class Failure(Exception):
    pass


def request(url, method="GET", body=None, token=None, key=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if key:
        headers["apikey"] = key
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as error:
        response = error
    except (urllib.error.URLError, TimeoutError):
        raise Failure(
            "Network request failed; no credentials or response body logged"
        ) from None
    with response:
        raw = response.read(8 * 1024 * 1024)
        try:
            parsed = json.loads(raw) if raw else None
        except (ValueError, UnicodeDecodeError):
            parsed = None
        return response.status, parsed


def main():
    source = (ROOT / "client-app/src/lib/supabase.ts").read_text()
    auth = re.search(r'const SUPABASE_URL = "([^"]+)"', source)[1]
    key = re.search(r'"(sb_publishable_[^"]+)"', source)[1]
    report = {
        "started_at_utc": datetime.datetime.now(datetime.UTC).isoformat(),
        "api": API,
        "checks": [],
        "cleanup": [],
        "completed": False,
        "scope": "tags and saved-query ownership; profile identity; anonymous denial",
        "not_tested": [
            "social mutations/privacy",
            "library writes",
            "settings writes",
            "all endpoints",
        ],
    }
    sessions, fixtures = [], []

    def check(name, passed, status=None):
        report["checks"].append(
            {"name": name, "passed": bool(passed), "status": status}
        )
        print(("PASS " if passed else "FAIL ") + name, flush=True)
        if not passed:
            raise Failure(name)

    def api(path, account=None, method="GET", body=None):
        return request(
            API + path,
            method,
            body,
            token=sessions[account]["access_token"] if account is not None else None,
        )

    try:
        status, _ = api("/test")
        check("backend reachable from this network", status == 200, status)
        for path in ["/profile", "/tags", "/saved-queries", "/settings"]:
            status, _ = api(path)
            check("anonymous denied " + path, status == 401, status)
        print("Use two DIFFERENT development/test accounts. Passwords are not saved.")
        for label in ["A", "B"]:
            email = input("Account " + label + " email: ").strip()
            password = getpass.getpass("Account " + label + " password (hidden): ")
            status, data = request(
                auth + "/auth/v1/token?grant_type=password",
                "POST",
                {"email": email, "password": password},
                key=key,
            )
            del password, email
            check(
                "account " + label + " sign-in",
                status == 200
                and isinstance(data, dict)
                and bool(data.get("access_token")),
                status,
            )
            sessions.append(
                {"access_token": data["access_token"], "id": data["user"]["id"]}
            )
            del data
        check("accounts are distinct", sessions[0]["id"] != sessions[1]["id"])
        marker = "isolation-" + uuid.uuid4().hex[:12]
        for owner in [0, 1]:
            status, profile = api("/profile", owner)
            check(
                f"account {owner} profile matches JWT subject",
                status == 200
                and isinstance(profile, dict)
                and profile.get("uid") == sessions[owner]["id"],
                status,
            )
            status, tag_id = api(
                "/tags",
                owner,
                "POST",
                {"name": f"{marker}-{owner}", "color": "#123456"},
            )
            check(
                f"account {owner} creates fixture tag",
                status == 200 and isinstance(tag_id, int),
                status,
            )
            fixtures.append((owner, "tag", tag_id))
            status, saved = api(
                "/saved-queries",
                owner,
                "POST",
                {
                    "name": f"{marker}-{owner}",
                    "query": {
                        "where": {
                            "filter": {
                                "field": "tag",
                                "tag_id": tag_id,
                                "op": "is_applied",
                            }
                        }
                    },
                    "consider_default_tags": False,
                    "library_or_tagged": True,
                    "favorite": False,
                },
            )
            # Register returned IDs before validating later fields so cleanup can run.
            if isinstance(saved, dict) and isinstance(saved.get("saved_query_id"), int):
                fixtures.append((owner, "saved_query", saved["saved_query_id"]))
            check(
                f"account {owner} creates fixture query",
                status == 200 and isinstance(saved, dict) and "saved_query_id" in saved,
                status,
            )
        for owner, kind, ident in fixtures:
            other = 1 - owner
            if kind == "tag":
                path = f"/tags?tag_id={ident}"
                status, before = api(path, owner)
                check(f"owner {owner} reads fixture tag", status == 200, status)
                status, _ = api(path, other)
                check(
                    f"other account cannot read tag {owner}",
                    status in (403, 404),
                    status,
                )
                status, _ = api(
                    "/tags",
                    other,
                    "PATCH",
                    {"tag_id": ident, "name": marker + "-unauthorized"},
                )
                check(
                    f"other account cannot rename tag {owner}",
                    status in (403, 404),
                    status,
                )
                # This endpoint intentionally returns success for a nonexistent/unowned ID.
                status, _ = api("/tags", other, "DELETE", {"tag_id": ident})
                check(
                    f"cross-account tag delete has valid response {owner}",
                    status in (200, 204, 403, 404),
                    status,
                )
                status, after = api(path, owner)
                check(
                    f"owner tag {owner} unchanged after attempted writes",
                    status == 200 and before == after,
                    status,
                )
            else:
                path = f"/saved-queries/{ident}"
                status, before = api(path + "/songs", owner)
                check(f"owner {owner} reads fixture query songs", status == 200, status)
                for suffix, method, body in [
                    ("/songs", "GET", None),
                    ("", "PATCH", {"name": marker + "-unauthorized"}),
                    ("/rerun", "POST", None),
                    ("", "DELETE", None),
                ]:
                    status, _ = api(path + suffix, other, method, body)
                    check(
                        f"other account denied query {owner} {method} {suffix}",
                        status in (403, 404),
                        status,
                    )
                status, listing = api("/saved-queries", owner)
                own = (
                    next((q for q in listing if q.get("saved_query_id") == ident), None)
                    if isinstance(listing, list)
                    else None
                )
                check(
                    f"owner query {owner} retained unchanged name",
                    status == 200
                    and own is not None
                    and own.get("name") == f"{marker}-{owner}",
                    status,
                )
                status, listing = api("/saved-queries", other)
                check(
                    f"query {owner} absent from other account list",
                    status == 200
                    and isinstance(listing, list)
                    and all(q.get("saved_query_id") != ident for q in listing),
                    status,
                )
        report["completed"] = True
    except (Failure, KeyboardInterrupt, EOFError) as error:
        report["failure"] = str(error) if isinstance(error, Failure) else "Interrupted"
        print("Stopped: " + report["failure"], file=sys.stderr)
    finally:
        for owner, kind, ident in reversed(fixtures):
            try:
                status, _ = api(
                    "/tags" if kind == "tag" else f"/saved-queries/{ident}",
                    owner,
                    "DELETE",
                    {"tag_id": ident} if kind == "tag" else None,
                )
                report["cleanup"].append(
                    {
                        "account": owner,
                        "kind": kind,
                        "id": ident,
                        "passed": status in (200, 204, 404),
                        "status": status,
                    }
                )
            except Failure:
                report["cleanup"].append(
                    {"account": owner, "kind": kind, "id": ident, "passed": False}
                )
        for session in sessions:
            try:
                status, _ = request(
                    auth + "/auth/v1/logout?scope=local",
                    "POST",
                    token=session["access_token"],
                    key=key,
                )
                report.setdefault("test_session_logout", []).append(status)
            except Failure:
                report.setdefault("test_session_logout", []).append("network_error")
        report["finished_at_utc"] = datetime.datetime.now(datetime.UTC).isoformat()
        REPORT.write_text(json.dumps(report, indent=2) + "\n")
        print("Credential-free report: " + str(REPORT))
    return (
        0 if report["completed"] and all(c["passed"] for c in report["cleanup"]) else 1
    )


if __name__ == "__main__":
    raise SystemExit(main())
