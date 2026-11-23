"""Limite de requêtes par adresse IP, en mémoire.

Chaque processus (worker uvicorn) garde ses propres compteurs : avec N workers, une adresse peut faire
jusqu'à N fois la limite. Ça suffit à empêcher un client de saturer MediaPipe ; pour plusieurs serveurs,
mettre la limite dans le proxy ou dans un stockage partagé.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable


class RateLimited(Exception):
    """Trop de requêtes depuis la même adresse : réponse 429."""


class RateLimiter:
    def __init__(self, per_minute: int, clock: Callable[[], float] = time.monotonic):
        self.per_minute = per_minute
        self._clock = clock
        self._windows: dict[str, tuple[float, int]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        """Compte une requête de `key` ; False au-delà de `per_minute` dans la minute. 0 : pas de limite."""
        if self.per_minute <= 0:
            return True
        now = self._clock()
        with self._lock:
            start, count = self._windows.get(key, (now, 0))
            if now - start >= 60:
                start, count = now, 0
            self._windows[key] = (start, count + 1)
            if len(self._windows) > 10_000:
                self._windows = {k: w for k, w in self._windows.items() if now - w[0] < 60}
            return count + 1 <= self.per_minute

    def reset(self) -> None:
        with self._lock:
            self._windows.clear()
