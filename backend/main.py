import asyncio, os, logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import time
import bcrypt
from database import connect_to_mongo, close_mongo_connection, db_instance
from auth_routes import router as auth_router
from project_routes import router as project_router
from client_routes import router as client_router
from extraction_routes import router as extraction_router
from extraction_pipeline import resume_extractions, cleanup_stuck_processes
from transmittal_routes import router as transmittal_router
from admin_user_routes import router as admin_user_router
# Using raw bcrypt for hashing
# Load configuration
load_dotenv()

# Logging configuration
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

# Setup origins
allowed_origins = [
    "https://steel-dms-frontend.onrender.com",
    "https://steel-project-iota.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
]

# Check for custom CORS origins
custom_origins = os.getenv("CORS_ORIGIN")
if custom_origins:
    for origin in custom_origins.split(","):
        o = origin.strip()
        if o and o not in allowed_origins:
            allowed_origins.append(o)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    await connect_to_mongo()
    await ensure_default_admin()
    # Phase 4: Resume any stuck extractions from before last restart
    await resume_extractions()
    # Phase 4: Schedule periodic cleanup of stuck 'processing' records
    async def _cleanup_loop():
        while True:
            await asyncio.sleep(60)    # every 60 seconds
            await cleanup_stuck_processes()
    asyncio.create_task(_cleanup_loop())
    logger.info("\n[SERVER] Steel Detailing DMS API (FastAPI) Ready")
    yield
    # Shutdown logic
    await close_mongo_connection()

app = FastAPI(title="Steel Detailing DMS API", lifespan=lifespan)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With", "Accept"],
)

# ── Auto-seeding logic ──────────────────────────────────────
async def ensure_default_admin():
    """
    Seed the database with properly bcrypt-hashed credentials.
    Uses passlib (compatible with bcryptjs from Node) so logins
    work immediately without any password resets.
    """
    db = db_instance.db
    try:
        ADMIN_PASSWORD = "Admin1@2026"
        THEJA_PASSWORD = "pass@1234"

        admin = await db["admins"].find_one({"username": "admin1"})
        if not admin:
            logger.info("[DB] Seeding default admin account...")
            hashed_admin_pw = bcrypt.hashpw(ADMIN_PASSWORD.encode('utf-8'), bcrypt.gensalt(12)).decode('ascii')
            result = await db["admins"].insert_one({
                "username": "admin1",
                "email": "admin1@steeldetailing.com",
                "password_hash": hashed_admin_pw,
                "displayName": "Default Admin",
                "role": "admin",
                "status": "active",
            })
            admin = await db["admins"].find_one({"_id": result.inserted_id})
        else:
            # Always refresh the hash so password changes take effect
            logger.info("[DB] Admin1 exists — refreshing password hash...")
            hashed_admin_pw = bcrypt.hashpw(ADMIN_PASSWORD.encode('utf-8'), bcrypt.gensalt(12)).decode('ascii')
            await db["admins"].update_one(
                {"username": "admin1"},
                {"$set": {"password_hash": hashed_admin_pw, "status": "active"}}
            )

        logger.info("[DB] Account READY: admin1 / Admin1@2026")

        # Seed demo user 'theja' if missing
        user_theja = await db["users"].find_one({"username": "theja"})
        if not user_theja:
            hashed_user_pw = bcrypt.hashpw(THEJA_PASSWORD.encode('utf-8'), bcrypt.gensalt(12)).decode('ascii')
            await db["users"].insert_one({
                "username": "theja",
                "email": "theja@firm1.com",
                "password_hash": hashed_user_pw,
                "adminId": admin["_id"],
                "status": "active",
                "role": "user",
            })
            logger.info("[DB] Created demo user: theja / pass@1234")

    except Exception as e:
        logger.warning(f"[DB] Skip auto-seed check: {e}")

# Global middleware for request timing and basic logging
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()
    logger.info(f"[API_DEBUG] {request.method} {request.url.path}")
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response

# ── API Routes ─────────────────────────────────────────────
app.include_router(auth_router)        # Phase 2: /api/auth/*
app.include_router(project_router)     # Phase 3: /api/admin/projects/*
app.include_router(client_router)      # Phase 3: /api/admin/clients/*
app.include_router(extraction_router)  # Phase 4: /api/extractions/*
app.include_router(transmittal_router) # Phase 5: /api/transmittals/*
app.include_router(admin_user_router)  # Phase X: /api/admin/users and /stats

@app.get("/api/health")
async def health_check():
    """Simple health check endpoint."""
    return {
        "status": "ok",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "engine": "FastAPI (Python)"
    }

# ── 404 Handler ────────────────────────────────────────────
@app.exception_handler(status.HTTP_404_NOT_FOUND)
async def not_found_handler(request: Request, exc):
    return JSONResponse(
        status_code=404,
        content={"error": "API endpoint not found."}
    )

if __name__ == "__main__":
    import uvicorn
    PORT = int(os.getenv("PORT", 5000))
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
