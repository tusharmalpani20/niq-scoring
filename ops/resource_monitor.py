#!/usr/bin/env python3
"""Bounded Linux resource checks. Sends only threshold transitions to Sentry."""

import argparse
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import uuid


def read_private_json(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise ValueError("Configuration and state files must be private regular files")
    if info.st_uid != os.geteuid():
        raise ValueError("Configuration and state must belong to the current user")
    return json.loads(path.read_text())


def save_state(path, state):
    path = Path(path)
    if not path.is_absolute():
        raise ValueError("State path must be absolute")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent = path.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_mode & 0o077:
        raise ValueError("State directory must be private")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as file:
            temporary = file.name
            os.chmod(temporary, 0o600)
            json.dump(state, file)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def collect(proc=Path("/proc"), disks=None, previous_cpu=None):
    values = [int(value) for value in (proc / "stat").read_text().splitlines()[0].split()[1:9]]
    # Guest CPU time is already included in user/nice; count each tick once.
    cpu = {"total": sum(values), "idle": values[3] + values[4]}
    measurements = {}
    if previous_cpu:
        total = cpu["total"] - previous_cpu["total"]
        idle = cpu["idle"] - previous_cpu["idle"]
        if total > 0 and 0 <= idle <= total:
            measurements["cpu"] = round(100 * (total - idle) / total, 2)
    memory = {}
    for line in (proc / "meminfo").read_text().splitlines():
        name, value = line.split(":", 1)
        memory[name] = int(value.split()[0])
    measurements["memory"] = round(100 * (1 - memory["MemAvailable"] / memory["MemTotal"]), 2)
    for index, path in enumerate(disks or ["/"]):
        usage = shutil.disk_usage(path)
        measurements[f"disk_{index + 1}"] = round(100 * usage.used / usage.total, 2)
    return measurements, cpu


def update_states(previous, measurements, thresholds, consecutive, hysteresis):
    states = dict(previous)
    transitions = []
    for name, value in measurements.items():
        threshold = thresholds["disk" if name.startswith("disk_") else name]
        old = states.get(name, {"active": False, "count": 0})
        active = old["active"]
        opposite = value < threshold - hysteresis if active else value >= threshold
        count = old["count"] + 1 if opposite else 0
        new = {"active": active, "count": count}
        if count >= consecutive:
            new = {"active": not active, "count": 0}
            transitions.append({"metric": name, "status": "recovered" if active else "high", "percent": value})
        states[name] = new
    return states, transitions


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def send_envelope(dsn, item_type, payload):
    parsed = urllib.parse.urlsplit(dsn)
    parts = parsed.path.rstrip("/").split("/")
    project = parts[-1]
    if (parsed.scheme != "https" or not parsed.hostname or not parsed.username
            or parsed.password or parsed.query or parsed.fragment or not project.isdigit()):
        raise ValueError("Invalid HTTPS Sentry DSN")
    key = parsed.username
    if not key.isalnum():
        raise ValueError("Invalid Sentry public key")
    netloc = parsed.hostname + (f":{parsed.port}" if parsed.port else "")
    endpoint = f"https://{netloc}{'/'.join(parts[:-1])}/api/{project}/envelope/"
    envelope_id = payload.get("event_id") or payload["check_in_id"]
    envelope = "\n".join([json.dumps({"event_id": envelope_id}), json.dumps({"type": item_type}), json.dumps(payload)]) + "\n"
    request = urllib.request.Request(endpoint, data=envelope.encode(), method="POST", headers={
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": f"Sentry sentry_version=7,sentry_client=niq-resource-monitor/1,sentry_key={key}",
    })
    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError("Sentry did not accept resource event")


def send_event(dsn, environment, transitions, now):
    high = any(item["status"] == "high" for item in transitions)
    event_id = uuid.uuid4().hex
    event = {
        "event_id": event_id,
        "timestamp": datetime.datetime.fromtimestamp(now, datetime.timezone.utc).isoformat(),
        "platform": "other", "logger": "niq.resource-monitor", "environment": environment,
        "level": "warning" if high else "info",
        "message": "NIQ server resource threshold exceeded" if high else "NIQ server resources recovered",
        "fingerprint": ["niq-server-resources", environment, "high" if high else "recovered"],
        "tags": {"component": "server-resources"},
        "extra": {"transitions": transitions},
    }
    # Deliberately omit hostname, filesystem paths, process lists and environment variables.
    send_envelope(dsn, "event", event)


def send_checkin(config, status, duration):
    slug = config.get("monitor_slug", "niq-server-resources")
    environment = config.get("environment", "production")
    if (not isinstance(slug, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,50}", slug)
            or environment not in {"production", "development", "staging"}
            or status not in {"ok", "error"}):
        raise ValueError("Invalid heartbeat configuration")
    dsn = config.get("dsn") or os.environ.get("SENTRY_RESOURCE_DSN")
    if not dsn:
        raise ValueError("Resource monitoring DSN is not configured")
    send_envelope(dsn, "check_in", {
        "check_in_id": uuid.uuid4().hex,
        "monitor_slug": slug,
        "status": status,
        "environment": environment,
        "duration": max(0, duration),
        "monitor_config": {
            "schedule": {"type": "crontab", "value": "*/5 * * * *"},
            "timezone": "Asia/Kolkata", "checkin_margin": 10, "max_runtime": 1,
            "failure_issue_threshold": 1, "recovery_threshold": 1,
        },
    })


def run(config, sender=send_event, collector=collect, now=None):
    state_path = config["state_path"]
    disks = config.get("filesystem_paths", ["/"])
    if not 1 <= len(disks) <= 8 or any(not Path(path).is_absolute() for path in disks):
        raise ValueError("Allowlist one to eight absolute filesystem paths")
    thresholds = {"cpu": 90, "memory": 90, "disk": 85, **config.get("threshold_percent", {})}
    if set(thresholds) != {"cpu", "memory", "disk"} or any(not 1 <= value <= 100 for value in thresholds.values()):
        raise ValueError("Invalid resource thresholds")
    consecutive = config.get("consecutive_checks", 3)
    hysteresis = config.get("recovery_margin_percent", 5)
    if not isinstance(consecutive, int) or not 1 <= consecutive <= 12 or not 0 < hysteresis < min(thresholds.values()):
        raise ValueError("Invalid debounce settings")
    environment = config.get("environment", "production")
    if environment not in {"production", "development", "staging"}:
        raise ValueError("Invalid environment")
    state = read_private_json(state_path) if Path(state_path).exists() else {}
    measurements, cpu = collector(disks=disks, previous_cpu=state.get("cpu"))
    previous = state.get("metrics", {})
    current, transitions = update_states(previous, measurements, thresholds, consecutive, hysteresis)
    if transitions:
        dsn = config.get("dsn") or os.environ.get("SENTRY_RESOURCE_DSN")
        if not dsn:
            raise ValueError("Resource monitoring DSN is not configured")
        sender(dsn, environment, transitions, time.time() if now is None else now)
    # Persist transitions only after Sentry accepts them, allowing failed delivery to retry.
    save_state(state_path, {"cpu": cpu, "metrics": current})
    return transitions


def execute(config, runner=run, checkin_sender=send_checkin):
    started = time.monotonic()
    heartbeat = config.get("heartbeat_enabled", False)
    if not isinstance(heartbeat, bool):
        raise ValueError("heartbeat_enabled must be boolean")
    try:
        result = runner(config)
    except Exception:
        if heartbeat:
            try:
                checkin_sender(config, "error", time.monotonic() - started)
            except Exception:
                pass  # A missing heartbeat also detects collector or connectivity failure.
        raise
    if heartbeat:
        checkin_sender(config, "ok", time.monotonic() - started)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Private JSON configuration file")
    args = parser.parse_args()
    try:
        changes = execute(read_private_json(args.config))
        print(f"Resource check complete; {len(changes)} threshold transition(s).")
        return 0
    except Exception:
        # Exceptions can contain DSNs or local paths; never print their raw text.
        print("Resource monitor failed; check private configuration, state permissions and connectivity.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
