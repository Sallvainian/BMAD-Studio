/**
 * File system utilities for ideation operations
 */

import path from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { RawIdea, RawIdeationData } from './types';

/** Known ideation type file prefixes (matches Python backend IDEATION_TYPES) */
const IDEATION_TYPE_FILES = [
  'code_improvements',
  'ui_ux_improvements',
  'documentation_gaps',
  'security_hardening',
  'performance_optimizations',
  'code_quality'
];

/**
 * Read ideation data from file
 */
export function readIdeationFile(ideationPath: string): RawIdeationData | null {
  if (!existsSync(ideationPath)) {
    return null;
  }

  try {
    const content = readFileSync(ideationPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Failed to read ideation file'
    );
  }
}

/**
 * Write ideation data to file
 */
export function writeIdeationFile(ideationPath: string, data: RawIdeationData): void {
  try {
    writeFileSync(ideationPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Failed to write ideation file'
    );
  }
}

/**
 * Update timestamp for ideation data
 */
export function updateIdeationTimestamp(data: RawIdeationData): void {
  data.updated_at = new Date().toISOString();
}

/**
 * Rebuild ideation.json from individual type files.
 *
 * When generation is stopped/timed out before the Python backend writes the
 * final merged ideation.json, the individual type files (e.g. code_improvements_ideas.json)
 * still exist on disk. The renderer loads ideas from these files via streaming events,
 * so the user sees them — but ideation.json is stale or missing, causing conversion
 * and reload to fail.
 *
 * This function merges all available type files into ideation.json so everything stays consistent.
 */
export function rebuildIdeationFromTypeFiles(ideationDir: string, ideationPath: string): RawIdeationData | null {
  const allIdeas: RawIdea[] = [];

  for (const typePrefix of IDEATION_TYPE_FILES) {
    const typeFilePath = path.join(ideationDir, `${typePrefix}_ideas.json`);
    if (!existsSync(typeFilePath)) continue;

    try {
      const content = readFileSync(typeFilePath, 'utf-8');
      const data: Record<string, RawIdea[]> = JSON.parse(content);
      const ideas = data[typePrefix] || [];
      allIdeas.push(...ideas);
    } catch {
      // Skip malformed type files
    }
  }

  if (allIdeas.length === 0) {
    return null;
  }

  const now = new Date().toISOString();
  const ideation: RawIdeationData = {
    id: `ideation-rebuilt-${Date.now()}`,
    ideas: allIdeas,
    generated_at: now,
    updated_at: now
  };

  // Persist so future reads are consistent
  writeFileSync(ideationPath, JSON.stringify(ideation, null, 2), 'utf-8');

  return ideation;
}
