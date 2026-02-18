/**
 * AI Configuration Types
 *
 * Ported from apps/backend/phase_config.py and apps/frontend/src/shared/constants/models.ts.
 * Provides model resolution maps, thinking budget configuration, and phase config types
 * for the Vercel AI SDK integration layer.
 */

import type { SupportedProvider } from '../providers/types';

// ============================================
// Model Shorthand Types
// ============================================

/** Valid model shorthands used throughout the application */
export type ModelShorthand = 'opus' | 'opus-1m' | 'opus-4.5' | 'sonnet' | 'haiku';

/** Valid thinking levels */
export type ThinkingLevel = 'low' | 'medium' | 'high';

/** Valid effort levels for adaptive thinking models */
export type EffortLevel = 'low' | 'medium' | 'high';

/** Execution phases for task pipeline */
export type Phase = 'spec' | 'planning' | 'coding' | 'qa';

// ============================================
// Model ID Mapping (mirrors phase_config.py)
// ============================================

/**
 * Model shorthand to full model ID mapping.
 * Must stay in sync with:
 * - apps/backend/phase_config.py MODEL_ID_MAP
 * - apps/frontend/src/shared/constants/models.ts MODEL_ID_MAP
 */
export const MODEL_ID_MAP: Record<ModelShorthand, string> = {
  opus: 'claude-opus-4-6',
  'opus-1m': 'claude-opus-4-6',
  'opus-4.5': 'claude-opus-4-5-20251101',
  sonnet: 'claude-sonnet-4-5-20250929',
  haiku: 'claude-haiku-4-5-20251001',
} as const;

/**
 * Model shorthand to required SDK beta headers.
 * Maps model shorthands that need special beta flags (e.g., 1M context window).
 */
export const MODEL_BETAS_MAP: Partial<Record<ModelShorthand, string[]>> = {
  'opus-1m': ['context-1m-2025-08-07'],
} as const;

// ============================================
// Thinking Budget (mirrors phase_config.py)
// ============================================

/**
 * Thinking level to budget tokens mapping.
 * Must stay in sync with:
 * - apps/backend/phase_config.py THINKING_BUDGET_MAP
 * - apps/frontend/src/shared/constants/models.ts THINKING_BUDGET_MAP
 */
export const THINKING_BUDGET_MAP: Record<ThinkingLevel, number> = {
  low: 1024,
  medium: 4096,
  high: 16384,
} as const;

/**
 * Effort level mapping for adaptive thinking models (e.g., Opus 4.6).
 * These models support effort-based routing.
 */
export const EFFORT_LEVEL_MAP: Record<EffortLevel, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
} as const;

/**
 * Models that support adaptive thinking via effort level.
 * These models get both max_thinking_tokens AND effort_level.
 */
export const ADAPTIVE_THINKING_MODELS: ReadonlySet<string> = new Set([
  'claude-opus-4-6',
]);

// ============================================
// Phase Configuration Types
// ============================================

/** Per-phase model configuration */
export interface PhaseModelConfig {
  spec: ModelShorthand;
  planning: ModelShorthand;
  coding: ModelShorthand;
  qa: ModelShorthand;
}

/** Per-phase thinking level configuration */
export interface PhaseThinkingConfig {
  spec: ThinkingLevel;
  planning: ThinkingLevel;
  coding: ThinkingLevel;
  qa: ThinkingLevel;
}

// ============================================
// Default Phase Configurations
// ============================================

/** Default phase models (matches 'Balanced' profile) */
export const DEFAULT_PHASE_MODELS: PhaseModelConfig = {
  spec: 'sonnet',
  planning: 'sonnet',
  coding: 'sonnet',
  qa: 'sonnet',
};

/** Default phase thinking levels */
export const DEFAULT_PHASE_THINKING: PhaseThinkingConfig = {
  spec: 'medium',
  planning: 'high',
  coding: 'medium',
  qa: 'high',
};

// ============================================
// Provider Model Mapping
// ============================================

/**
 * Maps model ID prefixes to their default provider.
 * Used to auto-detect which provider to use for a given model.
 */
export const MODEL_PROVIDER_MAP: Record<string, SupportedProvider> = {
  'claude-': 'anthropic',
  'gpt-': 'openai',
  'o1-': 'openai',
  'o3-': 'openai',
  'gemini-': 'google',
  'mistral-': 'mistral',
  'llama-': 'groq',
  'grok-': 'xai',
} as const;
