import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  ChevronRight,
  Copy,
  FolderOpen,
  Tag,
  History,
  Loader2,
  Package,
  Terminal,
} from 'lucide-react';
import { DialogBase } from './DialogBase';
import {
  type SemverBump,
  TAG_TEMPLATE_PRESETS,
  applyTagTemplate,
  buildSvnCopyCommand,
  bumpSemver,
  defaultTagCommitMessage,
  detectLatestVersion,
  extractVersionFromRenderedName,
  joinTagUrl,
  parseSemver,
  suggestBumpedName,
  validateTagName,
} from '@renderer/lib/tagTemplates';
import {
  loadRecentTagTemplates,
  recordRecentTagTemplate,
  saveRecentTagTemplates,
  type RecentTagTemplate,
} from '@renderer/lib/tagTemplateStore';
import { assertSuccessfulSvnRead } from '@renderer/utils/svnReadResult';

/**
 * Tag / release wizard (#51): create tags from any revision.
 *
 * Source picker (working copy or URL + HEAD/arbitrary revision) → destination
 * tags/ directory browser → name with templates (`release/x.y.z`, `x.y.z`,
 * `tags/#{rev}`, custom) and semver bump buttons against the last detected
 * tag → dry-run summary showing the exact `svn copy` command → execute via
 * the existing copy IPC → success state linking into the repo browser.
 *
 * Recent name templates persist through `window.api.store`
 * (lib/tagTemplateStore.ts, shortcutStore pattern).
 */

type TagWizardStep = 'source' | 'destination' | 'review';

interface TagWizardProps {
  isOpen: boolean;
  onClose: () => void;
  /** Working-copy path — the default copy source. */
  sourcePath: string;
  /** Repository URL of the source, when the caller knows it. */
  sourceUrl?: string;
  onComplete?: (tagUrl: string) => void;
  /**
   * Navigation handler for the success state's "open in repository browser"
   * action. The `/repo-browser` route accepts a `url` search param; callers
   * inside the router wire it, everyone else gets the copy-URL fallback.
   */
  onOpenInRepoBrowser?: (url: string) => void;
}

function stripTrailingLayoutSegment(url: string): string {
  return url.replace(/\/(trunk|branches\/[^/]+|tags\/[^/]+|tags|branches)\/?$/, '');
}

export function TagWizard({
  isOpen,
  onClose,
  sourcePath,
  sourceUrl,
  onComplete,
  onOpenInRepoBrowser,
}: TagWizardProps) {
  const [step, setStep] = useState<TagWizardStep>('source');
  const [sourceMode, setSourceMode] = useState<'working-copy' | 'url'>('url');
  const [sourceValue, setSourceValue] = useState('');
  const [revisionMode, setRevisionMode] = useState<'HEAD' | 'number'>('HEAD');
  const [revisionValue, setRevisionValue] = useState('');
  const [headRevision, setHeadRevision] = useState<number | undefined>(undefined);
  const [destUrl, setDestUrl] = useState('');
  const [templatePresetId, setTemplatePresetId] = useState('release-semver');
  const [customTemplate, setCustomTemplate] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [messageTouched, setMessageTouched] = useState(false);
  const [recentTemplates, setRecentTemplates] = useState<RecentTagTemplate[]>([]);
  const [showBrowser, setShowBrowser] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ revision: number; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset + bootstrap defaults every time the wizard opens.
  useEffect(() => {
    if (!isOpen) return;
    setStep('source');
    setSourceMode(sourceUrl ? 'url' : 'working-copy');
    setSourceValue(sourceUrl ?? sourcePath);
    setRevisionMode('HEAD');
    setRevisionValue('');
    setHeadRevision(undefined);
    setDestUrl(sourceUrl ? `${stripTrailingLayoutSegment(sourceUrl)}/tags/` : '');
    setTemplatePresetId('release-semver');
    setCustomTemplate('');
    setName('');
    setMessage('');
    setMessageTouched(false);
    setShowBrowser(false);
    setIsExecuting(false);
    setError(null);
    setSuccess(null);
    setCopied(false);

    void loadRecentTagTemplates().then(setRecentTemplates);

    let cancelled = false;
    const bootstrap = async () => {
      // Detect the conventional tags/ directory when the layout service can.
      if (sourceUrl) {
        try {
          const layout = await window.api.svn.getRepositoryLayout(sourceUrl);
          if (!cancelled && layout.tags) setDestUrl(`${layout.tags}/`);
        } catch {
          // Layout detection is best-effort; the derived default stands.
        }
        try {
          const info = await window.api.svn.infoUrl(sourceUrl);
          if (!cancelled && typeof info.revision === 'number') setHeadRevision(info.revision);
        } catch {
          // HEAD revision unknown — the label just stays generic.
        }
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [isOpen, sourcePath, sourceUrl]);

  const preset = TAG_TEMPLATE_PRESETS.find((entry) => entry.id === templatePresetId);
  const effectiveTemplate =
    preset?.id === 'custom' ? customTemplate : preset?.template ?? '{version}';

  const currentRevision =
    revisionMode === 'number' ? revisionValue.trim() : headRevision?.toString() ?? '';

  // Existing tags in the destination — powers the bump buttons and duplicate check.
  const { data: tagsResult, error: tagsError } = useQuery({
    queryKey: ['svn:list', destUrl, 'tag-wizard'],
    queryFn: async () =>
      assertSuccessfulSvnRead(await window.api.svn.list(destUrl, undefined, 'immediates')),
    enabled: isOpen && step !== 'source' && destUrl !== '',
    retry: false,
  });

  const existingTagNames = useMemo<string[]>(() => {
    const entries = tagsResult?.entries ?? [];
    return entries.filter((entry) => entry.kind === 'dir').map((entry) => entry.name);
  }, [tagsResult]);

  const latestVersion = useMemo(
    () => detectLatestVersion(existingTagNames, effectiveTemplate),
    [existingTagNames, effectiveTemplate]
  );

  const validation = useMemo(
    () => validateTagName(effectiveTemplate, name, { rev: currentRevision }),
    [effectiveTemplate, name, currentRevision]
  );

  const destinationTagUrl = useMemo(
    () => joinTagUrl(destUrl, name.trim()),
    [destUrl, name]
  );

  const duplicatesExisting =
    name.trim() !== '' && existingTagNames.includes(name.trim().split('/')[0]);

  // Keep the commit message in sync until the user edits it by hand.
  useEffect(() => {
    if (messageTouched || !isOpen) return;
    const version = extractVersionFromRenderedName(effectiveTemplate, name.trim()) ?? name.trim();
    setMessage(defaultTagCommitMessage(version || '…', sourceLabel(sourceMode, sourceValue, sourcePath), currentRevision));
  }, [isOpen, messageTouched, effectiveTemplate, name, sourceMode, sourceValue, sourcePath, currentRevision]);

  const applyPreset = useCallback(
    (presetId: string) => {
      setTemplatePresetId(presetId);
      const chosen = TAG_TEMPLATE_PRESETS.find((entry) => entry.id === presetId);
      const template = chosen?.id === 'custom' ? customTemplate : chosen?.template ?? '';
      if (presetId === 'custom' || template === '') return;
      if (template.includes('{rev}')) {
        setName(applyTagTemplate(template, { rev: currentRevision || 'REV' }));
        return;
      }
      // Semver-style: suggest the next patch above the newest existing tag.
      const base = latestVersion && parseSemver(latestVersion) ? bumpSemver(latestVersion, 'patch') : null;
      setName(applyTagTemplate(template, { version: base ?? '0.1.0' }));
    },
    [customTemplate, currentRevision, latestVersion]
  );

  const handleBump = (bump: SemverBump) => {
    setName(suggestBumpedName(effectiveTemplate, latestVersion, currentRevision, bump));
  };

  const handleRecentTemplate = (template: string) => {
    setCustomTemplate(template);
    setTemplatePresetId('custom');
    if (template.includes('{rev}')) {
      setName(applyTagTemplate(template, { rev: currentRevision || 'REV' }));
    }
  };

  const canLeaveSource = sourceValue.trim() !== '' && (revisionMode === 'HEAD' || /^\d+$/.test(revisionValue.trim()));
  const canLeaveDestination = destUrl.trim() !== '' && validation.valid && !duplicatesExisting;

  const commandPreview = useMemo(
    () =>
      buildSvnCopyCommand({
        source: sourceLabel(sourceMode, sourceValue, sourcePath),
        revision: revisionMode === 'number' ? revisionValue.trim() : undefined,
        destinationUrl: destinationTagUrl,
        message: message.trim() || '(no message)',
        fromWorkingCopy: sourceMode === 'working-copy',
      }),
    [sourceMode, sourceValue, sourcePath, revisionMode, revisionValue, destinationTagUrl, message]
  );

  const handleExecute = async () => {
    setIsExecuting(true);
    setError(null);
    try {
      const src =
        sourceMode === 'working-copy'
          ? sourcePath
          : revisionMode === 'number'
            ? `${sourceValue.trim()}@${revisionValue.trim()}`
            : sourceValue.trim();
      const result = await window.api.svn.copy(src, destinationTagUrl, message.trim());
      if (!result.success) {
        setError(result.error || 'svn copy failed');
        return;
      }
      setSuccess({ revision: result.revision ?? 0, url: destinationTagUrl });
      const nextRecent = recordRecentTagTemplate(recentTemplates, effectiveTemplate);
      setRecentTemplates(nextRecent);
      await saveRecentTagTemplates(nextRecent);
    } catch (err) {
      setError((err as Error).message || 'Failed to create the tag');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!success) return;
    try {
      await navigator.clipboard.writeText(success.url);
      setCopied(true);
    } catch {
      // Clipboard unavailable — the URL stays selectable on screen.
    }
  };

  const handleDone = () => {
    if (success && onComplete) onComplete(success.url);
    onClose();
  };

  if (!isOpen) return null;

  const steps: TagWizardStep[] = ['source', 'destination', 'review'];

  return (
    <>
      <DialogBase
        isOpen={isOpen && !showBrowser}
        onClose={success ? handleDone : onClose}
        dialogId="tag-wizard"
        className="w-[720px] max-w-[95vh] max-h-[85vh] flex flex-col"
        draggable
        resizable
        minWidth={520}
        minHeight={420}
        title={
          <>
            <Tag className="w-5 h-5 text-success" />
            Create Tag
          </>
        }
        headerExtras={
          <div className="flex items-center gap-1 text-xs text-text-muted">
            {success ? 'Done' : `Step ${steps.indexOf(step) + 1} of 3`}
          </div>
        }
      >
        {success ? (
          <div className="modal-body">
            <div className="flex flex-col items-center py-8 text-center">
              <div className="w-14 h-14 rounded-full bg-success/20 flex items-center justify-center mb-4">
                <CheckCircle className="w-7 h-7 text-success" />
              </div>
              <h3 className="text-lg font-medium text-text mb-1">Tag created</h3>
              <p className="text-text-secondary mb-1">Committed as revision r{success.revision}</p>
              <p className="mb-6 break-all font-mono text-xs text-text-faint">{success.url}</p>
              <div className="flex items-center gap-2">
                {onOpenInRepoBrowser && (
                  <button type="button" onClick={() => onOpenInRepoBrowser(success.url)} className="btn btn-primary">
                    <FolderOpen className="w-4 h-4" />
                    Open in repository browser
                  </button>
                )}
                <button type="button" onClick={() => void handleCopyUrl()} className="btn btn-secondary">
                  <Copy className="w-4 h-4" />
                  {copied ? 'Copied!' : 'Copy URL'}
                </button>
                <button type="button" onClick={handleDone} className="btn btn-secondary">
                  Done
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-shrink-0 px-6 py-3 bg-bg-secondary border-b border-border">
              <div className="flex items-center">
                {steps.map((stepId, index) => (
                  <div key={stepId} className="flex items-center">
                    <span
                      className={`flex items-center gap-2 px-3 py-1.5 text-sm capitalize ${
                        step === stepId ? 'text-accent' : index < steps.indexOf(step) ? 'text-svn-added' : 'text-text-muted'
                      }`}
                    >
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                          step === stepId
                            ? 'bg-accent text-white'
                            : index < steps.indexOf(step)
                              ? 'bg-svn-added text-white'
                              : 'bg-bg-tertiary text-text-muted'
                        }`}
                      >
                        {index + 1}
                      </span>
                      {stepId === 'source' ? 'Source' : stepId === 'destination' ? 'Name & place' : 'Dry run'}
                    </span>
                    {index < steps.length - 1 && <ChevronRight className="w-4 h-4 text-text-faint mx-1" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {/* Step 1: source + revision */}
              {step === 'source' && (
                <div className="modal-body space-y-5">
                  <div>
                    <div className="text-sm font-medium text-text-secondary mb-1.5 block">Copy from</div>
                    <div className="flex items-center gap-4 mb-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="tag-source"
                          checked={sourceMode === 'working-copy'}
                          onChange={() => setSourceMode('working-copy')}
                        />
                        <span className="text-sm">Working copy (includes local changes)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="tag-source"
                          checked={sourceMode === 'url'}
                          onChange={() => setSourceMode('url')}
                        />
                        <span className="text-sm">Repository URL</span>
                      </label>
                    </div>
                    {sourceMode === 'url' ? (
                      <input
                        type="text"
                        value={sourceValue}
                        onChange={(event) => setSourceValue(event.target.value)}
                        className="input w-full font-mono text-sm"
                        placeholder="svn://example.com/repo/trunk"
                        aria-label="Source URL"
                      />
                    ) : (
                      <div className="rounded bg-bg-tertiary px-3 py-2 font-mono text-sm text-text-secondary truncate">
                        {sourcePath}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-medium text-text-secondary mb-1.5 flex items-center gap-1.5">
                      <History className="w-4 h-4" />
                      Revision
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="tag-revision"
                          checked={revisionMode === 'HEAD'}
                          onChange={() => setRevisionMode('HEAD')}
                        />
                        <span className="text-sm">
                          HEAD{headRevision !== undefined ? ` (r${headRevision})` : ''}
                        </span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="tag-revision"
                          checked={revisionMode === 'number'}
                          onChange={() => setRevisionMode('number')}
                        />
                        <span className="text-sm">Revision:</span>
                        <input
                          type="text"
                          value={revisionValue}
                          onChange={(event) => setRevisionValue(event.target.value)}
                          className="input w-24"
                          placeholder="12345"
                          aria-label="Specific revision"
                        />
                      </label>
                    </div>
                    {revisionMode === 'number' && revisionValue.trim() !== '' && !/^\d+$/.test(revisionValue.trim()) && (
                      <p className="mt-1 text-xs text-error">Enter a positive revision number</p>
                    )}
                    <p className="mt-1.5 text-xs text-text-faint">
                      Working-copy copies always use your local state — pick the URL source to tag
                      an exact repository revision.
                    </p>
                  </div>

                  {error && (
                    <div className="rounded border border-error/30 bg-error/10 p-2.5 text-sm text-error">{error}</div>
                  )}
                </div>
              )}

              {/* Step 2: destination + name + templates */}
              {step === 'destination' && (
                <div className="modal-body space-y-5">
                  <div>
                    <div className="text-sm font-medium text-text-secondary mb-1.5 block">
                      Tags directory
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={destUrl}
                        onChange={(event) => setDestUrl(event.target.value)}
                        className="input flex-1 font-mono text-sm"
                        placeholder="svn://example.com/repo/tags"
                        aria-label="Tags directory URL"
                      />
                      <button type="button" onClick={() => setShowBrowser(true)} className="btn btn-secondary">
                        <FolderOpen className="w-4 h-4" />
                        Browse…
                      </button>
                    </div>
                    {tagsError ? (
                      <p className="mt-1 text-xs text-text-faint">
                        Could not list this directory ({(tagsError as Error).message}) — bump
                        suggestions may be incomplete.
                      </p>
                    ) : existingTagNames.length > 0 ? (
                      <p className="mt-1 text-xs text-text-faint">
                        {existingTagNames.length} existing tag{existingTagNames.length === 1 ? '' : 's'}
                        {latestVersion ? ` — newest version detected: ${latestVersion}` : ''}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <div className="text-sm font-medium text-text-secondary mb-1.5 block">
                      Name template
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mb-2">
                      {TAG_TEMPLATE_PRESETS.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => applyPreset(entry.id)}
                          className={`rounded-full border px-3 py-1 text-xs transition-fast ${
                            templatePresetId === entry.id
                              ? 'border-accent bg-accent/15 text-accent'
                              : 'border-border text-text-secondary hover:border-accent/50'
                          }`}
                        >
                          {entry.label}
                        </button>
                      ))}
                      {recentTemplates.map((entry) => (
                        <button
                          key={`recent-${entry.template}`}
                          type="button"
                          onClick={() => handleRecentTemplate(entry.template)}
                          className="rounded-full border border-border bg-bg-tertiary px-3 py-1 font-mono text-xs text-text-secondary transition-fast hover:border-accent/50"
                          title={`Recent — used ${new Date(entry.usedAt).toLocaleDateString()}`}
                        >
                          {entry.template}
                        </button>
                      ))}
                    </div>
                    {templatePresetId === 'custom' && (
                      <input
                        type="text"
                        value={customTemplate}
                        onChange={(event) => setCustomTemplate(event.target.value)}
                        className="input w-full font-mono text-sm mb-2"
                        placeholder="custom/{version}-r{rev}"
                        aria-label="Custom template"
                      />
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        className={`input flex-1 font-mono text-sm ${
                          name !== '' && !validation.valid ? 'border-error' : ''
                        }`}
                        placeholder={applyTagTemplate(effectiveTemplate, {
                          version: 'x.y.z',
                          rev: currentRevision || 'REV',
                        })}
                        aria-label="Tag name"
                      />
                      {effectiveTemplate.includes('{version}') && (
                        <div className="flex items-center gap-1">
                          {(['major', 'minor', 'patch'] as SemverBump[]).map((bump) => (
                            <button
                              key={bump}
                              type="button"
                              onClick={() => handleBump(bump)}
                              className="btn btn-secondary btn-sm text-xs capitalize"
                              aria-label={`Bump ${bump} version`}
                            >
                              {bump}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {name !== '' && !validation.valid && (
                      <p className="mt-1 text-xs text-error">{validation.error}</p>
                    )}
                    {duplicatesExisting && (
                      <p className="mt-1 text-xs text-warning">
                        A tag with this name already exists in {destUrl}
                      </p>
                    )}
                    {validation.valid && name !== '' && (
                      <p className="mt-1 break-all font-mono text-xs text-text-faint">
                        → {destinationTagUrl}
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-medium text-text-secondary mb-1.5 block">
                      Commit message
                    </div>
                    <textarea
                      value={message}
                      onChange={(event) => {
                        setMessage(event.target.value);
                        setMessageTouched(true);
                      }}
                      className="input h-20 resize-none text-sm"
                      aria-label="Commit message"
                    />
                  </div>

                  {error && (
                    <div className="rounded border border-error/30 bg-error/10 p-2.5 text-sm text-error">{error}</div>
                  )}
                </div>
              )}

              {/* Step 3: dry-run summary */}
              {step === 'review' && (
                <div className="modal-body space-y-4">
                  <div className="rounded-lg border border-border bg-bg-secondary p-4 space-y-2 text-sm">
                    <ReviewLine label="Source" value={sourceLabel(sourceMode, sourceValue, sourcePath)} />
                    <ReviewLine
                      label="Revision"
                      value={
                        sourceMode === 'working-copy'
                          ? 'WORKING (local state)'
                          : revisionMode === 'number'
                            ? `r${revisionValue.trim()}`
                            : `HEAD${headRevision !== undefined ? ` (r${headRevision})` : ''}`
                      }
                    />
                    <ReviewLine label="Destination" value={destinationTagUrl} />
                    <ReviewLine label="Message" value={message.trim() || '(none)'} />
                  </div>

                  <div className="rounded-lg border border-border bg-bg-tertiary p-4">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                      <Terminal className="w-3.5 h-3.5" />
                      Exact command to run
                    </p>
                    <pre className="overflow-x-auto rounded bg-bg-primary p-3 font-mono text-xs text-text whitespace-pre-wrap break-all">
                      {commandPreview}
                    </pre>
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-text-faint">
                      <Package className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      svn copy is a cheap, O(1) repository-side operation — no data is duplicated.
                    </p>
                  </div>

                  {error && (
                    <div className="rounded border border-error/30 bg-error/10 p-2.5 text-sm text-error">{error}</div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                onClick={() => (step === 'source' ? onClose() : setStep(steps[steps.indexOf(step) - 1]))}
                className="btn btn-secondary"
                disabled={isExecuting}
              >
                <ArrowLeft className="w-4 h-4" />
                {step === 'source' ? 'Cancel' : 'Back'}
              </button>
              {step === 'source' && (
                <button
                  type="button"
                  onClick={() => setStep('destination')}
                  disabled={!canLeaveSource}
                  className="btn btn-primary"
                >
                  Next
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
              {step === 'destination' && (
                <button
                  type="button"
                  onClick={() => setStep('review')}
                  disabled={!canLeaveDestination}
                  className="btn btn-primary"
                >
                  Dry run
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
              {step === 'review' && (
                <button
                  type="button"
                  onClick={() => void handleExecute()}
                  disabled={isExecuting}
                  className="btn btn-primary"
                >
                  {isExecuting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tag className="w-4 h-4" />}
                  Create tag
                </button>
              )}
            </div>
          </>
        )}
      </DialogBase>

      {/* Destination browser — nested dialog so the wizard stays mounted underneath. */}
      {showBrowser && (
        <DialogBase
          isOpen={showBrowser}
          onClose={() => setShowBrowser(false)}
          dialogId="tag-wizard-browser"
          className="w-[640px] h-[460px] flex flex-col"
          title={
            <>
              <FolderOpen className="w-5 h-5 text-accent" />
              Choose tags directory
            </>
          }
        >
          <TagsDirectoryBrowser
            initialUrl={destUrl || sourceValue}
            onSelect={(url) => {
              setDestUrl(url.endsWith('/') ? url : `${url}/`);
              setShowBrowser(false);
            }}
          />
        </DialogBase>
      )}
    </>
  );
}

/**
 * Compact tags-directory picker over the existing `svn.list` IPC (#51).
 * Breadcrumb navigation, one-click directory entry, and an explicit
 * "use this directory" action — `svn.list` is the same channel the
 * repository browser feature uses.
 */
function TagsDirectoryBrowser({ initialUrl, onSelect }: { initialUrl: string; onSelect: (url: string) => void }) {
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [showParents, setShowParents] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ['svn:list', currentUrl, 'tag-wizard-browser'],
    queryFn: async () =>
      assertSuccessfulSvnRead(await window.api.svn.list(currentUrl, undefined, 'immediates')),
    enabled: currentUrl !== '',
    retry: false,
  });

  const directories = useMemo(
    () => (data?.entries ?? []).filter((entry) => entry.kind === 'dir'),
    [data]
  );

  const breadcrumbs = useMemo(() => {
    const parts = currentUrl.split('/').filter(Boolean);
    const crumbs: Array<{ label: string; url: string }> = [];
    let accumulated = '';
    for (const part of parts) {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      // The scheme segment ("svn:") is not navigable on its own.
      crumbs.push({ label: part.endsWith(':') ? `${part}//` : part, url: accumulated });
    }
    return crumbs.slice(showParents ? 0 : Math.max(0, crumbs.length - 2));
  }, [currentUrl, showParents]);

  const parentUrl = currentUrl.replace(/\/[^/]+\/?$/, '');

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-bg-secondary px-3 py-2">
        <button
          type="button"
          onClick={() => parentUrl && setCurrentUrl(parentUrl)}
          disabled={!parentUrl || currentUrl === parentUrl}
          className="btn btn-secondary btn-sm"
          aria-label="Parent directory"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-xs">
          {breadcrumbs.map((crumb, index) => (
            <span key={crumb.url} className="flex items-center gap-0.5 whitespace-nowrap">
              {index > 0 && <ChevronRight className="h-3 w-3 text-text-faint" />}
              <button
                type="button"
                onClick={() => setCurrentUrl(crumb.url)}
                className="rounded px-1 py-0.5 font-mono text-text-secondary transition-fast hover:bg-bg-tertiary hover:text-text"
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowParents((previous) => !previous)}
          className="btn btn-secondary btn-sm text-xs"
        >
          {showParents ? 'Short path' : 'Full path'}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
          </div>
        ) : error ? (
          <p className="p-4 text-xs text-error">
            Could not list {currentUrl}: {(error as Error).message}
          </p>
        ) : directories.length === 0 ? (
          <p className="p-4 text-xs text-text-muted">
            No subdirectories here. You can use this directory as the tags location.
          </p>
        ) : (
          directories.map((entry) => (
            <button
              key={entry.url}
              type="button"
              onClick={() => setCurrentUrl(entry.url)}
              onDoubleClick={() => onSelect(entry.url)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-fast hover:bg-bg-tertiary"
            >
              <FolderOpen className="h-4 w-4 flex-shrink-0 text-accent" />
              <span className="flex-1 truncate font-mono text-xs">{entry.name}</span>
            </button>
          ))
        )}
      </div>

      <div className="modal-footer">
        <button
          type="button"
          onClick={() => onSelect(currentUrl)}
          className="btn btn-primary"
        >
          <CheckCircle className="w-4 h-4" />
          Use this directory
        </button>
      </div>
    </div>
  );
}

function sourceLabel(
  sourceMode: 'working-copy' | 'url',
  sourceValue: string,
  sourcePath: string
): string {
  return sourceMode === 'working-copy' ? sourcePath : sourceValue.trim();
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="w-24 flex-shrink-0 text-xs uppercase tracking-wide text-text-faint">
        {label}
      </span>
      <span className="min-w-0 flex-1 break-all font-mono text-sm text-text">{value}</span>
    </div>
  );
}

export default TagWizard;
