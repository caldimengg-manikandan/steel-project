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
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const { ensureDirectory } = require('../../../utils/initDirectories');

function resolveAttachmentCacheDir() {
  if (process.env.MAIL_ATTACHMENTS_DIR) {
    ensureDirectory(process.env.MAIL_ATTACHMENTS_DIR);
    return path.resolve(process.env.MAIL_ATTACHMENTS_DIR);
  }
  const backendDir = path.resolve(__dirname, '../../../../uploads/mail-attachments');
  const rootDir = path.resolve(__dirname, '../../../../../uploads/mail-attachments');
  ensureDirectory(backendDir);
  ensureDirectory(rootDir);
  return backendDir;
}
const ATTACHMENT_CACHE_DIR = resolveAttachmentCacheDir();

const Email = require('../mongoose/models/Email');
const MailAccount = require('../mongoose/models/MailAccount');
const Attachment = require('../mongoose/models/Attachment');
const { getMailProvider } = require('../services/mail/provider-factory');

const {
  listMailAccountsByUser,
  getMailAccountById,
  deleteMailAccount,
  upsertMailAccount,
  getMailAccountForUserAndProvider,
  setActiveMailAccountForUser,
} = require('../mongoose/services/accountService');

const { runMailSync } = require('../mongoose/services/mailSyncService');
const { forwardEmail } = require('../mongoose/services/mailForwardService');
const { listEmailsInWindow, getEmailById } = require('../mongoose/repositories/emailRepo');
const { listAttachmentsByEmail, getAttachmentById } = require('../mongoose/repositories/attachmentRepo');
const { listSyncJobs } = require('../mongoose/repositories/syncJobRepo');
const { listMailboxItems, getMailboxItem, markAsRead, countUnread, listEmployees } = require('../mongoose/repositories/forwardingRepo');
const { getAuthCodeUrl: getMsAuthCodeUrl, acquireTokenByCode: acquireMsToken } = require('../services/mail/msalProvider');
const { getZohoAuthUrl, exchangeZohoCode, exchangeZohoAuthCode } = require('../services/mail/providers/zoho/auth');
const { saveMsProfile, clearMsProfile } = require('../mongoose/services/tokenStore');

// Helper to resolve redirect URL against the frontend origin
function resolveFrontendUrl(returnTo, params = {}) {
  const fallbackOrigin = (process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173').trim().replace(/\/+$/, '');
  let url;
  try {
    if (returnTo && (returnTo.startsWith('http://') || returnTo.startsWith('https://'))) {
      url = new URL(returnTo);
    } else {
      const cleanPath = (returnTo || '/mail-router').startsWith('/') ? (returnTo || '/mail-router') : `/${returnTo || 'mail-router'}`;
      const baseObj = new URL(fallbackOrigin.startsWith('http') ? fallbackOrigin : `http://${fallbackOrigin}`);
      const combinedPath = (baseObj.pathname.replace(/\/+$/, '') + '/' + cleanPath.replace(/^\/+/, '')).replace(/\/+/g, '/');
      url = new URL(combinedPath, baseObj.origin);
    }
  } catch {
    url = new URL('/mail-router', fallbackOrigin.startsWith('http') ? fallbackOrigin : `http://${fallbackOrigin}`);
  }
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

// Match Steel-Detailing-DWF's FULL_ACCESS_ROLES (Tier 1 RBAC)
const FULL_ACCESS_ROLES = [
  'admin',
  'superadmin',
  'project_manager',
  'team_lead',
  'lead',
  'checker',
];
const MANAGER_ROLES = FULL_ACCESS_ROLES;

// Helper to extract authenticated user from Express request
// Supports req.principal (populated by SDMS verifyToken), req.user, or req.session
function getAuthUser(req) {
  const p = req.principal || req.user || (req.session && req.session.user) || {};
  const id = p.id || p._id || req.userId;
  if (!id) {
    return null;
  }
  const role = String(p.role || req.userRole || 'user').toLowerCase();
  return {
    id: String(id),
    role,
    email: p.email || '',
    username: p.username || '',
    adminId: p.adminId ? String(p.adminId) : null,
    isFullAccess: FULL_ACCESS_ROLES.includes(role),
  };
}

// Middleware: Require specific roles (or full-access roles)
function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized: Authentication required.' });
    if (allowedRoles.length > 0) {
      const lowerAllowed = allowedRoles.map((r) => r.toLowerCase());
      if (!lowerAllowed.includes(user.role) && !user.isFullAccess) {
        return res.status(403).json({
          error: `Forbidden: This action requires full access or one of [${allowedRoles.join(', ')}] role. Your role is ${user.role}.`,
        });
      }
    }
    req.authUser = user;
    next();
  };
}

// =============================================================================
// PART 1: HIGHER ROLES (PROJECT MANAGERS / ADMINS)
// Mailbox Connections, Syncing, and Triage Workspace
// =============================================================================

// ── Mail Folder Definitions (backend-driven, extensible) ──────────────────────
//
// SYSTEM_FOLDERS defines the canonical list of available mail folders.
// Each entry is the single source of truth for folder metadata.
// To add a new folder (e.g. Drafts, Archive), simply add an entry here.
// The route below merges live email counts into these definitions at request time.
//
// Supported fields:
//   id       – unique stable identifier used as a filter key
//   name     – human-readable label shown in the UI
//   icon     – emoji / icon identifier rendered by the frontend
//   type     – 'system' | 'custom' (used for ordering/grouping)
//   filter   – optional MongoDB query fragment for counting (omit = no count possible)
//   order    – integer sort position in the sidebar

const SYSTEM_FOLDERS = [
  {
    id: 'inbox',
    name: 'Inbox',
    icon: 'inbox',
    type: 'system',
    order: 0,
    filter: {
      folder: { $nin: ['sent', 'spam', 'trash', 'drafts', 'draft', 'outbox', 'archive'] },
      isSpam: { $ne: true },
    },
  },
  {
    id: 'sent',
    name: 'Sent',
    icon: 'send',
    type: 'system',
    order: 1,
    filter: {
      folder: 'sent',
    },
  },
  {
    id: 'drafts',
    name: 'Drafts',
    icon: 'drafts',
    type: 'system',
    order: 2,
    filter: {
      folder: { $in: ['drafts', 'draft'] },
    },
  },
  {
    id: 'outbox',
    name: 'Outbox',
    icon: 'outbox',
    type: 'system',
    order: 3,
    provider: 'ZOHO', // Outbox is supported only for Zoho Mail
    filter: {
      folder: 'outbox',
    },
  },
  {
    id: 'spam',
    name: 'Spam',
    icon: 'spam',
    type: 'system',
    order: 4,
    filter: {
      $or: [
        { folder: 'spam' },
        { isSpam: true },
      ],
    },
  },
  {
    id: 'history',
    name: 'History',
    icon: 'history',
    type: 'system',
    order: 5,
    filter: {
      $or: [
        { isForwarded: true },
        { triageStatus: 'FORWARDED' },
      ],
    },
  },
];

// GET /api/mail-router/folders — Return available mail folders with live counts
router.get('/folders', requireRoles(...MANAGER_ROLES), async (req, res) => {
  try {
    const userId = req.authUser.id;
    const targetProvider = req.query.provider ? String(req.query.provider).toUpperCase() : null;

    // Resolve account IDs for the current user so we can scope counts properly
    const userAccounts = await listMailAccountsByUser(userId);
    const filteredAccounts = targetProvider
      ? userAccounts.filter((a) => a.provider === targetProvider)
      : userAccounts;
    const accountIds = filteredAccounts.map((a) => a._id);

    // Base filter: emails belonging to this user (scoped to provider if specified)
    const userFilter = {
      $or: [
        { userId, ...(targetProvider ? { provider: targetProvider } : {}) },
        { accountId: { $in: accountIds } },
        { accountId: { $in: accountIds.map(String) } },
      ],
    };

    // Filter folder definitions based on provider:
    // Outbox is only present in Zoho Mail (not in modern Outlook)
    const eligibleFolderDefs = SYSTEM_FOLDERS.filter((f) => {
      if (f.provider && targetProvider && f.provider !== targetProvider) {
        return false;
      }
      if (f.id === 'outbox' && targetProvider === 'MICROSOFT') {
        return false;
      }
      return true;
    });

    // Build system folder list with live counts
    const folders = await Promise.all(
      eligibleFolderDefs.map(async ({ filter: folderFilter, ...def }) => {
        let count = 0;

        if (folderFilter) {
          try {
            count = await Email.countDocuments({ ...userFilter, ...folderFilter });
          } catch {
            count = 0;
          }
        }

        return {
          id: def.id,
          name: def.name,
          icon: def.icon,
          type: def.type,
          order: def.order,
          count,
        };
      })
    );

    // Fetch custom folders mapped by user (scoped to targetProvider if specified)
    const MailFolder = require('../mongoose/models/MailFolder');
    const customFolderQuery = { userId };
    if (targetProvider) {
      customFolderQuery.provider = targetProvider;
    }
    const customFolders = await MailFolder.find(customFolderQuery).sort({ order: 1, createdAt: 1 }).lean();

    const customFolderItems = await Promise.all(
      customFolders.map(async (cf) => {
        let count = 0;
        try {
          count = await Email.countDocuments({ ...userFilter, folder: cf.folderId });
        } catch {
          count = 0;
        }
        return {
          id: cf.folderId,
          name: cf.name,
          icon: cf.icon || 'folder',
          type: 'custom',
          order: cf.order || 10,
          provider: cf.provider,
          remoteFolderId: cf.remoteFolderId,
          mappingId: cf._id,
          count,
        };
      })
    );

    const allFolders = [...folders, ...customFolderItems];
    allFolders.sort((a, b) => a.order - b.order);

    return res.json({ folders: allFolders });
  } catch (err) {
    console.error('[mailRouter:folders] Error fetching folders:', err);
    return res.status(500).json({ error: err.message || 'Failed to list mail folders' });
  }
});

// GET /api/mail-router/remote-folders — Fetch available remote folders from connected mailbox
router.get('/remote-folders', requireRoles(...MANAGER_ROLES), async (req, res) => {
  try {
    const userId = req.authUser.id;
    const provider = req.query.provider ? String(req.query.provider).toUpperCase() : null;
    if (!provider || !['MICROSOFT', 'ZOHO'].includes(provider)) {
      return res.status(400).json({ error: 'Valid provider parameter (MICROSOFT or ZOHO) is required.' });
    }

    const account = await getMailAccountForUserAndProvider(userId, provider);
    if (!account) {
      return res.status(404).json({ error: `No connected ${provider} account found. Please connect your mailbox first.` });
    }

    const mailProvider = getMailProvider(provider);
    const remoteFolders = await mailProvider.listRemoteFolders(account);

    // Cross-reference with existing custom folders in MailFolder
    const MailFolder = require('../mongoose/models/MailFolder');
    const existingCustom = await MailFolder.find({ userId, provider }).lean();
    const existingRemoteIds = new Set(existingCustom.map((c) => String(c.remoteFolderId)));

    const folders = (remoteFolders || []).map((rf) => ({
      ...rf,
      isAdded: existingRemoteIds.has(String(rf.id)),
    }));

    return res.json({ folders });
  } catch (err) {
    console.error('[mailRouter:remote-folders] Error fetching remote folders:', err);
    return res.status(500).json({ error: err.message || 'Failed to list remote folders from provider' });
  }
});

// POST /api/mail-router/custom-folders — Dynamically map a remote folder into the app
router.post('/custom-folders', requireRoles(...MANAGER_ROLES), async (req, res) => {
  try {
    const userId = req.authUser.id;
    const { provider, remoteFolderId, name, icon } = req.body;

    if (!provider || !['MICROSOFT', 'ZOHO'].includes(String(provider).toUpperCase())) {
      return res.status(400).json({ error: 'Valid provider (MICROSOFT or ZOHO) is required.' });
    }
    if (!remoteFolderId || typeof remoteFolderId !== 'string' || !remoteFolderId.trim()) {
      return res.status(400).json({ error: 'Remote folder ID is required.' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Folder display name is required.' });
    }

    const normProvider = String(provider).toUpperCase();
    const cleanName = name.trim();
    const cleanRemoteFolderId = remoteFolderId.trim();

    const account = await getMailAccountForUserAndProvider(userId, normProvider);
    if (!account) {
      return res.status(404).json({ error: `No connected ${normProvider} account found.` });
    }

    const MailFolder = require('../mongoose/models/MailFolder');

    // 1. Prevent duplicate remoteFolderId mapping for the same user and provider
    const existingRemote = await MailFolder.findOne({
      userId,
      provider: normProvider,
      remoteFolderId: cleanRemoteFolderId,
    }).lean();

    if (existingRemote) {
      return res.status(409).json({
        error: `Folder "${existingRemote.name}" is already added to the sidebar.`,
        folder: existingRemote,
      });
    }

    // 2. Generate a collision-free slug for folderId
    let baseSlug = cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 30);
    if (!baseSlug || ['inbox', 'sent', 'spam', 'drafts', 'draft', 'outbox', 'history', 'trash', 'archive'].includes(baseSlug)) {
      baseSlug = `cf_${baseSlug || 'folder'}`;
    }

    let folderId = baseSlug;
    let counter = 1;
    while (await MailFolder.findOne({ userId, provider: normProvider, folderId }).lean()) {
      folderId = `${baseSlug}_${counter++}`;
    }

    // 3. Save custom folder mapping
    const newFolder = await MailFolder.create({
      userId,
      accountId: account._id,
      provider: normProvider,
      folderId,
      name: cleanName,
      remoteFolderId: cleanRemoteFolderId,
      icon: icon || 'folder',
      order: 10,
    });

    // 4. Trigger initial background sync for this folder non-blockingly
    (async () => {
      try {
        const { runMailSync } = require('../mongoose/services/mailSyncService');
        await runMailSync({
          userId,
          account,
          provider: normProvider,
          folder: folderId,
          remoteFolderId: cleanRemoteFolderId,
        });
      } catch (syncErr) {
        console.warn(`[mailRouter:custom-folders] Initial sync for folder ${folderId} failed:`, syncErr.message);
      }
    })();

    return res.status(201).json({
      success: true,
      folder: {
        id: newFolder.folderId,
        name: newFolder.name,
        icon: newFolder.icon,
        type: 'custom',
        order: newFolder.order,
        provider: newFolder.provider,
        remoteFolderId: newFolder.remoteFolderId,
        mappingId: newFolder._id,
        count: 0,
      },
    });
  } catch (err) {
    console.error('[mailRouter:custom-folders] Error creating custom folder mapping:', err);
    return res.status(500).json({ error: err.message || 'Failed to create folder mapping' });
  }
});

// DELETE /api/mail-router/custom-folders/:id — Remove a custom folder mapping
router.delete('/custom-folders/:id', requireRoles(...MANAGER_ROLES), async (req, res) => {
  try {
    const userId = req.authUser.id;
    const { id } = req.params;

    const MailFolder = require('../mongoose/models/MailFolder');
    const mongoose = require('mongoose');

    let deleted = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      deleted = await MailFolder.findOneAndDelete({ _id: id, userId });
    }
    if (!deleted) {
      deleted = await MailFolder.findOneAndDelete({ folderId: id, userId });
    }

    if (!deleted) {
      return res.status(404).json({ error: 'Folder mapping not found.' });
    }

    return res.json({ success: true, message: `Folder "${deleted.name}" removed from sidebar.` });
  } catch (err) {
    console.error('[mailRouter:custom-folders] Error deleting custom folder:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete custom folder mapping' });
  }
});

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

    // If an active account was disconnected, automatically activate the remaining connected mailbox (if any)
    const remaining = await listMailAccountsByUser(req.authUser.id);
    if (remaining.length > 0 && !remaining.some((a) => a.isActive)) {
      await setActiveMailAccountForUser(req.authUser.id, remaining[0]._id);
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

// POST /api/mail-router/accounts/active — Set the active mailbox for autosync
router.post('/accounts/active', requireRoles(...MANAGER_ROLES), async (req, res) => {
  const { accountId, provider } = req.body || {};
  const target = accountId || provider;
  if (!target) {
    return res.status(400).json({ error: 'accountId or provider is required.' });
  }

  try {
    const updated = await setActiveMailAccountForUser(req.authUser.id, target);
    if (!updated) {
      return res.status(404).json({ error: 'Mail account not found.' });
    }
    return res.json({
      success: true,
      message: `Active mailbox set to ${updated.provider} (${updated.email})`,
      account: updated,
    });
  } catch (err) {
    console.error('[mailRouter] Error setting active account:', err);
    return res.status(500).json({ error: err.message || 'Failed to set active account' });
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
        resolveFrontendUrl(returnTo, {
          error: `A Microsoft mailbox is already connected (${existingMs.email}). Limit is 1 Microsoft mailbox per user. Disconnect it before connecting a different one.`
        })
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
    return res.redirect(resolveFrontendUrl(returnTo, { error: String(error_description || error) }));
  }

  if (!code || !state || !userId) {
    return res.redirect(resolveFrontendUrl(returnTo, { error: 'Missing code or state parameter.' }));
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
        resolveFrontendUrl(returnTo, {
          error: `Limit reached: You already have a Microsoft mailbox connected (${existingMs.email}). Disconnect it first.`
        })
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

    return res.redirect(resolveFrontendUrl(returnTo, { connected: '1', provider: 'MICROSOFT' }));
  } catch (err) {
    console.error('[mailRouter:msal] Token exchange failed:', err);
    return res.redirect(resolveFrontendUrl(returnTo, { error: err.message || 'Token exchange failed' }));
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
        resolveFrontendUrl(returnTo, {
          error: `A Zoho mailbox is already connected (${existingZoho.email}). Limit is 1 Zoho mailbox. Disconnect it first.`
        })
      );
    }

    const state = Buffer.from(JSON.stringify({ returnTo, userId: req.authUser.id })).toString('base64url');
    const authUrl = getZohoAuthUrl(state, undefined, loginHint);
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
    return res.redirect(resolveFrontendUrl(returnTo, { error: String(error) }));
  }

  if (!code || !state || !userId) {
    return res.redirect(resolveFrontendUrl(returnTo, { error: 'Missing code or state parameter.' }));
  }

  try {
    const accountsServer = req.query['accounts-server'] || req.query.location || undefined;
    const tokenResult = await (exchangeZohoCode || exchangeZohoAuthCode)(String(code), accountsServer);
    const { getZohoAccounts } = require('../services/mail/providers/zoho/mail-fetcher');
    let email = '';
    let accountId = '0';

    try {
      const zohoAccounts = await getZohoAccounts(tokenResult.accessToken, tokenResult.apiUrl);
      if (zohoAccounts && zohoAccounts.length > 0) {
        accountId = String(zohoAccounts[0].accountId || '0');
        email = zohoAccounts[0].mailboxAddress || zohoAccounts[0].email || '';
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
        resolveFrontendUrl(returnTo, {
          error: `Limit reached: You already have a Zoho mailbox connected (${existingZoho.email}). Disconnect it first.`
        })
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

    return res.redirect(resolveFrontendUrl(returnTo, { connected: '1', provider: 'ZOHO' }));
  } catch (err) {
    console.error('[mailRouter:zoho] Callback error:', err);
    return res.redirect(resolveFrontendUrl(returnTo, { error: err.message || 'Zoho authentication failed' }));
  }
});

// ── Mailbox Synchronization ──────────────────────────────────────────────────

// POST /api/mail-router/sync — Trigger email synchronization
router.post('/sync', requireRoles(...MANAGER_ROLES), async (req, res) => {
  const { accountId, provider, startDate, endDate, folder } = req.body || {};

  // History is a local DB-indexed folder of forwarded emails; do not make remote mailbox calls
  if (folder && String(folder).toLowerCase() === 'history') {
    return res.json({
      message: 'History folder is indexed locally from forwarded emails. Remote mailbox fetch skipped.',
      jobs: [],
    });
  }

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
          folder: folder ? String(folder).toLowerCase() : undefined,
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

// GET /api/mail-router/autosync/status — Inspect background autosync status
router.get('/autosync/status', requireRoles(...MANAGER_ROLES), async (req, res) => {
  try {
    const { getAutoSyncStatus } = require('../services/mailAutoSyncService');
    const status = await getAutoSyncStatus();
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to get autosync status' });
  }
});

// POST /api/mail-router/autosync/trigger — Trigger immediate autosync for active mailboxes
router.post('/autosync/trigger', requireRoles(...MANAGER_ROLES), async (req, res) => {
  try {
    const { syncActiveMailboxes } = require('../services/mailAutoSyncService');
    const result = await syncActiveMailboxes();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to trigger autosync' });
  }
});

// ── Triage Workspace & Email Forwarding ──────────────────────────────────────

// GET /api/mail-router/emails — List emails in date range for active provider
router.get('/emails', requireRoles(...MANAGER_ROLES), async (req, res) => {
  const { startDate, endDate, provider, limit: qLimit, offset: qOffset, page: qPage, folder } = req.query;

  try {
    const cleanStartDate = startDate && startDate !== 'undefined' && startDate !== 'null' ? String(startDate) : undefined;
    const cleanEndDate = endDate && endDate !== 'undefined' && endDate !== 'null' ? String(endDate) : undefined;
    let targetProvider = provider && provider !== 'undefined' && provider !== 'null' ? String(provider).toUpperCase() : undefined;
    const cleanFolder = folder && folder !== 'undefined' && folder !== 'null' ? String(folder).toLowerCase() : undefined;

    const limit = Math.min(parseInt(qLimit || '200', 10), 500);
    const page = parseInt(qPage || '0', 10);
    const offset = qOffset !== undefined ? parseInt(qOffset, 10) : page * limit;

    if (!targetProvider) {
      const MailAccount = require('../mongoose/models/MailAccount');
      const activeAccount = await MailAccount.findOne({ userId: req.authUser.id, isActive: true }).lean();
      if (activeAccount) {
        targetProvider = activeAccount.provider;
      }
    }

    const { emails: rawEmails, total } = await listEmailsInWindow(
      cleanStartDate,
      cleanEndDate,
      targetProvider,
      req.authUser.id,
      limit,
      offset,
      cleanFolder
    );

    // Batch-load attachment metadata (non-inline drawings/files) for all emails in one fast indexed query
    const emailIds = rawEmails.map(e => e._id);
    const Attachment = require('../mongoose/models/Attachment');
    const allAttachments = await Attachment.find({
      emailId: { $in: emailIds },
      isInline: { $ne: true },
    }).select('_id emailId filename contentType sizeBytes isInline').lean();

    const attMap = new Map();
    for (const att of allAttachments) {
      const eId = String(att.emailId);
      if (!attMap.has(eId)) attMap.set(eId, []);
      attMap.get(eId).push(att);
    }

    const emails = rawEmails.map((e) => {
      const emailAtts = attMap.get(String(e._id)) || [];
      return {
        ...e,
        from: e.from || { name: e.fromName || e.fromAddress, email: e.fromAddress },
        to: e.to || (e.toAddress ? { name: e.toName || e.toAddress, email: e.toAddress } : undefined),
        isForwarded: e.isForwarded ?? (e.triageStatus === 'FORWARDED'),
        snippetText: e.snippetText || e.bodyPreview || '',
        hasAttachments: Boolean(e.hasAttachments || emailAtts.length > 0),
        attachments: emailAtts,
      };
    });

    return res.json({
      emails,
      total,
      hasMore: (offset + emails.length) < total,
    });
  } catch (err) {
    console.error('[mailRouter:emails] Failed to query emails:', err);
    return res.status(500).json({ error: err.message || 'Failed to list emails' });
  }
});

// DELETE /api/mail-router/emails — Purge downloaded emails & attachments without touching user sessions or connected mailboxes
router.delete('/emails', requireRoles(...MANAGER_ROLES), async (req, res) => {
  try {
    const EmailForward = require('../mongoose/models/EmailForward');
    const SyncJob = require('../mongoose/models/SyncJob');

    const emailFilter = {};
    if (!req.authUser.isFullAccess) {
      emailFilter.userId = req.authUser.id;
    }

    const emailsToDelete = await Email.find(emailFilter).select('_id').lean();
    const emailIds = emailsToDelete.map(e => e._id);

    const deleteAttachments = await Attachment.deleteMany({ emailId: { $in: emailIds } });
    const deleteForwards = await EmailForward.deleteMany({ emailId: { $in: emailIds } });
    const deleteEmails = await Email.deleteMany(emailFilter);
    const deleteSyncJobs = await SyncJob.deleteMany(emailFilter.userId ? { userId: emailFilter.userId } : {});

    // Reset lastSync status on MailAccounts
    await MailAccount.updateMany(emailFilter.userId ? { userId: emailFilter.userId } : {}, {
      $set: { lastSyncAt: null, lastSyncStatus: null }
    });

    return res.json({
      success: true,
      message: 'Downloaded emails cleared successfully. User accounts, user sessions, and mailbox connections remain intact.',
      deleted: {
        emails: deleteEmails.deletedCount,
        attachments: deleteAttachments.deletedCount,
        forwards: deleteForwards.deletedCount,
        syncJobs: deleteSyncJobs.deletedCount,
      }
    });
  } catch (err) {
    console.error('[mailRouter:clearEmails] Failed to clear downloaded emails:', err);
    return res.status(500).json({ error: err.message || 'Failed to clear downloaded emails' });
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

    const emailId = email._id || email.id || req.params.id;
    const Attachment = require('../mongoose/models/Attachment');
    const Email = require('../mongoose/models/Email');
    const { resolveInlineImages } = require('../mongoose/services/inlineImageService');

    const mongoose = require('mongoose');
    const emailIds = [emailId];
    if (typeof emailId === 'string' && mongoose.Types.ObjectId.isValid(emailId)) {
      emailIds.push(new mongoose.Types.ObjectId(emailId));
    } else if (emailId && emailId.toString) {
      emailIds.push(emailId.toString());
    }

    // Only load attachment binary buffers if the HTML body actually contains cid: or ImageDisplay references
    const hasCid = Boolean(email.bodyHtml && (email.bodyHtml.includes('cid:') || email.bodyHtml.includes('ImageDisplay')));
    let [attachments, fullAttachments] = await Promise.all([
      listAttachmentsByEmail(emailId),
      hasCid
        ? Attachment.find({ emailId: { $in: emailIds }, $or: [{ isInline: true }, { contentId: { $exists: true, $ne: null } }, { contentType: /^image\// }] }).lean()
        : Promise.resolve([]),
    ]);

    // If HTML has inline image references but no cached attachment binary content is present,
    // on-demand fetch and cache inline images so they render immediately
    const hasCachedContent = fullAttachments.some(a => a.content && a.content.length > 0);
    if (hasCid && !hasCachedContent && email.accountId && email.providerMessageId) {
      try {
        const account = await getMailAccountById(email.accountId);
        if (account) {
          const { getMailProvider } = require('../services/mail/provider-factory');
          const provider = getMailProvider(email.provider);
          const attList = await provider.listAttachments(email.providerMessageId, account);
          if (attList && Array.isArray(attList) && attList.length > 0) {
            const { upsertAttachment } = require('../mongoose/repositories/attachmentRepo');
            for (const att of attList) {
              const providerAttachmentId = att.providerAttachmentId || att.id;
              if (!providerAttachmentId) continue;
              const isImg = (att.contentType && att.contentType.startsWith('image/')) ||
                /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(att.filename || '');
              const matchesBody = att.isInline ||
                (email.bodyHtml && (
                  (att.contentId && email.bodyHtml.includes(att.contentId)) ||
                  (att.filename && email.bodyHtml.includes(att.filename)) ||
                  email.bodyHtml.includes('ImageDisplay')
                ));

              let downloadedContent = null;
              if (isImg && matchesBody) {
                try {
                  const dl = await provider.downloadAttachment(email.providerMessageId, providerAttachmentId, account, att.contentId);
                  if (dl && dl.content) {
                    downloadedContent = dl.content;
                  }
                } catch (dlErr) {
                  console.warn(`[mailRouter:lazy-att] Download failed for ${att.filename}:`, dlErr.message);
                }
              }

              const savedAtt = await upsertAttachment({
                emailId,
                providerAttachmentId,
                filename: att.filename || 'attachment',
                contentType: att.contentType || 'application/octet-stream',
                sizeBytes: att.sizeBytes ?? null,
                isInline: Boolean(att.isInline),
                contentId: att.contentId ? String(att.contentId).replace(/^<|>$/g, '').trim() : null,
                ...(downloadedContent ? { content: downloadedContent } : {}),
              });

              if (downloadedContent) {
                fullAttachments.push({
                  ...(savedAtt.toObject ? savedAtt.toObject() : savedAtt),
                  content: downloadedContent,
                });
              }
            }
            attachments = await listAttachmentsByEmail(emailId);
          }
        }
      } catch (lazyErr) {
        console.warn(`[mailRouter:lazy-att] On-demand inline attachment sync failed for ${emailId}:`, lazyErr.message);
      }
    }

    const { html: resolvedHtml, inlineAttachmentIds } = resolveInlineImages(email.bodyHtml, fullAttachments);
    if (resolvedHtml && resolvedHtml !== email.bodyHtml && email._id) {
      Email.updateOne({ _id: email._id }, { bodyHtml: resolvedHtml }).catch(() => {});
    }

    const drawingAttachments = attachments.filter(a =>
      !inlineAttachmentIds.includes(String(a._id || a.id)) && !a.isInline
    );

    const formattedEmail = {
      ...email,
      from: email.from || { name: email.fromName || email.fromAddress, email: email.fromAddress },
      bodyHtml: resolvedHtml || email.bodyHtml || '',
      isForwarded: email.isForwarded ?? (email.triageStatus === 'FORWARDED'),
      snippetText: email.snippetText || email.bodyPreview || (email.bodyText ? email.bodyText.slice(0, 150) : ''),
      attachments: drawingAttachments,
      hasAttachments: Boolean(drawingAttachments.length > 0),
    };
    return res.json({ email: formattedEmail, attachments: drawingAttachments });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch email' });
  }
});

// POST /api/mail-router/emails/:id/forward — Forward email to detailers/employees
router.post('/emails/:id/forward', requireRoles(...MANAGER_ROLES), async (req, res) => {
  const { recipientIds, note, projectId, projectName } = req.body || {};
  if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
    return res.status(400).json({ error: 'At least one recipient ID is required.' });
  }

  try {
    const email = await getEmailById(req.params.id);
    if (!email) return res.status(404).json({ error: 'Email not found.' });

    const emailId = email._id || email.id || req.params.id;
    await forwardEmail(emailId, req.authUser.id, recipientIds, note, projectId, projectName);
    return res.json({ success: true, count: recipientIds.length });
  } catch (err) {
    console.error('[mailRouter:forward] Forwarding error:', err);
    return res.status(500).json({ error: err.message || 'Failed to forward email' });
  }
});

// PATCH /api/mail-router/emails/:id/folder — Move email to a different folder (e.g. spam, inbox)
router.patch('/emails/:id/folder', requireRoles(...MANAGER_ROLES), async (req, res) => {
  const { folder } = req.body || {};
  const validFolders = ['inbox', 'sent', 'spam', 'drafts', 'trash', 'archive'];
  const cleanFolder = String(folder || '').toLowerCase().trim();

  if (!cleanFolder || !validFolders.includes(cleanFolder)) {
    return res.status(400).json({ error: `Invalid folder. Must be one of: ${validFolders.join(', ')}` });
  }

  try {
    const updateFields = {
      folder: cleanFolder,
      isSpam: cleanFolder === 'spam',
    };

    const updated = await Email.findByIdAndUpdate(req.params.id, { $set: updateFields }, { new: true });
    if (!updated) return res.status(404).json({ error: 'Email not found.' });

    return res.json({ success: true, id: updated._id, folder: updated.folder, isSpam: updated.isSpam });
  } catch (err) {
    console.error('[mailRouter:updateFolder] Error updating email folder:', err);
    return res.status(500).json({ error: err.message || 'Failed to update email folder' });
  }
});

// GET /api/mail-router/employees — List detailers/employees & projects for triage assignment
router.get('/employees', requireRoles(...MANAGER_ROLES), async (req, res) => {
  try {
    const adminId = req.authUser.role === 'superadmin' ? null : (req.authUser.adminId || req.authUser.id);
    const { employees, projects } = await listEmployees(adminId);
    return res.json({ employees, projects });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch employees' });
  }
});

// GET /api/mail-router/projects — List projects with members for triage assignment
router.get('/projects', requireRoles(...MANAGER_ROLES), async (req, res) => {
  try {
    const adminId = req.authUser.role === 'superadmin' ? null : (req.authUser.adminId || req.authUser.id);
    const { employees, projects } = await listEmployees(adminId);
    return res.json({ projects, employees });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch projects' });
  }
});


// =============================================================================
// PART 2: EMPLOYEES / DETAILERS (EMPLOYEE INBOX)
// Reading Assigned Emails, Drawings, and PM Notes
// =============================================================================

// GET /api/mail-router/inbox — Employee's personal inbox of forwarded emails
router.get('/inbox', requireRoles(), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const page = parseInt(req.query.page || '0', 10);
  const offset = req.query.offset !== undefined ? parseInt(req.query.offset, 10) : page * limit;

  try {
    // Strictly scoped to authenticated employee's ID
    const items = await listMailboxItems(req.authUser.id, limit, offset);
    const unreadCount = await countUnread(req.authUser.id);
    return res.json({ items, total: items.length, unreadCount });
  } catch (err) {
    console.error('[mailRouter:inbox] Error fetching employee inbox:', err);
    return res.status(500).json({ error: err.message || 'Failed to load inbox' });
  }
});

// GET /api/mail-router/inbox/unread-count — Unread badge counter for navbar
router.get('/inbox/unread-count', requireRoles(), async (req, res) => {
  try {
    const count = await countUnread(req.authUser.id);
    return res.json({ count, unreadCount: count });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to get unread count' });
  }
});

// GET /api/mail-router/inbox/:id — Open forwarded email, marks as read, returns attachments
router.get('/inbox/:id', requireRoles(), async (req, res) => {
  const targetId = req.params.id;

  try {
    const item = await getMailboxItem(req.authUser.id, targetId);
    if (!item) {
      return res.status(404).json({ error: 'Email not found or was not forwarded to you.' });
    }

    // Mark as read idempotently
    await markAsRead(req.authUser.id, targetId);

    // Get drawing / file attachments
    const actualEmailId = item.emailId || (item.email && item.email._id) || targetId;
    const attachments = (item.attachments && item.attachments.length > 0)
      ? item.attachments
      : await listAttachmentsByEmail(actualEmailId);

    return res.json({ item, attachments });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch email' });
  }
});

// In-flight download deduplication map to prevent concurrent duplicate provider fetches
const inFlightAttachmentDownloads = new Map();

async function fetchAndCacheAttachment(attachment) {
  const attachmentIdStr = String(attachment._id || attachment.id);

  if (inFlightAttachmentDownloads.has(attachmentIdStr)) {
    return inFlightAttachmentDownloads.get(attachmentIdStr);
  }

  const downloadPromise = (async () => {
    const localFilePath = path.join(ATTACHMENT_CACHE_DIR, attachmentIdStr);

    // 0. Check local disk first (0ms latency)
    if (fs.existsSync(localFilePath)) {
      try {
        const diskContent = await fs.promises.readFile(localFilePath);
        if (diskContent && diskContent.length > 0) {
          attachment.content = diskContent;
          return diskContent;
        }
      } catch (e) {
        console.warn(`[mailRouter:attachments] Error reading local disk cache for ${attachmentIdStr}:`, e);
      }
    }

    // 1. Re-check DB in case another process/worker cached it in the meantime
    const fresh = await Attachment.findById(attachment._id);
    if (fresh && fresh.content && fresh.content.length > 0) {
      attachment.content = fresh.content;
      attachment.contentType = fresh.contentType || attachment.contentType;
      attachment.filename = fresh.filename || attachment.filename;
      // Cache to local disk asynchronously so future reads are instantaneous
      ensureDirectory(path.dirname(localFilePath));
      fs.promises.writeFile(localFilePath, fresh.content)
        .then(() => { if (process.platform !== 'win32') try { fs.chmodSync(localFilePath, 0o664); } catch {} })
        .catch(() => {});
      return fresh.content;
    }

    // 2. Resolve parent Email
    let email = null;
    if (mongoose.Types.ObjectId.isValid(attachment.emailId)) {
      email = await Email.findById(attachment.emailId).lean();
    }
    if (!email) {
      email = await Email.findOne({ _id: attachment.emailId }).lean();
    }
    if (!email) {
      throw new Error(`Associated email record not found for attachment ${attachment.filename || attachmentIdStr}.`);
    }

    // 3. Resolve MailAccount credentials
    let account = null;
    if (email.accountId) {
      account = await MailAccount.findById(email.accountId).lean();
    }
    if (!account && email.mailboxAddress) {
      account = await MailAccount.findOne({
        email: email.mailboxAddress.toLowerCase(),
        provider: email.provider,
      }).lean();
    }
    if (!account && email.userId) {
      account = await MailAccount.findOne({
        userId: email.userId,
        provider: email.provider,
      }).lean();
    }
    if (!account) {
      account = await MailAccount.findOne({
        provider: email.provider,
      }).lean();
    }

    if (!account) {
      throw new Error(`Connected mail account not found for provider ${email.provider}. Please ensure your mailbox is connected.`);
    }

    if (!account.id && account._id) {
      account.id = String(account._id);
    }

    // 4. Download on-demand from provider (Zoho / Microsoft Graph)
    const mailProvider = getMailProvider(email.provider);
    const downloaded = await mailProvider.downloadAttachment(
      email.providerMessageId,
      attachment.providerAttachmentId,
      account
    );

    if (!downloaded || !downloaded.content) {
      throw new Error('Mail provider returned empty content for attachment.');
    }

    // 5. Cache the attachment locally on disk IMMEDIATELY
    try {
      ensureDirectory(path.dirname(localFilePath));
      await fs.promises.writeFile(localFilePath, downloaded.content);
      if (process.platform !== 'win32') {
        try { fs.chmodSync(localFilePath, 0o664); } catch {}
      }
    } catch (diskErr) {
      console.warn(`[mailRouter:attachments] Could not write to disk cache:`, diskErr);
    }

    // 6. Cache to MongoDB asynchronously in background only if file is <= 2MB (e.g. inline images / signatures)
    // Larger files (blueprints, DWGs, multi-page PDFs) are safely served from disk cache to preserve MongoDB Atlas quota
    const updateFields = {};
    if (downloaded.contentType) {
      updateFields.contentType = downloaded.contentType;
      attachment.contentType = downloaded.contentType;
    }
    if (downloaded.filename && (!attachment.filename || attachment.filename === 'attachment')) {
      updateFields.filename = downloaded.filename;
      attachment.filename = downloaded.filename;
    }
    if (downloaded.content.length && !attachment.sizeBytes) {
      updateFields.sizeBytes = downloaded.content.length;
      attachment.sizeBytes = downloaded.content.length;
    }
    if (downloaded.content.length <= 2 * 1024 * 1024) {
      updateFields.content = downloaded.content;
    }

    Attachment.findByIdAndUpdate(attachment._id, updateFields).catch(dbErr => {
      console.warn(`[mailRouter:attachments] Could not cache to MongoDB in background:`, dbErr.message);
    });

    attachment.content = downloaded.content;
    return downloaded.content;
  })();

  inFlightAttachmentDownloads.set(attachmentIdStr, downloadPromise);

  try {
    return await downloadPromise;
  } finally {
    inFlightAttachmentDownloads.delete(attachmentIdStr);
  }
}

// GET /api/mail-router/attachments/:id — Download / Preview drawing / attachment file
// Accessible by both Managers and Employees who have been forwarded the email
router.get('/attachments/:id', requireRoles(), async (req, res) => {
  const attachmentIdStr = String(req.params.id);
  const localFilePath = path.join(ATTACHMENT_CACHE_DIR, attachmentIdStr);

  try {
    const etag = `"${attachmentIdStr}"`;
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    const isDownload = req.query.download === '1' || req.query.download === 'true';

    // Step 0: Fast path — If cached on local disk, serve immediately without loading heavy buffer from MongoDB Atlas!
    let targetPath = fs.existsSync(localFilePath) ? localFilePath : null;
    if (!targetPath) {
      const altPath = path.resolve(__dirname, '../../../../../uploads/mail-attachments', attachmentIdStr);
      if (fs.existsSync(altPath)) targetPath = altPath;
    }

    if (targetPath) {
      const meta = await Attachment.findById(attachmentIdStr).select('_id filename contentType sizeBytes').lean();
      const filename = meta?.filename || 'attachment';
      const contentType = meta?.contentType || 'application/octet-stream';
      const stat = fs.statSync(targetPath);
      const disposition = isDownload ? 'attachment' : 'inline';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      res.setHeader('ETag', etag);
      res.setHeader('X-Attachment-Cache', 'DISK-HIT');

      const stream = fs.createReadStream(targetPath);
      return stream.pipe(res);
    }

    // Step 1: Check whether the attachment is already in MongoDB
    const attachment = await getAttachmentById(attachmentIdStr);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found.' });

    const disposition = isDownload ? 'attachment' : 'inline';

    if (attachment.content && attachment.content.length > 0) {
      // Save to local disk for future instant requests
      ensureDirectory(path.dirname(localFilePath));
      fs.promises.writeFile(localFilePath, attachment.content)
        .then(() => { if (process.platform !== 'win32') try { fs.chmodSync(localFilePath, 0o664); } catch {} })
        .catch(() => {});

      res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(attachment.filename)}"`);
      res.setHeader('Content-Length', attachment.content.length);
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      res.setHeader('ETag', etag);
      res.setHeader('X-Attachment-Cache', 'DB-HIT');
      return res.end(attachment.content);
    }

    // Step 2: Not cached: fetch on demand from provider, save to local disk & DB, and serve
    const content = await fetchAndCacheAttachment(attachment);

    res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(attachment.filename)}"`);
    res.setHeader('Content-Length', content.length);
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.setHeader('ETag', etag);
    res.setHeader('X-Attachment-Cache', 'MISS');
    return res.end(content);
  } catch (err) {
    console.error(`[mailRouter:attachments] Error serving attachment ${req.params.id}:`, err);
    return res.status(500).json({ error: err.message || 'Failed to download attachment' });
  }
});

// ── Word .doc to HTML Conversion Endpoint ─────────────────────────
const WordExtractor = require('word-extractor');

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDocTextToHtml(extracted) {
  const bodyText = (extracted && typeof extracted.getBody === 'function') ? (extracted.getBody() || '') : '';
  const headersText = (extracted && typeof extracted.getHeaders === 'function') ? (extracted.getHeaders() || '') : '';
  const footersText = (extracted && typeof extracted.getFooters === 'function') ? (extracted.getFooters() || '') : '';
  const footnotesText = (extracted && typeof extracted.getFootnotes === 'function') ? (extracted.getFootnotes() || '') : '';
  const endnotesText = (extracted && typeof extracted.getEndnotes === 'function') ? (extracted.getEndnotes() || '') : '';
  const textboxesText = (extracted && typeof extracted.getTextboxes === 'function') ? (extracted.getTextboxes() || '') : '';

  const htmlParts = [];

  if (headersText.trim()) {
    htmlParts.push(`<header style="color: #64748b; font-size: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 20px;">${escapeHtml(headersText).replace(/\n/g, '<br/>')}</header>`);
  }

  const rawParagraphs = bodyText.split(/\r?\n\r?\n/).map(p => p.trim()).filter(Boolean);
  if (rawParagraphs.length > 0) {
    for (const p of rawParagraphs) {
      if (p.length < 90 && p === p.toUpperCase() && p.replace(/[^A-Z]/g, '').length > 3) {
        htmlParts.push(`<h2>${escapeHtml(p)}</h2>`);
      } else if (p.length < 65 && !p.endsWith('.') && !p.includes('\n')) {
        htmlParts.push(`<h3>${escapeHtml(p)}</h3>`);
      } else {
        htmlParts.push(`<p>${escapeHtml(p).replace(/\r?\n/g, '<br/>')}</p>`);
      }
    }
  } else {
    const singleLines = bodyText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (singleLines.length > 0) {
      for (const line of singleLines) {
        htmlParts.push(`<p>${escapeHtml(line)}</p>`);
      }
    } else {
      htmlParts.push('<p style="color: #64748b; font-style: italic;">(Empty document)</p>');
    }
  }

  if (textboxesText.trim()) {
    htmlParts.push(`<div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 4px; padding: 12px; margin: 16px 0;"><strong>Text Boxes:</strong><br/>${escapeHtml(textboxesText).replace(/\n/g, '<br/>')}</div>`);
  }

  if (footnotesText.trim() || endnotesText.trim()) {
    htmlParts.push(`<footer style="color: #64748b; font-size: 12px; border-top: 1px solid #e2e8f0; padding-top: 12px; margin-top: 24px;"><strong>Notes:</strong><br/>${escapeHtml(footnotesText || endnotesText).replace(/\n/g, '<br/>')}</footer>`);
  }

  if (footersText.trim()) {
    htmlParts.push(`<footer style="color: #94a3b8; font-size: 11px; text-align: center; margin-top: 30px;">${escapeHtml(footersText).replace(/\n/g, ' ')}</footer>`);
  }

  return htmlParts.join('\n');
}

// POST /api/mail-router/convert-doc — Convert legacy .doc / Word documents to HTML
router.post('/convert-doc', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  try {
    let buffer = null;
    let filename = req.query.filename || 'Document.doc';

    const attachmentId = req.query.attachmentId;
    if (attachmentId) {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required to access attachments.' });
      }
      const attachment = await getAttachmentById(attachmentId);
      if (!attachment) return res.status(404).json({ error: 'Attachment not found.' });
      filename = attachment.filename || filename;
      buffer = (attachment.content && attachment.content.length > 0)
        ? attachment.content
        : await fetchAndCacheAttachment(attachment);
    } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      const contentType = (req.headers['content-type'] || '').toLowerCase();
      if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(req.body.toString('utf8'));
          if (parsed.base64) {
            buffer = Buffer.from(parsed.base64, 'base64');
          } else if (parsed.attachmentId) {
            if (!req.user) {
              return res.status(401).json({ error: 'Authentication required to access attachments.' });
            }
            const attachment = await getAttachmentById(parsed.attachmentId);
            if (attachment) {
              filename = attachment.filename || filename;
              buffer = (attachment.content && attachment.content.length > 0)
                ? attachment.content
                : await fetchAndCacheAttachment(attachment);
            }
          }
        } catch {
          buffer = req.body;
        }
      } else {
        buffer = req.body;
      }
    } else if (req.body && typeof req.body === 'object') {
      if (req.body.base64) {
        buffer = Buffer.from(req.body.base64, 'base64');
      } else if (req.body.attachmentId) {
        if (!req.user) {
          return res.status(401).json({ error: 'Authentication required to access attachments.' });
        }
        const attachment = await getAttachmentById(req.body.attachmentId);
        if (attachment) {
          filename = attachment.filename || filename;
          buffer = (attachment.content && attachment.content.length > 0)
            ? attachment.content
            : await fetchAndCacheAttachment(attachment);
        }
      }
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'No document content provided.' });
    }

    // 1. Check if RTF document
    if (buffer.length >= 5 && buffer.slice(0, 5).toString('ascii').startsWith('{\\rtf')) {
      const rtfText = buffer.toString('utf8');
      const cleaned = rtfText
        .replace(/\\par[d]?\s*/g, '\n\n')
        .replace(/\\[a-z0-9-]+\s?/gi, '')
        .replace(/[{}]/g, '')
        .trim();
      const paragraphs = cleaned.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
      const html = paragraphs.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`).join('\n');
      return res.json({ success: true, html, filename, type: 'rtf' });
    }

    // 2. Check if HTML document saved as .doc
    const headStr = buffer.slice(0, 120).toString('utf8').toLowerCase();
    if (headStr.includes('<html') || headStr.includes('<!doctype') || headStr.includes('<body')) {
      return res.json({ success: true, html: buffer.toString('utf8'), filename, type: 'html' });
    }

    // 3. Modern DOCX (ZIP format, starting with PK)
    const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B;
    if (isZip) {
      try {
        const mammoth = require('mammoth');
        const mammothRes = await mammoth.convertToHtml({ buffer });
        if (mammothRes.value) {
          return res.json({ success: true, html: mammothRes.value, filename, type: 'docx' });
        }
      } catch { /* proceed to extractor */ }
    }

    // 4. Legacy .doc binary (OLE2 CFBF)
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    const html = formatDocTextToHtml(doc);

    return res.json({ success: true, html, filename, type: 'doc' });
  } catch (err) {
    console.error('[mailRouter:convert-doc] Error converting doc:', err);
    return res.status(500).json({ error: err.message || 'Failed to extract .doc content' });
  }
});

module.exports = { mailRouter: router };

