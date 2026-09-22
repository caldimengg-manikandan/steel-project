// backend-cjs/routes/mailRouter.js
// -----------------------------------------------------------------------------
// Express.js CommonJS Router for Mail Router Module
// Provides all REST endpoints for Zoho & Microsoft mailbox management, OAuth,
// mail syncing, email querying, attachment downloading, and triage forwarding.
// -----------------------------------------------------------------------------

const express = require('express');
const router = express.Router();

const {
  listMailAccountsByUser,
  getMailAccountById,
  deleteMailAccount,
  upsertMailAccount,
  getMailAccountForUserAndProvider,
} = require('../services/mail/account-service');

const { runMailSync } = require('../services/mail-router/mailSyncService');
const { forwardEmail } = require('../services/mail-router/mailForwardService');
const { listEmailsInWindow, getEmailById } = require('../repositories/mail/emailRepo');
const { listAttachmentsByEmail, getAttachmentById } = require('../repositories/mail/attachmentRepo');
const { listSyncJobs } = require('../repositories/mail/syncJobRepo');
const { getAuthCodeUrl: getMsAuthCodeUrl, acquireTokenByCode: acquireMsToken } = require('../services/mail/msalProvider');
const { getZohoAuthUrl, exchangeZohoAuthCode } = require('../services/mail/providers/zoho/auth');
const { saveMsProfile, clearMsProfile } = require('../services/mail/tokenStore');
const { query } = require('../db');

// Helper to extract authenticated user from Express request
// Supports req.user (standard in passport/jwt middleware) or req.session.user
function getAuthUser(req) {
  const user = req.user || (req.session && req.session.user) || {};
  const id = user.id || user._id || req.userId;
  if (!id) {
    return null;
  }
  return {
    id: String(id),
    role: user.role || req.userRole || 'PROJECT_MANAGER',
    email: user.email || '',
  };
}

// -----------------------------------------------------------------------------
// 1. Mail Accounts Management (Per-User, Limit 1 Zoho + 1 Microsoft)
// -----------------------------------------------------------------------------

// GET /api/mail-router/accounts — List connected mailboxes for authenticated user
router.get('/accounts', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const accounts = await listMailAccountsByUser(user.id);
    return res.json({ accounts });
  } catch (err) {
    console.error('[mailRouter] Error fetching accounts:', err);
    return res.status(500).json({ error: err.message || 'Failed to list mail accounts' });
  }
});

// DELETE /api/mail-router/accounts?id=... — Disconnect a mailbox
router.delete('/accounts', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const accountId = req.query.id;
  if (!accountId) {
    return res.status(400).json({ error: 'Account ID parameter (id) is required.' });
  }

  try {
    const account = await getMailAccountById(accountId);
    if (!account || account.userId !== user.id) {
      return res.status(404).json({ error: 'Mail account not found or access denied.' });
    }

    // Clean up provider-specific profiles
    if (account.provider === 'MICROSOFT') {
      try {
        await clearMsProfile(user.id);
      } catch (profileErr) {
        console.warn('[mailRouter] Error clearing MS profile:', profileErr);
      }
    }

    const deleted = await deleteMailAccount(accountId, user.id);
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

// -----------------------------------------------------------------------------
// 2. Microsoft Entra ID / Outlook OAuth Flows
// -----------------------------------------------------------------------------

// GET /api/mail-router/auth/microsoft — Initiate Microsoft OAuth
router.get('/auth/microsoft', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const returnTo = req.query.returnTo || '/mail-router';
  const loginHint = req.query.loginHint || undefined;

  try {
    // Check 1 Microsoft account per user limit
    const existingMs = await getMailAccountForUserAndProvider(user.id, 'MICROSOFT');
    if (existingMs && (!loginHint || existingMs.email.toLowerCase() !== loginHint.toLowerCase())) {
      return res.redirect(
        `${returnTo}?error=${encodeURIComponent(
          `A Microsoft mailbox is already connected (${existingMs.email}). Each user can connect at most 1 Microsoft mailbox. Disconnect it before connecting a different mailbox.`
        )}`
      );
    }

    const state = Buffer.from(JSON.stringify({ returnTo, userId: user.id })).toString('base64url');
    const authUrl = await getMsAuthCodeUrl(state, loginHint);
    return res.redirect(authUrl);
  } catch (err) {
    console.error('[mailRouter:msal] Failed to build auth URL:', err);
    return res.status(500).json({ error: 'Failed to initiate Microsoft authentication.' });
  }
});

// GET /api/mail-router/auth/microsoft/callback — Handle OAuth callback from Microsoft
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

    // Enforce 1 Microsoft account limit
    const existingMs = await getMailAccountForUserAndProvider(userId, 'MICROSOFT');
    if (existingMs && mailboxEmail && existingMs.email.toLowerCase() !== mailboxEmail.toLowerCase()) {
      return res.redirect(
        `${returnTo}?error=${encodeURIComponent(
          `Limit reached: You already have a Microsoft mailbox connected (${existingMs.email}). Disconnect it first.`
        )}`
      );
    }

    // Persist MS token cache & connected mail account
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

// -----------------------------------------------------------------------------
// 3. Zoho Mail OAuth Flows
// -----------------------------------------------------------------------------

// GET /api/mail-router/auth/zoho — Initiate Zoho OAuth
router.get('/auth/zoho', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const returnTo = req.query.returnTo || '/mail-router';
  const loginHint = req.query.loginHint || undefined;

  try {
    const existingZoho = await getMailAccountForUserAndProvider(user.id, 'ZOHO');
    if (existingZoho && (!loginHint || existingZoho.email.toLowerCase() !== loginHint.toLowerCase())) {
      return res.redirect(
        `${returnTo}?error=${encodeURIComponent(
          `A Zoho mailbox is already connected (${existingZoho.email}). Limit is 1 Zoho mailbox. Disconnect it first.`
        )}`
      );
    }

    const state = Buffer.from(JSON.stringify({ returnTo, userId: user.id })).toString('base64url');
    const authUrl = getZohoAuthUrl(state, loginHint);
    return res.redirect(authUrl);
  } catch (err) {
    console.error('[mailRouter:zoho] Failed to initiate Zoho auth:', err);
    return res.status(500).json({ error: 'Failed to initiate Zoho authentication.' });
  }
});

// GET /api/mail-router/auth/zoho/callback — Handle OAuth callback from Zoho
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

    // Dynamic discovery of Zoho mailbox account ID & primary email
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

    // Enforce 1 Zoho account limit
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

// -----------------------------------------------------------------------------
// 4. Mailbox Synchronization
// -----------------------------------------------------------------------------

// POST /api/mail-router/sync — Trigger synchronization for user's mailbox
router.post('/sync', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { accountId, provider, startDate, endDate } = req.body || {};

  try {
    let targetAccounts = [];

    if (accountId) {
      const account = await getMailAccountById(accountId);
      if (!account || account.userId !== user.id) {
        return res.status(404).json({ error: 'Mail account not found or access denied.' });
      }
      targetAccounts = [account];
    } else {
      const userAccounts = await listMailAccountsByUser(user.id);
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
          userId: user.id,
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

// GET /api/mail-router/sync — Get recent sync history for user
router.get('/sync', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const jobs = await listSyncJobs(user.id, 10);
    return res.json({ jobs });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to list sync history' });
  }
});

// -----------------------------------------------------------------------------
// 5. Emails & Triage Workspace
// -----------------------------------------------------------------------------

// GET /api/mail-router/emails — Query synchronized emails within date range & provider
router.get('/emails', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { startDate, endDate, provider } = req.query;

  try {
    const emails = await listEmailsInWindow(
      String(startDate),
      String(endDate),
      provider || undefined,
      user.id
    );
    return res.json({ emails });
  } catch (err) {
    console.error('[mailRouter:emails] Failed to query emails:', err);
    return res.status(500).json({ error: err.message || 'Failed to list emails' });
  }
});

// GET /api/mail-router/emails/:id — Get full email details and attachments
router.get('/emails/:id', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const email = await getEmailById(req.params.id);
    if (!email) return res.status(404).json({ error: 'Email not found.' });

    // Verify account ownership
    if (email.accountId) {
      const account = await getMailAccountById(email.accountId);
      if (account && account.userId !== user.id) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    }

    const attachments = await listAttachmentsByEmail(email.id);
    return res.json({ email, attachments });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch email' });
  }
});

// POST /api/mail-router/emails/:id/forward — Forward email to employee recipients
router.post('/emails/:id/forward', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { recipientIds, note } = req.body || {};
  if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
    return res.status(400).json({ error: 'At least one recipient ID is required.' });
  }

  try {
    const email = await getEmailById(req.params.id);
    if (!email) return res.status(404).json({ error: 'Email not found.' });

    await forwardEmail(email.id, recipientIds, user.id, note);
    return res.json({ success: true, count: recipientIds.length });
  } catch (err) {
    console.error('[mailRouter:forward] Forwarding error:', err);
    return res.status(500).json({ error: err.message || 'Failed to forward email' });
  }
});

// GET /api/mail-router/attachments/:id — Download attachment file
router.get('/attachments/:id', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

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

// GET /api/mail-router/employees — List employee user refs for triage assignment
router.get('/employees', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { rows } = await query(
      `SELECT id, name, email, role 
         FROM mail_router_user_refs 
        WHERE role = 'EMPLOYEE' AND is_active = true 
        ORDER BY name ASC`
    );
    return res.json({ employees: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch employees' });
  }
});

module.exports = { mailRouter: router };
