"""
============================================================
Auth Middleware  (Python equivalent of middleware/auth.js)
============================================================
Verifies Bearer JWT on every protected route.
Attaches a `principal` dict to the request state:
    { id, username, email, role, adminId }

Works for BOTH admins and users.
Role-specific guards: require_admin(), require_user()
============================================================
"""

import os
import logging
import jwt
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from bson import ObjectId
from database import get_db

logger = logging.getLogger("auth_middleware")

JWT_SECRET = os.getenv("JWT_SECRET", "changeme_in_production")

# FastAPI's built-in Bearer token extractor
bearer_scheme = HTTPBearer(auto_error=False)


def _serialize_id(doc: dict, field: str) -> str:
    """Convert ObjectId field to string — safely."""
    val = doc.get(field)
    return str(val) if val else ""


async def verify_token(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """
    Dependency: validate JWT + load account from DB.
    Mirrors verifyToken() in middleware/auth.js.
    Returns the principal dict and also stores it in request.state.principal.
    """
    # 1. Extract token — header or ?token= query param
    token: str | None = None
    if credentials:
        token = credentials.credentials
    elif request.query_params.get("token"):
        token = request.query_params["token"]

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No token provided.",
        )

    # 2. Verify signature + expiry
    try:
        decoded = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired. Please log in again.",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token.",
        )

    # 3. Load account from DB to confirm it still exists & is active
    db = get_db()
    role = decoded.get("role")

    if role == "admin":
        try:
            oid = ObjectId(decoded["id"])
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token payload.")

        admin = await db["admins"].find_one({"_id": oid}, {"password_hash": 0})
        if not admin or admin.get("status", "active") != "active":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Admin account not found or deactivated.",
            )
        principal = {
            "id": str(admin["_id"]),
            "username": admin.get("username", ""),
            "email": admin.get("email", ""),
            "role": "admin",
            "adminId": str(admin["_id"]),   # for admin: adminId === their own id
        }

    else:
        try:
            oid = ObjectId(decoded["id"])
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token payload.")

        user = await db["users"].find_one({"_id": oid}, {"password_hash": 0})
        if not user or user.get("status", "active") != "active":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User account not found or deactivated.",
            )
        principal = {
            "id": str(user["_id"]),
            "username": user.get("username", ""),
            "email": user.get("email", ""),
            "role": "user",
            "adminId": str(user.get("adminId", "")),  # user's admin scope
        }

    # Store on request state for easy access in route handlers
    request.state.principal = principal
    return principal


# ── Role Guards ───────────────────────────────────────────

async def require_admin(principal: dict = Depends(verify_token)) -> dict:
    """
    Guard: only lets admin principals through.
    Chain after verify_token via FastAPI Depends.
    Mirrors requireAdmin() in middleware/auth.js.
    """
    if principal.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return principal


async def require_user(principal: dict = Depends(verify_token)) -> dict:
    """
    Guard: only lets user principals through.
    Chain after verify_token via FastAPI Depends.
    Mirrors requireUser() in middleware/auth.js.
    """
    if principal.get("role") != "user":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User access required.",
        )
    return principal
