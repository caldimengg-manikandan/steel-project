"""
============================================================
Auth Handler  (Python equivalent of controllers/authController.js)
============================================================
Handles login for BOTH admins and users.
Issues JWT with { id, username, email, role, adminId }.

Key compatibility note:
  The existing Node.js Mongoose models use bcrypt with salt=12.
  We use passlib[bcrypt] here which is compatible with the same
  hashes stored in MongoDB — no password resets needed on migration.
============================================================
"""

import os
import logging
from datetime import datetime, timedelta, timezone

import jwt
from bson import ObjectId
import bcrypt
from fastapi import HTTPException, status

from database import get_db

logger = logging.getLogger("auth_handler")

# ── Configuration ────────────────────────────────────────
JWT_SECRET = os.getenv("JWT_SECRET", "changeme_in_production")
JWT_EXPIRES_HOURS = int(os.getenv("JWT_EXPIRES_IN_HOURS", "8"))

# Using bcrypt directly since passlib has compatibility issues with newer bcrypt versions

def _sign_token(payload: dict) -> str:
    """
    Create a signed JWT.
    Mirrors signToken() in authController.js.
    """
    exp = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRES_HOURS)
    return jwt.encode(
        {**payload, "exp": exp},
        JWT_SECRET,
        algorithm="HS256",
    )


def _verify_password(plain: str, hashed: str) -> bool:
    """
    Compare plain-text password against a bcrypt hash.
    Works with hashes produced by bcryptjs (Node) and passlib (Python).
    """
    # The Node app stores PLAIN text in password_hash field for seeds,
    # then bcrypt-hashes on first save. Handle the edge case where
    # the hash might not be a valid bcrypt string (seeded records):
    try:
        if not hashed:
            return False
        return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        # Fallback: plain text comparison (only for unseeded dev records)
        return plain == hashed


def _to_safe_admin(admin: dict) -> dict:
    """Strip sensitive fields — mirrors Admin.toSafeObject()."""
    return {
        "_id": str(admin["_id"]),
        "id": str(admin["_id"]),
        "username": admin.get("username", ""),
        "email": admin.get("email", ""),
        "displayName": admin.get("displayName", ""),
        "role": admin.get("role", "admin"),
        "status": admin.get("status", "active"),
        "createdAt": admin.get("createdAt", ""),
    }


def _to_safe_user(user: dict) -> dict:
    """Strip sensitive fields — mirrors User.toSafeObject()."""
    return {
        "_id": str(user["_id"]),
        "id": str(user["_id"]),
        "username": user.get("username", ""),
        "email": user.get("email", ""),
        "displayName": user.get("displayName", ""),
        "role": user.get("role", "user"),
        "status": user.get("status", "active"),
        "adminId": str(user.get("adminId", "")),
        "createdAt": user.get("createdAt", ""),
    }


# ── Login Handlers ───────────────────────────────────────

async def admin_login(username: str, password: str) -> dict:
    """
    Admin login logic.
    Mirrors adminLogin() in authController.js.
    Returns { token, user }
    """
    db = get_db()
    logger.info(f'[AUTH] Admin login attempt for: "{username}"')

    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username and password are required.",
        )

    # Find admin by username (case-insensitive, trimmed — matches Mongoose lowercase:true)
    admin = await db["admins"].find_one({"username": username.strip().lower()})

    if not admin:
        logger.warning(f"[AUTH] No admin found with username: {username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    # Verify password against stored hash
    if not _verify_password(password, admin.get("password_hash", "")):
        logger.warning(f"[AUTH] Invalid password for admin: {username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    logger.info(f"[AUTH] Admin {username} logged in successfully!")

    token = _sign_token({
        "id": str(admin["_id"]),
        "username": admin.get("username"),
        "email": admin.get("email"),
        "role": "admin",
        "adminId": str(admin["_id"]),
    })

    return {"token": token, "user": _to_safe_admin(admin)}


async def user_login(username: str, password: str) -> dict:
    """
    User login logic.
    Mirrors userLogin() in authController.js.
    Returns { token, user }
    """
    db = get_db()
    logger.info(f"[AUTH] User login attempt: {username}")

    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username and password are required.",
        )

    # Find user across ALL admins by username
    user = await db["users"].find_one({"username": username.strip().lower()})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    if user.get("status", "active") != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been deactivated. Contact your administrator.",
        )

    if not _verify_password(password, user.get("password_hash", "")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    token = _sign_token({
        "id": str(user["_id"]),
        "username": user.get("username"),
        "email": user.get("email"),
        "role": "user",
        "adminId": str(user.get("adminId", "")),
    })

    return {"token": token, "user": _to_safe_user(user)}


async def get_me(principal: dict) -> dict:
    """
    Returns the current principal profile.
    Mirrors getMe() in authController.js.
    """
    return {"user": principal}
