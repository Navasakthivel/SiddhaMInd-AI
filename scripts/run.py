"""Start the whole SiddhaMind stack and wait until it is actually usable.

    python scripts/run.py

What this starts
----------------
    siddhamind-ai    FastAPI + bge-m3     127.0.0.1:8000
    siddhamind-core  Spring Boot + API    localhost:8080/siddhamind
    react-app        Vite dev server      localhost:5173   <- the UI you open

Three processes, started in that order. The React client is started last and
only once Java reports healthy, because its whole job is to proxy /api through
to Java: a Vite server that comes up first would spend its first seconds
answering the browser with proxy errors.

:8080 is now an API only. The server-rendered UI it used to serve was removed,
so there is no fallback page there and Chrome always opens :5173.

Postgres is Supabase and is not started here. The redis service in
docker-compose.yml is not wired into either codebase (the only references are
commented-out Celery lines in requirements.txt), so it is not started either.
Docker is not used at all by this script; docker-compose.yml is an optional
path and this is the one that is actually run.

The one non-obvious thing this does for you: Spring Boot does NOT read .env,
only real environment variables. Running mvn without loading .env into the
environment first fails at startup with "JAVA_DB_URL is not set."

Once all three report healthy the UI opens in Chrome - specifically Chrome,
located via the registry rather than the default browser. Set CHROME_CMD to
override, or pass --no-browser.

Options:
    --ai-port N       default 8000
    --core-port N     default 8080
    --web-port N      default 5173
    --timeout N       seconds to wait for readiness, default 180
    --no-reclaim      fail if a port is busy instead of stopping what holds it
    --no-browser      do not open Chrome when ready
    --no-web          start core + ai only, and do not start the React client.
                      There is no longer a UI on :8080 to fall back to, so this
                      leaves the stack with an API and no interface.
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WINDOWS = os.name == "nt"

# Line-buffer stdout. Python block-buffers when it is not writing to a terminal,
# which hides the readiness banner entirely if this is piped or redirected to a
# log - the least useful moment to lose output.
try:
    sys.stdout.reconfigure(line_buffering=True)
except (AttributeError, ValueError):
    pass

CREDENTIALS = [
    ("admin@siddhamind.in", "admin123", "Admin"),
    # Practitioners and students sign in with their login ID, not their email.
    ("DOC-0001", "doctor123", "Practitioner"),
    ("STU-0001", "student123", "Student"),
    ("patient@siddhamind.in", "patient123", "Patient"),
]


def find_chrome() -> str | None:
    """Locate Chrome specifically - not the default browser.

    The registry App Paths entry is checked first because it is what Windows
    itself resolves "chrome.exe" through, so it stays correct when Chrome is
    installed somewhere unusual or updates move it.
    """
    if WINDOWS:
        try:
            import winreg

            for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
                try:
                    key = winreg.OpenKey(
                        hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"
                    )
                    with key:
                        path, _ = winreg.QueryValueEx(key, None)
                        if path and Path(path).exists():
                            return path
                except OSError:
                    continue
        except ImportError:
            pass
        candidates = [
            Path(os.environ.get("PROGRAMFILES", r"C:\Program Files"))
            / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"))
            / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
        ]
    else:
        candidates = [
            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            Path("/usr/bin/google-chrome"),
            Path("/usr/bin/chromium"),
        ]
    for candidate in candidates:
        if candidate and candidate.exists():
            return str(candidate)
    return shutil.which("chrome") or shutil.which("google-chrome")


def open_in_chrome(url: str) -> None:
    """Open the UI in Chrome. Never fatal - the stack is already up."""
    chrome = os.environ.get("CHROME_CMD") or find_chrome()
    if not chrome:
        warn(f"Chrome not found - open {url} yourself (or set CHROME_CMD)")
        return
    try:
        subprocess.Popen(
            [chrome, url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            # Detach so closing this launcher never takes the browser with it.
            creationflags=getattr(subprocess, "DETACHED_PROCESS", 0) if WINDOWS else 0,
            start_new_session=not WINDOWS,
        )
        ok(f"opened {url} in Chrome")
    except OSError as exc:
        warn(f"could not launch Chrome ({exc}) - open {url} yourself")


def ok(msg: str) -> None:
    print(f"  ok   {msg}", flush=True)


def warn(msg: str) -> None:
    print(f"  warn {msg}", flush=True)


def die(msg: str) -> "None":
    print(f"  FAIL {msg}", file=sys.stderr, flush=True)
    raise SystemExit(1)


# --- .env ------------------------------------------------------------------
def load_env() -> None:
    """Load .env into os.environ so the Java child inherits it.

    Uses python-dotenv when it is importable so the launcher and the AI service
    parse the file identically - dotenv unescapes double-quoted values, and a
    hand-rolled parser that did not would disagree with the service about any
    value containing a backslash.
    """
    env_path = ROOT / ".env"
    if not env_path.exists():
        die(".env missing - copy .env.example and fill in the DB URLs")

    try:
        from dotenv import load_dotenv  # type: ignore

        load_dotenv(env_path, override=False)
    except ImportError:
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            os.environ.setdefault(key.strip(), value)

    for required in ("JAVA_DB_URL", "PYTHON_DB_URL"):
        if not os.environ.get(required):
            die(f"{required} is empty in .env")
    ok(".env loaded into the environment")


# --- ports -----------------------------------------------------------------
def pids_on_port(port: int) -> list[int] | None:
    """Pids listening on ``port``; None when the check itself could not run.

    The distinction matters more than it looks. netstat can take seconds under
    load, and returning [] on a timeout makes "I could not tell" identical to
    "nothing is listening" - which is how a healthy service got declared dead
    and torn down mid-verification while a font sweep was hammering the server.
    Callers must treat None as "no information", never as absence.
    """
    pids: set[int] = set()
    if WINDOWS:
        try:
            out = subprocess.run(
                ["netstat", "-ano", "-p", "TCP"],
                capture_output=True, text=True, timeout=20,
            ).stdout
        except Exception:
            return None
        for line in out.splitlines():
            parts = line.split()
            # Proto  Local  Foreign  State  PID
            if len(parts) >= 5 and parts[3] == "LISTENING":
                local = parts[1]
                if local.rsplit(":", 1)[-1] == str(port):
                    try:
                        pids.add(int(parts[4]))
                    except ValueError:
                        pass
    else:
        try:
            out = subprocess.run(
                ["lsof", "-ti", f"tcp:{port}", "-sTCP:LISTEN"],
                capture_output=True, text=True, timeout=20,
            ).stdout
            pids.update(int(p) for p in out.split())
        except Exception:
            return None
    return sorted(pids)


def kill_tree(pid: int) -> None:
    if WINDOWS:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                       capture_output=True, timeout=30)
    else:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass


def stop_port(port: int, attempts: int = 6) -> bool:
    """Kill whatever is listening on ``port``, and verify it actually went.

    Killing once and assuming it worked is not good enough here. The venv's
    python.exe on Windows re-execs the base interpreter, so the process holding
    the port is a *grandchild* of what was launched - killing the pid we started
    leaves the real server running, and the next run then fails to bind with a
    confusing error. This retries until netstat agrees the port is free.
    """
    for _ in range(attempts):
        pids = pids_on_port(port)
        if pids is None:
            time.sleep(1)          # could not check - retry, do not assume free
            continue
        if not pids:
            return True
        for pid in pids:
            kill_tree(pid)
        time.sleep(1)
    return pids_on_port(port) == []


def free_port(port: int, reclaim: bool) -> None:
    """A half-dead run from earlier holds the port and the new one dies silently."""
    pids = pids_on_port(port)
    if not pids:            # [] free, None unknown - either way, nothing to reclaim
        return
    if not reclaim:
        die(f"port {port} is in use (pid {', '.join(map(str, pids))})")
    warn(f"port {port} in use (pid {', '.join(map(str, pids))}) - stopping it")
    if not stop_port(port):
        die(f"could not free port {port}")


# --- health ----------------------------------------------------------------
def is_up(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=4) as resp:
            return '"status":"UP"' in resp.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError, ValueError):
        return False


def is_serving(url: str) -> bool:
    """True once ``url`` answers with a real HTTP response.

    Vite has no health endpoint and never reports {"status":"UP"}, so it is
    checked by asking for the page and seeing whether anything answers.

    Any status counts, including 4xx and 5xx: an HTTP error means the dev
    server is listening and replying, which is the only thing being decided
    here. Only a connection failure means "not up yet".
    """
    try:
        with urllib.request.urlopen(url, timeout=4):
            return True
    except urllib.error.HTTPError:
        return True
    except (urllib.error.URLError, OSError, ValueError):
        return False


def tail(path: Path, n: int) -> str:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return "(no log)"
    return "\n".join(lines[-n:])


# --- main ------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description="Start the SiddhaMind stack.")
    ap.add_argument("--ai-port", type=int, default=int(os.environ.get("AI_PORT", 8000)))
    ap.add_argument("--core-port", type=int, default=int(os.environ.get("CORE_PORT", 8080)))
    ap.add_argument("--web-port", type=int, default=int(os.environ.get("WEB_PORT", 5173)))
    ap.add_argument("--timeout", type=int, default=int(os.environ.get("BOOT_TIMEOUT", 180)))
    ap.add_argument("--no-reclaim", action="store_true")
    ap.add_argument("--no-browser", action="store_true",
                    help="do not open the UI in Chrome once the stack is ready")
    ap.add_argument("--no-web", action="store_true",
                    help="start core + ai only; no UI will be served at all")
    args = ap.parse_args()
    reclaim = not args.no_reclaim

    # Prefer the project virtualenv over whatever interpreter launched this, so
    # `python scripts/run.py` works from an unactivated shell too.
    venv_py = ROOT / ".venv" / ("Scripts/python.exe" if WINDOWS else "bin/python")
    python = str(venv_py) if venv_py.exists() else sys.executable
    if not venv_py.exists():
        warn(f"no .venv found - using {python}")

    mvn = os.environ.get("MVN_CMD") or shutil.which("mvn")
    if not mvn and WINDOWS and Path(r"C:\apache-maven-3.9.16\bin\mvn.cmd").exists():
        mvn = r"C:\apache-maven-3.9.16\bin\mvn.cmd"
    if not mvn:
        die("maven not found - put mvn on PATH or set MVN_CMD")

    # npm is looked up before anything starts so a missing toolchain is reported
    # at second zero rather than after a 40-second Java boot. Its absence is a
    # warning, not a failure: the API and the AI service are still worth having
    # up, and killing the whole stack over a missing frontend toolchain would be
    # a worse outcome than starting two of three services and saying so. Since
    # the server-rendered UI was removed there is no interface in that state -
    # the summary at the end says so explicitly.
    web_dir = ROOT / "react-app"
    npm = None
    if not args.no_web:
        npm = os.environ.get("NPM_CMD") or shutil.which("npm")
        if not npm:
            warn("npm not found - starting without the React client "
                 "(put npm on PATH or set NPM_CMD)")
        elif not (web_dir / "package.json").exists():
            warn(f"no package.json in {web_dir} - starting without the React client")
            npm = None
    start_web = npm is not None

    load_env()

    log_dir = Path(os.environ.get("LOG_DIR", ROOT / ".run-logs"))
    log_dir.mkdir(parents=True, exist_ok=True)

    free_port(args.ai_port, reclaim)
    free_port(args.core_port, reclaim)
    # Reclaimed up front with the other two, even though the dev server is not
    # started until Java is healthy. Finding out that :5173 is taken 40 seconds
    # in - after the slow part - is the wrong moment, and with --no-reclaim it
    # would mean failing at the very end of a successful boot.
    if start_web:
        free_port(args.web_port, reclaim)

    started = time.monotonic()
    ai_log, core_log = log_dir / "ai.log", log_dir / "core.log"
    web_log = log_dir / "web.log"
    procs: list[subprocess.Popen] = []
    web_out = None
    web = None

    ai_out = ai_log.open("w", encoding="utf-8")
    ai = subprocess.Popen(
        [python, "-m", "uvicorn", "app.main:app",
         "--host", "127.0.0.1", "--port", str(args.ai_port)],
        cwd=ROOT / "siddhamind-ai", stdout=ai_out, stderr=subprocess.STDOUT,
    )
    procs.append(ai)
    ok(f"siddhamind-ai starting   (pid {ai.pid}, {ai_log})")

    # mvn is a .cmd on Windows and CreateProcess cannot execute it directly,
    # so it goes through the shell. That forks a JVM underneath, which is why
    # shutdown below kills the whole tree rather than just this pid.
    core_cmd = ([os.environ.get("COMSPEC", "cmd.exe"), "/c", mvn, "spring-boot:run"]
                if WINDOWS else [mvn, "spring-boot:run"])
    core_out = core_log.open("w", encoding="utf-8")
    core = subprocess.Popen(
        core_cmd, cwd=ROOT / "siddhamind-core",
        stdout=core_out, stderr=subprocess.STDOUT,
    )
    procs.append(core)
    ok(f"siddhamind-core starting (pid {core.pid}, {core_log})")

    def shutdown(*_):
        print("\nstopping...", flush=True)
        # `procs` is appended to as services start, so this covers the React
        # client from the moment it is spawned and simply has nothing extra to
        # do before that. Ctrl+C during the Java boot still works.
        for proc in procs:
            if proc.poll() is None:
                kill_tree(proc.pid)
        # The ports are the authority, not the pids we started: mvn forks a JVM,
        # the venv python re-execs, and npm on Windows runs through cmd.exe and
        # forks node - in all three cases the process actually holding the port
        # is not the one launched here.
        ports = [args.ai_port, args.core_port]
        if start_web:
            ports.append(args.web_port)
        stubborn = [p for p in ports if not stop_port(p)]
        for handle in (ai_out, core_out, web_out):
            if handle is None:
                continue
            try:
                handle.close()
            except OSError:
                pass
        if stubborn:
            warn("could not free port(s): " + ", ".join(map(str, stubborn)))
        else:
            print("stopped.", flush=True)

    def launch_web() -> None:
        """Install if needed, then start the Vite dev server.

        Called the moment Java reports healthy - not after the whole stack is -
        because the client only ever talks to Java. Waiting for siddhamind-ai
        as well would hold the UI behind the bge-m3 model load, which is the
        slowest thing in the boot and nothing the frontend depends on.
        """
        nonlocal web, web_out, start_web

        # `npm install` is run only when it would do something. It is not free -
        # several seconds even with everything present - and this script is run
        # dozens of times a day. node_modules missing, or a manifest newer than
        # it, are the two cases where it matters.
        modules = web_dir / "node_modules"
        needs_install = not modules.exists()
        if not needs_install:
            stamp = modules.stat().st_mtime
            for manifest in ("package.json", "package-lock.json"):
                path = web_dir / manifest
                if path.exists() and path.stat().st_mtime > stamp:
                    needs_install = True
                    break

        if needs_install:
            print("  ...  npm install (first run or manifest changed)", flush=True)
            # Blocking on purpose: `npm run dev` against a half-populated
            # node_modules fails in ways that read like application errors.
            install = subprocess.run(
                ([os.environ.get("COMSPEC", "cmd.exe"), "/c", npm, "install"]
                 if WINDOWS else [npm, "install"]),
                cwd=web_dir, capture_output=True, text=True,
            )
            if install.returncode != 0:
                warn("npm install failed - continuing without the React client")
                print(install.stdout[-1500:], file=sys.stderr)
                print(install.stderr[-1500:], file=sys.stderr)
                start_web = False
                return
            ok("npm install complete")

        # npm is a .cmd on Windows and CreateProcess cannot execute it directly,
        # so it goes through the shell - the same reason mvn does above, and the
        # same reason shutdown kills the tree rather than this pid.
        web_cmd = ([os.environ.get("COMSPEC", "cmd.exe"), "/c", npm, "run", "dev",
                    "--", "--port", str(args.web_port), "--strictPort"]
                   if WINDOWS else
                   [npm, "run", "dev", "--", "--port", str(args.web_port), "--strictPort"])
        # --strictPort so Vite fails loudly instead of quietly moving to 5174,
        # which would leave this script polling a port nothing will ever answer.
        #
        # VITE_PROXY_TARGET is passed explicitly so --core-port is honoured end
        # to end, rather than the client proxying to the 8080 baked into
        # vite.config.js while Java listens somewhere else.
        web_env = dict(os.environ)
        web_env["VITE_PROXY_TARGET"] = f"http://localhost:{args.core_port}"

        web_out = web_log.open("w", encoding="utf-8")
        web = subprocess.Popen(
            web_cmd, cwd=web_dir, env=web_env,
            stdout=web_out, stderr=subprocess.STDOUT,
        )
        procs.append(web)
        ok(f"react-app starting      (pid {web.pid}, {web_log})")

    signal.signal(signal.SIGINT, lambda *a: (shutdown(), sys.exit(0)))
    signal.signal(signal.SIGTERM, lambda *a: (shutdown(), sys.exit(0)))

    # Poll the health endpoints rather than the log lines: Tomcat prints
    # "Started" before the datasource has served a query, and the first Supabase
    # connection is the slow part - which is exactly where a demo breaks.
    ai_url = f"http://127.0.0.1:{args.ai_port}/health"
    core_url = f"http://localhost:{args.core_port}/siddhamind/internal/health"
    ai_ready = core_ready = None
    dead = {"ai": 0, "core": 0}

    while ai_ready is None or core_ready is None:
        elapsed = time.monotonic() - started

        if ai_ready is None and is_up(ai_url):
            ai_ready = elapsed
            ok(f"siddhamind-ai UP    ({ai_ready:.0f}s)")
        if core_ready is None and is_up(core_url):
            core_ready = elapsed
            ok(f"siddhamind-core UP  ({core_ready:.0f}s)")
            # Java is answering, so the client has something to proxy to.
            # Started here rather than after this loop so it boots alongside
            # the AI service instead of queueing behind its model load.
            if start_web and web is None:
                launch_web()
        if ai_ready is not None and core_ready is not None:
            break

        # A dead launcher pid is NOT proof of failure: the venv python re-execs
        # the base interpreter and mvn forks a JVM, so in both cases the pid
        # started here exits while the real server keeps running. Nor is an
        # unbound port proof on its own - the shim exits before the grandchild
        # has finished binding, so a single check catches a live service mid
        # startup. Both conditions must hold for several consecutive polls.
        for proc, port, key in ((ai, args.ai_port, "ai"), (core, args.core_port, "core")):
            ready = ai_ready if key == "ai" else core_ready
            listening = pids_on_port(port)
            if ready is None and proc.poll() is not None and listening == []:
                dead[key] += 1
            else:
                dead[key] = 0
        if dead["ai"] >= 5:
            print(tail(ai_log, 20), file=sys.stderr)
            shutdown()
            return die(f"siddhamind-ai exited - see {ai_log}") or 1
        if dead["core"] >= 5:
            print(tail(core_log, 30), file=sys.stderr)
            shutdown()
            return die(f"siddhamind-core exited - see {core_log}") or 1
        if elapsed > args.timeout:
            shutdown()
            return die(f"not ready after {args.timeout}s - check the logs in {log_dir}") or 1

        time.sleep(2)

    # --- react client -------------------------------------------------------
    web_url = f"http://localhost:{args.web_port}/"
    web_ready = None

    if start_web and web is None:
        # Reached only if core came up in the same tick the loop exited on.
        launch_web()

    if start_web and web is not None:
        web_dead = 0
        while web_ready is None:
            elapsed = time.monotonic() - started
            if is_serving(web_url):
                web_ready = elapsed
                ok(f"react-app UP        ({web_ready:.0f}s)")
                break

            # Same two-condition rule as the other services: a dead launcher pid
            # alone proves nothing, because npm on Windows exits while the node
            # it forked keeps serving.
            if web.poll() is not None and pids_on_port(args.web_port) == []:
                web_dead += 1
            else:
                web_dead = 0
            if web_dead >= 5:
                print(tail(web_log, 25), file=sys.stderr)
                # Not fatal. Two of three services are healthy, so the stack is
                # left up rather than torn down over the client. There is no UI
                # in that state; the summary below reports it instead of opening
                # a browser at a port that serves no pages.
                warn(f"react-app exited - see {web_log}")
                start_web = False
                break
            if elapsed > args.timeout:
                warn(f"react-app not ready after {args.timeout}s - see {web_log}")
                start_web = False
                break

            time.sleep(2)

    total = time.monotonic() - started
    api_url = f"http://localhost:{args.core_port}/siddhamind"
    web_up = start_web and web_ready is not None
    # Only ever opened at the React client. :8080 serves JSON and nothing else
    # now, so pointing a browser at it would show a 401, not a fallback UI.
    if not args.no_browser and web_up:
        open_in_chrome(web_url)

    print(f"\nready in {total:.0f}s\n")
    if web_up:
        print(f"  UI        {web_url}          <- React client")
        print(f"  Core API  {api_url}/api")
    else:
        print("  UI        (none - start it with: cd react-app && npm run dev)")
        print(f"  Core API  {api_url}/api")
    print(f"  AI API    http://127.0.0.1:{args.ai_port}/health\n")
    for email, password, role in CREDENTIALS:
        print(f"  {email:<24} {password:<12} {role}")
    running = "all three" if (start_web and web_ready is not None) else "both"
    print(f"\nCtrl+C stops {running}. Logs: {log_dir}")

    # Once both are up this waits and does nothing else.
    #
    # There was a health monitor here that tore the stack down when a port
    # stopped answering. It was wrong three times: netstat is unreliable under
    # load - it timed out during a burst of asset requests, and separately
    # returned successfully without listing a port that was demonstrably
    # serving - and each false reading killed a healthy service mid-session.
    #
    # Distinguishing "could not check" from "not listening" reduced it but did
    # not fix it, so the watcher is gone rather than patched again. It was
    # guarding against a service dying, which is a thing the operator sees
    # immediately anyway; a launcher that occasionally kills a working demo is
    # far worse than one that fails to announce a crash.
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
