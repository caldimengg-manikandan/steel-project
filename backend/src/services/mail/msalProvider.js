"use strict";
// src/features/mail-router/auth/msalProvider.ts
// -----------------------------------------------------------------------------
// MSAL Delegated (Authorization Code) Flow — ConfidentialClientApplication
//
// This is the only file that creates or holds MSAL instances.
// It exposes:
//   - getAuthCodeUrl()     → redirect URL for the Microsoft login page
//   - acquireTokenByCode() → exchange the auth code for tokens
//   - acquireTokenSilent() → refresh an existing token using cached state
//
// Authentication config comes entirely from environment variables.
// No secrets are exposed to the browser.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRAPH_SCOPES = void 0;
exports.createMsalApp = createMsalApp;
exports.getAuthCodeUrl = getAuthCodeUrl;
exports.acquireTokenByCode = acquireTokenByCode;
exports.acquireTokenSilent = acquireTokenSilent;
const msal_node_1 = require("@azure/msal-node");
// ── Scopes required by this feature ──────────────────────────────────────────
// Mail.Read   — read messages in the PM's mailbox
// User.Read   — read the PM's profile (/me) to populate display name / UPN
// offline_access — acquire refresh token for silent background refresh
exports.GRAPH_SCOPES = ['Mail.Read', 'User.Read', 'offline_access'];
// ── MSAL instance factory ─────────────────────────────────────────────────────
// One ConfidentialClientApplication per request is acceptable because MSAL Node
// uses an in-memory token cache by default. For production, swap in a
// persistent cache backed by Redis or the DB.
function getMsalConfig() {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    if (!tenantId || !clientId || !clientSecret) {
        throw new Error('[mail-router:msal] Missing required environment variables: ' +
            'AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET. ' +
            'See .env.example for instructions.');
    }
    return {
        auth: {
            clientId,
            clientSecret,
            authority: `https://login.microsoftonline.com/${tenantId}`,
        },
        system: {
            loggerOptions: {
                loggerCallback: (level, message, containsPii) => {
                    if (containsPii)
                        return;
                    if (level === msal_node_1.LogLevel.Error)
                        console.error('[msal]', message);
                    if (level === msal_node_1.LogLevel.Warning)
                        console.warn('[msal]', message);
                    // Verbose / Info suppressed in production
                },
                piiLoggingEnabled: false,
                logLevel: process.env.NODE_ENV === 'development'
                    ? msal_node_1.LogLevel.Warning
                    : msal_node_1.LogLevel.Error,
            },
        },
    };
}
/**
 * Create a fresh MSAL ConfidentialClientApplication.
 * Optionally restore a serialised token cache (from the DB or session) so that
 * acquireTokenSilent can find a cached token without re-prompting the user.
 */
function createMsalApp(serialisedCache) {
    const app = new msal_node_1.ConfidentialClientApplication(getMsalConfig());
    if (serialisedCache) {
        app.getTokenCache().deserialize(serialisedCache);
    }
    return app;
}
/**
 * Build the Microsoft login URL.
 * The browser is redirected here when no valid token exists.
 *
 * @param state  An opaque string round-tripped through the OAuth flow so the
 *               callback can restore the user's original destination.
 */
async function getAuthCodeUrl(state, loginHint) {
    const app = createMsalApp();
    const redirectUri = process.env.AZURE_REDIRECT_URI;
    if (!redirectUri) {
        throw new Error('[mail-router:msal] AZURE_REDIRECT_URI is not set. See .env.example.');
    }
    const request = {
        scopes: exports.GRAPH_SCOPES,
        redirectUri,
        state,
        prompt: 'select_account', // allow PM to switch accounts
        loginHint: loginHint || undefined,
    };
    return app.getAuthCodeUrl(request);
}
/**
 * Exchange an authorization code (from the callback) for an access token.
 * Returns the full AuthenticationResult including tokens and the serialised
 * token cache (to be persisted for silent refresh later).
 */
async function acquireTokenByCode(code, state) {
    const app = createMsalApp();
    const redirectUri = process.env.AZURE_REDIRECT_URI;
    if (!redirectUri) {
        throw new Error('[mail-router:msal] AZURE_REDIRECT_URI is not set.');
    }
    const request = {
        scopes: exports.GRAPH_SCOPES,
        redirectUri,
        code,
        state,
    };
    const result = await app.acquireTokenByCode(request);
    if (!result) {
        throw new Error('[mail-router:msal] acquireTokenByCode returned null.');
    }
    const serialisedCache = app.getTokenCache().serialize();
    return { result, serialisedCache };
}
/**
 * Silently acquire a fresh access token using the stored token cache.
 * Call this before every Graph request to ensure the token is not expired.
 *
 * @param accountId      The MSAL account home account ID (from the original result).
 * @param serialisedCache The serialised MSAL token cache stored in the session/DB.
 */
async function acquireTokenSilent(accountId, serialisedCache) {
    const app = createMsalApp(serialisedCache);
    // Retrieve the cached account
    const accounts = await app.getTokenCache().getAllAccounts();
    const account = accounts.find((a) => a.homeAccountId === accountId);
    if (!account) {
        throw new Error('[mail-router:msal] No cached account found. Re-authentication required.');
    }
    const request = {
        scopes: exports.GRAPH_SCOPES,
        account,
        forceRefresh: false,
    };
    const result = await app.acquireTokenSilent(request);
    if (!result) {
        throw new Error('[mail-router:msal] acquireTokenSilent returned null.');
    }
    return {
        accessToken: result.accessToken,
        serialisedCache: app.getTokenCache().serialize(),
        expiresAt: result.expiresOn?.getTime() ?? Date.now() + 3600000,
    };
}
