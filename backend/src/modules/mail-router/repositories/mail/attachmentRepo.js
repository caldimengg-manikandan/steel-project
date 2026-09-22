"use strict";
// src/features/mail-router/infra/db/attachmentRepo.ts
// All SQL relating to the attachments table lives here.
// Supports multi-provider attachments.
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertAttachment = upsertAttachment;
exports.listAttachmentsByEmail = listAttachmentsByEmail;
exports.getAttachmentById = getAttachmentById;
exports.getAttachmentContent = getAttachmentContent;
const db_1 = require("../../db");
function mapRow(row) {
    const providerAttId = row.provider_attachment_id || row.graph_attachment_id;
    return {
        id: row.id,
        emailId: row.email_id,
        providerAttachmentId: providerAttId,
        graphAttachmentId: row.graph_attachment_id || providerAttId,
        filename: row.filename,
        contentType: row.content_type,
        sizeBytes: row.size_bytes,
    };
}
/**
 * Upsert attachment metadata and binary content.
 * ON CONFLICT (email_id, provider_attachment_id) DO NOTHING — idempotent.
 */
async function upsertAttachment(params) {
    const attId = params.providerAttachmentId || params.graphAttachmentId || '';
    const { rows } = await (0, db_1.query)(`INSERT INTO attachments
       (email_id, provider_attachment_id, graph_attachment_id, filename, content_type, size_bytes, content)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email_id, provider_attachment_id) DO UPDATE
       SET content      = COALESCE(EXCLUDED.content, attachments.content),
           size_bytes   = COALESCE(EXCLUDED.size_bytes, attachments.size_bytes),
           filename     = EXCLUDED.filename,
           content_type = COALESCE(EXCLUDED.content_type, attachments.content_type)
     RETURNING *`, [
        params.emailId,
        attId,
        attId, // also populate graph_attachment_id for backwards compat
        params.filename,
        params.contentType,
        params.sizeBytes ?? null,
        params.content,
    ]);
    return mapRow(rows[0]);
}
/** List attachment metadata for a given email (no binary content). */
async function listAttachmentsByEmail(emailId) {
    const { rows } = await (0, db_1.query)(`SELECT id, email_id, provider_attachment_id, graph_attachment_id, filename, content_type, size_bytes, created_at
       FROM attachments
      WHERE email_id = $1
      ORDER BY created_at ASC`, [emailId]);
    return rows.map(mapRow);
}
/** Get attachment metadata by its internal UUID (no binary content). */
async function getAttachmentById(id) {
    const { rows } = await (0, db_1.query)(`SELECT id, email_id, provider_attachment_id, graph_attachment_id, filename, content_type, size_bytes, created_at
       FROM attachments
      WHERE id = $1`, [id]);
    return rows[0] ? mapRow(rows[0]) : null;
}
/**
 * Retrieve the binary content of an attachment.
 */
async function getAttachmentContent(id) {
    const { rows } = await (0, db_1.query)(`SELECT content, content_type, filename FROM attachments WHERE id = $1`, [id]);
    if (!rows[0] || !rows[0].content)
        return null;
    return {
        content: rows[0].content,
        contentType: rows[0].content_type,
        filename: rows[0].filename,
    };
}
