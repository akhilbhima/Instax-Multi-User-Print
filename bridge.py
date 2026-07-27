"""Cloud bridge: connects the Vercel upload site to the local Instax printers.

Run this on the Mac (with the printers nearby) instead of app.py when guests
upload via the cloud page:  python bridge.py

- Polls the cloud for queued uploads, downloads each into ./photos/ (the
  permanent archive), hands it to the right PrinterWorker, then deletes it
  from the cloud queue.
- Pushes printer status (film left, battery, out-of-film pause, queues) to
  the cloud every ~15 s so the guest page shows it live.

The agent secret lives in .agent-secret (git-ignored) and must match the
AGENT_SECRET env var on the Vercel project.
"""

import logging
import os
import sys
import threading
import time
from datetime import datetime
from urllib.request import Request, urlopen

import config
from printer_worker import PrinterWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("instax")

# Mirror everything into bridge.log so the Control Room can show it.
_file_handler = logging.FileHandler("bridge.log")
_file_handler.setFormatter(logging.Formatter(
    "%(asctime)s %(levelname)-7s %(message)s", datefmt="%H:%M:%S"))
logging.getLogger().addHandler(_file_handler)

JOB_POLL_SECONDS = 4
STATUS_PUSH_SECONDS = 15
SECRET_FILE = ".agent-secret"


def load_secret():
    if os.environ.get("AGENT_SECRET"):
        return os.environ["AGENT_SECRET"].strip()
    if os.path.exists(SECRET_FILE):
        with open(SECRET_FILE) as f:
            return f.read().strip()
    sys.exit(f"No agent secret: put it in {SECRET_FILE} or set AGENT_SECRET. "
             "It must match the Vercel project's AGENT_SECRET env var.")


def api(secret, path, data=None, raw=False):
    """Small JSON/bytes HTTP helper against the cloud app."""
    url = path if path.startswith("http") else config.CLOUD_URL.rstrip("/") + path
    req = Request(url, data=data, headers={"x-agent-secret": secret})
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urlopen(req, timeout=30) as res:
        body = res.read()
    if raw:
        return body
    import json
    return json.loads(body)


PRINTED_LOG = ".printed-log"   # cloud basenames confirmed printed; survives restarts


def cloud_base(local_name):
    """Local archive names are YYYYmmdd-HHMMSS-<cloud basename>."""
    parts = local_name.split("-", 2)
    return parts[2] if len(parts) == 3 else None


def load_printed_log():
    if os.path.exists(PRINTED_LOG):
        with open(PRINTED_LOG) as f:
            return {line.strip() for line in f if line.strip()}
    return set()


def mark_printed(base):
    with open(PRINTED_LOG, "a") as f:
        f.write(base + "\n")


def find_in_dir(directory, base):
    if os.path.isdir(directory):
        for f in os.listdir(directory):
            if f.endswith(base):
                return os.path.join(directory, f)
    return None


def complete_job(secret, pathname):
    import json
    api(secret, "/api/agent/complete", data=json.dumps({"pathname": pathname}).encode())


def job_loop(secret, workers, printed):
    """Jobs stay in the cloud queue (so the guest page can show them) until
    they are printed or permanently failed; only then are they deleted.
    The printed-log guarantees a job is never printed twice, even across
    bridge restarts."""
    submitted = set()   # basenames handed to a worker by THIS process
    pending = {}        # basename -> {url, fmt, misses}, awaiting print confirmation
    while True:
        try:
            # 1) Clear finished work from the cloud queue.
            for w in workers.values():
                for h in w.status()["history"]:
                    base = cloud_base(h["file"])
                    if base and base in pending:
                        try:
                            complete_job(secret, pending[base]["pathname"])
                            mark_printed(base)
                            printed.add(base)
                            del pending[base]
                            log.info("printed %s — removed from cloud queue", base)
                        except Exception as e:
                            log.warning("cloud delete of %s failed (%s) — will retry",
                                        base, e)
            for base in list(pending):
                if find_in_dir(config.FAILED_DIR, base):
                    try:
                        complete_job(secret, pending[base]["pathname"])
                        del pending[base]
                        log.info("failed %s — removed from cloud queue", base)
                    except Exception as e:
                        log.warning("cloud delete of %s failed (%s) — will retry",
                                    base, e)

            # 2) Pull new jobs.
            resp = api(secret, "/api/agent/jobs")

            # A pending job whose blob vanished (and that we didn't print or
            # fail) was cancelled from the Queue tab. Require two consecutive
            # misses so a briefly-inconsistent listing can't cancel anything.
            cloud_bases = {os.path.basename(j["pathname"]) for j in resp.get("jobs", [])}
            for base, info in list(pending.items()):
                if base in cloud_bases:
                    info["misses"] = 0
                    continue
                info["misses"] += 1
                if info["misses"] >= 2:
                    workers[info["fmt"]].cancel_file(base)
                    del pending[base]
                    log.info("guest cancelled %s — worker will skip it", base)

            for job in resp.get("jobs", []):
                pathname = job["pathname"]           # queue/<fmt>/<stamp>-<rand>.jpg
                base = os.path.basename(pathname)
                parts = pathname.split("/")
                fmt = parts[1] if len(parts) > 2 else None
                if fmt not in workers:
                    log.warning("skipping job with unknown format: %s", pathname)
                    continue
                if base in printed:
                    # Printed before a crash/restart; just clean up the blob.
                    try:
                        complete_job(secret, job["pathname"])
                    except Exception:
                        pass
                    continue
                if base in submitted:
                    pending.setdefault(base, {"pathname": job["pathname"], "fmt": fmt, "misses": 0})
                    continue
                if find_in_dir(config.FAILED_DIR, base):
                    # Exhausted its retries in an earlier run — don't auto-retry;
                    # the operator can re-upload it deliberately.
                    try:
                        complete_job(secret, job["pathname"])
                        log.info("cleared previously-failed %s from cloud queue", base)
                    except Exception:
                        pass
                    continue
                local_path = find_in_dir(config.PHOTOS_DIR, base)
                if local_path is None:
                    photo = api(secret, job["url"], raw=True)
                    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                    local_path = os.path.join(config.PHOTOS_DIR, f"{stamp}-{base}")
                    with open(local_path, "wb") as f:
                        f.write(photo)
                else:
                    # Downloaded by a previous run but never printed (it's not
                    # in the printed-log) — re-queue the local copy.
                    log.info("re-queueing %s from a previous run", base)
                submitted.add(base)
                pending[base] = {"pathname": job["pathname"], "fmt": fmt, "misses": 0}
                position = workers[fmt].submit(local_path)
                log.info("cloud job %s -> %s queue (position %d)",
                         pathname, fmt, position)
        except Exception as e:
            log.warning("job poll failed (%s) — cloud unreachable? retrying", e)
        time.sleep(JOB_POLL_SECONDS)


def status_loop(secret, workers):
    import json
    while True:
        try:
            payload = {fmt: w.status() for fmt, w in workers.items()}
            api(secret, "/api/agent/status", data=json.dumps(payload).encode())
        except Exception as e:
            log.warning("status push failed (%s)", e)
        time.sleep(STATUS_PUSH_SECONDS)


def main():
    os.makedirs(config.PHOTOS_DIR, exist_ok=True)
    os.makedirs(config.FAILED_DIR, exist_ok=True)
    secret = load_secret()

    unconfigured = [
        fmt for fmt, spec in config.FORMATS.items()
        if "XXXXXXXX" in getattr(config, spec["printer_name_key"])
    ]
    if unconfigured:
        print(f"\n⚠️  Printer names not set for: {', '.join(unconfigured)} — "
              "run `python discover.py` and update config.py.\n")

    workers = {fmt: PrinterWorker(fmt) for fmt in config.FORMATS}
    from admin import create_admin_app, load_name_overrides
    for fmt, name in load_name_overrides().items():
        if fmt in workers:
            workers[fmt].device_name = name
    for w in workers.values():
        w.start()

    admin_app = create_admin_app(workers)
    threading.Thread(
        target=lambda: admin_app.run(host=config.ADMIN_HOST, port=config.ADMIN_PORT,
                                     threaded=True, use_reloader=False),
        daemon=True, name="admin").start()

    print("\n" + "=" * 60)
    print("  INSTAX MULTI USER PRINT — BRIDGE")
    print("=" * 60)
    print(f"  Guest page:   {config.CLOUD_URL}")
    print(f"  Control room: http://{config.ADMIN_HOST}:{config.ADMIN_PORT}")
    print(f"  Pulling jobs every {JOB_POLL_SECONDS}s, pushing status every "
          f"{STATUS_PUSH_SECONDS}s")
    print(f"  Archive:     ./{config.PHOTOS_DIR}/   (never deleted)")
    if not config.PRINT_ENABLED:
        print("  ⚠️  PRINT_ENABLED = False — dry-run mode, nothing will print!")
    print("=" * 60 + "\n")

    printed = load_printed_log()   # never double-print, even across restarts
    threading.Thread(target=status_loop, args=(secret, workers),
                     daemon=True, name="status-push").start()
    job_loop(secret, workers, printed)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nShutting down. Photos are safe in ./photos/")
        sys.exit(0)
