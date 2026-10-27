# Server resource monitoring

`ops/resource_monitor.py` is a Python standard-library Linux check for CPU, memory and disk usage. Run one instance per application server. It sends technical resource threshold events to the Sentry project chosen for server operations. It does not make AI calls.

## Default behaviour

- Check every five minutes using the supplied systemd timer.
- CPU and memory alert at 90%; disk alerts at 85%.
- A resource must remain above its threshold for three consecutive checks before an event is sent. CPU measures the average since the previous check, so its first check only establishes a baseline.
- Recovery requires three consecutive checks below the threshold minus five percentage points.
- Send one event when a resource becomes high and another when it recovers. Continuing pressure does not send repeated events. A failed Sentry delivery leaves the transition pending for retry at the next check.
- State is private and survives process restarts. If that state is lost, the debounce period starts again.
- Optional Sentry Cron heartbeats report each completed check as `ok` or `error`. Enable this to detect a stopped or failing timer even when no resource threshold is crossed. The monitor is upserted with a five-minute schedule, `Asia/Kolkata` timezone and ten-minute late margin. Heartbeats contain only the generic monitor slug, environment, status and duration.

Sentry receives the environment, generic names such as `cpu`, `memory` and `disk_1`, percentage and transition status. It receives no patient data, process list, hostname, filesystem path, private configuration, API keys or DSN in the event body. The DSN's public ingestion key is sent only to its configured HTTPS ingestion endpoint. Redirects are rejected.

## Private configuration

Create `/home/ghostpepper/.config/niq/resource-monitor.json` with mode `0600`, owned by the service user. Do not commit the real DSN. Create the state directory in advance with mode `0700` and service-user ownership.

```json
{
  "environment": "production",
  "dsn": "https://PUBLIC_KEY@INGEST_HOST/PROJECT_ID",
  "heartbeat_enabled": true,
  "monitor_slug": "niq-server-resources",
  "state_path": "/home/ghostpepper/.local/state/niq-resource-monitor/state.json",
  "filesystem_paths": ["/"],
  "threshold_percent": {"cpu": 90, "memory": 90, "disk": 85},
  "consecutive_checks": 3,
  "recovery_margin_percent": 5
}
```

Alternatively omit `dsn` and supply `SENTRY_RESOURCE_DSN` through a private environment file. Configure only the mount points that contain the application data, with a maximum of eight absolute paths. Avoid listing several directories on the same filesystem, which would duplicate disk alerts. `disk_1` refers to the first configured path, `disk_2` to the second; the mapping stays in private configuration. The `environment` can be `development`, `staging` or `production`; resource monitoring may run in staging too. Production-only scheduling of backups is separate.

## Install and verify

Review the user and deployment paths in `ops/systemd/niq-resource-monitor.*` before installation. Copy them into `/etc/systemd/system/`, reload systemd, then enable the timer. This requires the server administrator's CLI privileges, not an application frontend.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now niq-resource-monitor.timer
sudo systemctl start niq-resource-monitor.service
sudo systemctl status niq-resource-monitor.service
sudo systemctl list-timers niq-resource-monitor.timer
```

Normal stdout only reports the number of transitions. Failures return exit code 1 with a generic error; raw exceptions are intentionally suppressed because network exceptions may expose private endpoint details. Inspect configuration permissions and timer status locally when troubleshooting.

Configure the Sentry issue alert for `logger:niq.resource-monitor` and `level:warning` to notify `factbook999@gmail.com`. Recovery events are informational and should not send an additional urgent email. Configure repeat notifications in Sentry if persistent unresolved resource pressure needs reminders. The script itself does not send email.

With `heartbeat_enabled: true`, configure the Sentry Cron monitor's alerts to notify `factbook999@gmail.com` on errors and missed check-ins. Heartbeat traffic occurs every five minutes but should notify only on a monitor incident, not on every successful check. This consumes Sentry Cron check-in quota. Keep the configured cron schedule aligned with the supplied timer. An invalid/unreadable configuration cannot report an error check-in, but the missing check-in still detects it after the monitor has first been registered.

The timer checks resource pressure; it is not proof that public APIs are reachable. Configure an independent Sentry uptime check for public API health. A stopped server cannot send its own resource event, so missed-check-in detection happens at Sentry. Resource checks do not perform cleanup, delete clinical records or manage backup retention.

## Tests

```sh
python3 -m unittest discover -s ops/tests -p 'test_resource_monitor.py'
```

Tests use fake Linux counters, disk readings, time and delivery. They do not contact Sentry or consume AI credits.
