import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, FileJson2, Loader2, Save, Shield, Trash2 } from 'lucide-react';
import {
  ALL_DRAFT_TRANSFORMATIONS,
  parseListInput,
  parseTerminologyInput,
  type DraftTransformation,
  type RepositoryProfile,
} from './repositoryProfileAdapter';
import { useRepositoryProfile } from './useRepositoryProfile';

const transformationLabels: Record<DraftTransformation, string> = {
  shorter: 'Shorten',
  'add-body': 'Add body',
  'remove-body': 'Remove body',
  imperative: 'Imperative tone',
  'match-style': 'Match repository style',
  'include-issues': 'Include existing issues',
  'explain-motivation': 'Explain motivation',
  regenerate: 'Regenerate',
};

export function RepositoryProfilePanel({ workingCopyPath }: { workingCopyPath: string }) {
  const {
    profile,
    setProfile,
    exists,
    isLoading,
    isSaving,
    error,
    importPreview,
    setImportPreview,
    save,
    remove,
    previewImport,
    applyImportPreview,
  } = useRepositoryProfile(workingCopyPath);
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const patch = <Key extends keyof RepositoryProfile>(key: Key, value: RepositoryProfile[Key]) =>
    setProfile((current) => ({ ...current, [key]: value }));

  if (isLoading)
    return (
      <div
        className="h-52 animate-pulse border border-border bg-bg-secondary motion-reduce:animate-none"
        role="status"
        aria-label="Loading repository AI profile"
      />
    );

  return (
    <section aria-label="Repository AI profile" className="space-y-3">
      <div className="border border-accent/30 bg-accent/5 p-3">
        <div className="flex items-start gap-2">
          <Shield className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
          <div>
            <h3 className="text-12 font-semibold">Local repository conventions</h3>
            <p className="mt-1 text-10.5 leading-relaxed text-text-muted">
              ShellySVN stores this profile in its own application data. It never searches for or
              reads repository instruction files automatically.
            </p>
          </div>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="border border-svn-conflict/40 bg-svn-conflict/5 px-3 py-2 text-10.5 text-svn-conflict"
        >
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Commit prefixes" hint="Comma or newline separated">
          <TextListInput
            className="input w-full font-mono text-11"
            value={profile.commitPrefixes}
            onChange={(value) => patch('commitPrefixes', value)}
            placeholder="feat:, fix:, docs:"
          />
        </Field>
        <Field label="Issue ID pattern" hint="Used as a convention, not executed by the shell">
          <input
            className="input w-full font-mono text-11"
            value={profile.issueIdPattern}
            onChange={(event) => patch('issueIdPattern', event.target.value)}
            placeholder="[A-Z]+-[0-9]+"
            name="repository-issue-id-pattern"
            autoComplete="off"
          />
        </Field>
        <Field label="Maximum subject length">
          <input
            className="input w-full font-mono text-11"
            type="number"
            name="repository-subject-max-length"
            min={20}
            max={120}
            value={profile.subjectMaxLength}
            onChange={(event) =>
              patch(
                'subjectMaxLength',
                Math.min(120, Math.max(20, Number(event.target.value) || 72))
              )
            }
          />
        </Field>
        <Field label="Body style">
          <input
            className="input w-full text-11"
            value={profile.bodyStyle}
            onChange={(event) => patch('bodyStyle', event.target.value)}
            placeholder="Concise paragraphs explaining motivation"
            name="repository-body-style"
            autoComplete="off"
          />
        </Field>
      </div>

      <Field label="Preferred terminology" hint="One mapping per line: old term = preferred term">
        <TerminologyInput
          value={profile.terminology}
          onChange={(value) => patch('terminology', value)}
        />
      </Field>

      <div className="grid gap-3 md:grid-cols-2">
        <ListField
          label="Test paths"
          value={profile.testPaths}
          onChange={(value) => patch('testPaths', value)}
          placeholder="tests/, **/*.test.ts"
        />
        <ListField
          label="Generated paths"
          value={profile.generatedPaths}
          onChange={(value) => patch('generatedPaths', value)}
          placeholder="dist/, generated/"
        />
        <ListField
          label="Documentation paths"
          value={profile.documentationPaths}
          onChange={(value) => patch('documentationPaths', value)}
          placeholder="docs/, README.md"
        />
        <ListField
          label="Excluded from AI"
          value={profile.excludedPaths}
          onChange={(value) => patch('excludedPaths', value)}
          placeholder="vendor/, private/"
        />
      </div>

      <ListField
        label="Required review questions"
        value={profile.requiredReviewQuestions}
        onChange={(value) => patch('requiredReviewQuestions', value)}
        placeholder="Does this require a migration?, Is rollback documented?"
        multiline
      />

      <fieldset className="border border-border bg-bg-secondary p-3">
        <legend className="px-1 font-mono text-9 uppercase tracking-wider text-text-faint">
          Enabled draft transformations
        </legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {ALL_DRAFT_TRANSFORMATIONS.map((transformation) => (
            <label
              key={transformation}
              className="flex min-h-8 items-center gap-2 border border-border-muted bg-bg px-2 text-10.5"
            >
              <input
                type="checkbox"
                checked={profile.enabledDraftTransformations.includes(transformation)}
                onChange={(event) =>
                  patch(
                    'enabledDraftTransformations',
                    event.target.checked
                      ? [...profile.enabledDraftTransformations, transformation]
                      : profile.enabledDraftTransformations.filter(
                          (item) => item !== transformation
                        )
                  )
                }
                className="accent-[var(--color-accent)]"
              />
              {transformationLabels[transformation]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="border border-border bg-bg-secondary">
        <button
          type="button"
          className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-11 font-semibold hover:bg-bg-tertiary"
          onClick={() => {
            setShowImport((current) => !current);
            setImportPreview(null);
          }}
          aria-expanded={showImport}
        >
          <FileJson2 className="h-4 w-4 text-accent" />
          Import JSON with preview
          <span className="ml-auto font-mono text-9 text-text-faint">explicit only</span>
        </button>
        {showImport && (
          <div className="border-t border-border p-3">
            <textarea
              aria-label="Repository profile JSON"
              className="input min-h-32 w-full resize-y font-mono text-10"
              value={importJson}
              onChange={(event) => {
                setImportJson(event.target.value);
                setImportPreview(null);
              }}
              placeholder="Paste a JSON profile… Nothing is applied until previewed and confirmed."
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!importJson.trim()}
                onClick={() => void previewImport(importJson)}
              >
                Preview import
              </button>
            </div>
            {importPreview && (
              <div
                className={`mt-3 border p-3 ${importPreview.valid ? 'border-svn-normal/40 bg-svn-normal/5' : 'border-svn-conflict/40 bg-svn-conflict/5'}`}
                role="status"
              >
                <div className="flex items-center gap-2 text-11 font-semibold">
                  {importPreview.valid ? (
                    <Shield className="h-4 w-4 text-svn-normal" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-svn-conflict" />
                  )}
                  {importPreview.valid ? 'Valid profile preview' : 'Import rejected'}
                </div>
                {importPreview.warnings.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-10 text-svn-modified">
                    {importPreview.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
                {importPreview.valid && importPreview.profile && (
                  <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-9 text-text-muted">
                    <span>{importPreview.profile.commitPrefixes.length} prefixes</span>
                    <span>{Object.keys(importPreview.profile.terminology).length} terms</span>
                    <span>{importPreview.profile.excludedPaths.length} exclusions</span>
                  </div>
                )}
                {importPreview.valid && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm mt-3"
                    onClick={() => {
                      applyImportPreview();
                      setShowImport(false);
                    }}
                  >
                    Use preview in editor
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <span className="font-mono text-9.5 text-text-faint">
          {exists
            ? `Saved locally · ${new Date(profile.updatedAt).toLocaleString()}`
            : 'Not saved yet'}
        </span>
        {exists && (
          <button
            type="button"
            className="btn btn-secondary btn-sm ml-auto gap-1 text-svn-conflict"
            disabled={isSaving}
            onClick={() => void remove()}
          >
            <Trash2 className="h-3 w-3" />
            Remove profile
          </button>
        )}
        <button
          type="button"
          className={`btn btn-primary btn-sm gap-1 ${exists ? '' : 'ml-auto'}`}
          disabled={isSaving}
          onClick={() => void save()}
        >
          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save profile
        </button>
      </div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline gap-2 text-10.5 font-semibold">
        {label}
        {hint && <span className="font-normal text-text-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
function ListField({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <Field label={label} hint="Repository-relative patterns only">
      <TextListInput
        className={`input w-full font-mono text-10.5 ${multiline ? 'min-h-20 resize-y' : ''}`}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        multiline={multiline}
      />
    </Field>
  );
}

function TextListInput({
  className,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  className: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const serialized = value.join(multiline ? '\n' : ', ');
  const [draft, setDraft] = useState(serialized);
  useEffect(() => setDraft(serialized), [serialized]);
  const commit = () => onChange(parseListInput(draft));
  return multiline ? (
    <textarea
      className={className}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      placeholder={placeholder}
    />
  ) : (
    <input
      className={className}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      placeholder={placeholder}
    />
  );
}

function TerminologyInput({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}) {
  const serialized = Object.entries(value)
    .map(([key, replacement]) => `${key} = ${replacement}`)
    .join('\n');
  const [draft, setDraft] = useState(serialized);
  useEffect(() => setDraft(serialized), [serialized]);
  return (
    <textarea
      className="input min-h-20 w-full resize-y font-mono text-10.5"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onChange(parseTerminologyInput(draft))}
      placeholder={'login = sign in\nrepo = repository'}
    />
  );
}
