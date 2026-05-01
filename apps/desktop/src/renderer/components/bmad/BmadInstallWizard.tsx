/**
 * BmadInstallWizard — Phase 4 deliverable §4
 *
 * Module-checkbox UI for `npx bmad-method install`. Per ENGINE_SWAP_PROMPT.md
 * KAD-1 ("BMAD is installed, not bundled") this is the only path through
 * which a project gets BMad. Streams installer output via the existing
 * `bmad.runInstaller` IPC handler (Phase 1 deliverable) — captures every
 * `◆`/`◇`/`◒`/`●` progress event for the live log and surfaces the final
 * `BmadInstallerResult` so the user can land in their freshly-installed
 * project view.
 *
 * Per BMAD docs § "Headless CI installs" the installer accepts:
 *   --yes --modules <list> --tools cursor --directory <path>
 *   --user-name --communication-language --document-output-language
 *   --output-folder --action --pin --set --custom-source --channel
 *
 * Phase 4 surfaces the most user-relevant subset: modules + track + names
 * + languages + channel. Power users can still hand-edit the resulting
 * `_bmad/config.toml` after install (per BMAD docs § "Central Configuration").
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  PlayCircle,
  X,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { ScrollArea } from '../ui/scroll-area';
import type {
  BmadInstallerOptions,
  BmadInstallerResult,
  BmadInstallerStreamChunk,
  BmadModuleChannel,
  BmadTrack,
} from '../../../shared/types/bmad';

// =============================================================================
// Module catalog (defaults shown in the wizard)
// =============================================================================

interface ModuleOption {
  readonly id: string;
  readonly required?: boolean;
  /** Recommended-on-by-default when the wizard opens. */
  readonly defaultChecked?: boolean;
}

const MODULE_OPTIONS: readonly ModuleOption[] = [
  { id: 'core', required: true, defaultChecked: true },
  { id: 'bmm', defaultChecked: true },
  { id: 'cis' },
  { id: 'rgm' },
];

const TRACK_OPTIONS: readonly BmadTrack[] = ['method', 'enterprise', 'quick'];

// =============================================================================
// Component
// =============================================================================

interface BmadInstallWizardProps {
  /** Modal open state. */
  readonly open: boolean;
  /** Setter — used for cancel + auto-close on success. */
  readonly onOpenChange: (open: boolean) => void;
  /** The directory the user is installing into. */
  readonly projectRoot: string;
  /** Called on successful install with the result. */
  readonly onComplete?: (result: BmadInstallerResult) => void;
}

export function BmadInstallWizard({
  open,
  onOpenChange,
  projectRoot,
  onComplete,
}: BmadInstallWizardProps) {
  const { t } = useTranslation('bmad');

  const [selectedModules, setSelectedModules] = useState<string[]>(() =>
    MODULE_OPTIONS.filter((m) => m.required || m.defaultChecked).map(
      (m) => m.id,
    ),
  );
  const [track, setTrack] = useState<BmadTrack>('method');
  const [userName, setUserName] = useState('');
  const [communicationLanguage, setCommunicationLanguage] = useState('English');
  const [documentLanguage, setDocumentLanguage] = useState('English');
  const [outputFolder, setOutputFolder] = useState('_bmad-output/');
  const [channel, setChannel] = useState<BmadModuleChannel>('stable');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [streamLog, setStreamLog] = useState<BmadInstallerStreamChunk[]>([]);
  const [result, setResult] = useState<BmadInstallerResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stream subscription cleanup handle.
  const cleanupRef = useRef<(() => void) | null>(null);

  // Auto-scroll the log to the bottom as new chunks arrive.
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [streamLog.length]);

  // Tear down the IPC stream listener on unmount or modal close.
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const handleToggleModule = (id: string, required?: boolean) => {
    if (required) return;
    setSelectedModules((current) =>
      current.includes(id)
        ? current.filter((m) => m !== id)
        : [...current, id],
    );
  };

  const handleSubmit = async () => {
    if (isRunning) return;
    setError(null);
    setResult(null);
    setStreamLog([]);
    setIsRunning(true);

    // Subscribe to the installer output stream BEFORE firing the IPC call.
    cleanupRef.current?.();
    cleanupRef.current = window.electronAPI.bmad.onInstallerStream((payload) => {
      setStreamLog((prev) => [...prev, payload.chunk]);
    });

    try {
      const args: BmadInstallerOptions = {
        directory: projectRoot,
        yes: true,
        modules: selectedModules,
        tools: ['cursor'],
        action: 'install',
        channel,
        ...(userName.trim() ? { userName: userName.trim() } : {}),
        ...(communicationLanguage.trim()
          ? { communicationLanguage: communicationLanguage.trim() }
          : {}),
        ...(documentLanguage.trim()
          ? { documentOutputLanguage: documentLanguage.trim() }
          : {}),
        ...(outputFolder.trim() ? { outputFolder: outputFolder.trim() } : {}),
        ...(channel === 'next' ? { useNextChannel: true } : {}),
        // Track is captured client-side for now — the BMAD installer doesn't
        // accept a `--track` flag (per BMAD docs § "Headless CI installs"
        // there's no such flag yet). Phase 5's settings UI will surface
        // the track choice for orchestration. We persist it via the
        // user's --set escape hatch under [planning] track when supported.
        ...(track !== 'method'
          ? { set: { 'planning.track': track } }
          : {}),
      };

      const resp = await window.electronAPI.bmad.runInstaller(args);
      if (!resp.success) {
        setError(resp.error.message);
        return;
      }
      setResult(resp.data);
      onComplete?.(resp.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Install failed';
      setError(message);
    } finally {
      setIsRunning(false);
      cleanupRef.current?.();
      cleanupRef.current = null;
    }
  };

  const handleCancel = () => {
    if (isRunning) return;
    onOpenChange(false);
  };

  const handleOpenInProject = () => {
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && isRunning) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" aria-hidden="true" />
            {t('installWizard.title')}
          </DialogTitle>
          <DialogDescription>{t('installWizard.subtitle')}</DialogDescription>
        </DialogHeader>

        {!result && (
          <ScrollArea className="-mx-6 max-h-[60vh] px-6">
            <div className="space-y-4 py-2">
              {/* Modules */}
              <section>
                <h3 className="mb-1 text-sm font-semibold text-foreground">
                  {t('installWizard.moduleSectionTitle')}
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  {t('installWizard.moduleSectionHelp')}
                </p>
                <div
                  role="group"
                  aria-label={t('installWizard.modulesAriaLabel')}
                  className="space-y-2"
                >
                  {MODULE_OPTIONS.map((m) => {
                    const checked = selectedModules.includes(m.id);
                    return (
                      <label
                        key={m.id}
                        htmlFor={`bmad-install-mod-${m.id}`}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-md border border-border p-3',
                          checked && 'border-primary/50 bg-primary/5',
                          m.required && 'opacity-90',
                        )}
                      >
                        <Checkbox
                          id={`bmad-install-mod-${m.id}`}
                          checked={checked}
                          disabled={m.required || isRunning}
                          onCheckedChange={() =>
                            handleToggleModule(m.id, m.required)
                          }
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {t(`installWizard.moduleNames.${m.id}`, {
                              defaultValue: m.id,
                            })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t(`installWizard.moduleDescriptions.${m.id}`, {
                              defaultValue: '',
                            })}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </section>

              {/* Track */}
              <section>
                <h3 className="mb-1 text-sm font-semibold text-foreground">
                  {t('installWizard.trackSectionTitle')}
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  {t('installWizard.tracksHelp')}
                </p>
                <Select
                  value={track}
                  onValueChange={(v) => setTrack(v as BmadTrack)}
                  disabled={isRunning}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRACK_OPTIONS.map((tk) => (
                      <SelectItem key={tk} value={tk}>
                        {t(`tracks.${tk}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>

              {/* Advanced */}
              <details
                open={advancedOpen}
                onToggle={(e) =>
                  setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)
                }
              >
                <summary className="cursor-pointer text-sm font-semibold text-foreground">
                  {t('installWizard.advancedSectionTitle')}
                </summary>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="bmad-install-username">
                      {t('installWizard.userNameLabel')}
                    </Label>
                    <Input
                      id="bmad-install-username"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      placeholder={t('installWizard.userNamePlaceholder')}
                      disabled={isRunning}
                    />
                  </div>
                  <div>
                    <Label htmlFor="bmad-install-comm-lang">
                      {t('installWizard.communicationLanguageLabel')}
                    </Label>
                    <Input
                      id="bmad-install-comm-lang"
                      value={communicationLanguage}
                      onChange={(e) => setCommunicationLanguage(e.target.value)}
                      disabled={isRunning}
                    />
                  </div>
                  <div>
                    <Label htmlFor="bmad-install-doc-lang">
                      {t('installWizard.documentLanguageLabel')}
                    </Label>
                    <Input
                      id="bmad-install-doc-lang"
                      value={documentLanguage}
                      onChange={(e) => setDocumentLanguage(e.target.value)}
                      disabled={isRunning}
                    />
                  </div>
                  <div>
                    <Label htmlFor="bmad-install-output">
                      {t('installWizard.outputFolderLabel')}
                    </Label>
                    <Input
                      id="bmad-install-output"
                      value={outputFolder}
                      onChange={(e) => setOutputFolder(e.target.value)}
                      placeholder="_bmad-output/"
                      disabled={isRunning}
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {t('installWizard.outputFolderHelp')}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="bmad-install-channel">
                      {t('installWizard.channelLabel')}
                    </Label>
                    <Select
                      value={channel}
                      onValueChange={(v) => setChannel(v as BmadModuleChannel)}
                      disabled={isRunning}
                    >
                      <SelectTrigger id="bmad-install-channel">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="stable">
                          {t('installWizard.channelStable')}
                        </SelectItem>
                        <SelectItem value="next">
                          {t('installWizard.channelNext')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </details>
            </div>
          </ScrollArea>
        )}

        {/* Stream log */}
        {(isRunning || streamLog.length > 0 || result || error) && (
          <section
            className="rounded-md border border-border bg-secondary/20"
            data-testid="bmad-install-log"
          >
            <header className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
              <span className="font-semibold text-foreground">
                {t('installWizard.logHeader')}
              </span>
              {isRunning && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  {t('installWizard.submitting')}
                </span>
              )}
            </header>
            <div
              ref={logScrollRef}
              className="max-h-48 overflow-y-auto bg-background/50 p-2 font-mono text-xs"
              role="log"
              aria-label={t('installWizard.logAriaLabel')}
              aria-live="polite"
            >
              {streamLog.length === 0 && !error && (
                <p className="text-muted-foreground">
                  {t('installWizard.logEmptyState')}
                </p>
              )}
              {streamLog.map((chunk, idx) => (
                <div
                  key={`${idx}-${chunk.timestamp}`}
                  className={cn(
                    'whitespace-pre-wrap break-all',
                    chunk.kind === 'stderr' && 'text-destructive',
                    chunk.kind === 'progress' && 'text-info font-semibold',
                  )}
                  data-kind={chunk.kind}
                >
                  {chunk.text}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Status banner */}
        {result && (
          <div
            role="status"
            data-testid="bmad-install-success"
            className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm"
          >
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0 text-success"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold text-foreground">
                {t('installWizard.successTitle')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('installWizard.successDescription', {
                  count: result.skillsConfigured,
                })}
              </p>
            </div>
          </div>
        )}
        {error && (
          <div
            role="alert"
            data-testid="bmad-install-error"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          >
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold text-foreground">
                {t('installWizard.failureTitle')}
              </p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 pt-2">
          {!result && (
            <>
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={isRunning}
              >
                <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('installWizard.cancel')}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isRunning || selectedModules.length === 0}
                data-testid="bmad-install-submit"
              >
                {isRunning ? (
                  <Loader2
                    className="mr-1.5 h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <PlayCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
                )}
                {isRunning
                  ? t('installWizard.submitting')
                  : t('installWizard.submit')}
              </Button>
            </>
          )}
          {result && (
            <Button
              onClick={handleOpenInProject}
              data-testid="bmad-install-open"
            >
              {t('installWizard.openProjectButton')}
            </Button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Empty-state launch button (rendered when project isn't a BMad project)
// =============================================================================

interface BmadInstallPromptProps {
  readonly onLaunch: () => void;
  readonly className?: string;
}

/**
 * Compact "this isn't a BMad project, click here to install" panel. Mounted
 * in `BmadKanbanView` for projects without `_bmad/_config/manifest.yaml`.
 */
export function BmadInstallPrompt({
  onLaunch,
  className,
}: BmadInstallPromptProps) {
  const { t } = useTranslation('bmad');
  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center gap-3 p-8 text-center',
        className,
      )}
      data-testid="bmad-install-prompt"
    >
      <Download className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-foreground">
        {t('installWizard.promptToInstall')}
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {t('installWizard.promptToInstallHelp')}
      </p>
      <Button onClick={onLaunch} size="lg" data-testid="bmad-install-launch-button">
        <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />
        {t('installWizard.launchButton')}
      </Button>
    </div>
  );
}
