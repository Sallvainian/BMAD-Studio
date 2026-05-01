/**
 * Vitest fixtures for the installer.
 *
 * Coverage:
 *   - validateInstallerOptions rejects unsafe inputs
 *   - buildCliArgs produces every flag from BMAD docs § "Headless CI installs"
 *   - stripAnsi handles the cursor / clear / color sequences seen in real logs
 *   - detectProgress parses every known structured-log line
 *   - runInstaller (integration): runs `npx bmad-method install` against a temp
 *     dir and verifies _bmad/_config/manifest.yaml is produced. Skipped when
 *     RUN_BMAD_INSTALL_TEST !== '1' to keep CI fast (the install fetches from
 *     npm and takes ~10s).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import {
  __internals,
  detectProgress,
  InstallerError,
  runInstaller,
  stripAnsi,
  validateInstallerOptions,
} from '../installer';
import type { BmadInstallerStreamChunk } from '../../../../shared/types/bmad';

const { buildCliArgs } = __internals;

describe('validateInstallerOptions', () => {
  it('rejects missing directory', () => {
    expect(() => validateInstallerOptions({ directory: '' })).toThrow(InstallerError);
  });

  it('rejects relative paths', () => {
    expect(() => validateInstallerOptions({ directory: './rel' })).toThrow(/absolute/i);
  });

  it('rejects path with shell metacharacters', () => {
    expect(() =>
      validateInstallerOptions({ directory: '/tmp/bad;rm -rf /' }),
    ).toThrow(/unsafe/i);
  });

  it('accepts a clean absolute directory', () => {
    expect(() => validateInstallerOptions({ directory: '/tmp/clean' })).not.toThrow();
  });

  it('rejects invalid module names', () => {
    expect(() =>
      validateInstallerOptions({ directory: '/tmp/x', modules: ['valid', 'has space'] }),
    ).toThrow(/module/i);
  });

  it('rejects invalid pin tags', () => {
    expect(() =>
      validateInstallerOptions({
        directory: '/tmp/x',
        pin: { bmm: 'has space' },
      }),
    ).toThrow(/pin/i);
  });

  it('rejects --set keys without a module prefix', () => {
    expect(() =>
      validateInstallerOptions({
        directory: '/tmp/x',
        set: { 'no-module-prefix': 'v' },
      }),
    ).toThrow(/set/i);
  });

  it('rejects --set values containing newlines', () => {
    expect(() =>
      validateInstallerOptions({
        directory: '/tmp/x',
        set: { 'bmm.k': 'a\nb' },
      }),
    ).toThrow(/newlines/i);
  });

  it('rejects all-stable + all-next together', () => {
    expect(() =>
      validateInstallerOptions({
        directory: '/tmp/x',
        allStable: true,
        allNext: true,
      }),
    ).toThrow(/mutually exclusive/i);
  });
});

describe('buildCliArgs', () => {
  it('default install: just directory', () => {
    expect(buildCliArgs({ directory: '/tmp/x' })).toEqual([
      '-y',
      'bmad-method',
      'install',
      '--directory',
      '/tmp/x',
    ]);
  });

  it('full feature smoke', () => {
    expect(
      buildCliArgs({
        directory: '/tmp/x',
        yes: true,
        modules: ['bmm', 'bmb'],
        tools: ['cursor'],
        action: 'install',
        customSource: ['/path/one', 'https://github.com/org/repo'],
        channel: 'stable',
        next: ['bmb'],
        pin: { cis: 'v0.2.0' },
        set: { 'bmm.project_knowledge': 'research' },
        userName: 'Sallvain',
        communicationLanguage: 'English',
        documentOutputLanguage: 'English',
        outputFolder: '_bmad-output',
      }),
    ).toEqual([
      '-y',
      'bmad-method',
      'install',
      '--directory',
      '/tmp/x',
      '--yes',
      '--modules',
      'bmm,bmb',
      '--tools',
      'cursor',
      '--action',
      'install',
      '--custom-source',
      '/path/one,https://github.com/org/repo',
      '--channel',
      'stable',
      '--next=bmb',
      '--pin',
      'cis=v0.2.0',
      '--set',
      'bmm.project_knowledge=research',
      '--user-name',
      'Sallvain',
      '--communication-language',
      'English',
      '--document-output-language',
      'English',
      '--output-folder',
      '_bmad-output',
    ]);
  });

  it('uses bmad-method@next when useNextChannel is set', () => {
    const args = buildCliArgs({ directory: '/tmp/x', useNextChannel: true });
    expect(args[1]).toBe('bmad-method@next');
  });

  it('emits both --all-next and individual --next= entries', () => {
    const args = buildCliArgs({ directory: '/tmp/x', allNext: true, next: ['bmb'] });
    expect(args).toContain('--all-next');
    expect(args).toContain('--next=bmb');
  });

  it('emits --action update without --tools', () => {
    const args = buildCliArgs({ directory: '/tmp/x', action: 'update', modules: ['bmm', 'bmb'] });
    expect(args).toContain('--action');
    expect(args).toContain('update');
    expect(args).not.toContain('--tools');
  });
});

describe('stripAnsi', () => {
  it('strips colour escape sequences', () => {
    expect(stripAnsi('\u001B[31mred\u001B[0m')).toBe('red');
  });

  it('strips cursor visibility / clear sequences seen in installer logs', () => {
    expect(stripAnsi('\u001B[?25l\u001B[?25h◇  Done')).toBe('◇  Done');
    expect(stripAnsi('◒  Installing bmm\u001B[1G\u001B[J◇  2 module(s) installed')).toBe(
      '◒  Installing bmm◇  2 module(s) installed',
    );
  });

  it('leaves plain text alone', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });
});

describe('detectProgress', () => {
  const cases: { line: string; event: string }[] = [
    { line: '●  Using directory from command-line: /tmp/x', event: 'started' },
    { line: '◇  Shared scripts installed', event: 'shared-scripts-installed' },
    { line: '◒  Installing bmm', event: 'module-installing' },
    { line: '◇  2 module(s) installed', event: 'modules-installed' },
    { line: '◇  Module directories created', event: 'directories-created' },
    { line: '◇  Configurations generated', event: 'configurations-generated' },
    {
      line: '◆  cursor configured: 42 skills → .agents/skills',
      event: 'tool-configured',
    },
    { line: 'BMAD is ready to use!', event: 'completed' },
  ];

  for (const { line, event } of cases) {
    it(`recognizes "${line.slice(0, 60)}…" → ${event}`, () => {
      const result = detectProgress(line);
      expect(result?.event).toBe(event);
    });
  }

  it('returns null for plain output', () => {
    expect(detectProgress('Just a regular log line')).toBeNull();
  });

  it('extracts skill count from tool-configured detail', () => {
    const ev = detectProgress('◆  cursor configured: 42 skills → .agents/skills');
    expect(ev?.detail).toContain('cursor configured');
    expect(ev?.detail).toContain('42 skills');
  });
});

const RUN_LIVE = process.env.RUN_BMAD_INSTALL_TEST === '1';

describe('runInstaller (live integration)', () => {
  it.skipIf(!RUN_LIVE)(
    'runs `npx bmad-method install` against a temp dir and produces _bmad/',
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'bmad-installer-'));
      try {
        const chunks: BmadInstallerStreamChunk[] = [];
        const result = await runInstaller({
          args: {
            directory: dir,
            yes: true,
            modules: ['bmm'],
            tools: ['cursor'],
          },
          callbacks: { onChunk: (c) => chunks.push(c) },
          timeoutMs: 5 * 60_000,
        });

        expect(result.success).toBe(true);
        expect(result.bmadDirCreated).toBe(true);
        expect(result.skillsConfigured).toBeGreaterThan(0);
        expect(result.tools).toContain('cursor');
        expect(chunks.some((c) => c.kind === 'progress' && c.progress?.event === 'completed')).toBe(true);

        // Sanity check the produced manifest.
        const manifestPath = path.join(dir, '_bmad', '_config', 'manifest.yaml');
        const raw = await readFile(manifestPath, 'utf-8');
        expect(raw).toMatch(/version:\s*[\d.]+/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    10 * 60_000,
  );

  it('NPX_NOT_AVAILABLE when invoked with a totally bogus directory (validation only)', () => {
    expect(() =>
      validateInstallerOptions({ directory: '/tmp/$(echo bad)' }),
    ).toThrow(InstallerError);
  });
});
