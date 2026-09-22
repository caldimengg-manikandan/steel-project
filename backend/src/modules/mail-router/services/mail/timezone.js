"use strict";
// src/lib/timezone.ts
// -----------------------------------------------------------------------------
// IST ↔ UTC date-range helpers.
//
// The application displays dates in IST (Asia/Kolkata) for user interaction
// but always sends UTC timestamps to Microsoft Graph.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTodayUtcWindow = getTodayUtcWindow;
exports.localDateToUtcWindow = localDateToUtcWindow;
exports.localRangeToUtcWindow = localRangeToUtcWindow;
exports.toLocalDateStr = toLocalDateStr;
exports.formatLocalDateTime = formatLocalDateTime;
const date_fns_tz_1 = require("date-fns-tz");
const date_fns_1 = require("date-fns");
const APP_TIMEZONE = process.env.APP_TIMEZONE ?? 'Asia/Kolkata';
/**
 * Returns the UTC window that corresponds to "today" in the configured
 * app timezone (default: Asia/Kolkata / IST).
 *
 * Example (called at 2026-09-15T12:00:00 IST):
 *   start = "2026-09-14T18:30:00.000Z"   (midnight IST → UTC)
 *   end   = "2026-09-15T18:29:59.999Z"   (end of day IST → UTC)
 */
function getTodayUtcWindow() {
    const nowUtc = new Date();
    const nowLocal = (0, date_fns_tz_1.toZonedTime)(nowUtc, APP_TIMEZONE);
    const localStart = (0, date_fns_1.startOfDay)(nowLocal);
    const localEnd = (0, date_fns_1.endOfDay)(nowLocal);
    const utcStart = (0, date_fns_tz_1.fromZonedTime)(localStart, APP_TIMEZONE);
    const utcEnd = (0, date_fns_tz_1.fromZonedTime)(localEnd, APP_TIMEZONE);
    return {
        start: utcStart.toISOString(),
        end: utcEnd.toISOString(),
    };
}
/**
 * Converts a local date string (YYYY-MM-DD) in the app timezone to a UTC
 * window covering the full local day.
 *
 * @param localDateStr  e.g. "2026-09-15"
 */
function localDateToUtcWindow(localDateStr) {
    // Parse date in local timezone by treating it as midnight local time
    const localMidnight = (0, date_fns_tz_1.fromZonedTime)(new Date(`${localDateStr}T00:00:00`), APP_TIMEZONE);
    const localEndOfDay = (0, date_fns_tz_1.fromZonedTime)(new Date(`${localDateStr}T23:59:59.999`), APP_TIMEZONE);
    return {
        start: localMidnight.toISOString(),
        end: localEndOfDay.toISOString(),
    };
}
/**
 * Converts two local date strings to a multi-day UTC window.
 *
 * @param startDateStr  e.g. "2026-09-14"
 * @param endDateStr    e.g. "2026-09-15"
 */
function localRangeToUtcWindow(startDateStr, endDateStr) {
    const startWindow = localDateToUtcWindow(startDateStr);
    const endWindow = localDateToUtcWindow(endDateStr);
    return {
        start: startWindow.start,
        end: endWindow.end,
    };
}
/**
 * Format a UTC date string as a local IST date string (YYYY-MM-DD).
 * Used to display Graph receivedDateTime values in the UI.
 */
function toLocalDateStr(utcIso) {
    const local = (0, date_fns_tz_1.toZonedTime)(new Date(utcIso), APP_TIMEZONE);
    return local.toISOString().slice(0, 10);
}
/**
 * Format a UTC date string as a human-readable IST datetime.
 * e.g. "15 Sep 2026, 5:30 PM"
 */
function formatLocalDateTime(utcIso) {
    const local = (0, date_fns_tz_1.toZonedTime)(new Date(utcIso), APP_TIMEZONE);
    return local.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: APP_TIMEZONE,
    });
}
