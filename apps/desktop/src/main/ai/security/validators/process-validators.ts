/**
 * Process Management Validators
 * ==============================
 *
 * Validators for process management commands (pkill, kill, killall).
 *
 * Ported from: apps/backend/security/process_validators.py
 */

import type { ValidationResult } from '../bash-validator';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Allowed development process names */
const ALLOWED_PROCESS_NAMES = new Set([
  // Node.js ecosystem
  'node',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'bun',
  'deno',
  'vite',
  'next',
  'nuxt',
  'webpack',
  'esbuild',
  'rollup',
  'tsx',
  'ts-node',
  // Python ecosystem
  'python',
  'python3',
  'flask',
  'uvicorn',
  'gunicorn',
  'django',
  'celery',
  'streamlit',
  'gradio',
  'pytest',
  'mypy',
  'ruff',
  // Other languages
  'cargo',
  'rustc',
  'go',
  'ruby',
  'rails',
  'php',
  // Databases (local dev)
  'postgres',
  'mysql',
  'mongod',
  'redis-server',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple shell-like tokenizer — splits on whitespace, respects single/double quotes.
 * Returns null if parsing fails (unclosed quotes, etc.).
 */
function shellSplit(input: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;

  while (i < input.length) {
    const ch = input[i];

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
      i++;
      continue;
    }

    if (inDouble) {
      if (ch === '\\' && i + 1 < input.length) {
        current += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      } else {
        current += ch;
      }
      i++;
      continue;
    }

    if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      i++;
      continue;
    }
    current += ch;
    i++;
  }

  if (inSingle || inDouble) {
    return null; // Unclosed quote
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate pkill commands — only allow killing dev-related processes.
 *
 * Ported from: validate_pkill_command()
 */
export function validatePkillCommand(commandString: string): ValidationResult {
  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse pkill command'];
  }

  if (tokens.length === 0) {
    return [false, 'Empty pkill command'];
  }

  // Separate flags from arguments
  const args: string[] = [];
  for (const token of tokens.slice(1)) {
    if (!token.startsWith('-')) {
      args.push(token);
    }
  }

  if (args.length === 0) {
    return [false, 'pkill requires a process name'];
  }

  // The target is typically the last non-flag argument
  let target = args[args.length - 1];

  // For -f flag (full command line match), extract the first word
  if (target.includes(' ')) {
    target = target.split(' ')[0];
  }

  if (ALLOWED_PROCESS_NAMES.has(target)) {
    return [true, ''];
  }

  const sortedSample = [...ALLOWED_PROCESS_NAMES].sort().slice(0, 10);
  return [
    false,
    `pkill only allowed for dev processes: ${sortedSample.join(', ')}...`,
  ];
}

/**
 * Validate kill commands — allow killing by PID (user must know the PID).
 *
 * Ported from: validate_kill_command()
 */
export function validateKillCommand(commandString: string): ValidationResult {
  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse kill command'];
  }

  // Block kill -1 (kill all processes) and kill 0 / kill -0
  for (const token of tokens.slice(1)) {
    if (token === '-1' || token === '0' || token === '-0') {
      return [
        false,
        'kill -1 and kill 0 are not allowed (affects all processes)',
      ];
    }
  }

  return [true, ''];
}

/**
 * Validate killall commands — same rules as pkill.
 *
 * Ported from: validate_killall_command()
 */
export function validateKillallCommand(
  commandString: string,
): ValidationResult {
  return validatePkillCommand(commandString);
}
