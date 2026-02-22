/**
 * Ideation session CRUD operations
 */

import path from 'path';
import { existsSync } from 'fs';
import type { IpcMainInvokeEvent } from 'electron';
import { AUTO_BUILD_PATHS } from '../../../shared/constants';
import type { IPCResult, IdeationSession } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { transformIdeaFromSnakeCase } from './transformers';
import { readIdeationFile, rebuildIdeationFromTypeFiles } from './file-utils';

/**
 * Get ideation session for a project
 */
export async function getIdeationSession(
  _event: IpcMainInvokeEvent,
  projectId: string
): Promise<IPCResult<IdeationSession | null>> {
  const project = projectStore.getProject(projectId);
  if (!project) {
    return { success: false, error: 'Project not found' };
  }

  const ideationDir = path.join(project.path, AUTO_BUILD_PATHS.IDEATION_DIR);
  const ideationPath = path.join(ideationDir, AUTO_BUILD_PATHS.IDEATION_FILE);

  let rawIdeation = readIdeationFile(ideationPath);

  // Fallback: if ideation.json is missing or has no ideas, rebuild from type files.
  // This handles the case where generation was stopped/timed out before the
  // Python backend wrote the final merged ideation.json.
  if ((!rawIdeation || !rawIdeation.ideas?.length) && existsSync(ideationDir)) {
    const rebuilt = rebuildIdeationFromTypeFiles(ideationDir, ideationPath);
    if (rebuilt) {
      rawIdeation = rebuilt;
    }
  }

  if (!rawIdeation) {
    return { success: true, data: null };
  }

  try {
    // Transform snake_case to camelCase for frontend
    const enabledTypes = (rawIdeation.config?.enabled_types || rawIdeation.config?.enabledTypes || []) as unknown[];

    const session: IdeationSession = {
      id: rawIdeation.id || `ideation-${Date.now()}`,
      projectId,
      config: {
        enabledTypes: enabledTypes as IdeationSession['config']['enabledTypes'],
        includeRoadmapContext: rawIdeation.config?.include_roadmap_context ?? rawIdeation.config?.includeRoadmapContext ?? true,
        includeKanbanContext: rawIdeation.config?.include_kanban_context ?? rawIdeation.config?.includeKanbanContext ?? true,
        maxIdeasPerType: rawIdeation.config?.max_ideas_per_type || rawIdeation.config?.maxIdeasPerType || 5
      },
      ideas: (rawIdeation.ideas || []).map(idea => transformIdeaFromSnakeCase(idea)),
      projectContext: {
        existingFeatures: rawIdeation.project_context?.existing_features || rawIdeation.projectContext?.existingFeatures || [],
        techStack: rawIdeation.project_context?.tech_stack || rawIdeation.projectContext?.techStack || [],
        targetAudience: rawIdeation.project_context?.target_audience || rawIdeation.projectContext?.targetAudience,
        plannedFeatures: rawIdeation.project_context?.planned_features || rawIdeation.projectContext?.plannedFeatures || []
      },
      generatedAt: rawIdeation.generated_at ? new Date(rawIdeation.generated_at) : new Date(),
      updatedAt: rawIdeation.updated_at ? new Date(rawIdeation.updated_at) : new Date()
    };

    return { success: true, data: session };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read ideation'
    };
  }
}
