// backend-cjs/services/mailAutoSyncService.js
// -----------------------------------------------------------------------------
// Mail AutoSync Background Service
// Periodically synchronizes all active mailboxes (Zoho & Microsoft)
// using node-cron and the optimized attachment sync pipeline.
// -----------------------------------------------------------------------------

const cron = require('node-cron');
const MailAccount = require('../mongoose/models/MailAccount');
const { runMailSync } = require('../mongoose/services/mailSyncService');

// In-memory runtime state
let cronTask = null;
let isCycleRunning = false;
let lastRunAt = null;
let lastRunStatus = 'IDLE';
let lastRunResults = [];
const currentlySyncingAccounts = new Set();

/**
 * Perform a mail sync across all currently active mail accounts.
 */
async function syncActiveMailboxes(options = {}) {
  if (isCycleRunning) {
    console.log('[mail-router:autosync] An auto-sync cycle is already in progress. Skipping this tick.');
    return { skipped: true, reason: 'CYCLE_IN_PROGRESS' };
  }

  isCycleRunning = true;
  lastRunAt = new Date();
  lastRunStatus = 'RUNNING';
  const cycleStartTime = Date.now();
  const results = [];

  try {
    // 1. Query all active mail accounts
    const activeAccounts = await MailAccount.find({ isActive: true }).lean();
    const eligibleAccounts = activeAccounts.filter(
      (a) => (a.accessToken || a.refreshToken) && (a.provider === 'MICROSOFT' || a.provider === 'ZOHO')
    );

    if (eligibleAccounts.length === 0) {
      lastRunStatus = 'IDLE';
      lastRunResults = [];
      isCycleRunning = false;
      return { skipped: true, reason: 'NO_ACTIVE_ACCOUNTS', accountsSynced: 0 };
    }

    // 2. Sliding window: synchronize recent emails (last 2 days to today)
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const startDate = options.startDate || twoDaysAgo.toISOString().substring(0, 10);
    const endDate = options.endDate || now.toISOString().substring(0, 10);

    for (const account of eligibleAccounts) {
      const accountIdStr = String(account._id || account.id);

      // Prevent concurrent syncs for the same account
      if (currentlySyncingAccounts.has(accountIdStr)) {
        console.log(`[mail-router:autosync] Mailbox ${account.email} is already syncing. Skipping.`);
        results.push({ accountId: accountIdStr, email: account.email, status: 'SKIPPED_ALREADY_SYNCING' });
        continue;
      }

      currentlySyncingAccounts.add(accountIdStr);
      try {
        console.log(`[mail-router:autosync] Auto-syncing active mailbox: ${account.provider} (${account.email})...`);
        const job = await runMailSync({
          userId: account.userId,
          account,
          provider: account.provider,
          startDate,
          endDate,
        });

        results.push({
          accountId: accountIdStr,
          provider: account.provider,
          email: account.email,
          status: 'SUCCESS',
          jobId: job?.id || job?._id,
        });
        console.log(`[mail-router:autosync] Completed auto-sync for ${account.email} (Job: ${job?.id || job?._id})`);
      } catch (syncErr) {
        const errorMsg = syncErr instanceof Error ? syncErr.message : String(syncErr);
        console.warn(`[mail-router:autosync] Error syncing mailbox ${account.email}:`, errorMsg);
        results.push({
          accountId: accountIdStr,
          provider: account.provider,
          email: account.email,
          status: 'FAILED',
          error: errorMsg,
        });
      } finally {
        currentlySyncingAccounts.delete(accountIdStr);
      }
    }

    const duration = Date.now() - cycleStartTime;
    const hasFailures = results.some((r) => r.status === 'FAILED');
    lastRunStatus = hasFailures ? 'PARTIAL' : 'COMPLETED';
    lastRunResults = results;

    console.log(
      `[mail-router:autosync] Auto-sync cycle finished in ${duration}ms. Processed ${results.length} active mailbox(es).`
    );
    return { success: true, results, duration };
  } catch (err) {
    lastRunStatus = 'ERROR';
    console.error('[mail-router:autosync] Unexpected error in autosync cycle:', err);
    return { success: false, error: err.message };
  } finally {
    isCycleRunning = false;
  }
}

/**
 * Start the background cron scheduler for mail autosync.
 */
function startMailAutoSync() {
  const isEnabled = process.env.MAIL_AUTOSYNC_ENABLED !== 'false';
  if (!isEnabled) {
    console.log('[mail-router:autosync] Mail auto-sync is disabled via MAIL_AUTOSYNC_ENABLED=false.');
    return;
  }

  // Default: every 1 minute ('* * * * *')
  const cronExpression = process.env.MAIL_AUTOSYNC_CRON || '* * * * *';

  if (!cron.validate(cronExpression)) {
    console.error(
      `[mail-router:autosync] Invalid cron expression: "${cronExpression}". Defaulting to "* * * * *".`
    );
  }

  const validCron = cron.validate(cronExpression) ? cronExpression : '* * * * *';

  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }

  console.log(`[mail-router:autosync] Starting mail autosync cron schedule: "${validCron}" (Every 1 minute)`);

  cronTask = cron.schedule(validCron, async () => {
    try {
      await syncActiveMailboxes();
    } catch (err) {
      console.error('[mail-router:autosync] Cron tick failed:', err);
    }
  });

  // Trigger initial background sync 10 seconds after server startup
  setTimeout(async () => {
    try {
      console.log('[mail-router:autosync] Running initial post-startup sync for active mailboxes...');
      await syncActiveMailboxes();
    } catch (startupErr) {
      console.warn('[mail-router:autosync] Initial post-startup sync error:', startupErr.message);
    }
  }, 10000);
}

/**
 * Stop the background cron scheduler.
 */
function stopMailAutoSync() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log('[mail-router:autosync] Stopped mail autosync scheduler.');
  }
}

/**
 * Inspect the current autosync status and health.
 */
async function getAutoSyncStatus() {
  const activeCount = await MailAccount.countDocuments({ isActive: true });
  return {
    enabled: Boolean(cronTask),
    cronExpression: process.env.MAIL_AUTOSYNC_CRON || '* * * * *',
    intervalDescription: 'Every 1 minute',
    isCycleRunning,
    lastRunAt,
    lastRunStatus,
    lastRunResults,
    currentlySyncingAccounts: Array.from(currentlySyncingAccounts),
    activeMailboxesCount: activeCount,
  };
}

module.exports = {
  startMailAutoSync,
  stopMailAutoSync,
  syncActiveMailboxes,
  getAutoSyncStatus,
};
