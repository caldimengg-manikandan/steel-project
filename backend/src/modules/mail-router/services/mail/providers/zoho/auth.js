"use strict";
// src/lib/mail/providers/zoho/auth.ts
// -----------------------------------------------------------------------------
// Zoho Mail OAuth2 Authentication Module.
// Supports multi-datacenter domains (e.g. zoho.in, zoho.com, zoho.eu).
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZOHO_DEFAULT_SCOPES = void 0;
exports.getZohoConfig = getZohoConfig;
exports.extractZohoDatacenter = extractZohoDatacenter;
exports.getZohoAuthUrl = getZohoAuthUrl;
exports.exchangeZohoCode = exchangeZohoCode;
exports.exchangeZohoAuthCode = exchangeZohoCode;
exports.refreshZohoAccessToken = refreshZohoAccessToken;
const errors_1 = require("../../errors");
exports.ZOHO_DEFAULT_SCOPES = [
    'ZohoMail.messages.READ',
    'ZohoMail.accounts.READ',
    'ZohoMail.folders.READ',
];
function getZohoConfig() {
    const clientId = process.env.ZOHO_CLIENT_ID || '';
    const clientSecret = process.env.ZOHO_CLIENT_SECRET || '';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const redirectUri = process.env.ZOHO_REDIRECT_URI || `${appUrl}/api/auth/zoho/callback`;
    const domain = (process.env.ZOHO_DOMAIN || 'zoho.com').trim().toLowerCase();
    const accountsUrl = process.env.ZOHO_ACCOUNTS_URL || `https://accounts.${domain}`;
    const apiUrl = process.env.ZOHO_API_URL || `https://mail.${domain}/api`;
    return {
        clientId,
        clientSecret,
        redirectUri,
        domain,
        accountsUrl,
        apiUrl,
    };
}
function extractZohoDatacenter(apiDomain, fallbackAccountsUrl) {
    // 1. If apiDomain is provided, extract from it (e.g. 'https://mail.zoho.com' or 'https://www.zohoapis.com')
    if (apiDomain) {
        try {
            const urlObj = new URL(apiDomain.startsWith('http') ? apiDomain : `https://${apiDomain}`);
            const hostname = urlObj.hostname.toLowerCase();
            let domain = null;
            if (hostname.endsWith('zoho.in') || hostname.endsWith('zohoapis.in')) {
                domain = 'zoho.in';
            }
            else if (hostname.endsWith('zoho.eu') || hostname.endsWith('zohoapis.eu')) {
                domain = 'zoho.eu';
            }
            else if (hostname.endsWith('zoho.com.au') || hostname.endsWith('zohoapis.com.au')) {
                domain = 'zoho.com.au';
            }
            else if (hostname.endsWith('zoho.jp') || hostname.endsWith('zohoapis.jp')) {
                domain = 'zoho.jp';
            }
            else if (hostname.endsWith('zoho.ca') || hostname.endsWith('zohoapis.ca')) {
                domain = 'zoho.ca';
            }
            else if (hostname.endsWith('zoho.com') || hostname.endsWith('zohoapis.com')) {
                domain = 'zoho.com';
            }
            if (domain) {
                return {
                    domain,
                    apiUrl: `https://mail.${domain}/api`,
                    accountsUrl: `https://accounts.${domain}`,
                };
            }
        }
        catch {
            // ignore parse error
        }
    }
    // 2. If fallbackAccountsUrl is provided (e.g. 'https://accounts.zoho.com'), extract from it
    if (fallbackAccountsUrl) {
        try {
            const urlObj = new URL(fallbackAccountsUrl.startsWith('http') ? fallbackAccountsUrl : `https://${fallbackAccountsUrl}`);
            const hostname = urlObj.hostname.toLowerCase();
            let domain = null;
            if (hostname.endsWith('zoho.in')) {
                domain = 'zoho.in';
            }
            else if (hostname.endsWith('zoho.eu')) {
                domain = 'zoho.eu';
            }
            else if (hostname.endsWith('zoho.com.au')) {
                domain = 'zoho.com.au';
            }
            else if (hostname.endsWith('zoho.jp')) {
                domain = 'zoho.jp';
            }
            else if (hostname.endsWith('zoho.ca')) {
                domain = 'zoho.ca';
            }
            else if (hostname.endsWith('zoho.com')) {
                domain = 'zoho.com';
            }
            if (domain) {
                return {
                    domain,
                    apiUrl: `https://mail.${domain}/api`,
                    accountsUrl: `https://accounts.${domain}`,
                };
            }
        }
        catch {
            // ignore parse error
        }
    }
    // 3. Fallback default
    const defaultDomain = (process.env.ZOHO_DOMAIN || 'zoho.com').trim().toLowerCase();
    return {
        domain: defaultDomain,
        apiUrl: `https://mail.${defaultDomain}/api`,
        accountsUrl: `https://accounts.${defaultDomain}`,
    };
}
/**
 * Generate authorization URL for Zoho OAuth2 consent.
 */
function getZohoAuthUrl(state, scopes = exports.ZOHO_DEFAULT_SCOPES, loginHint, customAccountsUrl) {
    const config = getZohoConfig();
    if (!config.clientId) {
        throw new errors_1.MailProviderError({
            provider: 'ZOHO',
            code: 'CONFIG_MISSING',
            message: 'ZOHO_CLIENT_ID is not set in environment variables.',
            retryable: false,
        });
    }
    const baseAccountsUrl = customAccountsUrl || config.accountsUrl;
    const accountsUrl = baseAccountsUrl.replace(/\/+$/, '');
    const params = new URLSearchParams({
        scope: scopes.join(','),
        client_id: config.clientId,
        response_type: 'code',
        access_type: 'offline', // requests refresh_token
        redirect_uri: config.redirectUri || '',
        prompt: 'consent',
        state,
    });
    if (loginHint) {
        params.set('login_id', loginHint);
    }
    return `${accountsUrl}/oauth/v2/auth?${params.toString()}`;
}
/**
 * Exchange authorization code for access and refresh tokens.
 * Supports Multi-DC accounts server (e.g. from accounts-server parameter in callback).
 */
async function exchangeZohoCode(code, customAccountsUrl) {
    const config = getZohoConfig();
    let rawAccountsUrl = customAccountsUrl || config.accountsUrl;
    if (rawAccountsUrl && !rawAccountsUrl.startsWith('http://') && !rawAccountsUrl.startsWith('https://')) {
        rawAccountsUrl = `https://${rawAccountsUrl}`;
    }
    const accountsUrl = rawAccountsUrl.replace(/\/+$/, '');
    const tokenUrl = `${accountsUrl}/oauth/v2/token`;
    const body = new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri || '',
        grant_type: 'authorization_code',
    });
    const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    const data = (await res.json());
    if (!res.ok || data.error || !data.access_token) {
        throw new errors_1.MailProviderError({
            provider: 'ZOHO',
            statusCode: res.status,
            code: 'AUTH_FAILED',
            message: `Failed to exchange Zoho authorization code on ${tokenUrl}: ${data.error || res.statusText}`,
            retryable: false,
        });
    }
    const expiresInSec = data.expires_in || 3600;
    const expiresAt = new Date(Date.now() + expiresInSec * 1000);
    const datacenter = extractZohoDatacenter(data.api_domain, accountsUrl);
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
        apiDomain: data.api_domain,
        domain: datacenter.domain,
        apiUrl: datacenter.apiUrl,
        accountsUrl: datacenter.accountsUrl,
    };
}
/**
 * In-flight promise cache to prevent concurrent Zoho token refresh requests from racing.
 */
const inFlightZohoRefreshes = new Map();

/**
 * Refresh an existing Zoho access token using its refresh token.
 */
async function refreshZohoAccessToken(refreshToken, customAccountsUrl) {
    if (!refreshToken) {
        throw new errors_1.MailProviderError({
            provider: 'ZOHO',
            code: 'AUTH_FAILED',
            message: 'Zoho refresh token is missing. Please re-authenticate the mailbox.',
            retryable: false,
        });
    }

    if (inFlightZohoRefreshes.has(refreshToken)) {
        return inFlightZohoRefreshes.get(refreshToken);
    }

    const refreshPromise = (async () => {
        const config = getZohoConfig();
        const accountsUrl = customAccountsUrl || config.accountsUrl;
        const tokenUrl = `${accountsUrl}/oauth/v2/token`;
        const body = new URLSearchParams({
            refresh_token: refreshToken,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: 'refresh_token',
        });
        const res = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const data = (await res.json());
        if (!res.ok || data.error || !data.access_token) {
            const rawErr = data.error_description || data.error || res.statusText || 'Access Denied';
            console.error(`[zoho:auth] Token refresh failed for ${accountsUrl}:`, rawErr, data);
            throw new errors_1.MailProviderError({
                provider: 'ZOHO',
                statusCode: res.status,
                code: 'AUTH_FAILED',
                message: `Failed to refresh Zoho token: ${rawErr}`,
                retryable: false,
            });
        }
        const expiresInSec = data.expires_in || 3600;
        const expiresAt = new Date(Date.now() + expiresInSec * 1000);
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            expiresAt,
        };
    })();

    inFlightZohoRefreshes.set(refreshToken, refreshPromise);
    try {
        return await refreshPromise;
    } finally {
        inFlightZohoRefreshes.delete(refreshToken);
    }
}

