"""
A small in-process cache with an expiry, for answers that change rarely and
cost a database round trip (the paint library, Explore's place pills).
One process, so a write here clears it at once; nothing personal goes in
without the viewer in the key.
"""
import threading
import time


class TTLCache:
    def __init__(self, seconds: float, max_items: int = 500):
        self.seconds, self.max_items = seconds, max_items
        self._items: dict = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            hit = self._items.get(key)
            if hit and hit[0] > time.monotonic():
                return hit[1]
            self._items.pop(key, None)
            return None

    def put(self, key, value):
        with self._lock:
            if len(self._items) >= self.max_items:
                self._items.clear()
            self._items[key] = (time.monotonic() + self.seconds, value)
        return value

    def clear(self):
        with self._lock:
            self._items.clear()
