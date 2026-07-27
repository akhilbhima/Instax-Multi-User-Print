"""Print queue workers and the Pillow image pipeline.

One PrinterWorker thread per physical printer. Each job is: prepare the image
to the printer's exact dimensions, connect over BLE, transfer, print,
disconnect. Failures retry with backoff; after the last retry the original
upload is moved to photos/failed/ and the queue keeps moving.
"""

import logging
import os
import queue
import shutil
import threading
import time
from collections import deque
from datetime import datetime
from io import BytesIO

from PIL import Image, ImageOps

import config
from vendor_instaxble.InstaxBLE import InstaxBLE

log = logging.getLogger("instax")

# simplepyble shares one Bluetooth adapter between both workers; scanning from
# two threads at once confuses it, so connects are serialized.
_ble_lock = threading.Lock()


class PrintError(Exception):
    pass


class OutOfFilmError(PrintError):
    pass


# ---------------------------------------------------------------------------
# Image pipeline
# ---------------------------------------------------------------------------

def prepare_image(src_path, fmt):
    """EXIF-rotate, center-crop to the format's aspect ratio, resize to exact
    printer dimensions, and JPEG-encode under config.MAX_IMAGE_KB.

    Returns the encoded JPEG bytes.
    """
    spec = config.FORMATS[fmt]
    target_w, target_h = spec["width"], spec["height"]

    img = Image.open(src_path)
    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        img = img.convert("RGB")

    if config.AUTO_ROTATE_TO_FIT:
        img_landscape = img.width >= img.height
        target_landscape = target_w >= target_h
        if img_landscape != target_landscape:
            img = img.rotate(90, expand=True)

    # Center-crop to the target aspect ratio, then resize to exact dimensions.
    img = ImageOps.fit(img, (target_w, target_h), Image.Resampling.LANCZOS)

    max_bytes = config.MAX_IMAGE_KB * 1024
    for quality in (90, 85, 80, 70, 60, 50, 40, 30):
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        if buf.tell() <= max_bytes:
            log.info("prepared %s as %s %dx%d, quality=%d, %.1f KB",
                     os.path.basename(src_path), fmt, target_w, target_h,
                     quality, buf.tell() / 1024)
            return buf.getvalue()
    # Even quality 30 was too big (essentially impossible at these dimensions,
    # but never send an oversized file to the printer).
    raise PrintError(f"could not encode {src_path} under {config.MAX_IMAGE_KB} KB")


# ---------------------------------------------------------------------------
# Printer worker
# ---------------------------------------------------------------------------

class PrinterWorker(threading.Thread):
    """Background thread that drains a queue of jobs for one printer."""

    def __init__(self, fmt):
        super().__init__(daemon=True, name=f"printer-{fmt}")
        self.fmt = fmt
        spec = config.FORMATS[fmt]
        self.device_name = getattr(config, spec["printer_name_key"])
        self.jobs = queue.Queue()
        self.lock = threading.Lock()
        self.printed = deque(maxlen=5)   # last 5 printed filenames
        self.history = deque(maxlen=20)  # {"file", "at" (HH:MM), "ts"} per print
        self.printed_count = 0
        self.failed_count = 0
        self.current = None              # filename being printed right now
        self.last_error = None
        self.film_left = None            # prints remaining (None = not yet known)
        self.battery = None              # battery %, None = not yet known
        self.out_of_film = False         # True = queue paused, waiting for refill
        self._last_low_warn = None       # last film count we warned about
        self._last_film_check = 0.0      # monotonic-ish time of last real BLE read

    # -- public API ---------------------------------------------------------

    def submit(self, src_path):
        """Queue a photo for printing. Returns the queue position (1-based)."""
        self.jobs.put(src_path)
        return self.jobs.qsize()

    def status(self):
        with self.lock:
            return {
                "format": self.fmt,
                "queued": self.jobs.qsize(),
                # queued + the job the worker is holding right now
                "waiting": self.jobs.qsize() + (1 if self.current else 0),
                "current": self.current,
                "printed_count": self.printed_count,
                "failed_count": self.failed_count,
                "last_printed": list(self.printed),
                "history": list(self.history),
                "last_error": self.last_error,
                "film_left": self.film_left,
                "battery": self.battery,
                "out_of_film": self.out_of_film,
            }

    # -- worker loop --------------------------------------------------------

    def run(self):
        log.info("[%s] worker started for printer %r", self.fmt, self.device_name)
        if "XXXXXXXX" not in self.device_name:
            # Best-effort startup check so the upload page shows film counts
            # before the first print. Failure here is fine — the printer may
            # simply be asleep; every print job re-checks anyway.
            self._query_film(startup=True)
        while True:
            try:
                src_path = self.jobs.get(timeout=5)
            except queue.Empty:
                # Idle: periodically re-read the REAL film count from the
                # printer so the displayed number can't drift from reality.
                if time.time() - self._last_film_check > config.FILM_IDLE_RECHECK_SECONDS:
                    self._query_film()
                continue
            name = os.path.basename(src_path)
            with self.lock:
                self.current = name
            try:
                jpeg_bytes = prepare_image(src_path, self.fmt)
                # Out-of-film pauses the queue instead of failing the job: hold
                # this job, wait for a refill, then print it. Only real errors
                # (BLE, encoding) fall through to the failed/ path.
                while True:
                    try:
                        self._print_with_retries(jpeg_bytes)
                        break
                    except OutOfFilmError:
                        self._wait_for_film()
                with self.lock:
                    self.printed_count += 1
                    self.printed.append(name)
                    self.history.append({
                        "file": name,
                        "at": datetime.now().strftime("%H:%M"),
                        "ts": time.time(),
                    })
                    self.last_error = None
                self._warn_if_low()
                log.info("[%s] PRINTED %s", self.fmt, name)
            except Exception as e:
                with self.lock:
                    self.failed_count += 1
                    self.last_error = f"{name}: {e}"
                self._move_to_failed(src_path)
                log.error("[%s] GAVE UP on %s: %s — moved to failed/", self.fmt, name, e)
            finally:
                with self.lock:
                    self.current = None
                self.jobs.task_done()

    def _print_with_retries(self, jpeg_bytes):
        last_exc = None
        for attempt in range(config.RETRIES + 1):
            if attempt > 0:
                wait = config.RETRY_BACKOFF_SECONDS[
                    min(attempt - 1, len(config.RETRY_BACKOFF_SECONDS) - 1)]
                log.warning("[%s] attempt %d failed (%s); retrying in %ds",
                            self.fmt, attempt, last_exc, wait)
                time.sleep(wait)
            try:
                self._print_once(jpeg_bytes)
                return
            except OutOfFilmError:
                raise   # not a transient error — handled by the pause loop
            except Exception as e:
                last_exc = e
        raise PrintError(f"all {config.RETRIES + 1} attempts failed: {last_exc}")

    # -- film monitoring -----------------------------------------------------

    @staticmethod
    def _wait_for_printer_info(instax, extra_seconds=3):
        """connect() only waits 1s for the printer's info replies; give the
        film/battery packets a little longer so we never act on a
        not-yet-populated (0) film count."""
        deadline = time.time() + extra_seconds
        while instax.printerSettings is None and time.time() < deadline:
            time.sleep(0.2)

    def _update_film(self, film, battery):
        with self.lock:
            self.film_left = film
            self.battery = battery
        self._last_film_check = time.time()

    def _warn_if_low(self):
        with self.lock:
            film = self.film_left
        if film is None or film == 0 or film > config.LOW_FILM_THRESHOLD:
            return
        if self._last_low_warn != film:
            self._last_low_warn = film
            log.warning("[%s] ⚠️  LOW FILM: only %d print%s left — grab a refill pack!",
                        self.fmt, film, "" if film == 1 else "s")

    def _query_film(self, startup=False):
        """Status-only BLE check: connect, read film/battery, disconnect.
        Returns prints remaining, or None if the printer was unreachable."""
        # Stamp up front so an unreachable printer isn't re-scanned in a
        # tight loop by the idle checker.
        self._last_film_check = time.time()
        instax = None
        try:
            with _ble_lock:
                try:
                    instax = InstaxBLE(device_name=self.device_name, verbose=False)
                except SystemExit:
                    return None
                instax.connect(timeout=config.STATUS_CONNECT_TIMEOUT_SECONDS)
            if instax.peripheral and instax.peripheral.is_connected():
                self._wait_for_printer_info(instax)
            if (not instax.peripheral or not instax.peripheral.is_connected()
                    or instax.printerSettings is None):
                if startup:
                    log.info("[%s] startup film check: printer not reachable "
                             "(asleep/off?) — will check at first print", self.fmt)
                return None
            self._update_film(instax.photosLeft, instax.batteryPercentage)
            log.info("[%s] film check: %d prints left, battery %d%%",
                     self.fmt, instax.photosLeft, instax.batteryPercentage)
            self._warn_if_low()
            return instax.photosLeft
        except Exception as e:
            log.info("[%s] film check failed: %s", self.fmt, e)
            return None
        finally:
            if instax is not None:
                try:
                    instax.disconnect()
                except Exception:
                    pass

    def _wait_for_film(self):
        """Queue is paused: poll the printer until new film is detected."""
        with self.lock:
            self.out_of_film = True
            waiting = self.jobs.qsize() + 1
        log.warning("=" * 60)
        log.warning("[%s] 🟥 OUT OF FILM — queue PAUSED (%d photo%s waiting).",
                    self.fmt, waiting, "" if waiting == 1 else "s")
        log.warning("[%s] Reload film; printing auto-resumes (re-check every %ds).",
                    self.fmt, config.FILM_RECHECK_SECONDS)
        log.warning("=" * 60)
        while True:
            time.sleep(config.FILM_RECHECK_SECONDS)
            film = self._query_film()
            if film is None:
                log.info("[%s] film re-check: printer unreachable (door open / "
                         "powered off?) — still waiting", self.fmt)
            elif film > 0:
                with self.lock:
                    self.out_of_film = False
                log.warning("[%s] 🟩 FILM RELOADED — %d prints available, "
                            "resuming queue.", self.fmt, film)
                return
            else:
                log.info("[%s] film re-check: still out of film", self.fmt)

    def _print_once(self, jpeg_bytes):
        """One full connect → transfer → print → disconnect cycle."""
        instax = None
        try:
            with _ble_lock:
                # Constructor may sys.exit() if Bluetooth is off — surface that
                # as a normal error instead of killing the thread.
                try:
                    instax = InstaxBLE(device_name=self.device_name, verbose=False)
                except SystemExit as e:
                    raise PrintError(f"Bluetooth unavailable: {e}")
                if config.PRINT_ENABLED:
                    instax.enable_printing()
                log.info("[%s] connecting to %s ...", self.fmt, self.device_name)
                instax.connect(timeout=config.CONNECT_TIMEOUT_SECONDS)

            if not instax.peripheral or not instax.peripheral.is_connected():
                raise PrintError(f"printer {self.device_name} not found/connected "
                                 f"within {config.CONNECT_TIMEOUT_SECONDS}s (is it on?)")
            self._wait_for_printer_info(instax)
            if instax.printerSettings is None:
                # Printer never answered the info request; connection is bad.
                raise PrintError("connected but printer did not report its status")
            self._update_film(instax.photosLeft, instax.batteryPercentage)
            log.info("[%s] connected — battery %d%%, %d prints left",
                     self.fmt, instax.batteryPercentage, instax.photosLeft)
            if instax.photosLeft == 0:
                raise OutOfFilmError("printer reports 0 photos left — reload film")
            self._warn_if_low()

            # Pass raw bytes: print_image() re-encodes paths/BytesIO through its
            # own pipeline, but a bytearray is sent as-is — ours is already at
            # exact printer dimensions and under the size cap.
            # print_image() queues packets and returns immediately; the BLE
            # notification handler drains the queue. Wait for it, watching for
            # stalls (BLE drop mid-transfer leaves the queue stuck).
            instax.print_image(bytearray(jpeg_bytes))

            # InstaxBLE queues a trailing status query after the PRINT_IMAGE
            # command, but its handler only advances the queue on transfer
            # events — the print confirmation never triggers the send. Left in
            # place, the queue sticks at 1 forever, the stall detector calls a
            # SUCCESSFUL print a failure, and the retry prints a duplicate.
            # Drop it; queue-empty then means exactly "print command sent once".
            if config.PRINT_ENABLED and instax.packetsForPrinting:
                last = instax.packetsForPrinting[-1]
                if bytes(last[4:6]) == b"\x00\x02":  # SUPPORT_FUNCTION_INFO opcode
                    instax.packetsForPrinting.pop()
            deadline = time.time() + config.TRANSFER_TIMEOUT_SECONDS
            last_len = len(instax.packetsForPrinting)
            last_progress = time.time()
            while instax.packetsForPrinting:
                if time.time() > deadline:
                    raise PrintError("image transfer timed out")
                cur_len = len(instax.packetsForPrinting)
                if cur_len != last_len:
                    last_len, last_progress = cur_len, time.time()
                elif time.time() - last_progress > config.TRANSFER_STALL_SECONDS:
                    raise PrintError(
                        f"transfer stalled ({cur_len} packets unsent) — BLE drop?")
                if not instax.peripheral.is_connected():
                    raise PrintError("BLE connection dropped during transfer")
                time.sleep(0.5)

            log.info("[%s] transfer complete, waiting %ds for the print to eject",
                     self.fmt, config.POST_PRINT_WAIT_SECONDS)
            time.sleep(config.POST_PRINT_WAIT_SECONDS)

            # Still connected: ask the printer for its REAL remaining-film
            # count instead of guessing with a local decrement. If this fails
            # the idle re-check corrects the display within a minute anyway.
            try:
                instax.get_printer_status()
                time.sleep(1.5)
                self._update_film(instax.photosLeft, instax.batteryPercentage)
                log.info("[%s] post-print film check: %d prints left",
                         self.fmt, instax.photosLeft)
            except Exception as e:
                log.warning("[%s] post-print film check failed: %s", self.fmt, e)
        finally:
            if instax is not None:
                try:
                    instax.disconnect()
                except Exception as e:
                    log.warning("[%s] error during disconnect: %s", self.fmt, e)

    def _move_to_failed(self, src_path):
        try:
            os.makedirs(config.FAILED_DIR, exist_ok=True)
            shutil.move(src_path, os.path.join(config.FAILED_DIR,
                                               os.path.basename(src_path)))
        except Exception as e:
            log.error("could not move %s to failed/: %s", src_path, e)
