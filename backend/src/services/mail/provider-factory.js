"use strict";
// src/lib/mail/provider-factory.ts
// -----------------------------------------------------------------------------
// Provider Registry & Factory.
// Ensures application code requests a provider through getMailProvider('MICROSOFT' | 'ZOHO')
// rather than checking provider types throughout business logic.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMailProvider = getMailProvider;
exports.registerMailProvider = registerMailProvider;
exports.getRegisteredProviders = getRegisteredProviders;
const mail_provider_1 = require("./providers/microsoft/mail-provider");
const mail_provider_2 = require("./providers/zoho/mail-provider");
const registry = new Map();
// Register built-in providers
registry.set('MICROSOFT', mail_provider_1.microsoftMailProvider);
registry.set('ZOHO', mail_provider_2.zohoMailProvider);
/**
 * Get the registered MailProvider for the given provider type.
 */
function getMailProvider(providerType) {
    const provider = registry.get(providerType);
    if (!provider) {
        throw new Error(`[mail:factory] Unsupported mail provider: ${providerType}`);
    }
    return provider;
}
/**
 * Register a custom or replacement mail provider.
 */
function registerMailProvider(provider) {
    registry.set(provider.providerType, provider);
}
/**
 * List all registered provider types.
 */
function getRegisteredProviders() {
    return Array.from(registry.keys());
}
