/**
 * Database Client Factory
 *
 * Supports three deployment modes:
 * 1. Free/offline (Electron, no login) — local libSQL file
 * 2. Cloud user (Electron, logged in) — embedded replica with Turso sync
 * 3. Web app (Next.js SaaS) — pure cloud libSQL
 */

import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MEMORY_SCHEMA_SQL, MEMORY_PRAGMA_SQL } from './schema';

let _client: Client | null = null;

/**
 * Get or create the Electron memory database client.
 * Uses local libSQL file by default; optionally syncs to Turso Cloud.
 *
 * @param tursoSyncUrl - Optional Turso Cloud sync URL for cloud users
 * @param authToken - Required when tursoSyncUrl is provided
 */
export async function getMemoryClient(
  tursoSyncUrl?: string,
  authToken?: string,
): Promise<Client> {
  if (_client) return _client;

  // Lazy import electron to avoid issues in test environments
  const { app } = await import('electron');
  const localPath = join(app.getPath('userData'), 'memory.db');

  _client = createClient({
    url: `file:${localPath}`,
    ...(tursoSyncUrl && authToken
      ? { syncUrl: tursoSyncUrl, authToken, syncInterval: 60 }
      : {}),
  });

  // Apply WAL and other PRAGMAs first (must be separate execute calls)
  for (const pragma of MEMORY_PRAGMA_SQL.split('\n').filter(l => l.trim())) {
    try {
      await _client.execute(pragma);
    } catch {
      // Some PRAGMAs may not be supported in all libSQL modes — ignore
    }
  }

  // Initialize schema (idempotent — uses CREATE IF NOT EXISTS throughout)
  await _client.executeMultiple(MEMORY_SCHEMA_SQL);

  // Load sqlite-vec extension for local mode only.
  // Cloud Turso has built-in vector support (DiskANN) — no extension needed.
  if (!tursoSyncUrl) {
    try {
      // Determine vec0 extension path
      // In ESM bundles __dirname is not available; derive from import.meta.url
      const currentDir = dirname(fileURLToPath(import.meta.url));
      const vecExtPath = app.isPackaged
        ? join(process.resourcesPath, 'extensions', 'vec0')
        : join(currentDir, '..', '..', 'node_modules', 'sqlite-vec', 'vec0');
      await _client.execute(`SELECT load_extension('${vecExtPath}')`);
    } catch (err) {
      // sqlite-vec may not be bundled yet — log warning but don't crash
      console.warn('[MemoryDB] Failed to load sqlite-vec extension:', err);
    }
  }

  return _client;
}

/**
 * Close and reset the singleton client.
 * Call this on app quit or when switching projects.
 */
export async function closeMemoryClient(): Promise<void> {
  if (_client) {
    _client.close();
    _client = null;
  }
}

/**
 * Get a web app (Next.js) memory client for pure cloud access.
 * Not a singleton — each call creates a new client.
 *
 * @param tursoUrl - Turso Cloud database URL
 * @param authToken - Auth token for the database
 */
export async function getWebMemoryClient(
  tursoUrl: string,
  authToken: string,
): Promise<Client> {
  const client = createClient({ url: tursoUrl, authToken });

  // Apply PRAGMAs
  for (const pragma of MEMORY_PRAGMA_SQL.split('\n').filter(l => l.trim())) {
    try {
      await client.execute(pragma);
    } catch {
      // Ignore unsupported PRAGMAs in cloud mode
    }
  }

  await client.executeMultiple(MEMORY_SCHEMA_SQL);
  return client;
}

/**
 * Create an in-memory client (for tests — no Electron dependency).
 */
export async function getInMemoryClient(): Promise<Client> {
  const client = createClient({ url: ':memory:' });
  await client.executeMultiple(MEMORY_SCHEMA_SQL);
  return client;
}
