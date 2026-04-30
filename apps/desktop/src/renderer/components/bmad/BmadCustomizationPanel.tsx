/**
 * BmadCustomizationPanel — Phase 5 deliverable §1
 *
 * Visual editor over `_bmad/custom/*.toml`. Users pick a common recipe, scope
 * it to team or personal overrides, preview the resolved merge, then write a
 * sparse TOML override through the existing BMAD IPC handler. Per BMAD docs
 * § "Worked Examples" / Recipes 1-5, the panel exposes agent rules, workflow
 * rules, publish hooks, template swaps, and central agent-roster edits.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, Save, SlidersHorizontal } from 'lucide-react';

import type {
  BmadCustomizationScope,
  BmadSkillManifestEntry,
} from '../../../shared/types/bmad';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ScrollArea } from '../ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Textarea } from '../ui/textarea';
import { cn } from '../../lib/utils';

type TemplateId =
  | 'agent-icon'
  | 'agent-persistent-facts'
  | 'workflow-persistent-facts'
  | 'workflow-on-complete'
  | 'workflow-template'
  | 'roster-description';

const TEMPLATE_IDS: readonly TemplateId[] = [
  'agent-icon',
  'agent-persistent-facts',
  'workflow-persistent-facts',
  'workflow-on-complete',
  'workflow-template',
  'roster-description',
];

interface BmadCustomizationPanelProps {
  readonly projectRoot: string;
}

export function BmadCustomizationPanel({ projectRoot }: BmadCustomizationPanelProps) {
  const { t } = useTranslation('bmad');
  const [skills, setSkills] = useState<readonly BmadSkillManifestEntry[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string>('config');
  const [scope, setScope] = useState<BmadCustomizationScope>('team');
  const [templateId, setTemplateId] = useState<TemplateId>('agent-icon');
  const [targetKey, setTargetKey] = useState('bmad-agent-pm');
  const [value, setValue] = useState('📋');
  const [resolved, setResolved] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedWriteTarget = templateId === 'roster-description' ? 'config' : selectedSkillId;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      const resp = await window.electronAPI.bmad.listSkills(projectRoot);
      if (cancelled) return;
      if (!resp.success) {
        setError(resp.error.message);
        setIsLoading(false);
        return;
      }
      const customizable = resp.data.filter((skill) => skill.canonicalId !== 'bmad-help');
      setSkills(customizable);
      if (customizable.length > 0) {
        const john = customizable.find((skill) => skill.canonicalId === 'bmad-agent-pm');
        setSelectedSkillId(john?.canonicalId ?? customizable[0].canonicalId);
      }
      setIsLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  useEffect(() => {
    let cancelled = false;
    async function loadResolved() {
      setError(null);
      const resp = await window.electronAPI.bmad.readCustomization(
        projectRoot,
        selectedWriteTarget,
      );
      if (cancelled) return;
      if (resp.success) {
        setResolved(resp.data);
      } else {
        setResolved(null);
        setError(resp.error.message);
      }
    }
    void loadResolved();
    return () => {
      cancelled = true;
    };
  }, [projectRoot, selectedWriteTarget]);

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.canonicalId === selectedSkillId) ?? null,
    [skills, selectedSkillId],
  );

  const overridePreview = useMemo(
    () => buildOverride(templateId, value, targetKey),
    [templateId, value, targetKey],
  );

  const handleTemplateChange = (next: TemplateId) => {
    setTemplateId(next);
    if (next === 'agent-icon') setValue('🏥');
    if (next === 'workflow-template') setValue('{project-root}/docs/enterprise/template.md');
    if (next === 'roster-description') {
      setTargetKey('bmad-agent-pm');
      setValue('John the regulated-product PM — crisp, audit-aware, and focused on traceability.');
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setMessage(null);
    const resp = await window.electronAPI.bmad.writeCustomization(
      projectRoot,
      selectedWriteTarget,
      scope,
      overridePreview,
    );
    setIsSaving(false);
    if (!resp.success) {
      setError(resp.error.message);
      return;
    }
    setMessage(t('customization.saved', { file: resp.data.filePath }));
    const reread = await window.electronAPI.bmad.readCustomization(
      projectRoot,
      selectedWriteTarget,
    );
    if (reread.success) setResolved(reread.data);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('customization.loading')}
      </div>
    );
  }

  return (
    <div className="grid min-h-0 grid-cols-[18rem_1fr] gap-4" data-testid="bmad-customization-panel">
      <aside className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-3">
          <h3 className="flex items-center gap-2 font-semibold">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {t('customization.skillsTitle')}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('customization.skillsHelp')}
          </p>
        </div>
        <ScrollArea className="h-[32rem]">
          <button
            type="button"
            className={cn(
              'block w-full border-b border-border px-3 py-2 text-left text-sm hover:bg-muted',
              selectedWriteTarget === 'config' && 'bg-muted font-medium',
            )}
            onClick={() => {
              setTemplateId('roster-description');
              setSelectedSkillId(skills[0]?.canonicalId ?? 'config');
            }}
          >
            {t('customization.centralConfig')}
          </button>
          {skills.map((skill) => (
            <button
              type="button"
              key={skill.canonicalId}
              className={cn(
                'block w-full border-b border-border px-3 py-2 text-left text-sm hover:bg-muted',
                selectedSkillId === skill.canonicalId &&
                  selectedWriteTarget !== 'config' &&
                  'bg-muted font-medium',
              )}
              onClick={() => {
                setSelectedSkillId(skill.canonicalId);
                if (templateId === 'roster-description') setTemplateId('agent-icon');
              }}
            >
              <span className="block">{skill.name || skill.canonicalId}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {skill.canonicalId}
              </span>
            </button>
          ))}
        </ScrollArea>
      </aside>

      <section className="min-w-0 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t('customization.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('customization.description')}
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {message && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {message}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>{t('customization.scopeLabel')}</Label>
            <Select value={scope} onValueChange={(next) => setScope(next as BmadCustomizationScope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="team">{t('customization.scopeTeam')}</SelectItem>
                <SelectItem value="user">{t('customization.scopeUser')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('customization.templateLabel')}</Label>
            <Select value={templateId} onValueChange={(next) => handleTemplateChange(next as TemplateId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {t(`customization.templates.${id}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {templateId === 'roster-description' && (
          <div className="space-y-2">
            <Label htmlFor="bmad-customization-target">
              {t('customization.targetAgentLabel')}
            </Label>
            <Input
              id="bmad-customization-target"
              value={targetKey}
              onChange={(event) => setTargetKey(event.target.value)}
              placeholder="bmad-agent-pm"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="bmad-customization-value">
            {t('customization.valueLabel')}
          </Label>
          <Textarea
            id="bmad-customization-value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            rows={templateId.includes('persistent') || templateId === 'workflow-on-complete' ? 8 : 3}
          />
          <p className="text-xs text-muted-foreground">
            {templateId.includes('persistent')
              ? t('customization.multilineHint')
              : selectedSkill?.description}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <PreviewBlock
            title={t('customization.overridePreviewTitle')}
            value={overridePreview}
          />
          <PreviewBlock
            title={t('customization.resolvedPreviewTitle')}
            value={resolved ?? {}}
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {isSaving ? t('customization.saving') : t('customization.save')}
          </Button>
        </div>
      </section>
    </div>
  );
}

function PreviewBlock({
  title,
  value,
}: {
  readonly title: string;
  readonly value: Record<string, unknown>;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/30">
      <div className="border-b border-border px-3 py-2 text-sm font-medium">{title}</div>
      <pre className="max-h-80 overflow-auto p-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function buildOverride(
  templateId: TemplateId,
  value: string,
  targetKey: string,
): Record<string, unknown> {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  switch (templateId) {
    case 'agent-icon':
      return { agent: { icon: value.trim() || '📋' } };
    case 'agent-persistent-facts':
      return { agent: { persistent_facts: lines } };
    case 'workflow-persistent-facts':
      return { workflow: { persistent_facts: lines } };
    case 'workflow-on-complete':
      return { workflow: { on_complete: value } };
    case 'workflow-template':
      return { workflow: { brief_template: value.trim() } };
    case 'roster-description':
      return {
        agents: {
          [targetKey.trim() || 'bmad-agent-pm']: {
            description: value.trim(),
          },
        },
      };
  }
}
