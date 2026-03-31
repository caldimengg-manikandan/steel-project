"""
============================================================
Auth Routes  (Python equivalent of routes/authRoutes.js)
============================================================
POST /api/auth/admin/login
POST /api/auth/user/login
GET  /api/auth/me

These are the ONLY unauthenticated endpoints in the system.
============================================================
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth_handler import admin_login, user_login, get_me
from auth_middleware import verify_token

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


# ── Request Body Schemas ──────────────────────────────────

class LoginBody(BaseModel):
    username: str
    password: str


# ── Endpoints ─────────────────────────────────────────────

@router.post("/admin/login", summary="Admin Login")
async def route_admin_login(body: LoginBody):
    """
    POST /api/auth/admin/login
    Body: { username, password }
    Returns: { token, user }
    """
    return await admin_login(body.username, body.password)


@router.post("/user/login", summary="User Login")
async def route_user_login(body: LoginBody):
    """
    POST /api/auth/user/login
    Body: { username, password }
    Returns: { token, user }
    """
    return await user_login(body.username, body.password)


@router.get("/me", summary="Get Current User")
async def route_get_me(principal: dict = Depends(verify_token)):
    """
    GET /api/auth/me
    Requires: Bearer token in Authorization header.
    Returns: { user: principal }
    """
    return await get_me(principal)
