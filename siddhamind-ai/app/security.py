"""Shared-token auth for calls arriving from siddhamind-core."""

import hmac

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)


def require_internal_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> None:
    """Reject any request that does not carry the shared internal token.

    Fails closed when INTERNAL_API_TOKEN is unset, so a misconfigured deployment
    is unreachable rather than open.
    """
    if not settings.internal_api_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="INTERNAL_API_TOKEN is not configured on the AI service.",
        )

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Constant-time compare - a plain == leaks token bytes through timing.
    if not hmac.compare_digest(credentials.credentials, settings.internal_api_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
