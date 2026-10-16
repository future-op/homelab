#!/usr/bin/env python3
"""collect_status.py - build the public data/status.json feed from LAN-only sources.

Run this INSIDE your LAN (cron/systemd timer). It reads internal monitoring data,
maps internal names to public ids, and writes a sanitized file containing only:

    {"updated": "<ISO-8601 UTC>", "services": [{"id": ..., "name": ..., "state": ...}]}

state is one of: up | down | stopped | degraded.  Nothing else (no IPs, no hostnames,
no URLs, no internal job or guest names) is ever written. Python stdlib only (3.8+).

Sources (either or both; at least one required)
  Prometheus  env PROM_URL   e.g. http://prometheus.example:9090
              env PROM_QUERY metric/query to evaluate (default: up)
              Each series' value 1 => up, 0 => down. If several series map to the
              same public id: all up => up, some up => degraded, none up => down.
              Series are attributed to public ids in the mapping file two ways:
                prometheus.map    {"<value of label>": "<public id>"}, label set by
                                  prometheus.label (default "job"), e.g. up{job=...}
                prometheus.rules  [{"match": {"<label>": "<value>", ...}, "id": "<public id>"}]
                                  every label must match exactly; "__name__" matches the
                                  metric name. Rules win over map. Optional "off_state"
                                  ("down" default, or "stopped") is reported when the
                                  value is 0. Use for pve_up (prometheus-pve-exporter),
                                  e.g. match {"__name__": "pve_up", "id": "qemu/107"},
                                  and set PROM_QUERY='pve_up or up' to fetch both.
              An empty query result counts as a failed source (nothing is written).
  Proxmox     env PVE_URL    e.g. https://pve.example:8006
              env PVE_TOKEN  API token as 'user@realm!tokenid=SECRET' (read-only role,
                             PVEAuditor, is enough). Keep it in the environment / an
                             EnvironmentFile, never in a file in the site repo.
              env PVE_VERIFY_TLS  set to 0 to skip TLS verification (self-signed lab certs)
              Uses /api2/json/cluster/resources?type=vm: running => up,
              stopped => stopped, anything else (paused, ...) => degraded.

Combining: if a public id has data from both, Proxmox 'stopped' wins (the guest is
intentionally off); otherwise Prometheus wins (it sees the service itself); if
Proxmox says running but Prometheus says down, the result is 'degraded'.

Other env: PROM_TIMEOUT / HTTP_TIMEOUT seconds (default 10).

Usage
  collect_status.py --mapping tools/mapping.json --out data/status.json
                    [--services data/services.json] [--print]

  --services  optional; used to look up the display name for each id and to warn about
              mapped ids that do not exist on the site.
  --print     also print the result to stdout.

Safety behaviour: if every configured source fails, the script exits non-zero and does
NOT touch the existing output file, so the website's feed goes stale and visitors see
'unknown' rather than a wrong 'up'. The output is written atomically (temp file + rename).
Exit codes: 0 ok, 1 all sources failed, 2 configuration error.
"""
import argparse
import datetime
import json
import os
import ssl
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

VALID = ("up", "down", "stopped", "degraded")


def log(msg):
    print("collect_status: " + msg, file=sys.stderr)


def http_get_json(url, headers=None, verify=True):
    timeout = float(os.environ.get("HTTP_TIMEOUT", os.environ.get("PROM_TIMEOUT", "10")))
    req = urllib.request.Request(url, headers=headers or {})
    ctx = None
    if url.startswith("https://") and not verify:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return json.loads(r.read().decode("utf-8"))


def match_rule(metric, rules):
    """Return the first rule whose 'match' labels all equal the series' labels."""
    for r in rules:
        m = r.get("match") or {}
        if m and all(metric.get(k) == v for k, v in m.items()):
            return r
    return None


def query_prometheus(base, query, label, name_map, rules=None):
    """Return {public_id: state} from an instant query.

    A series is attributed to a public id by the first matching entry of `rules`
    (all labels in "match" must be equal; "__name__" matches the metric name), else by
    the legacy single-label `name_map` (value of `label` -> public id)."""
    rules = rules or []
    url = base.rstrip("/") + "/api/v1/query?" + urllib.parse.urlencode({"query": query})
    data = http_get_json(url)
    if data.get("status") != "success":
        raise RuntimeError("prometheus returned status=%r" % data.get("status"))
    results = data.get("data", {}).get("result", [])
    if not results:
        # an empty answer means the query/exporter is broken, not that everything is down
        raise RuntimeError("prometheus returned no series")
    seen = {}  # public id -> list of up? flags
    off_state = {}  # public id -> state to report when nothing is up
    for series in results:
        metric = series.get("metric", {})
        rule = match_rule(metric, rules)
        if rule:
            pub = rule.get("id")
        else:
            pub = name_map.get(metric.get(label))
        if not pub:
            continue  # not allow-listed: ignored, never published
        try:
            val = float(series["value"][1])
        except (KeyError, IndexError, ValueError, TypeError):
            continue
        seen.setdefault(pub, []).append(val >= 1)
        if rule and rule.get("off_state") in VALID:
            off_state[pub] = rule["off_state"]
    out = {}
    for pub, flags in seen.items():
        out[pub] = "up" if all(flags) else ("degraded" if any(flags) else off_state.get(pub, "down"))
    # mapped ids with no series at all: Prometheus no longer scrapes them => down
    for pub in set(name_map.values()) | set(r.get("id") for r in rules if r.get("id")):
        out.setdefault(pub, "down")
    return out


def query_proxmox(base, token, verify, vmid_map):
    """Return {public_id: state} from the cluster resources API."""
    url = base.rstrip("/") + "/api2/json/cluster/resources?type=vm"
    data = http_get_json(url, headers={"Authorization": "PVEAPIToken=" + token}, verify=verify)
    out = {}
    for g in data.get("data", []):
        pub = vmid_map.get(str(g.get("vmid")))
        if not pub:
            continue
        status = g.get("status")
        out[pub] = "up" if status == "running" else ("stopped" if status == "stopped" else "degraded")
    for pub in set(vmid_map.values()):
        out.setdefault(pub, "down")  # mapped guest not found in the cluster
    return out


def combine(prom, pve):
    result = {}
    for pub in set(prom) | set(pve):
        p, v = prom.get(pub), pve.get(pub)
        if v == "stopped":
            result[pub] = "stopped"
        elif p is not None:
            result[pub] = "degraded" if (p == "down" and v == "up") else p
        else:
            result[pub] = v
    return result


def main():
    ap = argparse.ArgumentParser(description="Write the sanitized public status.json feed.")
    ap.add_argument("--mapping", required=True, help="mapping file (see tools/mapping.example.json)")
    ap.add_argument("--out", required=True, help="output path, e.g. data/status.json")
    ap.add_argument("--services", help="data/services.json (optional, for display names)")
    ap.add_argument("--print", action="store_true", dest="do_print")
    a = ap.parse_args()

    try:
        with open(a.mapping) as f:
            mapping = json.load(f)
    except (OSError, ValueError) as e:
        log("cannot read mapping: %s" % e)
        return 2

    names = {}
    if a.services:
        try:
            with open(a.services) as f:
                names = {s["id"]: s["name"] for s in json.load(f)["services"]}
        except (OSError, ValueError, KeyError) as e:
            log("cannot read services file: %s" % e)
            return 2

    prom_url = os.environ.get("PROM_URL")
    pve_url = os.environ.get("PVE_URL")
    if not prom_url and not pve_url:
        log("set PROM_URL and/or PVE_URL")
        return 2

    prom, pve, ok, failed = {}, {}, 0, 0
    if prom_url:
        pm = mapping.get("prometheus", {})
        try:
            prom = query_prometheus(prom_url, os.environ.get("PROM_QUERY", "up"),
                                    pm.get("label", "job"), pm.get("map", {}), pm.get("rules", []))
            ok += 1
        except Exception as e:  # noqa: BLE001 - report type only, URLs may be internal
            failed += 1
            log("prometheus source failed: %s" % type(e).__name__)
    if pve_url:
        token = os.environ.get("PVE_TOKEN")
        if not token:
            log("PVE_URL set but PVE_TOKEN missing")
            return 2
        verify = os.environ.get("PVE_VERIFY_TLS", "1") != "0"
        try:
            pve = query_proxmox(pve_url, token, verify, mapping.get("proxmox", {}).get("map", {}))
            ok += 1
        except Exception as e:  # noqa: BLE001
            failed += 1
            log("proxmox source failed: %s" % type(e).__name__)
    if ok == 0:
        log("all sources failed; leaving %s untouched (feed will go stale)" % a.out)
        return 1
    if failed:
        log("warning: %d source(s) failed; results are partial" % failed)

    states = combine(prom, pve)
    services = []
    for pub in sorted(states):
        if names and pub not in names:
            log("warning: mapped id %r is not in services file" % pub)
        st = states[pub]
        services.append({"id": pub, "name": names.get(pub, pub), "state": st if st in VALID else "degraded"})
    doc = {"updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "services": services}

    out_dir = os.path.dirname(os.path.abspath(a.out))
    fd, tmp = tempfile.mkstemp(prefix=".status-", suffix=".tmp", dir=out_dir)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(doc, f, indent=2)
            f.write("\n")
        os.chmod(tmp, 0o644)
        os.replace(tmp, a.out)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    if a.do_print:
        print(json.dumps(doc, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
