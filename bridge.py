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


def job_loop(secret, workers, seen):
    import json
    while True:
        try:
            resp = api(secret, "/api/agent/jobs")
            for job in resp.get("jobs", []):
                pathname = job["pathname"]           # queue/<fmt>/<stamp>-<rand>.jpg
                if pathname in seen:
                    continue
                parts = pathname.split("/")
                fmt = parts[1] if len(parts) > 2 else None
                if fmt not in workers:
                    log.warning("skipping job with unknown format: %s", pathname)
                    continue
                photo = api(secret, job["url"], raw=True)
                stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                filename = f"{stamp}-{os.path.basename(pathname)}"
                local_path = os.path.join(config.PHOTOS_DIR, filename)
                with open(local_path, "wb") as f:
                    f.write(photo)
                seen.add(pathname)
                position = workers[fmt].submit(local_path)
                log.info("cloud job %s -> %s queue (position %d)",
                         pathname, fmt, position)
                api(secret, "/api/agent/complete",
                    data=json.dumps({"url": job["url"]}).encode())
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
    for w in workers.values():
        w.start()

    print("\n" + "=" * 60)
    print("  NM PHOTOPRINTS — CLOUD BRIDGE")
    print("=" * 60)
    print(f"  Guest page:  {config.CLOUD_URL}")
    print(f"  Pulling jobs every {JOB_POLL_SECONDS}s, pushing status every "
          f"{STATUS_PUSH_SECONDS}s")
    print(f"  Archive:     ./{config.PHOTOS_DIR}/   (never deleted)")
    if not config.PRINT_ENABLED:
        print("  ⚠️  PRINT_ENABLED = False — dry-run mode, nothing will print!")
    print("=" * 60 + "\n")

    seen = set()   # pathnames already downloaded (survives a failed delete)
    threading.Thread(target=status_loop, args=(secret, workers),
                     daemon=True, name="status-push").start()
    job_loop(secret, workers, seen)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nShutting down. Photos are safe in ./photos/")
        sys.exit(0)
