/**
 * AI Auth Resolver
 *
 * Multi-stage credential resolution for Vercel AI SDK providers.
 * Reuses existing claude-profile/credential-utils.ts for OAuth token retrieval.
 *
 * Fallback chain (in priority order):
 * 1. Profile-specific OAuth token (from credential-utils keychain/credential store)
 * 2. Profile-specific API key (from app settings)
 * 3. Environment variable (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
 * 4. Default provider credentials (no-auth for Ollama, etc.)
 *
 * This module does NOT rewrite credential storage — it imports from
 * existing claude-profile/ utilities.
 */

import { getCredentialsFromKeychain } from '../../claude-profile/credential-utils';
import type { SupportedProvider } from '../providers/types';
import type { AuthResolverContext, ResolvedAuth } from './types';
import {
  PROVIDER_BASE_URL_ENV,
  PROVIDER_ENV_VARS,
  PROVIDER_SETTINGS_KEY,
} from './types';

// ============================================
// Settings Accessor
// ============================================

/**
 * Function type for retrieving a global API key from app settings.
 * Injected to avoid circular dependency on settings-store.
 */
type SettingsAccessor = (key: string) => string | undefined;

let _getSettingsValue: SettingsAccessor | null = null;

/**
 * Register a settings accessor function.
 * Called once during app initialization to wire up settings access.
 *
 * @param accessor - Function that retrieves a value from AppSettings by key
 */
export function registerSettingsAccessor(accessor: SettingsAccessor): void {
  _getSettingsValue = accessor;
}

// ============================================
// Stage 1: Profile OAuth Token
// ============================================

/**
 * Attempt to resolve credentials from the profile's OAuth token store.
 * Only applicable for Anthropic provider (Claude profiles use OAuth).
 *
 * @param ctx - Auth resolution context
 * @returns Resolved auth or null if not available
 */
function resolveFromProfileOAuth(ctx: AuthResolverContext): ResolvedAuth | null {
  if (ctx.provider !== 'anthropic') return null;

  try {
    const credentials = getCredentialsFromKeychain(ctx.configDir);
    if (credentials.token) {
      const resolved: ResolvedAuth = {
        apiKey: credentials.token,
        source: 'profile-oauth',
      };

      // Check for custom base URL from environment (profile may set ANTHROPIC_BASE_URL)
      const baseUrlEnv = PROVIDER_BASE_URL_ENV[ctx.provider];
      if (baseUrlEnv) {
        const baseURL = process.env[baseUrlEnv];
        if (baseURL) resolved.baseURL = baseURL;
      }

      // Check for auth token header (enterprise proxy setups)
      const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
      if (authToken) {
        resolved.headers = { 'X-Auth-Token': authToken };
      }

      return resolved;
    }
  } catch {
    // Keychain access failed (locked, permission denied, etc.) — fall through
  }

  return null;
}

// ============================================
// Stage 2: Profile API Key (from settings)
// ============================================

/**
 * Attempt to resolve credentials from profile-specific API key in app settings.
 *
 * @param ctx - Auth resolution context
 * @returns Resolved auth or null if not available
 */
function resolveFromProfileApiKey(ctx: AuthResolverContext): ResolvedAuth | null {
  if (!_getSettingsValue) return null;

  const settingsKey = PROVIDER_SETTINGS_KEY[ctx.provider];
  if (!settingsKey) return null;

  const apiKey = _getSettingsValue(settingsKey);
  if (!apiKey) return null;

  const resolved: ResolvedAuth = {
    apiKey,
    source: 'profile-api-key',
  };

  const baseUrlEnv = PROVIDER_BASE_URL_ENV[ctx.provider];
  if (baseUrlEnv) {
    const baseURL = process.env[baseUrlEnv];
    if (baseURL) resolved.baseURL = baseURL;
  }

  return resolved;
}

// ============================================
// Stage 3: Environment Variable
// ============================================

/**
 * Attempt to resolve credentials from environment variables.
 *
 * @param ctx - Auth resolution context
 * @returns Resolved auth or null if not available
 */
function resolveFromEnvironment(ctx: AuthResolverContext): ResolvedAuth | null {
  const envVar = PROVIDER_ENV_VARS[ctx.provider];
  if (!envVar) return null;

  const apiKey = process.env[envVar];
  if (!apiKey) return null;

  const resolved: ResolvedAuth = {
    apiKey,
    source: 'environment',
  };

  const baseUrlEnv = PROVIDER_BASE_URL_ENV[ctx.provider];
  if (baseUrlEnv) {
    const baseURL = process.env[baseUrlEnv];
    if (baseURL) resolved.baseURL = baseURL;
  }

  return resolved;
}

// ============================================
// Stage 4: Default Provider Credentials
// ============================================

/** Providers that work without explicit authentication */
const NO_AUTH_PROVIDERS = new Set<SupportedProvider>([
  'ollama',
]);

/**
 * Attempt to resolve default credentials for providers that don't require auth.
 *
 * @param ctx - Auth resolution context
 * @returns Resolved auth or null if provider requires auth
 */
function resolveDefaultCredentials(ctx: AuthResolverContext): ResolvedAuth | null {
  if (!NO_AUTH_PROVIDERS.has(ctx.provider)) return null;

  return {
    apiKey: '',
    source: 'default',
  };
}

// ============================================
// Public API
// ============================================

/**
 * Resolve authentication credentials for a given provider and profile.
 *
 * Walks the multi-stage fallback chain in priority order:
 * 1. Profile OAuth token (Anthropic only, from system keychain)
 * 2. Profile API key (from app settings)
 * 3. Environment variable
 * 4. Default provider credentials (no-auth providers like Ollama)
 *
 * @param ctx - Auth resolution context (provider, profileId, configDir)
 * @returns Resolved auth credentials, or null if no credentials found
 */
export function resolveAuth(ctx: AuthResolverContext): ResolvedAuth | null {
  return (
    resolveFromProfileOAuth(ctx) ??
    resolveFromProfileApiKey(ctx) ??
    resolveFromEnvironment(ctx) ??
    resolveDefaultCredentials(ctx) ??
    null
  );
}

/**
 * Check if credentials are available for a provider without returning them.
 * Useful for UI validation and provider availability checks.
 *
 * @param ctx - Auth resolution context
 * @returns True if credentials can be resolved
 */
export function hasCredentials(ctx: AuthResolverContext): boolean {
  return resolveAuth(ctx) !== null;
}
