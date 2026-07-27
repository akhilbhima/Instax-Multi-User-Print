"""Admin control room — served by bridge.py on the operator's computer.

One page with everything the operator needs mid-event:
- live printer cards (on/off, film, battery, queue, current job)
- Bluetooth discovery + assigning found printers to the Mini/Wide roles
- the full photo catalogue (archive + failed pile) with print-again buttons
"""

import json
import logging
import os
import time

from flask import Flask, jsonify, render_template, request, send_from_directory

import config
from printer_worker import _ble_lock, BLE_LOCK_TIMEOUT

log = logging.getLogger("instax")

NAMES_FILE = ".printer-names.json"


def load_name_overrides():
    if os.path.exists(NAMES_FILE):
        try:
            with open(NAMES_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_name_overrides(overrides):
    with open(NAMES_FILE, "w") as f:
        json.dump(overrides, f, indent=2)


def create_admin_app(workers):
    app = Flask("instax-admin", template_folder="templates")

    @app.route("/")
    def index():
        return render_template("admin.html")

    @app.route("/api/state")
    def state():
        printers = {}
        for fmt, w in workers.items():
            s = w.status()
            s["device_name"] = w.device_name
            printers[fmt] = s
        photos = []
        for directory, failed in ((config.PHOTOS_DIR, False), (config.FAILED_DIR, True)):
            if os.path.isdir(directory):
                for f in os.listdir(directory):
                    if f.startswith(".") or not f.lower().endswith(
                            (".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif")):
                        continue
                    path = os.path.join(directory, f)
                    photos.append({
                        "name": f,
                        "failed": failed,
                        "mtime": os.path.getmtime(path),
                        "url": f"/failed-photos/{f}" if failed else f"/photos/{f}",
                    })
        photos.sort(key=lambda p: p["mtime"], reverse=True)
        return jsonify(printers=printers, photos=photos)

    @app.route("/photos/<path:name>")
    def photo(name):
        return send_from_directory(os.path.abspath(config.PHOTOS_DIR), name)

    @app.route("/failed-photos/<path:name>")
    def failed_photo(name):
        return send_from_directory(os.path.abspath(config.FAILED_DIR), name)

    @app.route("/api/print", methods=["POST"])
    def print_photo():
        data = request.get_json(force=True)
        name, fmt = data.get("name", ""), data.get("format", "")
        if fmt not in workers or "/" in name or ".." in name:
            return jsonify(ok=False, error="bad request"), 400
        path = os.path.join(config.PHOTOS_DIR, name)
        if not os.path.exists(path):
            failed_path = os.path.join(config.FAILED_DIR, name)
            if not os.path.exists(failed_path):
                return jsonify(ok=False, error="photo not found"), 404
            # give a failed photo another chance: back into the archive
            os.rename(failed_path, path)
        position = workers[fmt].submit(path)
        log.info("admin: %s -> %s queue (position %d)", name, fmt, position)
        return jsonify(ok=True, position=position)

    @app.route("/api/discover", methods=["POST"])
    def discover():
        import simplepyble
        if not _ble_lock.acquire(timeout=min(BLE_LOCK_TIMEOUT, 30)):
            return jsonify(ok=False, error="Bluetooth is busy — try again in a moment"), 503
        try:
            adapters = simplepyble.Adapter.get_adapters()
            if not adapters:
                return jsonify(ok=False, error="no Bluetooth adapter"), 500
            adapter = adapters[0]
            adapter.scan_for(6000)
            found = sorted({
                p.identifier() for p in adapter.scan_get_results()
                if p.identifier().startswith("INSTAX")
            })
            return jsonify(ok=True, printers=found)
        finally:
            _ble_lock.release()

    @app.route("/api/assign", methods=["POST"])
    def assign():
        data = request.get_json(force=True)
        fmt, name = data.get("format", ""), data.get("name", "").strip()
        if fmt not in workers or not name.startswith("INSTAX"):
            return jsonify(ok=False, error="bad request"), 400
        # strip the (IOS)/(BLE)/(ANDROID) suffix; matching is by prefix
        name = name.split("(")[0]
        workers[fmt].device_name = name
        overrides = load_name_overrides()
        overrides[fmt] = name
        save_name_overrides(overrides)
        log.info("admin: assigned %s printer -> %s", fmt, name)
        return jsonify(ok=True)

    return app
