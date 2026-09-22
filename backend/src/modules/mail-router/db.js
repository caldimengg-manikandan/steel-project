"use strict";
// src/lib/db.ts
// -----------------------------------------------------------------------------
// PostgreSQL connection pool — singleton pattern.
//
// All database access in this application goes through this pool.
// Import `query` for parameterised queries, or `getPool` for transactions.
//
// Integration note: If the host application already manages a pg Pool,
// replace this file with a re-export of that pool and remove the DATABASE_URL
// requirement from this feature's .env.example.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPool = getPool;
exports.query = query;
exports.getClient = getClient;
const pg_1 = require("pg");
let pool = null;
function getPool() {
    if (!pool) {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error('[mail-router] DATABASE_URL environment variable is not set. ' +
                'Copy .env.example to .env.local and fill in your PostgreSQL connection string.');
        }
        pool = new pg_1.Pool({
            connectionString,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
        });
        pool.on('error', (err) => {
            console.error('[mail-router:db] Unexpected pool error:', err.message);
        });
    }
    return pool;
}
/**
 * Execute a single parameterised SQL query.
 *
 * @example
 * const { rows } = await query<{ id: string }>(
 *   'SELECT id FROM imported_emails WHERE graph_message_id = $1',
 *   [graphId]
 * );
 */
async function query(text, params) {
    return getPool().query(text, params);
}
/**
 * Acquire a client for multi-statement transactions.
 * Always call client.release() in a finally block.
 *
 * @example
 * const client = await getClient();
 * try {
 *   await client.query('BEGIN');
 *   // ...
 *   await client.query('COMMIT');
 * } catch (e) {
 *   await client.query('ROLLBACK');
 *   throw e;
 * } finally {
 *   client.release();
 * }
 */
async function getClient() {
    return getPool().connect();
}
