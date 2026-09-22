"use strict";
// src/features/mail-router/infra/db/syncJobRepo.ts
// All SQL relating to the sync_jobs table lives here.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSyncJob = createSyncJob;
exports.markJobRunning = markJobRunning;
exports.updateJobProgress = updateJobProgress;
exports.markJobCompleted = markJobCompleted;
exports.markJobFailed = markJobFailed;
exports.markJobPartial = markJobPartial;
exports.getSyncJob = getSyncJob;
exports.listSyncJobs = listSyncJobs;
const db_1 = require("../../db");
function mapRow(row) {
    return {
        id: row.id,
        triggeredBy: row.triggered_by,
        status: row.status,
        windowStart: row.window_start.toISOString(),
        windowEnd: row.window_end.toISOString(),
        pagesFetched: row.pages_fetched,
        messagesSynced: row.messages_synced,
        lastNextLink: row.last_next_link,
        errorMessage: row.error_message,
        startedAt: row.started_at ? row.started_at.toISOString() : null,
        completedAt: row.completed_at ? row.completed_at.toISOString() : null,
        createdAt: row.created_at.toISOString(),
    };
}
/** Create a new PENDING sync job and return it. */
async function createSyncJob(triggeredBy, windowStart, windowEnd) {
    const { rows } = await (0, db_1.query)(`INSERT INTO sync_jobs (triggered_by, window_start, window_end)
     VALUES ($1, $2, $3)
     RETURNING *`, [triggeredBy, windowStart, windowEnd]);
    return mapRow(rows[0]);
}
/** Mark a job as RUNNING and record its start time. */
async function markJobRunning(jobId) {
    await (0, db_1.query)(`UPDATE sync_jobs SET status = 'RUNNING', started_at = now() WHERE id = $1`, [jobId]);
}
/**
 * Update progress counters and the pagination checkpoint.
 * Called after each successfully persisted page.
 */
async function updateJobProgress(jobId, pagesFetched, messagesSynced, nextLink) {
    await (0, db_1.query)(`UPDATE sync_jobs
        SET pages_fetched   = $1,
            messages_synced = $2,
            last_next_link  = $3
      WHERE id = $4`, [pagesFetched, messagesSynced, nextLink, jobId]);
}
/** Mark a job as COMPLETED. */
async function markJobCompleted(jobId, pagesFetched, messagesSynced) {
    await (0, db_1.query)(`UPDATE sync_jobs
        SET status          = 'COMPLETED',
            pages_fetched   = $1,
            messages_synced = $2,
            last_next_link  = NULL,
            completed_at    = now()
      WHERE id = $3`, [pagesFetched, messagesSynced, jobId]);
}
/** Mark a job as FAILED and store diagnostic information. */
async function markJobFailed(jobId, errorMessage, errorDetail) {
    await (0, db_1.query)(`UPDATE sync_jobs
        SET status        = 'FAILED',
            error_message = $1,
            error_detail  = $2,
            completed_at  = now()
      WHERE id = $3`, [errorMessage, errorDetail ? JSON.stringify(errorDetail) : null, jobId]);
}
/** Mark a job as PARTIAL (some pages completed before failure). */
async function markJobPartial(jobId, errorMessage) {
    await (0, db_1.query)(`UPDATE sync_jobs
        SET status        = 'PARTIAL',
            error_message = $1,
            completed_at  = now()
      WHERE id = $2`, [errorMessage, jobId]);
}
/** Get a sync job by ID. */
async function getSyncJob(jobId) {
    const { rows } = await (0, db_1.query)('SELECT * FROM sync_jobs WHERE id = $1', [jobId]);
    return rows[0] ? mapRow(rows[0]) : null;
}
/** List recent sync jobs for a given PM (newest first). */
async function listSyncJobs(triggeredBy, limit = 20) {
    const { rows } = await (0, db_1.query)('SELECT * FROM sync_jobs WHERE triggered_by = $1 ORDER BY created_at DESC LIMIT $2', [triggeredBy, limit]);
    return rows.map(mapRow);
}
