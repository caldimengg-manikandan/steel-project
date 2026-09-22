"use strict";
// src/lib/mail/providers/zoho/zoho-client.ts
// -----------------------------------------------------------------------------
// Resilient Zoho Mail API HTTP Client.
// Handles:
//   - Header injection: Authorization: Zoho-oauthtoken <token>
//   - Rate limiting / HTTP 429 backoff
//   - 5xx transient error retries
//   - Zoho-specific error response parsing
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.zohoFetch = zohoFetch;
exports.zohoGet = zohoGet;
exports.zohoGetRaw = zohoGetRaw;
const auth_1 = require("./auth");
const errors_1 = require("../../errors");
const MAX_RETRIES = parseInt(process.env.ZOHO_MAX_RETRIES ?? '5', 10);
const MAX_BACKOFF_MS = parseInt(process.env.ZOHO_MAX_BACKOFF_MS ?? '32000', 10);
const BASE_DELAY_MS = 1000;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function backoffMs(attempt) {
    const exp = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
    const jitter = exp * 0.2 * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(exp + jitter));
}
async function zohoFetch(pathOrUrl, accessToken, options = {}) {
    const config = (0, auth_1.getZohoConfig)();
    const base = options.baseUrl || config.apiUrl;
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${base}${pathOrUrl}`;
    let attempt = 0;
    while (true) {
        let response;
        try {
            response = await fetch(url, {
                ...options,
                headers: {
                    Authorization: `Zoho-oauthtoken ${accessToken}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    ...(options.headers || {}),
                },
            });
        }
        catch (networkErr) {
            if (attempt >= MAX_RETRIES) {
                throw new errors_1.MailProviderError({
                    provider: 'ZOHO',
                    code: 'NETWORK_ERROR',
                    message: `Network error reaching Zoho Mail API on ${url}: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`,
                    retryable: true,
                    originalError: networkErr,
                });
            }
            const waitMs = backoffMs(attempt);
            attempt++;
            await sleep(waitMs);
            continue;
        }
        if (response.ok) {
            return response;
        }
        // ── 429 Rate Limiting ───────────────────────────────────────────────────
        if (response.status === 429) {
            const retryAfterHeader = response.headers.get('Retry-After');
            const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
            const waitMs = retryAfterSec ? retryAfterSec * 1000 : backoffMs(attempt);
            if (attempt >= MAX_RETRIES) {
                throw new errors_1.MailProviderError({
                    provider: 'ZOHO',
                    statusCode: 429,
                    code: 'RATE_LIMIT_EXCEEDED',
                    message: `Zoho Mail rate limit exceeded after ${MAX_RETRIES} retries on ${url}`,
                    retryable: true,
                    retryAfterSeconds: retryAfterSec,
                });
            }
            console.warn(`[mail:zoho] Rate limited on ${url}, retry ${attempt + 1}/${MAX_RETRIES} in ${waitMs}ms`);
            await sleep(waitMs);
            attempt++;
            continue;
        }
        // ── 5xx Transient Errors ────────────────────────────────────────────────
        if (response.status >= 500 && response.status < 600) {
            if (attempt >= MAX_RETRIES) {
                throw new errors_1.MailProviderError({
                    provider: 'ZOHO',
                    statusCode: response.status,
                    code: 'SERVER_ERROR',
                    message: `Zoho Mail server error ${response.status} after ${MAX_RETRIES} retries on ${url}`,
                    retryable: true,
                });
            }
            const waitMs = backoffMs(attempt);
            await sleep(waitMs);
            attempt++;
            continue;
        }
        // ── 4xx Errors ──────────────────────────────────────────────────────────
        let errorBody = '';
        try {
            errorBody = await response.text();
        }
        catch {
            errorBody = '(unreadable error response)';
        }
        const isAuthError = response.status === 401 || response.status === 403;
        throw new errors_1.MailProviderError({
            provider: 'ZOHO',
            statusCode: response.status,
            code: isAuthError ? 'AUTHENTICATION_REQUIRED' : 'CLIENT_ERROR',
            message: `Zoho Mail request failed with status ${response.status} on ${url}: ${errorBody}`,
            retryable: false,
        });
    }
}
async function zohoGet(pathOrUrl, accessToken, baseUrl) {
    const response = await zohoFetch(pathOrUrl, accessToken, { baseUrl });
    return response.json();
}
async function zohoGetRaw(pathOrUrl, accessToken, headers, baseUrl) {
    return zohoFetch(pathOrUrl, accessToken, { headers, baseUrl });
}
