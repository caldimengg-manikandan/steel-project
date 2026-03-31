"""
============================================================
Project Routes  (Python equivalent of routes/adminProjectRoutes.js)
============================================================
All routes require admin authentication.

GET    /api/admin/projects
POST   /api/admin/projects
GET    /api/admin/projects/{project_id}
PATCH  /api/admin/projects/{project_id}
DELETE /api/admin/projects/{project_id}
POST   /api/admin/projects/{project_id}/assignments
DELETE /api/admin/projects/{project_id}/assignments/{user_id}
POST   /api/admin/projects/{project_id}/reserve-transmittal
============================================================
"""

from typing import Optional
from fastapi import APIRouter, Depends, Query

from auth_middleware import require_admin
from project_service import (
    CreateProjectBody, UpdateProjectBody, AssignUserBody,
    list_projects, create_project, get_project,
    update_project, delete_project,
    assign_user, remove_assignment, reserve_transmittal,
)

router = APIRouter(prefix="/api/admin/projects", tags=["Admin Projects"])


@router.get("/", summary="List Projects")
async def route_list_projects(
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    principal: dict = Depends(require_admin),
):
    return await list_projects(principal, status_filter=status, search=search)


@router.post("/", summary="Create Project", status_code=201)
async def route_create_project(
    body: CreateProjectBody,
    principal: dict = Depends(require_admin),
):
    return await create_project(principal, body)


@router.get("/{project_id}", summary="Get Project")
async def route_get_project(
    project_id: str,
    principal: dict = Depends(require_admin),
):
    return await get_project(principal, project_id)


@router.patch("/{project_id}", summary="Update Project")
async def route_update_project(
    project_id: str,
    body: UpdateProjectBody,
    principal: dict = Depends(require_admin),
):
    return await update_project(principal, project_id, body)


@router.delete("/{project_id}", summary="Delete Project")
async def route_delete_project(
    project_id: str,
    principal: dict = Depends(require_admin),
):
    return await delete_project(principal, project_id)


@router.post("/{project_id}/assignments", summary="Assign User to Project")
async def route_assign_user(
    project_id: str,
    body: AssignUserBody,
    principal: dict = Depends(require_admin),
):
    return await assign_user(principal, project_id, body)


@router.delete("/{project_id}/assignments/{user_id}", summary="Remove User Assignment")
async def route_remove_assignment(
    project_id: str,
    user_id: str,
    principal: dict = Depends(require_admin),
):
    return await remove_assignment(principal, project_id, user_id)


@router.post("/{project_id}/reserve-transmittal", summary="Reserve Transmittal Number")
async def route_reserve_transmittal(
    project_id: str,
    principal: dict = Depends(require_admin),
):
    return await reserve_transmittal(principal, project_id)
