/**
 * Config resolver
 * ===============
 *
 * Faithful TypeScript port of `_bmad/scripts/resolve_config.py`. Reads BMad's
 * central config — the cross-cutting state external skills (`bmad-party-mode`,
 * `bmad-retrospective`, `bmad-advanced-elicitation`) consume — using the
 * four-layer merge from BMAD docs § "Central Configuration":
 *
 *   Priority 1 (wins): _bmad/custom/config.user.toml  (human-authored, gitignored)
 *   Priority 2:        _bmad/custom/config.toml       (human-authored, committed)
 *   Priority 3:        _bmad/config.user.toml         (installer-owned, user)
 *   Priority 4 (base): _bmad/config.toml              (installer-owned, team) — required
 *
 * Same structural rules as the per-skill resolver (`customization-resolver.ts`)
 * — scalars override, tables deep-merge, `code`/`id`-keyed arrays merge by
 * key, other arrays append. Per BMAD docs § "Four-Layer Merge".
 *
 * The base layer (`_bmad/config.toml`) is required — its absence means the
 * project isn't a BMAD install. The other three layers are optional and
 * silently degrade to `{}` per the Python.
 */

import path from 'node:path';
import {
  CustomizationResolverError,
  deepMerge,
  extractKey,
  loadToml,
} from './customization-resolver';

export interface ResolveConfigOptions {
  /** Absolute path to the project root (the directory containing `_bmad/`). */
  readonly projectRoot: string;
  /**
   * Repeatable dotted-key extractions. Empty / undefined → return the full
   * merged tree. Mirrors `--key` in the Python CLI.
   */
  readonly keys?: readonly string[];
  /** Optional warning sink for non-required parse failures. */
  readonly onWarn?: (msg: string) => void;
}

type ConfigObject = Record<string, unknown>;

/**
 * Four-layer central-config resolution. The base layer at `_bmad/config.toml`
 * is required — absence throws `CustomizationResolverError`. All other layers
 * are optional and quietly resolve to `{}` if missing.
 *
 * @example
 *   const cfg = await resolveConfig({ projectRoot: '/proj' });
 *   cfg.agents['bmad-agent-pm'].icon === '🏥';   // user override applied
 */
export async function resolveConfig(options: ResolveConfigOptions): Promise<ConfigObject> {
  const projectRoot = path.resolve(options.projectRoot);
  const bmadDir = path.join(projectRoot, '_bmad');
  const onWarn = options.onWarn;

  const baseTeam = await loadToml(path.join(bmadDir, 'config.toml'), {
    required: true,
    onWarn,
  });
  const baseUser = await loadToml(path.join(bmadDir, 'config.user.toml'), { onWarn });
  const customTeam = await loadToml(path.join(bmadDir, 'custom', 'config.toml'), { onWarn });
  const customUser = await loadToml(path.join(bmadDir, 'custom', 'config.user.toml'), { onWarn });

  let merged = deepMerge(baseTeam, baseUser) as ConfigObject;
  merged = deepMerge(merged, customTeam) as ConfigObject;
  merged = deepMerge(merged, customUser) as ConfigObject;

  if (options.keys && options.keys.length > 0) {
    const sparse: ConfigObject = {};
    for (const key of options.keys) {
      const value = extractKey(merged, key);
      if (value !== undefined) {
        sparse[key] = value;
      }
    }
    return sparse;
  }

  return merged;
}

export { CustomizationResolverError as ConfigResolverError };
