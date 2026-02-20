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

import { ensureValidToken, reactiveTokenRefresh } from '../../claude-profile/token-refresh';
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
 * Calls ensureValidToken() for proactive token refresh before expiry.
 *
 * @param ctx - Auth resolution context
 * @returns Resolved auth or null if not available
 */
async function resolveFromProfileOAuth(ctx: AuthResolverContext): Promise<ResolvedAuth | null> {
  if (ctx.provider !== 'anthropic') return null;

  try {
    const tokenResult = await ensureValidToken(ctx.configDir);
    if (tokenResult.token) {
      const resolved: ResolvedAuth = {
        apiKey: tokenResult.token,
        source: 'profile-oauth',
        // OAuth tokens require the beta header for Anthropic API
        headers: { 'anthropic-beta': 'oauth-2025-04-20' },
      };

      // Check for custom base URL from environment (profile may set ANTHROPIC_BASE_URL)
      const baseUrlEnv = PROVIDER_BASE_URL_ENV[ctx.provider];
      if (baseUrlEnv) {
        const baseURL = process.env[baseUrlEnv];
        if (baseURL) resolved.baseURL = baseURL;
      }

      return resolved;
    }
  } catch {
    // Token refresh failed (network, keychain locked, etc.) — fall through
  }

  return null;
}

/**
 * Perform a reactive OAuth token refresh (called on 401 errors).
 * Forces a refresh regardless of apparent token state.
 *
 * @param configDir - Config directory for the profile
 * @returns New token or null if refresh failed
 */
export async function refreshOAuthTokenReactive(configDir: string | undefined): Promise<string | null> {
  try {
    const result = await reactiveTokenRefresh(configDir);
    return result.token ?? null;
  } catch {
    return null;
  }
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
 * 1. Profile OAuth token (Anthropic only, from system keychain, with proactive refresh)
 * 2. Profile API key (from app settings)
 * 3. Environment variable
 * 4. Default provider credentials (no-auth providers like Ollama)
 *
 * @param ctx - Auth resolution context (provider, profileId, configDir)
 * @returns Resolved auth credentials, or null if no credentials found
 */
export async function resolveAuth(ctx: AuthResolverContext): Promise<ResolvedAuth | null> {
  return (
    (await resolveFromProfileOAuth(ctx)) ??
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
export async function hasCredentials(ctx: AuthResolverContext): Promise<boolean> {
  return (await resolveAuth(ctx)) !== null;
}
