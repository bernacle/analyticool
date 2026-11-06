"""Independent standard-library replay of BRU-482; no candidate calculator imports.

Reads the materialized rows and independently authored expectations. Uses Python
integer arithmetic and datetime UTC normalization. This corroborates the baseline;
the TypeScript harness separately checks its declared negative cases and mutations.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

folder = Path(__file__).resolve().parent
fixture = json.loads((folder / "bru-482.fixture.json").read_text())
expected = json.loads((folder / "bru-482.expected.json").read_text())
data = fixture["input"]
assert data["asOf"] == "2026-07-01" and data["tenantId"] == "acme"
charges = {c["id"]: c for c in data["charges"]["rows"]}
payments = {p["id"]: p for p in data["payments"]["rows"]}
assert len(charges) == len(data["charges"]["rows"])
assert len(payments) == len(data["payments"]["rows"])
for c in charges.values():
    assert c["tenantId"] in fixture["organizations"]
    assert fixture["users"][fixture["chargeUsers"][c["id"]]] == c["tenantId"]


def month(at):
    return datetime.fromisoformat(at.replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%Y-%m")


def calculate(tenant):
    totals = {f"2026-{m:02}": [0, 0, 0] for m in range(1, 7)}
    for p in payments.values():
        c = charges[p["chargeId"]]
        if c["tenantId"] == tenant and p["status"] == "captured" and month(p["capturedAt"]) in totals:
            totals[month(p["capturedAt"])][0] += c["amountCents"]
    for column, stream, status, at in [(1, "refunds", "settled", "settledAt"), (2, "fees", "posted", "postedAt")]:
        rows = data[stream]["rows"]
        assert len({r["id"] for r in rows}) == len(rows)
        for r in rows:
            p = payments[r["paymentId"]]
            assert r["tenantId"] == charges[p["chargeId"]]["tenantId"] and p["status"] == "captured"
            if r["tenantId"] == tenant and r["status"] == status and month(r[at]) in totals:
                totals[month(r[at])][column] += r["amountCents"]
    return [dict(month=m, capturedCents=p, settledRefundCents=r, postedFeeCents=f, netCents=p-r-f) for m, (p, r, f) in totals.items()]


actual = calculate("acme")
assert actual == expected["points"]
assert {k: sum(p[k] for p in actual) for k in expected["totals"]} == expected["totals"]
assert {k: calculate("orbit")[1][k] for k in expected["orbitFebruary"]} == expected["orbitFebruary"]
print(json.dumps({"points": actual, "totals": expected["totals"]}, separators=(",", ":")))
