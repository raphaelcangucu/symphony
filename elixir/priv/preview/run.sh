#!/usr/bin/env bash
set -euo pipefail

exec python3 - "$@" <<'PYTHON'
import datetime
import http.client
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path


REPORT_VERSION = 1
DEFAULT_HEALTH_PATH = "/"
DEFAULT_HEALTH_TIMEOUT_MS = 120_000
DEFAULT_HEALTH_INTERVAL_MS = 1_000
DEFAULT_STOP_SIGNAL = "TERM"
DEFAULT_STOP_GRACE_MS = 5_000
HTTP_SUCCESS_MIN = 200
HTTP_SUCCESS_MAX = 399
MIN_PORT = 1
MAX_PORT = 65_535
SHELL_CONTROL_PATTERN = re.compile(r"[;&|<>`\r\n]|\$\(")
SUBSTITUTION_PATTERN = re.compile(r"\$\{([A-Z][A-Z0-9_]*)\}")
REQUIRED_ENV = (
    "SYMPHONY_PREVIEW_CONTRACT_ID",
    "SYMPHONY_PREVIEW_CONTRACT_REVISION",
    "SYMPHONY_PREVIEW_PREFERRED_PORT",
    "SYMPHONY_PREVIEW_ALLOWED_PORTS",
    "SYMPHONY_PREVIEW_REPORT_PATH",
    "SYMPHONY_PREVIEW_RUN_SPEC",
    "PORT",
)


class RunnerError(Exception):
    pass


def required_environment():
    values = {}
    for name in REQUIRED_ENV:
        value = os.environ.get(name, "").strip()
        if not value:
            raise RunnerError(f"missing required environment variable {name}")
        values[name] = value
    return values


def parse_integer(value, name, minimum=None, maximum=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise RunnerError(f"{name} must be an integer") from error

    if minimum is not None and parsed < minimum:
        raise RunnerError(f"{name} must be at least {minimum}")
    if maximum is not None and parsed > maximum:
        raise RunnerError(f"{name} must be at most {maximum}")
    return parsed


def parse_allowed_ports(raw_ports):
    ports = []
    for raw_port in raw_ports.split(","):
        stripped_port = raw_port.strip()
        if not stripped_port:
            raise RunnerError("SYMPHONY_PREVIEW_ALLOWED_PORTS contains an empty port")
        port = parse_integer(stripped_port, "allowed port", MIN_PORT, MAX_PORT)
        if port not in ports:
            ports.append(port)

    if not ports:
        raise RunnerError("SYMPHONY_PREVIEW_ALLOWED_PORTS must not be empty")
    return tuple(ports)


def load_spec(spec_path):
    try:
        with open(spec_path, "r", encoding="utf-8") as spec_file:
            spec = json.load(spec_file)
    except (OSError, json.JSONDecodeError) as error:
        raise RunnerError(f"cannot load run spec: {error}") from error

    if not isinstance(spec, dict):
        raise RunnerError("run spec must be a JSON object")
    return spec


class PreviewRunner:
    def __init__(self):
        environment = required_environment()
        self.launch_directory = Path.cwd()
        self.contract_id = environment["SYMPHONY_PREVIEW_CONTRACT_ID"]
        self.revision = parse_integer(
            environment["SYMPHONY_PREVIEW_CONTRACT_REVISION"],
            "SYMPHONY_PREVIEW_CONTRACT_REVISION",
            1,
        )
        self.preferred_port = parse_integer(
            environment["SYMPHONY_PREVIEW_PREFERRED_PORT"],
            "SYMPHONY_PREVIEW_PREFERRED_PORT",
            MIN_PORT,
            MAX_PORT,
        )
        self.port = parse_integer(environment["PORT"], "PORT", MIN_PORT, MAX_PORT)
        self.allowed_ports = parse_allowed_ports(environment["SYMPHONY_PREVIEW_ALLOWED_PORTS"])
        self.server_slug = os.environ.get("SYMPHONY_PREVIEW_SERVER_SLUG") or None
        self.session_name = os.environ.get("SYMPHONY_PREVIEW_SESSION_NAME") or None
        self.report_path = self._absolute_launch_path(environment["SYMPHONY_PREVIEW_REPORT_PATH"])
        self.spec_path = self._absolute_launch_path(environment["SYMPHONY_PREVIEW_RUN_SPEC"])
        self.spec = load_spec(self.spec_path)
        self.workspace = self._workspace_path()
        self.working_directory = self._working_directory()
        self.child = None
        self.stop_requested = False
        self.actual_port = None
        self._install_signal_handlers()

    def _absolute_launch_path(self, raw_path):
        path = Path(raw_path).expanduser()
        if path.is_absolute():
            return path
        return (self.launch_directory / path).resolve()

    def _workspace_path(self):
        configured_workspace = os.environ.get("SYMPHONY_WORKSPACE")
        if not configured_workspace:
            return self.launch_directory

        workspace = Path(configured_workspace).expanduser()
        if not workspace.is_absolute():
            workspace = self.launch_directory / workspace
        return workspace.resolve()

    def _working_directory(self):
        raw_cwd = self.spec.get("cwd")
        if raw_cwd is None or raw_cwd == "":
            return self.workspace
        if not isinstance(raw_cwd, str):
            raise RunnerError("run spec cwd must be a string")

        cwd = Path(raw_cwd).expanduser()
        if not cwd.is_absolute():
            cwd = self.workspace / cwd
        return cwd.resolve()

    def _install_signal_handlers(self):
        for handled_signal in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGQUIT):
            signal.signal(handled_signal, self._request_stop)

    def _request_stop(self, _signal_number, _frame):
        self.stop_requested = True

    def write_report(self, state, error=None):
        child_pid = self.child.pid if self.child is not None else os.getpid()
        report = {
            "version": REPORT_VERSION,
            "contract_id": self.contract_id,
            "revision": self.revision,
            "server_slug": self.server_slug,
            "state": state,
            "selected_port": self.preferred_port,
            "actual_port": self.actual_port,
            "pid": child_pid,
            "session_name": self.session_name,
            "reported_at": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
            "error": error,
        }

        self.report_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = None
        try:
            file_descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{self.report_path.name}.",
                suffix=".tmp",
                dir=self.report_path.parent,
            )
            temporary_path = Path(temporary_name)
            with os.fdopen(file_descriptor, "w", encoding="utf-8") as report_file:
                json.dump(report, report_file, separators=(",", ":"))
                report_file.write("\n")
                report_file.flush()
                os.fsync(report_file.fileno())
            os.replace(temporary_path, self.report_path)
        except OSError as write_error:
            raise RunnerError(f"cannot write runtime report: {write_error}") from write_error
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()

    def run(self):
        if not self.working_directory.is_dir():
            raise RunnerError(f"run spec cwd does not exist: {self.working_directory}")

        os.chdir(self.working_directory)
        self.write_report("starting")

        prepare_commands = self._command_list(self.spec.get("prepare", []), "prepare")
        start_commands = self._command_list(self.spec.get("start"), "start", require_nonempty=True)

        for command in prepare_commands:
            if self._command_is_skipped(command):
                continue
            self._run_one_shot(command, "prepare")
            self._raise_if_stop_requested()

        for command in start_commands[:-1]:
            if self._command_is_skipped(command):
                continue
            self._run_one_shot(command, "start")
            self._raise_if_stop_requested()

        supervised_command = start_commands[-1]
        if self._command_is_skipped(supervised_command):
            raise RunnerError("last start command cannot be skipped by exists")

        self._spawn_supervised(supervised_command)
        self._wait_for_health()
        self.actual_port = self.port

        if self.port not in self.allowed_ports:
            raise RunnerError(f"PORT {self.port} is not in allowed ports {list(self.allowed_ports)}")

        self.write_report("ready")

        if self._warmup_requested():
            self.stop_and_report()
            return 0

        while self.child.poll() is None:
            if self.stop_requested:
                self.stop_and_report()
                return 0
            time.sleep(0.05)

        raise RunnerError(f"supervised process exited with status {self.child.returncode}")

    def _command_list(self, value, field_name, require_nonempty=False):
        if not isinstance(value, list):
            raise RunnerError(f"run spec {field_name} must be a list")
        if require_nonempty and not value:
            raise RunnerError(f"run spec {field_name} must not be empty")
        return [self._normalize_command(command, field_name) for command in value]

    def _normalize_command(self, command, field_name):
        exists_path = None
        if isinstance(command, list):
            argv = command
        elif isinstance(command, dict):
            exists_path = command.get("exists")
            argv = command.get("argv", command.get("run"))
        else:
            raise RunnerError(f"{field_name} command must be an argv list or object")

        if exists_path is not None and (not isinstance(exists_path, str) or not exists_path.strip()):
            raise RunnerError(f"{field_name} command exists must be a non-empty string")
        if not isinstance(argv, list) or not argv:
            raise RunnerError(f"{field_name} command argv must be a non-empty list")

        shell_script_index = self._shell_script_index(argv)
        normalized_argv = []
        for index, argument in enumerate(argv):
            if not isinstance(argument, str) or "\x00" in argument:
                raise RunnerError(f"{field_name} command argv entries must be strings without NUL")
            if index == shell_script_index:
                # Explicit `bash -c` / `sh -lc` script argument: the shell is
                # intentional, so metacharacters are legitimate here and the
                # shell itself expands ${...} from the contract environment.
                normalized_argv.append(argument)
                continue
            expanded_argument = self._expand_argument(argument)
            if SHELL_CONTROL_PATTERN.search(expanded_argument):
                raise RunnerError(
                    f"{field_name} command contains rejected shell metacharacters; "
                    'wrap shell logic as ["bash", "-lc", "<script>"] or move it into a repo script'
                )
            normalized_argv.append(expanded_argument)

        return {"argv": tuple(normalized_argv), "exists": exists_path}

    @staticmethod
    def _shell_script_index(argv):
        if len(argv) < 3:
            return None
        if not all(isinstance(argument, str) for argument in argv[:3]):
            return None
        interpreter = Path(argv[0]).name
        if interpreter not in ("bash", "sh"):
            return None
        if argv[1] not in ("-c", "-lc"):
            return None
        return 2

    def _expand_argument(self, argument):
        def replace(match):
            variable_name = match.group(1)
            if variable_name != "PORT" and not variable_name.startswith("SYMPHONY_PREVIEW_"):
                raise RunnerError(f"unsupported command substitution {match.group(0)}")
            if variable_name not in os.environ:
                raise RunnerError(f"missing command substitution environment variable {variable_name}")
            return os.environ[variable_name]

        return SUBSTITUTION_PATTERN.sub(replace, argument)

    def _command_is_skipped(self, command):
        exists_path = command["exists"]
        if exists_path is None:
            return False

        path = Path(exists_path).expanduser()
        if not path.is_absolute():
            path = self.working_directory / path
        return not path.exists()

    def _run_one_shot(self, command, phase):
        try:
            completed = subprocess.run(
                command["argv"],
                cwd=self.working_directory,
                check=False,
            )
        except OSError as error:
            raise RunnerError(f"{phase} command failed to start: {error}") from error

        if completed.returncode != 0:
            raise RunnerError(f"{phase} command exited with status {completed.returncode}")

    def _spawn_supervised(self, command):
        try:
            self.child = subprocess.Popen(
                command["argv"],
                cwd=self.working_directory,
                start_new_session=True,
            )
        except OSError as error:
            raise RunnerError(f"start command failed to launch: {error}") from error

    def _wait_for_health(self):
        health = self.spec.get("health", {})
        if health is None:
            health = {}
        if not isinstance(health, dict):
            raise RunnerError("run spec health must be an object")

        timeout_ms = parse_integer(
            health.get("timeout_ms", DEFAULT_HEALTH_TIMEOUT_MS),
            "health.timeout_ms",
            1,
        )
        interval_ms = parse_integer(
            health.get("interval_ms", DEFAULT_HEALTH_INTERVAL_MS),
            "health.interval_ms",
            1,
        )
        # A serve process is never killed for being slow: long first boots
        # (image builds, dependency installs) keep running and readiness is
        # observed whenever the port finally responds. Only warm-up runs are
        # bounded by health.timeout_ms, because they exist to terminate.
        if self._warmup_requested():
            deadline = time.monotonic() + (timeout_ms / 1000)
        else:
            deadline = None

        primary_probe = {
            "path": health.get("path", DEFAULT_HEALTH_PATH),
            "host_header": health.get("host_header"),
        }
        self._wait_for_probe(primary_probe, deadline, interval_ms)

        additional_probes = health.get("also", [])
        if not isinstance(additional_probes, list):
            raise RunnerError("health.also must be a list")

        for probe in additional_probes:
            if not isinstance(probe, dict):
                raise RunnerError("health.also entries must be objects")
            if self._probe_is_skipped(probe):
                continue
            self._wait_for_probe(probe, deadline, interval_ms)

    def _probe_is_skipped(self, probe):
        exists_path = probe.get("exists")
        if exists_path is None:
            return False
        if not isinstance(exists_path, str) or not exists_path.strip():
            raise RunnerError("health.also exists must be a non-empty string")

        path = Path(exists_path).expanduser()
        if not path.is_absolute():
            path = self.working_directory / path
        return not path.exists()

    def _wait_for_probe(self, probe, deadline, interval_ms):
        path = probe.get("path", DEFAULT_HEALTH_PATH)
        host_header = probe.get("host_header")
        if not isinstance(path, str) or not path.startswith("/"):
            raise RunnerError("health probe path must start with /")
        if host_header is not None and (not isinstance(host_header, str) or not host_header.strip()):
            raise RunnerError("health probe host_header must be a non-empty string")

        last_error = "probe did not run"
        while deadline is None or time.monotonic() < deadline:
            self._raise_if_stop_requested()
            if self.child.poll() is not None:
                raise RunnerError(f"supervised process exited with status {self.child.returncode} before ready")

            if deadline is None:
                remaining_seconds = 1.0
            else:
                remaining_seconds = max(0.05, deadline - time.monotonic())
            try:
                connection = http.client.HTTPConnection(
                    "127.0.0.1",
                    self.port,
                    timeout=min(1.0, remaining_seconds),
                )
                headers = {"Host": host_header} if host_header else {}
                connection.request("GET", path, headers=headers)
                response = connection.getresponse()
                response.read()
                if HTTP_SUCCESS_MIN <= response.status <= HTTP_SUCCESS_MAX:
                    connection.close()
                    return
                last_error = f"HTTP {response.status}"
                connection.close()
            except (OSError, http.client.HTTPException) as error:
                last_error = str(error)

            if deadline is None:
                time.sleep(interval_ms / 1000)
            else:
                time.sleep(min(interval_ms / 1000, max(0, deadline - time.monotonic())))

        raise RunnerError(f"health probe {path} timed out: {last_error}")

    def _raise_if_stop_requested(self):
        if self.stop_requested:
            raise InterruptedError()

    def _warmup_requested(self):
        return os.environ.get("SYMPHONY_PREVIEW_WARMUP") == "1" or self.spec.get("warmup") is True

    def stop_and_report(self):
        self._terminate_child()
        self.write_report("stopped")

    def _terminate_child(self):
        if self.child is None or self.child.poll() is not None:
            return

        stop = self.spec.get("stop", {})
        if stop is None:
            stop = {}
        if not isinstance(stop, dict):
            stop = {}

        grace_ms = parse_integer(stop.get("grace_ms", DEFAULT_STOP_GRACE_MS), "stop.grace_ms", 0)
        stop_command = stop.get("command")

        if stop_command is not None:
            normalized_stop = self._normalize_command(stop_command, "stop")
            if not self._command_is_skipped(normalized_stop):
                try:
                    subprocess.run(
                        normalized_stop["argv"],
                        cwd=self.working_directory,
                        check=False,
                        timeout=max(1, grace_ms / 1000),
                    )
                except (OSError, subprocess.TimeoutExpired):
                    pass
        else:
            signal_name = stop.get("signal", DEFAULT_STOP_SIGNAL)
            child_signal = self._signal_number(signal_name)
            self._signal_child_group(child_signal)

        deadline = time.monotonic() + (grace_ms / 1000)
        while self.child.poll() is None and time.monotonic() < deadline:
            time.sleep(0.05)

        if self.child.poll() is None:
            self._signal_child_group(signal.SIGKILL)

        try:
            self.child.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass

    def _signal_number(self, signal_name):
        if not isinstance(signal_name, str) or not signal_name.strip():
            raise RunnerError("stop.signal must be a non-empty string")

        normalized_name = signal_name.strip().upper()
        if normalized_name.startswith("SIG"):
            normalized_name = normalized_name[3:]
        signal_number = getattr(signal, f"SIG{normalized_name}", None)
        if not isinstance(signal_number, signal.Signals):
            raise RunnerError(f"unsupported stop signal {signal_name}")
        return signal_number

    def _signal_child_group(self, signal_number):
        try:
            os.killpg(self.child.pid, signal_number)
        except ProcessLookupError:
            pass

    def force_kill_child(self):
        if self.child is None or self.child.poll() is not None:
            return

        self._signal_child_group(signal.SIGKILL)
        try:
            self.child.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass


def run():
    runner = None
    try:
        runner = PreviewRunner()
        return runner.run()
    except InterruptedError:
        if runner is not None:
            runner.stop_and_report()
        return 0
    except Exception as error:
        message = str(error) or error.__class__.__name__
        if runner is not None:
            try:
                runner._terminate_child()
            except Exception:
                runner.force_kill_child()
            try:
                runner.write_report("error", message)
            except Exception as report_error:
                print(f"preview runner could not write error report: {report_error}", file=sys.stderr)
        print(f"preview runner error: {message}", file=sys.stderr)
        return 1


sys.exit(run())
PYTHON
