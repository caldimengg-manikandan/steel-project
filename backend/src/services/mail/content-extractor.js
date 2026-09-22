"use strict";
// src/lib/mail/content-extractor.ts
// -----------------------------------------------------------------------------
// Provider-neutral complete content and link extraction for emails.
// Extracts full top-to-bottom HTML body, plain-text body, and all embedded links.
// Preserves original email content completely without truncation or omission.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeHtmlEntities = decodeHtmlEntities;
exports.escapeHtml = escapeHtml;
exports.htmlToPlainText = htmlToPlainText;
exports.plainTextToHtml = plainTextToHtml;
exports.extractLinks = extractLinks;
exports.extractEmailContent = extractEmailContent;
/**
 * Decode common HTML entities into their character equivalents.
 */
function decodeHtmlEntities(input) {
    if (!input)
        return '';
    return input
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&zwnj;/gi, '')
        .replace(/&zwj;/gi, '')
        .replace(/&#(\d+);/g, (_, dec) => {
        try {
            return String.fromCharCode(parseInt(dec, 10));
        }
        catch {
            return '';
        }
    })
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
        try {
            return String.fromCharCode(parseInt(hex, 16));
        }
        catch {
            return '';
        }
    });
}
/**
 * Escape HTML special characters for safe inclusion in generated HTML.
 */
function escapeHtml(input) {
    if (!input)
        return '';
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/**
 * Convert HTML body into a clean, complete plain-text representation top-to-bottom.
 * Preserves paragraph breaks, list markers, and layout spacing without HTML markup.
 */
function htmlToPlainText(html) {
    if (!html)
        return '';
    let text = html;
    // Remove <head>, <style>, and <script> blocks completely
    text = text.replace(/<head[\s\S]*?<\/head>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    // Convert block elements to line breaks
    text = text.replace(/<br\s*[\/]?>/gi, '\n');
    text = text.replace(/<\/(p|div|tr|h[1-6]|table|blockquote)>/gi, '\n\n');
    text = text.replace(/<\/li>/gi, '\n');
    text = text.replace(/<li[^>]*>/gi, '• ');
    text = text.replace(/<\/td>/gi, '\t');
    // Strip all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');
    // Decode HTML entities
    text = decodeHtmlEntities(text);
    // Normalize excessive blank lines (more than 2 consecutive newlines)
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
}
/**
 * Wrap plain-text into clean, well-formatted HTML with preserved whitespace.
 */
function plainTextToHtml(text) {
    if (!text)
        return '';
    let escaped = escapeHtml(text);
    // Autolink HTTP/HTTPS URLs safely
    escaped = escaped.replace(/(https?:\/\/[^\s<"']+)/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    return `<div style="white-space: pre-wrap; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: inherit;">${escaped}</div>`;
}
/**
 * Extract all links/URLs from HTML anchors and plain-text.
 * Preserves anchor text and deduplicates in order of appearance.
 */
function extractLinks(html, text) {
    const seen = new Set();
    const results = [];
    function addLink(rawUrl, linkText) {
        let cleanUrl = (rawUrl || '').trim();
        if (!cleanUrl)
            return;
        // Clean trailing punctuation commonly caught in regex
        cleanUrl = cleanUrl.replace(/[.,;:)\]}>]+$/, '');
        // Only accept valid web or mail links
        if (!/^(https?:\/\/|mailto:)/i.test(cleanUrl)) {
            return;
        }
        const key = cleanUrl.toLowerCase();
        if (seen.has(key))
            return;
        seen.add(key);
        const cleanText = linkText ? decodeHtmlEntities(linkText.trim()) : null;
        results.push({
            url: cleanUrl,
            text: cleanText && cleanText !== cleanUrl ? cleanText : null,
        });
    }
    // 1. Extract from HTML <a> tags
    if (html) {
        const anchorRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = anchorRegex.exec(html)) !== null) {
            const url = match[1];
            const innerText = match[2].replace(/<[^>]+>/g, '').trim();
            addLink(url, innerText);
        }
    }
    // 2. Extract raw URLs from plain-text or HTML content
    const rawContent = `${text || ''}\n${html ? html.replace(/<[^>]+>/g, ' ') : ''}`;
    const urlRegex = /\bhttps?:\/\/[^\s<>"']+/gi;
    let urlMatch;
    while ((urlMatch = urlRegex.exec(rawContent)) !== null) {
        addLink(urlMatch[0]);
    }
    return results;
}
/**
 * Master email content extractor.
 * Produces complete HTML body, complete plain-text body, and all extracted links.
 * Guarantees no truncation or omission.
 */
function extractEmailContent(input) {
    const rawHtml = input.html?.trim() || null;
    const rawText = input.text?.trim() || null;
    let finalHtml = rawHtml;
    let finalText = rawText;
    // If HTML is available but text is missing, extract complete plain-text
    if (finalHtml && !finalText) {
        finalText = htmlToPlainText(finalHtml);
    }
    // If text is available but HTML is missing, format text into clean HTML
    if (finalText && !finalHtml) {
        finalHtml = plainTextToHtml(finalText);
    }
    // Extract all embedded links from both bodies
    const links = extractLinks(finalHtml, finalText);
    return {
        bodyHtml: finalHtml,
        bodyText: finalText,
        links,
    };
}
