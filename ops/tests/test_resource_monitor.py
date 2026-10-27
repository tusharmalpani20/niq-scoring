import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("resource_monitor", Path(__file__).parents[1] / "resource_monitor.py")
monitor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(monitor)


class ResourceMonitorTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.state = self.root / "state" / "resources.json"
        self.config = {"state_path": str(self.state), "dsn": "https://publickey@sentry.example/123", "consecutive_checks": 2}
        self.events = []

    def tearDown(self):
        self.directory.cleanup()

    def sample(self, cpu=20, memory=40, disk=50):
        def collector(**kwargs):
            return {"cpu": cpu, "memory": memory, "disk_1": disk}, {"total": 100, "idle": 80}
        return collector

    def sender(self, *args):
        self.events.append(args)

    def check(self, **values):
        return monitor.run(self.config, sender=self.sender, collector=self.sample(**values), now=1000)

    def test_sustained_pressure_and_recovery_emit_once_each(self):
        self.assertEqual(self.check(cpu=95), [])
        self.assertEqual(len(self.check(cpu=96)), 1)
        self.check(cpu=97)
        # Hysteresis keeps a borderline reading from flapping the alert.
        self.check(cpu=88)
        self.check(cpu=80)
        self.check(cpu=80)
        self.check(cpu=20)
        self.assertEqual([event[2][0]["status"] for event in self.events], ["high", "recovered"])
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.state.parent.stat().st_mode & 0o777, 0o700)

    def test_spike_does_not_alert(self):
        self.check(memory=99)
        self.check(memory=30)
        self.check(memory=99)
        self.assertEqual(self.events, [])

    def test_failed_delivery_does_not_mark_alert_as_delivered(self):
        self.check(disk=95)
        def unavailable(*args):
            raise OSError("network unavailable")
        with self.assertRaises(OSError):
            monitor.run(self.config, sender=unavailable, collector=self.sample(disk=95), now=1000)
        self.assertFalse(monitor.read_private_json(self.state)["metrics"]["disk_1"]["active"])
        self.check(disk=95)
        self.assertEqual(len(self.events), 1)

    def test_cpu_and_memory_are_calculated_from_linux_counters(self):
        proc = self.root / "proc"
        proc.mkdir()
        (proc / "stat").write_text("cpu 20 0 10 60 10 0 0 0 7 0\n")
        (proc / "meminfo").write_text("MemTotal: 1000 kB\nMemAvailable: 250 kB\n")
        with patch.object(monitor.shutil, "disk_usage", return_value=type("Usage", (), {"used": 85, "total": 100})()):
            measurements, cpu = monitor.collect(proc=proc, disks=["/"], previous_cpu={"total": 50, "idle": 40})
        self.assertEqual(cpu, {"total": 100, "idle": 70})
        self.assertEqual(measurements, {"cpu": 40.0, "memory": 75.0, "disk_1": 85.0})

    def test_first_sample_and_reboot_do_not_report_invalid_cpu(self):
        proc = self.root / "proc"
        proc.mkdir()
        (proc / "stat").write_text("cpu 20 0 10 60 10 0 0 0\n")
        (proc / "meminfo").write_text("MemTotal: 1000 kB\nMemAvailable: 250 kB\n")
        for previous in [None, {"total": 200, "idle": 100}]:
            measurements, _ = monitor.collect(proc=proc, disks=["/"], previous_cpu=previous)
            self.assertNotIn("cpu", measurements)

    def test_public_configuration_and_symlinks_are_rejected(self):
        config = self.root / "config.json"
        config.write_text("{}")
        config.chmod(0o644)
        with self.assertRaises(ValueError):
            monitor.read_private_json(config)
        config.chmod(0o600)
        link = self.root / "link"
        link.symlink_to(config)
        with self.assertRaises(ValueError):
            monitor.read_private_json(link)

    def test_sentry_payload_contains_only_resource_information(self):
        sent = []
        class Response:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
        class Opener:
            def open(self, request, **kwargs):
                sent.append(request)
                return Response()
        with patch.object(monitor.urllib.request, "build_opener", return_value=Opener()):
            monitor.send_event(self.config["dsn"], "production", [{"metric": "disk_1", "status": "high", "percent": 92}], 1000)
        request = sent[0]
        self.assertEqual(request.full_url, "https://sentry.example/api/123/envelope/")
        event = json.loads(request.data.decode().splitlines()[2])
        self.assertNotIn("server_name", event)
        self.assertNotIn("user", event)
        self.assertNotIn("request", event)
        self.assertNotIn("dsn", request.data.decode())
        self.assertEqual(event["extra"], {"transitions": [{"metric": "disk_1", "status": "high", "percent": 92}]})

    def test_dsn_cannot_use_plain_http_or_credentials(self):
        for dsn in ["http://key@sentry.example/123", "https://key:secret@sentry.example/123", "https://key@sentry.example/123?token=secret"]:
            with self.assertRaises(ValueError):
                monitor.send_event(dsn, "production", [], 1000)

    def test_relative_filesystem_paths_are_not_allowed(self):
        self.config["filesystem_paths"] = ["private/uploads"]
        with self.assertRaises(ValueError):
            self.check()

    def test_heartbeat_payload_has_fixed_schedule_and_no_private_context(self):
        self.config["environment"] = "development"
        with patch.object(monitor, "send_envelope") as send:
            monitor.send_checkin(self.config, "ok", 0.25)
        dsn, item_type, payload = send.call_args.args
        self.assertEqual(dsn, self.config["dsn"])
        self.assertEqual(item_type, "check_in")
        self.assertEqual(payload["monitor_slug"], "niq-server-resources")
        self.assertEqual(payload["environment"], "development")
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["monitor_config"]["schedule"], {"type": "crontab", "value": "*/5 * * * *"})
        self.assertEqual(payload["monitor_config"]["timezone"], "Asia/Kolkata")
        self.assertEqual(payload["monitor_config"]["checkin_margin"], 10)
        self.assertNotIn("state_path", payload)
        self.assertNotIn(str(self.root), json.dumps(payload))

    def test_optional_heartbeat_reports_success_and_error_without_masking_failure(self):
        checkins = []
        def sender(config, status, duration):
            checkins.append(status)
        monitor.execute(self.config, runner=lambda config: [], checkin_sender=sender)
        self.assertEqual(checkins, [])
        self.config["heartbeat_enabled"] = True
        monitor.execute(self.config, runner=lambda config: [], checkin_sender=sender)
        def failed(config):
            raise ValueError("collector failed")
        with self.assertRaisesRegex(ValueError, "collector failed"):
            monitor.execute(self.config, runner=failed, checkin_sender=sender)
        self.assertEqual(checkins, ["ok", "error"])
        def unavailable(*args):
            raise OSError("delivery failed")
        with self.assertRaisesRegex(ValueError, "collector failed"):
            monitor.execute(self.config, runner=failed, checkin_sender=unavailable)
        with self.assertRaisesRegex(OSError, "delivery failed"):
            monitor.execute(self.config, runner=lambda config: [], checkin_sender=unavailable)


if __name__ == "__main__":
    unittest.main()
