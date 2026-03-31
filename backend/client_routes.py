"""
============================================================
Client Routes  (Python equivalent of routes/adminClientRoutes.js)
============================================================
All routes require admin authentication.

GET    /api/admin/clients
POST   /api/admin/clients
POST   /api/admin/clients/bulk    (Excel/CSV file upload)
PATCH  /api/admin/clients/{client_id}
DELETE /api/admin/clients/{client_id}
============================================================
"""

from fastapi import APIRouter, Depends, UploadFile, File

from auth_middleware import require_admin
from client_service import (
    CreateClientBody, UpdateClientBody,
    list_clients, create_client, update_client,
    delete_client, bulk_create_clients,
)

router = APIRouter(prefix="/api/admin/clients", tags=["Admin Clients"])


@router.get("/", summary="List Clients")
async def route_list_clients(principal: dict = Depends(require_admin)):
    return await list_clients(principal)


@router.post("/", summary="Create Client", status_code=201)
async def route_create_client(
    body: CreateClientBody,
    principal: dict = Depends(require_admin),
):
    return await create_client(principal, body)


@router.post("/bulk", summary="Bulk Create Clients from Excel/CSV")
async def route_bulk_create_clients(
    file: UploadFile = File(...),
    principal: dict = Depends(require_admin),
):
    return await bulk_create_clients(principal, file)


@router.patch("/{client_id}", summary="Update Client")
async def route_update_client(
    client_id: str,
    body: UpdateClientBody,
    principal: dict = Depends(require_admin),
):
    return await update_client(principal, client_id, body)


@router.delete("/{client_id}", summary="Delete Client")
async def route_delete_client(
    client_id: str,
    principal: dict = Depends(require_admin),
):
    return await delete_client(principal, client_id)
