// backend-cjs/mongoose/repositories/syncJobRepo.js
const SyncJob = require('../models/SyncJob');

async function createSyncJob(userId, windowStart, windowEnd) {
  return SyncJob.create({
    triggeredBy: userId,
    status: 'PENDING',
    windowStart: new Date(windowStart),
    windowEnd: new Date(windowEnd),
    startedAt: new Date(),
  });
}

async function markJobRunning(id) {
  return SyncJob.findByIdAndUpdate(id, { status: 'RUNNING', startedAt: new Date() }, { new: true });
}

async function updateJobProgress(id, pagesFetched, messagesSynced, nextLink) {
  return SyncJob.findByIdAndUpdate(
    id,
    { pagesFetched, messagesSynced, lastNextLink: nextLink || null },
    { new: true }
  );
}

async function markJobCompleted(id, pagesFetched, messagesSynced) {
  return SyncJob.findByIdAndUpdate(
    id,
    { status: 'COMPLETED', pagesFetched, messagesSynced, completedAt: new Date() },
    { new: true }
  );
}

async function markJobFailed(id, errorMessage) {
  return SyncJob.findByIdAndUpdate(
    id,
    { status: 'FAILED', errorMessage, completedAt: new Date() },
    { new: true }
  );
}

async function markJobPartial(id, errorMessage) {
  return SyncJob.findByIdAndUpdate(
    id,
    { status: 'PARTIAL', errorMessage, completedAt: new Date() },
    { new: true }
  );
}

async function getSyncJob(id) {
  return SyncJob.findById(id).lean();
}

async function listSyncJobs(userId, limit = 10) {
  return SyncJob.find({ triggeredBy: userId }).sort({ createdAt: -1 }).limit(limit).lean();
}

module.exports = {
  createSyncJob,
  markJobRunning,
  updateJobProgress,
  markJobCompleted,
  markJobFailed,
  markJobPartial,
  getSyncJob,
  listSyncJobs,
};
