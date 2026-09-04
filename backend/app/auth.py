"""
Stateless Supabase JWT verification (design doc, Section 3, "Auth").

Login itself bypasses this server entirely — the frontend talks to
Supabase's auth API directly. Every later request carries the resulting
JWT in `Authorization: Bearer <token>`, and this module checks its
signature against Supabase's public JWKS. No DB lookup needed for the
check.

This project is on Supabase's asymmetric JWT Signing Keys (Project
Settings -> API -> JWT Settings), not the older "Legacy JWT Secret
(HS256)" — so verification here fetches the current public signing
key(s) from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` and picks the
one matching the token's `kid` header, rather than checking against a
single shared secret. The JWKS response is cached in-process; if a
token's `kid` isn't found (e.g. Supabase just rotated keys), the cache
is refreshed once before giving up.
"""
import time

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from jose.exceptions import JWTError

from config import SUPABASE_URL, SUPABASE_JWT_AUDIENCE

bearer_scheme = HTTPBearer(auto_error=False)

_JWKS_TTL_SECONDS = 3600
_jwks_cache: dict = {"keys": [], "fetched_at": 0.0}


def _fetch_jwks() -> list:
    resp = httpx.get(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json", timeout=5)
    resp.raise_for_status()
    return resp.json().get("keys", [])


def _get_jwks(force_refresh: bool = False) -> list:
    now = time.time()
    stale = (now - _jwks_cache["fetched_at"]) > _JWKS_TTL_SECONDS
    if force_refresh or not _jwks_cache["keys"] or stale:
        _jwks_cache["keys"] = _fetch_jwks()
        _jwks_cache["fetched_at"] = now
    return _jwks_cache["keys"]


def _find_key(kid: str) -> dict | None:
    for key in _get_jwks():
        if key.get("kid") == kid:
            return key
    # kid missing — keys may have rotated since our cache was filled.
    for key in _get_jwks(force_refresh=True):
        if key.get("kid") == kid:
            return key
    return None


async def get_current_sketcher_id(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    """FastAPI dependency: returns the verified sketcher's UUID (auth.uid())."""
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    if not SUPABASE_URL:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "SUPABASE_URL is not set — see backend/.env.example",
        )

    token = credentials.credentials
    try:
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        key = _find_key(kid) if kid else None
        if key is None:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "Invalid token: no matching signing key (kid) found in Supabase's JWKS",
            )

        payload = jwt.decode(
            token,
            key,
            algorithms=[key.get("alg", "ES256")],
            audience=SUPABASE_JWT_AUDIENCE,
        )
        return payload["sub"]  # auth.uid()
    except JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {exc}")
