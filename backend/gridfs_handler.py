"""
============================================================
GridFS Handler  (Python equivalent of utils/gridfs.js)
============================================================
Saves and reads PDF files to/from MongoDB GridFS using Motor.

Key advantage over the Node version:
  - No custom Multer storage engine needed.
  - We receive bytes directly from FastAPI's UploadFile.
  - No temp-file dance for reading: we stream straight to response.
============================================================
"""

import logging
import os
from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from database import get_db

logger = logging.getLogger("gridfs_handler")

BUCKET_NAME = "uploads"   # matches the Node version bucket name


def _get_bucket() -> AsyncIOMotorGridFSBucket:
    """Return the Motor GridFS bucket for the active db connection."""
    db = get_db()
    return AsyncIOMotorGridFSBucket(db, bucket_name=BUCKET_NAME)


async def save_file_to_gridfs(
    file_bytes: bytes,
    original_filename: str,
    content_type: str,
    project_id: str,
    admin_id: str,
    field_type: str = "drawings",
) -> str:
    """
    Upload raw bytes into GridFS and return the new file's ObjectId as a string.
    Mirrors the _handleFile logic in storage engine of gridfs.js.

    Returns: gridfs_file_id (str)
    """
    bucket = _get_bucket()

    metadata = {
        "originalName": original_filename,
        "projectId": project_id,
        "adminId": admin_id,
        "type": field_type,
        "uploadedAt": datetime.now(timezone.utc).isoformat(),
    }

    # Generate a safe filename: keep original extension, use ObjectId as unique prefix
    ext = os.path.splitext(original_filename)[1]
    safe_filename = f"{ObjectId()}{ext}"

    gridfs_id = await bucket.upload_from_stream(
        safe_filename,
        file_bytes,
        metadata=metadata,
        chunk_size_bytes=255 * 1024,  # 255 KB chunks (GridFS default)
    )

    logger.info(f"[GridFS] Uploaded '{original_filename}' → ID={gridfs_id}")
    return str(gridfs_id)


async def download_file_from_gridfs(gridfs_file_id: str) -> bytes:
    """
    Download a file from GridFS and return raw bytes.
    Used to write a temp file before passing to the AI extractor.
    Mirrors _downloadFromGridFS() in extractionService.js.
    """
    bucket = _get_bucket()
    try:
        oid = ObjectId(gridfs_file_id)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid GridFS file ID: {gridfs_file_id}")

    try:
        data = await bucket.open_download_stream(oid).read()
        return data
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"GridFS file not found: {e}")


async def stream_file_from_gridfs(
    gridfs_file_id: str,
    original_filename: str,
    content_type: str = "application/pdf",
    inline: bool = True,
) -> StreamingResponse:
    """
    Stream a file from GridFS directly to the HTTP response.
    Used for the PDF viewer endpoint.
    Mirrors bucket.openDownloadStream().pipe(res) in Node.
    """
    bucket = _get_bucket()
    try:
        oid = ObjectId(gridfs_file_id)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid GridFS file ID: {gridfs_file_id}")

    try:
        # Motor's download_stream is async-iterable
        download_stream = await bucket.open_download_stream(oid)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"File not found in GridFS: {e}")

    disposition = "inline" if inline else "attachment"
    headers = {
        "Content-Disposition": f'{disposition}; filename="{original_filename}"',
    }

    async def _generator():
        while True:
            chunk = await download_stream.read(65536)  # 64 KB chunks
            if not chunk:
                break
            yield chunk

    return StreamingResponse(
        _generator(),
        media_type=content_type,
        headers=headers,
    )


async def delete_file_from_gridfs(gridfs_file_id: str) -> bool:
    """
    Delete a file from GridFS by its ID.
    Mirrors bucket.delete(fileId) in gridfs.js.
    Returns True on success, False if not found.
    """
    bucket = _get_bucket()
    try:
        oid = ObjectId(gridfs_file_id)
        await bucket.delete(oid)
        logger.info(f"[GridFS] Deleted file ID={gridfs_file_id}")
        return True
    except Exception as e:
        logger.warning(f"[GridFS] Failed to delete file {gridfs_file_id}: {e}")
        return False
