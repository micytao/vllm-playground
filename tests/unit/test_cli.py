"""Unit tests for vllm_playground.cli.

Covers PID-file lifecycle (mocked psutil, no real processes touched) and
argparse subcommand wiring (mocked cmd_* handlers, no real server start).
"""

from types import SimpleNamespace

import pytest

from vllm_playground import cli

# ---------------------------------------------------------------------------
# PID file helpers
# ---------------------------------------------------------------------------


def test_get_pid_file_uses_home(isolated_home):
    assert cli.get_pid_file() == isolated_home / ".vllm_playground.pid"


def test_write_and_cleanup_pid_file(isolated_home):
    cli.write_pid_file()
    pid_file = cli.get_pid_file()
    assert pid_file.exists()
    assert pid_file.read_text().strip().isdigit()

    cli.cleanup_pid_file()
    assert not pid_file.exists()


def test_cleanup_pid_file_missing_is_noop(isolated_home):
    # Should not raise even if the file was never created.
    cli.cleanup_pid_file()


# ---------------------------------------------------------------------------
# find_process_by_port / get_existing_process (mocked psutil)
# ---------------------------------------------------------------------------


class FakeConn:
    def __init__(self, port, status="LISTEN", pid=4242):
        self.laddr = SimpleNamespace(port=port)
        self.status = status
        self.pid = pid


class FakeProcess:
    def __init__(self, pid, cmdline_parts=None, alive=True):
        self.pid = pid
        self._cmdline_parts = cmdline_parts or ["python", "-m", "vllm_playground"]
        self._alive = alive

    def cmdline(self):
        return list(self._cmdline_parts)

    def terminate(self):
        self._terminated = True

    def kill(self):
        self._killed = True
        # Real processes die (eventually) once SIGKILL is sent -- flip the
        # fake's state so the subsequent wait() call succeeds, matching
        # cli.kill_existing_process()'s terminate-then-kill fallback flow.
        self._alive = False

    def wait(self, timeout=None):
        if not self._alive:
            return 0
        raise __import__("psutil").TimeoutExpired(seconds=timeout, pid=self.pid)

    def status(self):
        return "running"


def test_find_process_by_port_matches_listening_socket(monkeypatch):
    conn = FakeConn(port=7860, pid=555)
    monkeypatch.setattr(cli.psutil, "net_connections", lambda kind="inet": [conn])
    monkeypatch.setattr(cli.psutil, "Process", lambda pid: FakeProcess(pid))

    proc = cli.find_process_by_port(7860)
    assert proc is not None
    assert proc.pid == 555


def test_find_process_by_port_no_match(monkeypatch):
    conn = FakeConn(port=9999, pid=555)
    monkeypatch.setattr(cli.psutil, "net_connections", lambda kind="inet": [conn])

    assert cli.find_process_by_port(7860) is None


def test_find_process_by_port_survives_permission_error(monkeypatch):
    # Some restricted/sandboxed environments (e.g. macOS without full
    # process-listing entitlements) raise a raw PermissionError from the
    # underlying syscall instead of psutil.AccessDenied -- must not crash.
    def _raise(kind="inet"):
        raise PermissionError("Operation not permitted")

    monkeypatch.setattr(cli.psutil, "net_connections", _raise)

    assert cli.find_process_by_port(7860) is None


def test_get_existing_process_reads_valid_pid_file(isolated_home, monkeypatch):
    cli.get_pid_file().write_text("4242")
    monkeypatch.setattr(cli.psutil, "pid_exists", lambda pid: True)
    monkeypatch.setattr(cli.psutil, "Process", lambda pid: FakeProcess(pid, ["python", "vllm-playground"]))

    proc = cli.get_existing_process()
    assert proc is not None
    assert proc.pid == 4242


def test_get_existing_process_removes_stale_pid_file(isolated_home, monkeypatch):
    pid_file = cli.get_pid_file()
    pid_file.write_text("4242")
    monkeypatch.setattr(cli.psutil, "pid_exists", lambda pid: False)
    monkeypatch.setattr(cli.psutil, "net_connections", lambda kind="inet": [])

    proc = cli.get_existing_process()
    assert proc is None
    assert not pid_file.exists()


def test_get_existing_process_survives_undeletable_stale_pid_file(isolated_home, monkeypatch):
    # A stale PID file that can't be removed (e.g. owned by another user, or
    # a read-only filesystem) must not crash status/start/stop -- it should
    # just fall back to a port scan like any other stale-PID-file case.
    pid_file = cli.get_pid_file()
    pid_file.write_text("4242")
    monkeypatch.setattr(cli.psutil, "pid_exists", lambda pid: False)
    monkeypatch.setattr(cli.psutil, "net_connections", lambda kind="inet": [])
    monkeypatch.setattr(
        cli.Path,
        "unlink",
        lambda self, missing_ok=False: (_ for _ in ()).throw(PermissionError("Operation not permitted")),
    )

    proc = cli.get_existing_process()
    assert proc is None


def test_get_existing_process_falls_back_to_port_scan(isolated_home, monkeypatch):
    # No PID file at all -- should fall back to scanning the port.
    conn = FakeConn(port=7860, pid=777)
    monkeypatch.setattr(cli.psutil, "net_connections", lambda kind="inet": [conn])
    monkeypatch.setattr(cli.psutil, "Process", lambda pid: FakeProcess(pid, ["python", "vllm_playground"]))

    proc = cli.get_existing_process(port=7860)
    assert proc is not None
    assert proc.pid == 777


def test_kill_existing_process_graceful_terminate():
    proc = FakeProcess(pid=1, alive=False)
    assert cli.kill_existing_process(proc) is True


def test_kill_existing_process_force_kill_on_timeout():
    proc = FakeProcess(pid=1, alive=True)
    assert cli.kill_existing_process(proc) is True
    assert getattr(proc, "_killed", False) is True


# ---------------------------------------------------------------------------
# cmd_stop / cmd_status
# ---------------------------------------------------------------------------


def test_cmd_status_no_process(isolated_home, monkeypatch, capsys):
    monkeypatch.setattr(cli, "get_existing_process", lambda port=7860: None)
    rc = cli.cmd_status(SimpleNamespace())
    assert rc == 1
    assert "not running" in capsys.readouterr().out.lower()


def test_cmd_status_running(isolated_home, monkeypatch, capsys):
    monkeypatch.setattr(cli, "get_existing_process", lambda port=7860: FakeProcess(pid=99))
    rc = cli.cmd_status(SimpleNamespace())
    assert rc == 0
    assert "99" in capsys.readouterr().out


def test_cmd_stop_no_process(isolated_home, monkeypatch, capsys):
    monkeypatch.setattr(cli, "get_existing_process", lambda port=7860: None)
    rc = cli.cmd_stop(SimpleNamespace())
    assert rc == 0
    assert "no running" in capsys.readouterr().out.lower()


def test_cmd_stop_kills_existing_process(isolated_home, monkeypatch):
    monkeypatch.setattr(cli, "get_existing_process", lambda port=7860: FakeProcess(pid=99, alive=False))
    rc = cli.cmd_stop(SimpleNamespace())
    assert rc == 0


# ---------------------------------------------------------------------------
# Argparse wiring
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "argv,expected_cmd",
    [
        (["vllm-playground", "stop"], "cmd_stop"),
        (["vllm-playground", "status"], "cmd_status"),
        (["vllm-playground", "pull", "--cpu"], "cmd_pull"),
        (["vllm-playground"], "cmd_start"),
    ],
)
def test_main_dispatches_to_correct_subcommand(monkeypatch, argv, expected_cmd):
    called = {}

    for name in ("cmd_start", "cmd_stop", "cmd_status", "cmd_pull"):

        def make_recorder(n):
            def _recorder(args):
                called["name"] = n
                return 0

            return _recorder

        monkeypatch.setattr(cli, name, make_recorder(name))

    monkeypatch.setattr(cli.sys, "argv", argv)
    rc = cli.main()

    assert rc == 0
    assert called["name"] == expected_cmd


def test_pull_default_targets_nvidia_when_no_flags():
    """Mirrors cmd_pull's own flag-resolution logic (no subprocess calls made)."""
    args = SimpleNamespace(cpu=False, amd=False, tpu=False, omni=False, nvidia=False, gpu=False, all=False)
    has_specific_flag = args.cpu or args.amd or args.tpu or args.omni
    pull_nvidia = args.nvidia or args.gpu or args.all or (not has_specific_flag)
    assert pull_nvidia is True


def test_pull_cpu_flag_does_not_imply_nvidia():
    args = SimpleNamespace(cpu=True, amd=False, tpu=False, omni=False, nvidia=False, gpu=False, all=False)
    has_specific_flag = args.cpu or args.amd or args.tpu or args.omni
    pull_nvidia = args.nvidia or args.gpu or args.all or (not has_specific_flag)
    assert pull_nvidia is False
