// ============================================================
// File Cache & Prefetch Utility for Microsoft 365 File Viewer
// Provides in-memory caching of ArrayBuffers and Blob URLs
// so opening files is instantaneous and bandwidth is preserved.
// ============================================================

interface CacheEntry {
    buffer: ArrayBuffer;
    blobUrl: string;
    size: number;
    timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 25;
const MAX_TOTAL_BYTES = 120 * 1024 * 1024; // 120MB memory limit

let currentTotalBytes = 0;

function evictIfNecessary(incomingBytes: number) {
    while (
        (cache.size >= MAX_CACHE_ENTRIES || currentTotalBytes + incomingBytes > MAX_TOTAL_BYTES) &&
        cache.size > 0
    ) {
        // Evict oldest entry (LRU)
        const oldestKey = cache.keys().next().value;
        if (!oldestKey) break;
        const entry = cache.get(oldestKey);
        if (entry) {
            try {
                URL.revokeObjectURL(entry.blobUrl);
            } catch {
                /* ignore */
            }
            currentTotalBytes -= entry.size;
            cache.delete(oldestKey);
        }
    }
}

export function getCachedFile(url: string): { buffer: ArrayBuffer; blobUrl: string } | null {
    const entry = cache.get(url);
    if (!entry) return null;
    // If the buffer was detached (byteLength === 0) by a consumer, evict it and re-fetch fresh
    if (!entry.buffer || entry.buffer.byteLength === 0) {
        try { URL.revokeObjectURL(entry.blobUrl); } catch { /* ignore */ }
        currentTotalBytes -= entry.size;
        cache.delete(url);
        return null;
    }
    // Update access time for LRU
    entry.timestamp = Date.now();
    // Return a clone so consumer transferring it to a Web Worker only detaches their local slice
    return { buffer: entry.buffer.slice(0), blobUrl: entry.blobUrl };
}

export function setCachedFile(url: string, buffer: ArrayBuffer, contentType?: string): { blobUrl: string } {
    if (!buffer || buffer.byteLength === 0) {
        return { blobUrl: '' };
    }
    const existing = cache.get(url);
    if (existing && existing.buffer && existing.buffer.byteLength > 0) {
        existing.timestamp = Date.now();
        return { blobUrl: existing.blobUrl };
    }
    if (existing) {
        cache.delete(url);
    }

    const size = buffer.byteLength;
    evictIfNecessary(size);

    // Keep an independent clone in cache so worker transfers elsewhere can NEVER detach the master cached copy
    const safeBuffer = buffer.slice(0);
    const blob = new Blob([safeBuffer], { type: contentType || 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);

    cache.set(url, {
        buffer: safeBuffer,
        blobUrl,
        size,
        timestamp: Date.now(),
    });

    currentTotalBytes += size;
    return { blobUrl };
}

/**
 * Prefetch an attachment silently into memory cache on hover or idle.
 */
const inFlightPrefetches = new Set<string>();

export function prefetchFile(url: string, sizeBytes?: number): void {
    if (!url || cache.has(url) || inFlightPrefetches.has(url)) return;
    // Don't auto-prefetch files larger than 15MB
    if (sizeBytes && sizeBytes > 15 * 1024 * 1024) return;

    inFlightPrefetches.add(url);

    const token = localStorage.getItem('token');
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

    fetch(url, { headers, credentials: 'include' })
        .then(async (res) => {
            if (!res.ok) return null;
            const contentType = res.headers.get('content-type') || undefined;
            const buffer = await res.arrayBuffer();
            if (buffer && buffer.byteLength > 0) {
                setCachedFile(url, buffer, contentType);
            }
        })
        .catch(() => {
            /* ignore prefetch error silently */
        })
        .finally(() => {
            inFlightPrefetches.delete(url);
        });
}
