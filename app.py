"""instax-party-printer — guests upload photos, they auto-print on Instax printers.

Run:  python app.py
Then scan the QR code (or open the printed URL) from any phone on the same
hotspot network.
"""

import logging
import os
import socket
import sys
from datetime import datetime
from threading import Lock

import qrcode
from flask import Flask, jsonify, render_template, request

import config
from printer_worker import PrinterWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("instax")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = config.MAX_UPLOAD_MB * 1024 * 1024

workers = {fmt: PrinterWorker(fmt) for fmt in config.FORMATS}

# Two simultaneous uploads in the same second must not collide on filename.
_name_lock = Lock()
_name_counter = 0

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"}


def _archive_filename(original_name, fmt):
    """Timestamped, collision-proof filename for the photos/ archive."""
    global _name_counter
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        ext = ".jpg"
    with _name_lock:
        _name_counter += 1
        n = _name_counter
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{n:03d}-{fmt}{ext}"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():
    photo = request.files.get("photo")
    fmt = request.form.get("format", "")
    if not photo or photo.filename == "":
        return jsonify(ok=False, error="No photo received — try again."), 400
    if fmt not in config.FORMATS:
        return jsonify(ok=False, error="Pick Mini or Wide."), 400

    filename = _archive_filename(photo.filename, fmt)
    path = os.path.join(config.PHOTOS_DIR, filename)
    photo.save(path)
    worker = workers[fmt]
    position = worker.submit(path)
    out_of_film = worker.status()["out_of_film"]
    message = ("Added to queue — this printer is being refilled, "
               "your photo will print shortly.") if out_of_film else None
    log.info("upload: %s -> %s queue (position %d)%s", filename, fmt, position,
             " [printer out of film]" if out_of_film else "")
    return jsonify(ok=True, filename=filename, format=fmt, position=position,
                   out_of_film=out_of_film, message=message)


@app.route("/status")
def status():
    statuses = [workers[fmt].status() for fmt in config.FORMATS]
    if request.args.get("json"):
        return jsonify(statuses)
    return render_template("status.html", statuses=statuses)


def get_local_ip():
    """LAN IP of this Mac on the hotspot network. The UDP 'connect' never sends
    a packet, so this works with no internet — it just needs a default route."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def show_qr(url):
    qr = qrcode.QRCode(border=2)
    qr.add_data(url)
    qr.make(fit=True)
    qr.make_image().save("qr.png")
    qr.print_ascii(invert=True)
    print(f"\n  Guests scan the QR above, or open:  {url}")
    print("  (QR also saved to qr.png — AirDrop it around or leave it on screen)\n")


def main():
    os.makedirs(config.PHOTOS_DIR, exist_ok=True)
    os.makedirs(config.FAILED_DIR, exist_ok=True)

    unconfigured = [
        fmt for fmt, spec in config.FORMATS.items()
        if "XXXXXXXX" in getattr(config, spec["printer_name_key"])
    ]
    if unconfigured:
        print(f"\n⚠️  Printer names not set for: {', '.join(unconfigured)}.")
        print("   Run `python discover.py` and paste the names into config.py.")
        print("   Uploads will queue but printing will fail until this is fixed.\n")

    ip = get_local_ip()
    if ip is None:
        print("\n⚠️  Could not detect the Mac's local IP — is it on the hotspot Wi-Fi?")
        ip = "127.0.0.1"
    url = f"http://{ip}:{config.PORT}"

    print("\n" + "=" * 60)
    print("  INSTAX PARTY PRINTER")
    print("=" * 60)
    show_qr(url)
    print(f"  Status page: {url}/status")
    print(f"  Archive:     ./{config.PHOTOS_DIR}/   (never deleted)")
    if not config.PRINT_ENABLED:
        print("  ⚠️  PRINT_ENABLED = False — dry-run mode, nothing will print!")
    print("=" * 60 + "\n")

    for worker in workers.values():
        worker.start()

    # threaded=True so uploads keep flowing while another request is in flight;
    # the reloader would start the BLE workers twice, so it stays off.
    app.run(host=config.HOST, port=config.PORT, threaded=True, use_reloader=False)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nShutting down. Photos are safe in ./photos/")
        sys.exit(0)
