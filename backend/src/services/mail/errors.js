"use strict";
// src/lib/mail/errors.ts
// -----------------------------------------------------------------------------
// Unified Error Model for Mail Providers.
// Converts Microsoft Graph, Zoho Mail, and network exceptions into a normalized
// application error structure with retry and diagnostic semantics.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailProviderError = void 0;
exports.isRetryableMailError = isRetryableMailError;
class MailProviderError extends Error {
    constructor(opts) {
        super(`[${opts.provider}] ${opts.code}: ${opts.message}`);
        this.name = 'MailProviderError';
        this.provider = opts.provider;
        this.statusCode = opts.statusCode;
        this.code = opts.code;
        this.message = opts.message;
        this.retryable = Boolean(opts.retryable);
        this.retryAfterSeconds = opts.retryAfterSeconds;
        this.mailboxId = opts.mailboxId;
        this.originalError = opts.originalError;
    }
}
exports.MailProviderError = MailProviderError;
/**
 * Checks if a given error is a retryable MailProviderError.
 */
function isRetryableMailError(err) {
    if (err instanceof MailProviderError) {
        return err.retryable;
    }
    return false;
}
