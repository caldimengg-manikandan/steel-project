// backend-cjs/routes/mailRouter.js
// -----------------------------------------------------------------------------
// Express.js CommonJS Router for Mail Router & Employee Inbox Module
//
// Role-Based Architecture:
// 1. HIGHER ROLES (Project Manager, Admin, Lead):
//    - Manage mailbox connections (Zoho + Microsoft, max 1 each)
//    - Trigger mail synchronization
//    - Triage all company incoming emails
//    - Forward/assign emails with notes to detailers/employees
//
// 2. EMPLOYEES / DETAILERS:
//    - Personal Inbox of forwarded/assigned emails
//    - Unread count badge for navbar
//    - View email details, PM notes, and download drawing attachments
// -----------------------------------------------------------------------------

const express = require('express');
const router = express.Router();

const {
  listMailAccountsByUser,
  getMailAccountById,
  deleteMailAccount,
  upsertMailAccount,
  getMailAccountForUserAndProvider,
} = require('../mongoose/services/accountService');

const { runMailSync } = require('../mongoose/services/mailSyncService');
const { forwardEmail } = require('../mongoose/services/mailForwardService');
const { listEmailsInWindow, getEmailById } = require('../mongoose/repositories/emailRepo');
const { listAttachmentsByEmail, getAttachmentById } = require('../mongoose/repositories/attachmentRepo');
const { listSyncJobs } = require('../mongoose/repositories/syncJobRepo');
const { listMailboxItems, getMailboxItem, markAsRead, countUnread, listEmployees } = require('../mongoose/repositories/forwardingRepo');
const { getAuthCodeUrl: getMsAuthCodeUrl, acquireTokenByCode: acquireMsToken } = require('../services/mail/msalProvider');
const { getZohoAuthUrl, exchangeZohoAuthCode } = require('../services/mail/providers/zoho/auth');
const { saveMsProfile, clearMsProfile } = require('../mongoose/services/tokenStore');

// Roles that can manage mailboxes, sync, and triage emails
const MANAGER_ROLES = ['PROJECT_MANAGER', 'ADMIN', 'LEAD', 'CHECKER'];

// Helper to extract authenticated user from Express request
function getAuthUser(req) {
  const user = req.user || (req.session && req.session.user) || {};
  const id = user.id || user._id || req.userId;
  if (!id) {
    return null;
  }
  return {
    id: String(id),
    role: (user.role || req.userRole || 'PROJECT_MANAGER').toUpperCase(),
    email: user.email || '',
  };
}

// Middleware: Require specific roles
function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized: Authentication required.' });
    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      return res.status(403).json({
        error: `Forbidden: This action requires one of [${allowedRoles.join(', ')}] role. Your role is ${user.role}.`,
      });
    }
    req.authUser = user;
    next();
  };
}

// =============================================================================
// PART 1: HIGHER ROLES (PROJECT MANAGERS / ADMINS)
// Mailbox Connections, Syncing, and Triage Workspace
// =============================================================================

// ── Mailbox Connection Management ────────────────────────────────────────────

// GET /api/mail-router/accounts — List user's connected mailboxes (Zoho & MS)
router.get('/accounts', requireRoles(...MANAGER_ROLES), async (req, res) => {
  try {
    const accounts = await listMailAccountsByUser(req.authUser.id);
    return res.json({ accounts });
  } catch (err) {
    console.error('[mailRouter] Error fetching accounts:', err);
    return res.status(500).json({ error: err.message || 'Failed to list mail accounts' });
  }
});

// DELETE /api/mail-router/accounts?id=... — Disconnect a connected mailbox
router.delete('/accounts', requireRoles(...MANAGER_ROLES), async (req, res) => {
  const accountId = req.query.id;
  if (!accountId) {
    return res.status(400).json({ error: 'Account ID parameter (id) is required.' });
  }

  try {
    const account = await getMailAccountById(accountId);
    if (!account || account.userId !== req.authUser.id) {
      return res.status(404).json({ error: 'Mail account not found or access denied.' });
    }

    if (account.provider === 'MICROSOFT') {
      try {
        await clearMsProfile(req.authUser.id);
      } catch (profileErr) {
        console.warn('[mailRouter] Error clearing MS profile:', profileErr);
      }
    }

    const deleted = await deleteMailAccount(accountId, req.authUser.id);
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete mailbox connection.' });
    }

    return res.json({
      success: true,
      message: `Successfully disconnected ${account.provider} mailbox (${account.email}).`,
    });
  } catch (err) {
    console.error('[mailRouter] Error disconnecting account:', err);
    return res.status(500).json({ error: err.message || 'Failed to disconnect mailbox' });
  }
});

// ── OAuth Flows ──────────────────────────────────────────────────────────────

// GET /api/mail-router/auth/microsoft — Start Microsoft 365 OAuth flow
router.get('/auth/microsoft', requireRoles(...MANAGER_ROLES), async (req, res) => {
  const returnTo = req.query.returnTo || '/mail-router';
  const loginHint = req.query.loginHint || undefined;

  try {
    const existingMs = await getMailAccountForUserAndProvider(req.authUser.id, 'MICROSOFT');
    if (existingMs && (!loginHint || existingMs.email.toLowerCase() !== loginHint.toLowerCase())) {
      return res.redirect(
        `${returnTo}?error=${encodeURIComponent(
          `A Microsoft mailbox is already connected (${existingMs.email}). Limit is 1 Microsoft mailbox per user. Disconnect it before connecting a different one.`
        )}`
      );
    }

    const state = Buffer.from(JSON.stringify({ returnTo, userId: req.authUser.id })).toString('base64url');
    const authUrl = await getMsAuthCodeUrl(state, loginHint);
    return res.redirect(authUrl);
  } catch (err) {
    console.error('[mailRouter:msal] Failed to build auth URL:', err);
    return res.status(500).json({ error: 'Failed to initiate Microsoft authentication.' });
  }
});

// GET /api/mail-router/auth/microsoft/callback — Microsoft OAuth callback
router.get('/auth/microsoft/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  let returnTo = '/mail-router';
  let userId = '';

  if (state) {
    try {
      const parsed = JSON.parse(Buffer.from(String(state), 'base64url').toString());
      returnTo = parsed.returnTo || returnTo;
      userId = parsed.userId || '';
    } catch {
      // ignore
    }
  }

  if (error) {
    console.error('[mailRouter:msal] Microsoft OAuth error:', error, error_description);
    return res.redirect(`${returnTo}?error=${encodeURIComponent(String(error_description || error))}`);
  }

  if (!code || !state || !userId) {
    return res.status(400).json({ error: 'Missing code or state parameter.' });
  }

  try {
    const { result, serialisedCache } = await acquireMsToken(String(code), String(state));

    const tenantId = result.idTokenClaims?.tid || '';
    const upn = result.account?.username || '';
    const accountId = result.account?.homeAccountId || '';
    const mailboxEmail =
      upn ||
      result.idTokenClaims?.preferred_username ||
      result.idTokenClaims?.email ||
      '';

    const existingMs = await getMailAccountForUserAndProvider(userId, 'MICROSOFT');
    if (existingMs && mailboxEmail && existingMs.email.toLowerCase() !== mailboxEmail.toLowerCase()) {
      return res.redirect(
        `${returnTo}?error=${encodeURIComponent(
          `Limit reached: You already have a Microsoft mailbox connected (${existingMs.email}). Disconnect it first.`
        )}`
      );
    }

    await saveMsProfile(userId, tenantId, upn, serialisedCache);

    if (mailboxEmail) {
      await upsertMailAccount({
        userId,
        email: mailboxEmail,
        provider: 'MICROSOFT',
        providerUserId: mailboxEmail,
        displayName: `Work Mailbox (${mailboxEmail})`,
        accessToken: result.accessToken,
        tokenExpiresAt: result.expiresOn ?? null,
        providerMetadata: { tenantId, accountId },
        isActive: true,
      });
    }

    const redirectUrl = new URL(returnTo, `${req.protocol}://${req.get('host')}`);
    redirectUrl.searchParams.set('connected', '1');
    return res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error('[mailRouter:msal] Token exchange failed:', err);
    return res.redirect(`${returnTo}?error=${encodeURIComponent(err.message || 'Token exchange failed')}`);
  }
});

// GET /api/mail-router/auth/zoho — Start Zoho Mail OAuth flow
router.get('/auth/zoho', requireRoles(...MANAGER_ROLES), async (req, res) => {
  const returnTo = req.query.returnTo || '/mail-router';
  const loginHint = req.query.loginHint || undefined;

  try {
    const existingZoho = await getMailAccountForUserAndProvider(req.authUser.id, 'ZOHO');
    if (existingZoho && (!loginHint || existingZoho.email.toLowerCase() !== loginHint.toLowerCase())) {
      return res.redirect(
        `${returnTo}?error=${encodeURIComponent(
          `A Zoho mailbox is already connected (${existingZoho.email}). Limit is 1 Zoho mailbox. Disconnect it first.`
        )}`
      );
    }

    const state = Buffer.from(JSON.stringify({ returnTo, userId: req.authUser.id })).toString('base64url');
    const authUrl = getZohoAuthUrl(state, loginHint);
    return res.redirect(authUrl);
  } catch (err) {
    console.error('[mailRouter:zoho] Failed to initiate Zoho auth:', err);
    return res.status(500).json({ error: 'Failed to initiate Zoho authentication.' });
  }
});

// GET /api/mail-router/auth/zoho/callback — Zoho OAuth callback
router.get('/auth/zoho/callback', async (req, res) => {
  const { code, state, error } = req.query;

  let returnTo = '/mail-router';
  let userId = '';

  if (state) {
    try {
      const parsed = JSON.parse(Buffer.from(String(state), 'base64url').toString());
      returnTo = parsed.returnTo || returnTo;
      userId = parsed.userId || '';
    } catch {
      // ignore
    }
  }

  if (error) {
    return res.redirect(`${returnTo}?error=${encodeURIComponent(String(error))}`);
  }

  if (!code || !state || !userId) {
    return res.status(400).json({ error: 'Missing code or state parameter.' });
  }

  try {
    const tokenResult = await exchangeZohoAuthCode(String(code));
    const { getZohoAccounts } = require('../services/mail/providers/zoho/mail-fetcher');
    let email = '';
    let accountId = '0';

    try {
      const zohoAccounts = await getZohoAccounts(tokenResult.accessToken);
      if (zohoAccounts.length > 0) {
        accountId = zohoAccounts[0].accountId;
        email = zohoAccounts[0].mailboxAddress;
      }
    } catch (fetchErr) {
      console.warn('[mailRouter:zoho] Could not fetch Zoho account info:', fetchErr);
    }

    if (!email) {
      email = `zoho-${accountId}@work.com`;
    }

    const existingZoho = await getMailAccountForUserAndProvider(userId, 'ZOHO');
    if (existingZoho && existingZoho.email.toLowerCase() !== email.toLowerCase()) {
      return res.redirect(
        `${returnTo}?error=${encodeURIComponent(
          `Limit reached: You already have a Zoho mailbox connected (${existingZoho.email}). Disconnect it first.`
        )}`
      );
    }

    await upsertMailAccount({
      userId,
      email,
      provider: 'ZOHO',
      providerUserId: accountId,
      displayName: `Zoho Mail (${email})`,
      accessToken: tokenResult.accessToken,
      refreshToken: tokenResult.refreshToken,
      tokenExpiresAt: tokenResult.expiresAt,
      providerMetadata: {
        apiDomain: tokenResult.apiDomain,
        accountsUrl: tokenResult.accountsUrl,
        accountId,
      },
      isActive: true,
    });

    const redirectUrl = new URL(returnTo, `${req.protocol}://${req.get('host')}`);
    redirectUrl.searchParams.set('connected', '1');
    return res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error('[mailRouter:zoho] Callback error:', err);
    return res.redirect(`${returnTo}?error=${encodeURIComponent(err.message || 'Zoho authentication failed')}`);
  }
});

// ── Mailbox Synchronization ──────────────────────────────────────────────────

// POST /api/mail-router/sync — Trigger email synchronization
router.post('/sync', requireRoles(...MANAGER_ROLES), async (req, res) => {
  const { accountId, provider, startDate, endDate } = req.body || {};

  try {
    let targetAccounts = [];

    if (accountId) {
      const account = await getMailAccountById(accountId);
      if (!account || account.userId !== req.authUser.id) {
        return res.status(404).json({ error: 'Mail account not found or access denied.' });
      }
      targetAccounts = [account];
    } else {
      const userAccounts = await listMailAccountsByUser(req.authUser.id);
      targetAccounts = [...userAccounts];

      if (provider) {
        targetAccounts = targetAccounts.filter((a) => a.provider === provider);
      }

      targetAccounts = targetAccounts.filter((a) => a.isActive && (a.accessToken || a.refreshToken));
    }

    if (targetAccounts.length === 0) {
      return res.status(404).json({
        error: 'No connected mail accounts found. Please connect your work mailbox first.',
      });
    }

    const syncResults = [];
    let lastError = null;

    for (const account of targetAccounts) {
      try {
        const job = await runMailSync({
          userId: req.authUser.id,
          account,
          provider: account.provider,
          startDate,
          endDate,
        });

        syncResults.push({
          jobId: job.id,
          status: job.status,
          provider: account.provider,
          email: account.email,
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`[mailRouter:sync] Failed for ${account.provider} (${account.email}):`, err);
      }
    }

    if (syncResults.length === 0) {
      return res.status(400).json({
        error: `Mail synchronization failed: ${lastError || 'Unknown error'}`,
        details: lastError,
      });
    }

    return res.json({
      status: syncResults[0].status,
      jobId: syncResults[0].jobId,
      provider: syncResults[0].provider,
      email: syncResults[0].email,
      jobs: syncResults,
    });
  } catch (err) {
    console.error('[mailRouter:sync] Sync error:', err);
    return res.status(500).json({ error: err.message || 'Sync failed.' });
  }
});

// GET /api/mail-router/sync — View sync history
router.get('/sync', requireRoles(...MANAGER_ROLES), async (req, res) => {
  try {
    const jobs = await listSyncJobs(req.authUser.id, 10);
    return res.json({ jobs });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to list sync history' });
  }
});

// ── Triage Workspace & Email Forwarding ──────────────────────────────────────

// GET /api/mail-router/emails — List emails in date range for active provider
router.get('/emails', requireRoles(...MANAGER_ROLES), async (req, res) => {
  const { startDate, endDate, provider } = req.query;

  try {
    const emails = await listEmailsInWindow(
      String(startDate),
      String(endDate),
      provider || undefined,
      req.authUser.id
    );
    return res.json({ emails });
  } catch (err) {
    console.error('[mailRouter:emails] Failed to query emails:', err);
    return res.status(500).json({ error: err.message || 'Failed to list emails' });
  }
});

// GET /api/mail-router/emails/:id — Get email details and attachments
router.get('/emails/:id', requireRoles(...MANAGER_ROLES), async (req, res) => {
  try {
    const email = await getEmailById(req.params.id);
    if (!email) return res.status(404).json({ error: 'Email not found.' });

    if (email.accountId) {
      const account = await getMailAccountById(email.accountId);
      if (account && account.userId !== req.authUser.id) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    }

    const attachments = await listAttachmentsByEmail(email.id);
    return res.json({ email, attachments });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch email' });
  }
});

// POST /api/mail-router/emails/:id/forward — Forward email to detailers/employees
router.post('/emails/:id/forward', requireRoles(...MANAGER_ROLES), async (req, res) => {
  const { recipientIds, note } = req.body || {};
  if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
    return res.status(400).json({ error: 'At least one recipient ID is required.' });
  }

  try {
    const email = await getEmailById(req.params.id);
    if (!email) return res.status(404).json({ error: 'Email not found.' });

    await forwardEmail(email.id, recipientIds, req.authUser.id, note);
    return res.json({ success: true, count: recipientIds.length });
  } catch (err) {
    console.error('[mailRouter:forward] Forwarding error:', err);
    return res.status(500).json({ error: err.message || 'Failed to forward email' });
  }
});

// GET /api/mail-router/employees — List detailers/employees for triage assignment
router.get('/employees', requireRoles(...MANAGER_ROLES), async (req, res) => {
  try {
    const employees = await listEmployees();
    return res.json({ employees });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch employees' });
  }
});


// =============================================================================
// PART 2: EMPLOYEES / DETAILERS (EMPLOYEE INBOX)
// Reading Assigned Emails, Drawings, and PM Notes
// =============================================================================

// GET /api/mail-router/inbox — Employee's personal inbox of forwarded emails
router.get('/inbox', requireRoles(), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = parseInt(req.query.offset || '0', 10);

  try {
    // Strictly scoped to authenticated employee's ID
    const items = await listMailboxItems(req.authUser.id, limit, offset);
    return res.json({ items });
  } catch (err) {
    console.error('[mailRouter:inbox] Error fetching employee inbox:', err);
    return res.status(500).json({ error: err.message || 'Failed to load inbox' });
  }
});

// GET /api/mail-router/inbox/unread-count — Unread badge counter for navbar
router.get('/inbox/unread-count', requireRoles(), async (req, res) => {
  try {
    const count = await countUnread(req.authUser.id);
    return res.json({ count });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to get unread count' });
  }
});

// GET /api/mail-router/inbox/:id — Open forwarded email, marks as read, returns attachments
router.get('/inbox/:id', requireRoles(), async (req, res) => {
  const emailId = req.params.id;

  try {
    const item = await getMailboxItem(req.authUser.id, emailId);
    if (!item) {
      return res.status(404).json({ error: 'Email not found or was not forwarded to you.' });
    }

    // Mark as read idempotently
    await markAsRead(req.authUser.id, emailId);

    // Get drawing / file attachments
    const attachments = await listAttachmentsByEmail(emailId);

    return res.json({ item, attachments });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch email' });
  }
});

// GET /api/mail-router/attachments/:id — Download drawing / attachment file
// Accessible by both Managers and Employees who have been forwarded the email
router.get('/attachments/:id', requireRoles(), async (req, res) => {
  try {
    const attachment = await getAttachmentById(req.params.id);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found.' });

    if (!attachment.content) {
      return res.status(404).json({ error: 'Attachment binary content is unavailable.' });
    }

    res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.filename)}"`);
    res.setHeader('Content-Length', attachment.content.length);
    return res.end(attachment.content);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to download attachment' });
  }
});

module.exports = { mailRouter: router };
