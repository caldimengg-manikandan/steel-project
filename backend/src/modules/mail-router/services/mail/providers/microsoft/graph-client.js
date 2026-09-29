"use strict";
// src/lib/mail/providers/microsoft/graph-client.ts
// -----------------------------------------------------------------------------
// Throttle-aware Microsoft Graph HTTP client.
// Centralises:
//   - Bearer token injection
//   - HTTP 429 throttle handling (Retry-After header + bounded exponential backoff with jitter)
//   - HTTP 5xx transient error handling
//   - Error mapping into MailProviderError
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.graphFetch = graphFetch;
exports.graphGet = graphGet;
exports.graphGetRaw = graphGetRaw;
const errors_1 = require("../../errors");
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MAX_RETRIES = parseInt(process.env.GRAPH_MAX_RETRIES ?? '5', 10);
const MAX_BACKOFF_MS = parseInt(process.env.GRAPH_MAX_BACKOFF_MS ?? '32000', 10);
const BASE_DELAY_MS = 1000;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function backoffMs(attempt) {
    const exp = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
    const jitter = exp * 0.2 * (Math.random() * 2 - 1); // ±20%
    return Math.max(0, Math.round(exp + jitter));
}
function logRetry(ctx) {
    console.warn(`[mail:microsoft:graph] HTTP ${ctx.status} on ${ctx.url} — ` +
        `attempt ${ctx.attempt}/${MAX_RETRIES}, waiting ${ctx.waitMs}ms before retry.`);
}
async function graphFetch(url, accessToken) {
    let attempt = 0;
    while (true) {
        let response;
        try {
            response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
            });
        }
        catch (networkErr) {
            if (attempt >= MAX_RETRIES) {
                throw new errors_1.MailProviderError({
                    provider: 'MICROSOFT',
                    code: 'NETWORK_ERROR',
                    message: `Network error connecting to Microsoft Graph on ${url}: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`,
                    retryable: true,
                    originalError: networkErr,
                });
            }
            const waitMs = backoffMs(attempt);
            attempt++;
            await sleep(waitMs);
            continue;
        }
        // ── Success ──────────────────────────────────────────────────────────────
        if (response.ok) {
            return response;
        }
        // ── 429 Too Many Requests ─────────────────────────────────────────────────
        if (response.status === 429) {
            const retryAfterHeader = response.headers.get('Retry-After');
            const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
            const waitMs = retryAfterSec ? retryAfterSec * 1000 : backoffMs(attempt);
            if (attempt >= MAX_RETRIES) {
                throw new errors_1.MailProviderError({
                    provider: 'MICROSOFT',
                    statusCode: 429,
                    code: 'RATE_LIMIT_EXCEEDED',
                    message: `Microsoft Graph rate limit exceeded after ${MAX_RETRIES} retries on ${url}`,
                    retryable: true,
                    retryAfterSeconds: retryAfterSec,
                });
            }
            logRetry({ url, attempt: attempt + 1, status: 429, waitMs });
            await sleep(waitMs);
            attempt++;
            continue;
        }
        // ── 5xx Transient Server Errors ───────────────────────────────────────────
        if (response.status >= 500 && response.status < 600) {
            if (attempt >= MAX_RETRIES) {
                throw new errors_1.MailProviderError({
                    provider: 'MICROSOFT',
                    statusCode: response.status,
                    code: 'SERVER_ERROR',
                    message: `Microsoft Graph server error ${response.status} after ${MAX_RETRIES} retries on ${url}`,
                    retryable: true,
                });
            }
            const waitMs = backoffMs(attempt);
            logRetry({ url, attempt: attempt + 1, status: response.status, waitMs });
            await sleep(waitMs);
            attempt++;
            continue;
        }
        // ── 4xx Non-Retryable Errors ──────────────────────────────────────────────
        let errorBody = '';
        try {
            errorBody = await response.text();
        }
        catch {
            errorBody = '(could not read body)';
        }
        let graphErrorCode = '';
        let graphErrorMessage = '';
        try {
            const parsed = JSON.parse(errorBody);
            if (parsed?.error) {
                graphErrorCode = parsed.error.code || '';
                graphErrorMessage = parsed.error.message || '';
            }
        }
        catch {
            // Not JSON format
        }
        // Build human-friendly diagnostic messages for common Microsoft Graph failures
        let friendlyMessage = `Microsoft Graph request failed with status ${response.status} on ${url}: ${errorBody}`;
        if (graphErrorCode === 'MailboxNotEnabledForRESTAPI') {
            friendlyMessage =
                'This Microsoft account does not have an active Microsoft 365 (Exchange Online) mailbox license. ' +
                    'In Microsoft Graph, mail synchronization requires an account with an active Exchange license. ' +
                    'Please assign an Exchange Online license in the Microsoft 365 admin center or connect a mailbox account with an active license.';
        }
        else if (graphErrorCode === 'ErrorInvalidUser') {
            friendlyMessage =
                `The requested Microsoft user was not found or has been deleted from the directory: ${graphErrorMessage || errorBody}`;
        }
        else if (response.status === 400 &&
            graphErrorMessage.toLowerCase().includes('/me request is only valid with delegated')) {
            friendlyMessage =
                'Microsoft Graph /me endpoint is only valid with delegated user authentication. ' +
                    'When using application permissions (client credentials), requests must target /users/{email}/messages.';
        }
        else if (graphErrorMessage) {
            friendlyMessage = `Microsoft Graph error [${graphErrorCode || response.status}]: ${graphErrorMessage}`;
        }
        const isAuthError = response.status === 401 ||
            response.status === 403 ||
            graphErrorCode === 'ErrorInvalidUser';
        throw new errors_1.MailProviderError({
            provider: 'MICROSOFT',
            statusCode: response.status,
            code: isAuthError ? 'AUTHENTICATION_REQUIRED' : 'CLIENT_ERROR',
            message: friendlyMessage,
            retryable: false,
        });
    }
}
async function graphGet(path, accessToken) {
    const url = path.startsWith('https://') ? path : `${GRAPH_BASE}${path}`;
    const response = await graphFetch(url, accessToken);
    return response.json();
}
async function graphGetRaw(path, accessToken) {
    const url = path.startsWith('https://') ? path : `${GRAPH_BASE}${path}`;
    return graphFetch(url, accessToken);
}
