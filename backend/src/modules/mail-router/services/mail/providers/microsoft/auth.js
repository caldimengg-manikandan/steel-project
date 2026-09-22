"use strict";
// src/lib/mail/providers/microsoft/auth.ts
// -----------------------------------------------------------------------------
// Microsoft Entra ID Authentication Module
// Supports:
//   1. Client Credentials flow (app-only / service-to-service access)
//   2. Delegated Authorization Code flow (per-user / PM interactive access)
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRAPH_DELEGATED_SCOPES = exports.GRAPH_DEFAULT_SCOPE = void 0;
exports.getAuthConfig = getAuthConfig;
exports.getMsalConfiguration = getMsalConfiguration;
exports.createMsalApp = createMsalApp;
exports.getClientCredentialsApp = getClientCredentialsApp;
exports.resetClientCredentialsApp = resetClientCredentialsApp;
exports.getGraphAccessToken = getGraphAccessToken;
exports.getAuthCodeUrl = getAuthCodeUrl;
exports.acquireTokenByCode = acquireTokenByCode;
exports.acquireTokenSilent = acquireTokenSilent;
const msal_node_1 = require("@azure/msal-node");
exports.GRAPH_DEFAULT_SCOPE = 'https://graph.microsoft.com/.default';
exports.GRAPH_DELEGATED_SCOPES = ['Mail.Read', 'User.Read', 'offline_access'];
function getAuthConfig() {
    if (typeof globalThis.window !== 'undefined') {
        throw new Error('[microsoft:auth] Microsoft authentication module cannot be executed on the client side.');
    }
    const tenantId = process.env.MICROSOFT_TENANT_ID || process.env.AZURE_TENANT_ID;
    const clientId = process.env.MICROSOFT_CLIENT_ID || process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET;
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI || process.env.AZURE_REDIRECT_URI;
    const missing = [];
    if (!tenantId)
        missing.push('MICROSOFT_TENANT_ID / AZURE_TENANT_ID');
    if (!clientId)
        missing.push('MICROSOFT_CLIENT_ID / AZURE_CLIENT_ID');
    if (!clientSecret)
        missing.push('MICROSOFT_CLIENT_SECRET / AZURE_CLIENT_SECRET');
    if (missing.length > 0) {
        throw new Error(`[microsoft:auth] Missing required environment variable(s): ${missing.join(', ')}.`);
    }
    return {
        tenantId: tenantId,
        clientId: clientId,
        clientSecret: clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri,
    };
}
function getMsalConfiguration(_serialisedCache) {
    const { clientId, clientSecret, authority } = getAuthConfig();
    return {
        auth: {
            clientId,
            authority,
            clientSecret,
        },
        system: {
            loggerOptions: {
                loggerCallback: (level, message, containsPii) => {
                    if (containsPii)
                        return;
                    if (level === msal_node_1.LogLevel.Error)
                        console.error('[msal-node:error]', message);
                    if (level === msal_node_1.LogLevel.Warning)
                        console.warn('[msal-node:warn]', message);
                },
                piiLoggingEnabled: false,
                logLevel: process.env.NODE_ENV === 'development'
                    ? msal_node_1.LogLevel.Warning
                    : msal_node_1.LogLevel.Error,
            },
        },
    };
}
function createMsalApp(serialisedCache) {
    const config = getMsalConfiguration(serialisedCache);
    const app = new msal_node_1.ConfidentialClientApplication(config);
    if (serialisedCache) {
        app.getTokenCache().deserialize(serialisedCache);
    }
    return app;
}
// ── Client Credentials Flow (App-Only) ────────────────────────────────────────
let clientCredsApp = null;
function getClientCredentialsApp() {
    if (!clientCredsApp) {
        clientCredsApp = createMsalApp();
    }
    return clientCredsApp;
}
function resetClientCredentialsApp() {
    clientCredsApp = null;
}
async function getGraphAccessToken() {
    const app = getClientCredentialsApp();
    const request = {
        scopes: [exports.GRAPH_DEFAULT_SCOPE],
    };
    const result = await app.acquireTokenByClientCredential(request);
    if (!result || !result.accessToken) {
        throw new Error('[microsoft:auth] Failed to acquire Microsoft Graph token via client credentials.');
    }
    return result.accessToken;
}
// ── Delegated Authorization Code Flow ─────────────────────────────────────────
async function getAuthCodeUrl(state) {
    const app = createMsalApp();
    const { redirectUri } = getAuthConfig();
    if (!redirectUri) {
        throw new Error('[microsoft:auth] Redirect URI is not configured.');
    }
    const request = {
        scopes: exports.GRAPH_DELEGATED_SCOPES,
        redirectUri,
        state,
        prompt: 'select_account',
    };
    return app.getAuthCodeUrl(request);
}
async function acquireTokenByCode(code, state) {
    const app = createMsalApp();
    const { redirectUri } = getAuthConfig();
    if (!redirectUri) {
        throw new Error('[microsoft:auth] Redirect URI is not configured.');
    }
    const request = {
        scopes: exports.GRAPH_DELEGATED_SCOPES,
        redirectUri,
        code,
        state,
    };
    const result = await app.acquireTokenByCode(request);
    if (!result) {
        throw new Error('[microsoft:auth] acquireTokenByCode returned null.');
    }
    const serialisedCache = app.getTokenCache().serialize();
    return { result, serialisedCache };
}
async function acquireTokenSilent(accountId, serialisedCache) {
    const app = createMsalApp(serialisedCache);
    const accounts = await app.getTokenCache().getAllAccounts();
    const account = accounts.find((a) => a.homeAccountId === accountId);
    if (!account) {
        throw new Error('[microsoft:auth] No cached account found. Re-authentication required.');
    }
    const request = {
        scopes: exports.GRAPH_DELEGATED_SCOPES,
        account,
        forceRefresh: false,
    };
    const result = await app.acquireTokenSilent(request);
    if (!result) {
        throw new Error('[microsoft:auth] acquireTokenSilent returned null.');
    }
    return {
        accessToken: result.accessToken,
        serialisedCache: app.getTokenCache().serialize(),
        expiresAt: result.expiresOn?.getTime() ?? Date.now() + 3600000,
    };
}
