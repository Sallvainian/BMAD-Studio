/**
 * BmadModuleManager — Phase 5 deliverable §2
 *
 * UI wrapper around `npx bmad-method install` for module install/update/remove.
 * Per BMAD docs § "Community Modules", § "Custom Sources", and § "Updating
 * Custom Modules", the installer is still the source of truth; this component
 * just collects module choices, streams output, and refreshes the manifest.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2, Package, RefreshCw, Trash2 } from 'lucide-react';

import type {
  BmadInstallerOptions,
  BmadInstallerStreamChunk,
  BmadModule,
} from '../../../shared/types/bmad';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ScrollArea } from '../ui/scroll-area';
import { Checkbox } from '../ui/checkbox';

interface BmadModuleManagerProps {
  readonly projectRoot: string;
}

const DEFAULT_INSTALLABLE_MODULES = ['bmm', 'cis', 'rgm'] as const;

export function BmadModuleManager({ projectRoot }: BmadModuleManagerProps) {
  const { t } = useTranslation('bmad');
  const [modules, setModules] = useState<readonly BmadModule[]>([]);
  const [selectedModules, setSelectedModules] = useState<string[]>(['bmm']);
  const [customSource, setCustomSource] = useState('');
  const [rawOptions, setRawOptions] = useState('');
  const [streamLog, setStreamLog] = useState<readonly BmadInstallerStreamChunk[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const loadModules = async () => {
    setIsLoading(true);
    setError(null);
    const resp = await window.electronAPI.bmad.listModules(projectRoot);
    if (resp.success) {
      setModules(resp.data);
    } else {
      setError(resp.error.message);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    void loadModules();
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectRoot]);

  const runInstaller = async (args: BmadInstallerOptions, successMessage: string) => {
    setIsRunning(true);
    setError(null);
    setMessage(null);
    setStreamLog([]);
    cleanupRef.current?.();
    cleanupRef.current = window.electronAPI.bmad.onInstallerStream((payload) => {
      setStreamLog((prev) => [...prev, payload.chunk]);
    });
    const resp = await window.electronAPI.bmad.runInstaller(args);
    cleanupRef.current?.();
    cleanupRef.current = null;
    setIsRunning(false);
    if (!resp.success) {
      setError(resp.error.message);
      return;
    }
    setMessage(successMessage);
    await loadModules();
  };

  const handleUpdate = async (moduleName?: string) => {
    await runInstaller(
      {
        directory: projectRoot,
        yes: true,
        tools: ['cursor'],
        action: 'quick-update',
        ...(moduleName && moduleName !== 'core' ? { modules: [moduleName] } : {}),
      },
      t('moduleManager.updateSuccess'),
    );
  };

  const handleRemove = async (moduleName: string) => {
    const remaining = modules
      .map((module) => module.name)
      .filter((name) => name !== 'core' && name !== moduleName);
    await runInstaller(
      {
        directory: projectRoot,
        yes: true,
        tools: ['cursor'],
        action: 'install',
        modules: remaining,
      },
      t('moduleManager.removeSuccess', { module: moduleName }),
    );
  };

  const handleInstall = async () => {
    const customSources = customSource
      .split(',')
      .map((source) => source.trim())
      .filter(Boolean);
    await runInstaller(
      {
        directory: projectRoot,
        yes: true,
        tools: ['cursor'],
        action: 'install',
        modules: selectedModules,
        ...(customSources.length > 0 ? { customSource: customSources } : {}),
      },
      t('moduleManager.installSuccess'),
    );
  };

  const handleListOptions = async () => {
    setError(null);
    const resp = await window.electronAPI.bmad.listInstallerOptions(projectRoot);
    if (resp.success) {
      const result = resp.data as { raw?: string };
      setRawOptions(result.raw ?? JSON.stringify(result, null, 2));
    } else {
      setError(resp.error.message);
    }
  };

  const toggleModule = (moduleName: string) => {
    setSelectedModules((current) =>
      current.includes(moduleName)
        ? current.filter((name) => name !== moduleName)
        : [...current, moduleName],
    );
  };

  return (
    <div className="space-y-4" data-testid="bmad-module-manager">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Package className="h-5 w-5" aria-hidden="true" />
          {t('moduleManager.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('moduleManager.description')}</p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          {message}
        </div>
      )}

      <section className="rounded-lg border border-border">
        <div className="flex items-center justify-between border-b border-border p-3">
          <div>
            <h3 className="font-medium">{t('moduleManager.installedTitle')}</h3>
            <p className="text-xs text-muted-foreground">
              {t('moduleManager.installedHelp')}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => handleUpdate()} disabled={isRunning}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('moduleManager.updateAll')}
          </Button>
        </div>
        <div className="divide-y divide-border">
          {isLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('moduleManager.loading')}
            </div>
          ) : modules.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              {t('moduleManager.empty')}
            </div>
          ) : (
            modules.map((module) => (
              <div key={module.name} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="font-medium">{module.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {t('moduleManager.moduleMeta', {
                      version: module.version,
                      updated: module.lastUpdated,
                      source: module.source,
                    })}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUpdate(module.name)}
                    disabled={isRunning}
                  >
                    {t('moduleManager.update')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRemove(module.name)}
                    disabled={isRunning || module.name === 'core'}
                  >
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t('moduleManager.remove')}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-4 rounded-lg border border-border p-4">
        <div>
          <h3 className="font-medium">{t('moduleManager.installTitle')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('moduleManager.installHelp')}
          </p>
        </div>
        <div className="grid gap-2">
          {DEFAULT_INSTALLABLE_MODULES.map((moduleName) => (
            <label key={moduleName} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selectedModules.includes(moduleName)}
                onCheckedChange={() => toggleModule(moduleName)}
              />
              {t(`installWizard.moduleNames.${moduleName}`)}
            </label>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="bmad-custom-source">{t('moduleManager.customSourceLabel')}</Label>
          <Input
            id="bmad-custom-source"
            value={customSource}
            onChange={(event) => setCustomSource(event.target.value)}
            placeholder="/path/to/module, https://github.com/org/module"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleInstall} disabled={isRunning}>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {isRunning ? t('moduleManager.running') : t('moduleManager.install')}
          </Button>
          <Button variant="outline" onClick={handleListOptions} disabled={isRunning}>
            {t('moduleManager.listOptions')}
          </Button>
        </div>
      </section>

      {(streamLog.length > 0 || rawOptions) && (
        <section className="rounded-lg border border-border">
          <div className="border-b border-border px-3 py-2 text-sm font-medium">
            {t('moduleManager.outputTitle')}
          </div>
          <ScrollArea className="h-52">
            <pre className="whitespace-pre-wrap p-3 text-xs">
              {rawOptions || streamLog.map((chunk) => chunk.text).join('\n')}
            </pre>
          </ScrollArea>
        </section>
      )}
    </div>
  );
}
