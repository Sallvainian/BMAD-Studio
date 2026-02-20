# Authentication Architecture Research: Multi-Provider AI SDK Migration

**Date:** 2026-02-20
**Research scope:** Authentication refactor for Auto Claude migrating from Python claude-agent-sdk to TypeScript Vercel AI SDK v6 with 9+ providers.

---

## 1. Current State Analysis

### 1.1 What exists today

The existing auth system is sophisticated and Claude-specific, split across several modules in `apps/frontend/src/main/claude-profile/`:

**credential-utils.ts**
- Reads OAuth credentials from OS keychain (macOS Keychain via `security` CLI, Windows Credential Manager via PowerShell, Linux Secret Service via `secret-tool`, fallback to `.credentials.json`)
- Supports named profile directories — each profile is identified by its `CLAUDE_CONFIG_DIR` path, hashed to derive a unique keychain service name (`"Claude Code-credentials-{sha256-8-hash}"`)
- Returns structured credential objects: `{ token, refreshToken, expiresAt, email, scopes }`
- Provides `getCredentialsFromKeychain(configDir)`, `getFullCredentialsFromKeychain(configDir)`, `updateKeychainCredentials(configDir, creds)`, and `clearKeychainCache(configDir)`

**token-refresh.ts**
- Calls `https://console.anthropic.com/v1/oauth/token` with `grant_type=refresh_token`
- Uses the public Claude Code OAuth client ID: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- Exports `ensureValidToken(configDir)` — proactive refresh 30 minutes before expiry
- Exports `reactiveTokenRefresh(configDir)` — called on 401 responses
- Handles retry with exponential backoff (2 retries), permanent error detection (`invalid_grant` = needs re-auth), and critical write-back of new tokens to keychain immediately after refresh (old token is revoked instantly)

**usage-monitor.ts**
- `UsageMonitor` singleton polls usage every 30 seconds
- Supports multiple providers: Anthropic (`/api/oauth/usage`), z.ai, ZHIPU (quota/limit endpoints)
- Implements proactive profile swapping when usage crosses thresholds (95% session, 99% weekly)
- Fetches usage for inactive profiles in parallel using their own stored credentials
- Normalizes usage responses across providers to `ClaudeUsageSnapshot`
- Emits events: `usage-updated`, `all-profiles-usage-updated`, `proactive-swap-completed`, `proactive-operations-restarted`

**profile-scorer.ts**
- Unified account scoring across OAuth profiles and API key profiles
- Selection algorithm: filter by availability (auth state, rate limit, threshold), sort by user-configured priority order, fall back to "least bad" option
- Scoring: base 100, -1000 unauthenticated, -500 weekly rate limit, -200 session rate limit, proportional usage penalties
- `getBestAvailableUnifiedAccount()` works across both `ClaudeProfile` (OAuth) and `APIProfile` (API key) types

### 1.2 The new TS auth layer (partially complete)

**ai/auth/types.ts** — clean type definitions:
- `AuthSource`: `'profile-oauth' | 'profile-api-key' | 'environment' | 'default' | 'none'`
- `ResolvedAuth`: `{ apiKey, source, baseURL?, headers? }`
- `AuthResolverContext`: `{ provider, profileId?, configDir? }`
- `PROVIDER_ENV_VARS`, `PROVIDER_SETTINGS_KEY`, `PROVIDER_BASE_URL_ENV` mappings for all 9 providers

**ai/auth/resolver.ts** — 4-stage fallback chain:
1. Profile OAuth token (Anthropic only, via `getCredentialsFromKeychain`)
2. Profile API key (from app settings via injected `SettingsAccessor`)
3. Environment variable (e.g., `ANTHROPIC_API_KEY`)
4. Default credentials (empty string for Ollama/no-auth providers)

**ai/providers/factory.ts** — maps `ProviderConfig` to AI SDK provider instances via `createAnthropic`, `createOpenAI`, etc.

**ai/providers/registry.ts** — builds a `createProviderRegistry()` from a `RegistryConfig` map

**ai/client/factory.ts** — `createAgentClient()` and `createSimpleClient()` call `resolveAuth()` synchronously, currently hard-coded to `provider: 'anthropic'`

**ai/session/runner.ts** — `runAgentSession()` accepts `onAuthRefresh?: () => Promise<string | null>` callback for reactive token refresh on 401

### 1.3 Key gap: Missing token refresh in the TS path

The resolver (`resolver.ts`) calls `getCredentialsFromKeychain` (synchronous, no refresh). It does NOT call `ensureValidToken` (async, with refresh). This means:
- Tokens are read but never proactively refreshed
- The 401 retry in `runner.ts` calls `onAuthRefresh` but this callback is never wired up in `client/factory.ts`
- Profile swapping logic in `UsageMonitor` is entirely disconnected from the new agent worker path

---

## 2. Claude Code OSS Authentication Patterns

### 2.1 What Claude Code does

From official docs and OSS issue analysis:

**Credential storage:** macOS Keychain, Windows Credential Manager, Linux Secret Service, `.credentials.json` fallback. Exact same approach as the existing `credential-utils.ts`.

**Token structure stored in `.credentials.json`:**
```json
{
  "access_token": "sk-ant-oa...",
  "refresh_token": "sk-ant-ort01-...",
  "expires_in": 28800,
  "token_type": "Bearer",
  "scopes": ["user:inference", "user:profile"]
}
```

**Token refresh:** Claude Code calls `https://console.anthropic.com/v1/oauth/token` with `refresh_token` grant. The `token-refresh.ts` module already mirrors this correctly.

**`apiKeyHelper` pattern:** Claude Code supports a shell script `apiKeyHelper` in settings that returns an API key on demand. It is called after 5 minutes or on 401, configurable via `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`. This is the Claude Code approach to dynamic credential refreshing — a callback-based pull pattern.

**OAuth scope restriction (critical limitation):** Anthropic explicitly restricts Claude Code OAuth tokens to the `user:inference` scope for internal use only. Third-party tools (opencode, NanoClaw, etc.) were blocked in late 2025 from using these tokens. Anthropic requires `claude-code-20250219` beta header for Claude Code-scoped OAuth access. The `@ai-sdk/anthropic` provider's `authToken` parameter (which sends `Authorization: Bearer`) does work with Anthropic's API when the token is a valid OAuth token — but the token must have been issued with the correct scopes.

**What this means for Auto Claude:** Auto Claude already uses the keychain to get OAuth tokens and passes them as the `apiKey` parameter to `createAnthropic({ apiKey: token })`. This works because Anthropic's `x-api-key` header also accepts OAuth tokens. However, to be safe and future-proof, using `authToken` instead of `apiKey` for OAuth tokens is semantically more correct — `authToken` maps to `Authorization: Bearer`, which is the standard OAuth 2.0 transport.

### 2.2 Required beta headers for OAuth

When calling Anthropic's API with OAuth tokens, the following headers are required:

```
anthropic-beta: oauth-2025-04-20
anthropic-version: 2023-06-01
```

The `claude-code-20250219` beta header is additionally needed only if accessing Claude Code-specific subscription routing. For direct `user:inference` calls, only `oauth-2025-04-20` is required.

The existing `UsageMonitor` already injects `anthropic-beta: oauth-2025-04-20` for usage API calls. The agent session path needs to inject the same header when using OAuth tokens.

### 2.3 Patterns we can adopt

1. **`apiKeyHelper` callback pattern** — Claude Code's `CLAUDE_CODE_API_KEY_HELPER_TTL_MS` + `apiKeyHelper` is equivalent to the `onAuthRefresh` callback already designed in `runner.ts`. Wire this up properly.

2. **Credential write-back on refresh** — Token refresh in `token-refresh.ts` already handles this correctly: write new tokens immediately, old token is revoked instantly.

3. **Profile-scoped config dirs** — The keychain keying by SHA256 hash of config dir is the right approach for multi-profile support. Keep this.

---

## 3. Vercel AI SDK Authentication Patterns

### 3.1 Per-provider auth interfaces

Each `@ai-sdk/*` provider package exposes a `create*` factory that accepts:
- `apiKey?: string` — sent as `x-api-key` (Anthropic) or `Authorization: Bearer` (OpenAI, Google, etc.)
- `authToken?: string` — sent as `Authorization: Bearer` (Anthropic-specific alternative to apiKey)
- `baseURL?: string` — overrides the default API endpoint
- `headers?: Record<string, string>` — additional headers added after auth headers

There is NO unified auth interface across providers. Each provider is initialized independently with its own credentials. The `createProviderRegistry()` accepts pre-configured provider instances.

**Key insight:** Provider instances are created at startup with static credentials. There is no built-in mechanism to swap credentials mid-session. Token refresh requires creating a new provider instance.

### 3.2 The middleware pattern for auth injection

`wrapLanguageModel({ model, middleware })` allows intercepting calls:

```typescript
const middleware: LanguageModelMiddleware = {
  wrapGenerate: async ({ doGenerate, params }) => {
    // Can modify params before the call
    // Cannot modify HTTP headers directly (that's provider-level)
    const result = await doGenerate(params);
    return result;
  },
};
```

**Limitation:** Middleware operates at the params level, not the HTTP level. It cannot inject or refresh auth headers. Auth must happen at provider creation time.

### 3.3 Pattern for dynamic auth refresh

Since provider instances carry static credentials, the correct pattern for token refresh is:

```typescript
// On 401, create a new provider instance with the refreshed token
async function onAuthRefresh(): Promise<string | null> {
  const result = await reactiveTokenRefresh(configDir);
  if (!result.token) return null;
  // Recreate the provider with the new token
  // The next retry in runner.ts will use the new model instance
  return result.token;
}
```

However, `runner.ts` currently passes `config.model` as a fixed reference to `executeStream`. After a token refresh, the model instance (with the old token) would be reused. This is a gap that needs fixing.

### 3.4 Rate limiting behavior

The Vercel AI SDK does NOT automatically retry on 429 errors with provider-specific backoff. It throws `AI_APICallError` or provider-specific error types. The retry loop must be implemented by the caller — which is already the design intent with the `onAuthRefresh` pattern, but needs to be extended to handle 429 / rate-limit-triggered provider switching.

---

## 4. Minimal Change for Anthropic Auth Through the TS Worker Path

This is the smallest set of changes to get Anthropic working correctly through the new TypeScript agent layer, with proactive token refresh and reactive 401 recovery.

### 4.1 Fix 1: Make resolver async and call ensureValidToken

**File:** `apps/frontend/src/main/ai/auth/resolver.ts`

Change `resolveFromProfileOAuth` from synchronous to async and call `ensureValidToken`:

```typescript
// BEFORE (broken: no refresh)
function resolveFromProfileOAuth(ctx: AuthResolverContext): ResolvedAuth | null {
  const credentials = getCredentialsFromKeychain(ctx.configDir);
  if (credentials.token) {
    return { apiKey: credentials.token, source: 'profile-oauth' };
  }
  return null;
}

// AFTER (correct: proactive refresh)
async function resolveFromProfileOAuth(ctx: AuthResolverContext): Promise<ResolvedAuth | null> {
  if (ctx.provider !== 'anthropic') return null;
  try {
    const tokenResult = await ensureValidToken(ctx.configDir);
    if (tokenResult.token) {
      return {
        apiKey: tokenResult.token,
        source: 'profile-oauth',
        // OAuth tokens need the beta header for Anthropic API
        headers: { 'anthropic-beta': 'oauth-2025-04-20' },
      };
    }
  } catch {
    // Fall through to other stages
  }
  return null;
}

// Make resolveAuth async
export async function resolveAuth(ctx: AuthResolverContext): Promise<ResolvedAuth | null> {
  return (
    (await resolveFromProfileOAuth(ctx)) ??
    resolveFromProfileApiKey(ctx) ??
    resolveFromEnvironment(ctx) ??
    resolveDefaultCredentials(ctx) ??
    null
  );
}
```

### 4.2 Fix 2: Wire up onAuthRefresh in client/factory.ts

**File:** `apps/frontend/src/main/ai/client/factory.ts`

The `createAgentClient` function needs to return an `onAuthRefresh` callback that recreates the model with a fresh token:

```typescript
// Add to AgentClientResult type
export interface AgentClientResult {
  model: LanguageModel;
  tools: Record<string, AITool>;
  mcpClients: McpClientResult[];
  systemPrompt: string;
  maxSteps: number;
  thinkingLevel: ThinkingLevel;
  cleanup: () => Promise<void>;
  // NEW: Reactive auth refresh callback
  onAuthRefresh?: () => Promise<string | null>;
}

// Inside createAgentClient, after model creation:
const configDir = /* resolve from profile */ undefined;

const onAuthRefresh = async (): Promise<string | null> => {
  const result = await reactiveTokenRefresh(configDir);
  return result.token ?? null;
};

return {
  model,
  tools,
  mcpClients,
  systemPrompt,
  maxSteps,
  thinkingLevel: resolvedThinkingLevel,
  cleanup,
  onAuthRefresh,
};
```

### 4.3 Fix 3: Recreate model on auth refresh in runner.ts

**File:** `apps/frontend/src/main/ai/session/runner.ts`

The `runAgentSession` loop needs to recreate the model instance after a successful token refresh. Currently it retries with the old model (stale token):

```typescript
// Add to RunnerOptions
export interface RunnerOptions {
  onEvent?: SessionEventCallback;
  onAuthRefresh?: () => Promise<string | null>;
  // NEW: Factory to recreate model with new token
  onModelRefresh?: (newToken: string) => LanguageModel;
  tools?: Record<string, AITool>;
}

// In the retry loop:
if (isAuthenticationError(error) && authRetries < MAX_AUTH_RETRIES && onAuthRefresh) {
  authRetries++;
  const newToken = await onAuthRefresh();
  if (!newToken) {
    // ... return auth failure
  }
  // Recreate model with new token if factory provided
  if (options.onModelRefresh) {
    config = { ...config, model: options.onModelRefresh(newToken) };
  }
  continue;
}
```

### 4.4 Fix 4: Add oauth-2025-04-20 header for OAuth-sourced tokens

When `auth.source === 'profile-oauth'`, the `@ai-sdk/anthropic` provider must include `anthropic-beta: oauth-2025-04-20`. The current `resolver.ts` already returns `headers` but the provider factory must pass them:

```typescript
// In factory.ts createProviderInstance for Anthropic:
case SupportedProvider.Anthropic:
  return createAnthropic({
    // If token is an OAuth token, use authToken (Authorization: Bearer)
    // If token is an API key (sk-ant-api...), use apiKey (x-api-key)
    ...(isOAuthToken(config.apiKey)
      ? { authToken: config.apiKey }
      : { apiKey: config.apiKey }),
    baseURL,
    headers,
  });
```

Helper to detect OAuth vs API key:
```typescript
function isOAuthToken(token: string | undefined): boolean {
  if (!token) return false;
  // OAuth access tokens start with 'sk-ant-oa' prefix
  // Refresh tokens start with 'sk-ant-ort'
  // API keys start with 'sk-ant-api'
  return token.startsWith('sk-ant-oa') || token.startsWith('sk-ant-ort');
}
```

---

## 5. Full Multi-Provider Auth Design

### 5.1 Architecture overview

The architecture divides auth concerns into three layers:

```
Layer 1: Credential Storage (per-provider)
  - Anthropic OAuth: claude-profile/ (existing keychain system)
  - Anthropic API key: profile settings / env var
  - OpenAI API key: profile settings / env var
  - Google API key: profile settings / env var
  - All others: profile settings / env var / OS env

Layer 2: Auth Resolution (unified)
  - resolver.ts: multi-stage fallback for any provider
  - Token refresh only for Anthropic OAuth (other providers use static keys)
  - Rate limit awareness: resolver can return null to trigger profile swap

Layer 3: Profile Management (provider-aware)
  - Existing claude-profile/ handles OAuth profiles (Claude subscriptions)
  - Existing services/profile/ handles API profiles (any provider with API key)
  - UsageMonitor gates profile swapping by usage thresholds
  - ProfileScorer selects best available account across both types
```

### 5.2 Unified credential interface

Define a `ProviderCredential` type that every provider's auth resolves to:

```typescript
// apps/frontend/src/main/ai/auth/types.ts (extended)

export interface ProviderCredential {
  provider: SupportedProvider;
  // The credential value (API key, OAuth token, or empty string for no-auth)
  credential: string;
  // How the credential should be sent to the provider
  credentialType: 'api-key' | 'bearer-token' | 'none';
  // Optional custom endpoint
  baseURL?: string;
  // Provider-specific headers (e.g., anthropic-beta for OAuth)
  headers?: Record<string, string>;
  // Where the credential came from
  source: AuthSource;
  // For OAuth: expiry tracking to know when to refresh
  expiresAt?: number;
  // Profile this credential belongs to (for swap tracking)
  profileId?: string;
}
```

### 5.3 Provider-specific auth implementations

**Anthropic OAuth (existing claude-profile):**
```typescript
async function resolveAnthropicOAuth(configDir?: string): Promise<ProviderCredential | null> {
  const result = await ensureValidToken(configDir);
  if (!result.token) return null;
  return {
    provider: 'anthropic',
    credential: result.token,
    credentialType: 'bearer-token',
    headers: { 'anthropic-beta': 'oauth-2025-04-20' },
    source: 'profile-oauth',
    expiresAt: /* from token refresh result */,
  };
}
```

**Anthropic API key (from settings or env):**
```typescript
function resolveAnthropicApiKey(settingsAccessor?: SettingsAccessor): ProviderCredential | null {
  const key = settingsAccessor?.('globalAnthropicApiKey') ?? process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return {
    provider: 'anthropic',
    credential: key,
    credentialType: 'api-key',
    source: settingsAccessor ? 'profile-api-key' : 'environment',
  };
}
```

**OpenAI, Google, Mistral, Groq, xAI (all API key only):**
```typescript
function resolveApiKeyProvider(
  provider: SupportedProvider,
  envVar: string,
  settingsKey?: string,
  settingsAccessor?: SettingsAccessor
): ProviderCredential | null {
  const key = (settingsKey && settingsAccessor?.(settingsKey)) ?? process.env[envVar];
  if (!key) return null;
  return {
    provider,
    credential: key,
    credentialType: 'api-key',
    source: settingsKey && settingsAccessor?.(settingsKey) ? 'profile-api-key' : 'environment',
  };
}
```

**AWS Bedrock (credential chain, not a single key):**
```typescript
function resolveBedrockCredential(): ProviderCredential {
  // Bedrock uses AWS SDK credential chain (env vars, ~/.aws/credentials, IAM role)
  // No single API key — the SDK resolves credentials automatically
  return {
    provider: 'bedrock',
    credential: '',
    credentialType: 'none',
    source: 'environment',
  };
}
```

**Ollama (no auth):**
```typescript
function resolveOllamaCredential(): ProviderCredential {
  return {
    provider: 'ollama',
    credential: '',
    credentialType: 'none',
    source: 'default',
  };
}
```

### 5.4 Provider factory updated for credential types

```typescript
// apps/frontend/src/main/ai/providers/factory.ts

function createProviderInstance(config: ProviderConfig, credential: ProviderCredential) {
  const { baseURL, headers } = config;
  const mergedHeaders = { ...credential.headers, ...headers };

  switch (config.provider) {
    case SupportedProvider.Anthropic:
      // Differentiate OAuth bearer vs API key
      if (credential.credentialType === 'bearer-token') {
        return createAnthropic({
          authToken: credential.credential,  // -> Authorization: Bearer
          baseURL,
          headers: mergedHeaders,
        });
      }
      return createAnthropic({
        apiKey: credential.credential,       // -> x-api-key
        baseURL,
        headers: mergedHeaders,
      });

    case SupportedProvider.OpenAI:
      return createOpenAI({
        apiKey: credential.credential,
        baseURL,
        headers: mergedHeaders,
      });

    // ... other providers follow their existing pattern
  }
}
```

### 5.5 Preserving profile swapping across providers

Profile swapping currently works only for OAuth profiles via `UsageMonitor`. To extend it to all providers:

**Option A: Provider-parallel profile systems (recommended for now)**

Keep the existing `claude-profile/` system for Anthropic OAuth profiles (profile swapping, usage tracking, rate limiting all work). Add a separate simple concept of "active API profile" from `services/profile/` for API-keyed providers.

The `resolveAuth` function is the switchboard:
1. If active profile is an OAuth profile: use `claude-profile/` → `ensureValidToken`
2. If active profile is an API profile: use `services/profile/` → get `apiKey` + `baseURL`

Profile swapping for OAuth profiles continues to work via `UsageMonitor`. API profiles do not have usage tracking (no API to query), so swapping is manual/explicit.

**Option B: Unified ProviderProfile system (future)**

Create a `ProviderProfile` type that unifies OAuth and API key profiles:
```typescript
interface ProviderProfile {
  id: string;
  name: string;
  provider: SupportedProvider;
  authType: 'oauth' | 'api-key' | 'bedrock' | 'no-auth';
  // For oauth: configDir points to keychain entry
  configDir?: string;
  // For api-key: the encrypted/stored key
  apiKey?: string;
  // For bedrock: region + role ARN
  region?: string;
  roleArn?: string;
  // For openai-compatible: custom base URL
  baseURL?: string;
  // Scoring and availability
  isAuthenticated: boolean;
  isRateLimited: boolean;
  usage?: ProviderUsage;
}
```

This is a significant refactor and is only needed when you have multiple accounts per non-Anthropic provider to swap between. For most users, a single OpenAI key, a single Google key, etc. is sufficient.

**Recommendation:** Implement Option A now. It is the minimal change. Option B is a future optimization if users need multi-account non-Anthropic profile swapping.

### 5.6 Rate limiting and 429 handling

The Vercel AI SDK does NOT auto-retry on 429. The agent worker needs explicit handling:

```typescript
// In session/runner.ts — extended error handling
if (isRateLimitError(error)) {
  // Emit event to trigger profile swap at the orchestration level
  options.onRateLimit?.({
    profileId: config.profileId,
    retryAfter: extractRetryAfter(error),
  });
  // Return rate-limited outcome (orchestrator handles swap + restart)
  return buildErrorResult('rate_limited', sessionError, startTime);
}
```

The profile swap itself happens in `UsageMonitor.performProactiveSwap()` which is already implemented. The missing piece is connecting the worker thread 429 signal to the orchestrator which knows how to swap and restart.

### 5.7 Operation registry integration

The existing `OperationRegistry` in `claude-profile/operation-registry.ts` tracks running operations per profile. When a proactive swap fires, it calls `restartOperationsOnProfile()`. This mechanism works at the Python level today.

For the TypeScript worker path, the `WorkerBridge` (in `ai/agent/worker-bridge.ts`) needs to register operations with the operation registry so swaps can restart them with new credentials.

---

## 6. Migration Path

### Phase 1: Minimal Anthropic fix (unblocks current task)

1. Make `resolveAuth` async, call `ensureValidToken` instead of raw keychain read.
2. Add `oauth-2025-04-20` header when source is `profile-oauth`.
3. Wire `onAuthRefresh` callback from `createAgentClient` through to `runAgentSession`.
4. Fix model recreation after token refresh in `runner.ts` (don't reuse stale model instance).
5. Test: start an agent session with an OAuth profile, wait for near-expiry, verify proactive refresh fires.

**Files changed:** `ai/auth/resolver.ts`, `ai/client/factory.ts`, `ai/session/runner.ts`

### Phase 2: API profile auth for non-Anthropic providers

6. Update `resolver.ts` to handle all 9 providers via their settings keys / env vars.
7. Update `factory.ts` `createProviderInstance` to use `credentialType` to pick `apiKey` vs `authToken`.
8. Add `baseURL` passthrough from API profile settings (needed for z.ai, custom OpenAI proxies).
9. Test: configure an OpenAI API key in settings, run an agent session with `provider: 'openai'`.

**Files changed:** `ai/auth/resolver.ts`, `ai/providers/factory.ts`, `ai/providers/types.ts`

### Phase 3: Profile swapping integration

10. Connect `WorkerBridge` events to `OperationRegistry` so workers are registered as active operations.
11. Add `onRateLimit` callback to `RunnerOptions`; emit from the 429 handler.
12. Wire `onRateLimit` in the orchestration layer (`build-orchestrator.ts`) to trigger `UsageMonitor.performProactiveSwap`.
13. After swap, restart the affected operation with new profile credentials.
14. Test: simulate 429 on active profile, verify swap to backup profile, verify operation restarts.

**Files changed:** `ai/agent/worker-bridge.ts`, `ai/session/runner.ts`, `ai/orchestration/build-orchestrator.ts`

### Phase 4: Usage monitoring for API profiles (optional)

15. Extend `UsageMonitor` to query per-provider usage APIs if available (OpenAI has `/v1/usage`, Google has billing API, others vary).
16. For providers without usage APIs, implement request-count-based rate limit detection from 429 headers.
17. Add scoring for API profiles based on rate limit signals (since there are no subscription percent metrics).

**Files changed:** `claude-profile/usage-monitor.ts`

---

## 7. Key Decisions and Recommendations

### Decision 1: Keep claude-profile/ for Anthropic OAuth, no rewrite needed

The existing `claude-profile/` system is production-grade. It handles keychain storage, token refresh, usage tracking, proactive swapping, and scoring. The migration task is to wire it into the new TypeScript agent path — not replace it.

**Action:** Import `ensureValidToken` and `reactiveTokenRefresh` from `claude-profile/token-refresh.ts` directly in the new auth resolver.

### Decision 2: Use authToken (not apiKey) for OAuth tokens with Anthropic

Anthropic's `@ai-sdk/anthropic` has two auth paths: `apiKey` (x-api-key header) and `authToken` (Authorization: Bearer). For OAuth tokens, `authToken` is semantically correct and matches the OAuth RFC 6750 standard. The `oauth-2025-04-20` beta header is required alongside it.

**Action:** Detect OAuth tokens by prefix (`sk-ant-oa`) and route to `authToken`; direct API keys to `apiKey`.

### Decision 3: No unified ProviderProfile system yet

The complexity of a unified profile type is not justified until there is a user need for swapping between multiple non-Anthropic accounts. The current two-track system (OAuth profiles for Claude subscriptions, API profiles for everything else) is sufficient for Phase 1-3.

**Action:** Keep the two-track system. The `resolveAuth` function is the integration point that bridges both tracks.

### Decision 4: Profile swapping stays in UsageMonitor

`UsageMonitor` with its `OperationRegistry` integration is the right place for profile swap orchestration. It fires events that the orchestration layer responds to. Do not duplicate this logic in the new TypeScript worker path.

**Action:** Extend `WorkerBridge` to register/deregister with `OperationRegistry`, so existing swap machinery can restart TS workers.

### Decision 5: Vercel AI SDK has no built-in auth middleware

The middleware API (`wrapLanguageModel`) operates at the params level, not HTTP. Auth refresh requires recreating provider instances. The `onAuthRefresh` callback pattern in `runner.ts` is correct — just needs the model recreation fix.

**Action:** In the auth retry loop, recreate the model instance using a factory function that injects the fresh token.

---

## 8. Open Questions

1. **Anthropic OAuth scope restrictions:** Anthropic has been actively restricting Claude Code OAuth tokens for third-party use. Auto Claude uses these tokens from the user's keychain (same as Claude Code CLI does), so it should be unaffected — but this is worth monitoring if Anthropic changes enforcement.

2. **Bedrock authentication:** AWS Bedrock uses the AWS credential chain (not a single API key). The current `createAmazonBedrock` call in `factory.ts` passes `apiKey` which is incorrect for IAM-based auth. This needs investigation before shipping Bedrock support.

3. **Multi-account non-Anthropic:** If users want to swap between two OpenAI API keys (e.g., different rate limit pools), the current architecture has no mechanism for this. Phase 4 would need to address it.

4. **Token expiry for non-OAuth providers:** API keys for OpenAI, Google, etc. do not expire. No refresh mechanism is needed. Only Anthropic OAuth tokens expire (8-hour access tokens).

---

## Sources Consulted

- [Anthropic Provider - ai-sdk.dev](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic) — `authToken`, `apiKey`, `headers` options
- [Claude Code Authentication Docs](https://code.claude.com/docs/en/authentication) — credential storage, `apiKeyHelper` pattern
- [Claude Code OAuth token race condition issue](https://github.com/anthropics/claude-code/issues/24317)
- [Claude Code OAuth refresh token on remote machines issue](https://github.com/anthropics/claude-code/issues/21765)
- [Vercel AI SDK GitHub](https://github.com/vercel/ai) — middleware API, provider patterns
- [OpenCode Anthropic auth deep wiki](https://deepwiki.com/sst/opencode-anthropic-auth) — OAuth PKCE flow, fetch interceptor pattern, required beta headers
- [Anthropic blocks third-party OAuth - HN discussion](https://news.ycombinator.com/item?id=46549823)
- [AI SDK middleware docs](https://ai-sdk.dev/docs/ai-sdk-core/middleware)
- [Vercel AI SDK rate limit discussion](https://github.com/vercel/ai/discussions/3387)
