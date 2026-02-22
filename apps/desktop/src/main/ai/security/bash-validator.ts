/**
 * Bash Security Validator
 * =======================
 *
 * Pre-tool-use hook that validates bash commands for security.
 * Main enforcement point for the security system.
 *
 * Ported from: apps/backend/security/hooks.py
 */

import * as path from 'node:path';

import {
  extractCommands,
  getCommandForValidation,
  splitCommandSegments,
} from './command-parser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Validation result: [isAllowed, reason] */
export type ValidationResult = [boolean, string];

/** A validator function that checks a command segment */
export type ValidatorFunction = (commandSegment: string) => ValidationResult;

/**
 * Minimal security profile interface.
 * Mirrors the Python SecurityProfile's public API used by the hook.
 */
export interface SecurityProfile {
  baseCommands: Set<string>;
  stackCommands: Set<string>;
  scriptCommands: Set<string>;
  customCommands: Set<string>;
  customScripts: {
    shellScripts: string[];
  };
  getAllAllowedCommands(): Set<string>;
}

/** Hook input data shape (matches Vercel AI SDK tool call metadata) */
export interface HookInputData {
  toolName?: string;
  toolInput?: Record<string, unknown> | null;
  cwd?: string;
}

/** Hook deny result */
interface HookDenyResult {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'deny';
    permissionDecisionReason: string;
  };
}

/** Hook result — empty object means allow */
type HookResult = Record<string, never> | HookDenyResult;

// ---------------------------------------------------------------------------
// Validators registry
// ---------------------------------------------------------------------------

/**
 * Central map of command names → validator functions.
 *
 * Individual validators will be registered here as they are ported.
 * The dispatch pattern mirrors apps/backend/security/validator_registry.py.
 */
export const VALIDATORS: Record<string, ValidatorFunction> = {
  // Validators will be populated as they are ported from Python.
  // Example shape:
  // pkill: validatePkillCommand,
  // kill: validateKillCommand,
  // rm: validateRmCommand,
  // git: validateGitCommit,
};

/**
 * Get the validator function for a given command name.
 */
export function getValidator(
  commandName: string,
): ValidatorFunction | undefined {
  return VALIDATORS[commandName];
}

// ---------------------------------------------------------------------------
// Command allowlist check
// ---------------------------------------------------------------------------

/**
 * Check if a command is allowed by the security profile.
 *
 * Ported from: apps/backend/project/__init__.py → is_command_allowed()
 */
export function isCommandAllowed(
  command: string,
  profile: SecurityProfile,
): ValidationResult {
  const allowed = profile.getAllAllowedCommands();

  if (allowed.has(command)) {
    return [true, ''];
  }

  // Check for script commands (e.g., "./script.sh")
  if (command.startsWith('./') || command.startsWith('/')) {
    const basename = path.basename(command);
    if (profile.customScripts.shellScripts.includes(basename)) {
      return [true, ''];
    }
    if (profile.scriptCommands.has(command)) {
      return [true, ''];
    }
  }

  return [
    false,
    `Command '${command}' is not in the allowed commands for this project`,
  ];
}

// ---------------------------------------------------------------------------
// Main security hook
// ---------------------------------------------------------------------------

/**
 * Pre-tool-use hook that validates bash commands using a dynamic allowlist.
 *
 * This is the main security enforcement point. It:
 * 1. Validates tool_input structure (must have a 'command' key)
 * 2. Extracts command names from the command string
 * 3. Checks each command against the project's security profile
 * 4. Runs additional validation for sensitive commands
 * 5. Blocks disallowed commands with clear error messages
 *
 * Ported from: apps/backend/security/hooks.py → bash_security_hook()
 */
export function bashSecurityHook(
  inputData: HookInputData,
  profile: SecurityProfile,
): HookResult {
  if (inputData.toolName !== 'Bash') {
    return {} as Record<string, never>;
  }

  // Validate tool_input structure
  const toolInput = inputData.toolInput;

  if (toolInput === null || toolInput === undefined) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Bash tool_input is null/undefined - malformed tool call',
      },
    };
  }

  if (typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Bash tool_input must be an object, got ${typeof toolInput}`,
      },
    };
  }

  const command =
    typeof toolInput.command === 'string' ? toolInput.command : '';
  if (!command) {
    return {} as Record<string, never>;
  }

  // Extract all commands from the command string
  const commands = extractCommands(command);

  if (commands.length === 0) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Could not parse command for security validation: ${command}`,
      },
    };
  }

  // Split into segments for per-command validation
  const segments = splitCommandSegments(command);

  // Check each command against the allowlist
  for (const cmd of commands) {
    const [allowed, reason] = isCommandAllowed(cmd, profile);

    if (!allowed) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      };
    }

    // Additional validation for sensitive commands
    const validator = VALIDATORS[cmd];
    if (validator) {
      const cmdSegment = getCommandForValidation(cmd, segments) ?? command;
      const [validatorAllowed, validatorReason] = validator(cmdSegment);

      if (!validatorAllowed) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: validatorReason,
          },
        };
      }
    }
  }

  return {} as Record<string, never>;
}

// ---------------------------------------------------------------------------
// Testing / debugging helper
// ---------------------------------------------------------------------------

/**
 * Validate a command string against a security profile (for testing/debugging).
 *
 * Ported from: apps/backend/security/hooks.py → validate_command()
 */
export function validateCommand(
  command: string,
  profile: SecurityProfile,
): ValidationResult {
  const commands = extractCommands(command);

  if (commands.length === 0) {
    return [false, 'Could not parse command'];
  }

  const segments = splitCommandSegments(command);

  for (const cmd of commands) {
    const [allowed, reason] = isCommandAllowed(cmd, profile);
    if (!allowed) {
      return [false, reason];
    }

    const validator = VALIDATORS[cmd];
    if (validator) {
      const cmdSegment = getCommandForValidation(cmd, segments) ?? command;
      const [validatorAllowed, validatorReason] = validator(cmdSegment);
      if (!validatorAllowed) {
        return [false, validatorReason];
      }
    }
  }

  return [true, ''];
}
