import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, FileCode, Save, X } from 'lucide-react';
import { DialogBase } from './DialogBase';
import {
  SVN_KEYWORDS,
  defaultKeywordSample,
  expandKeywordsInText,
  formatKeywordsValue,
  isKnownKeyword,
  isTextLikeFile,
  lintKeywordTokens,
  parseKeywordsValue,
} from '../../lib/svnKeywords';

const PRIMARY_KEYWORDS = SVN_KEYWORDS.filter(
  (keyword) => !keyword.name.startsWith('LastChanged')
);

export interface KeywordsEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Path of the file carrying the svn:keywords property (display only). */
  path: string;
  /** Current svn:keywords value. */
  initialValue: string;
  /** Receives the new svn:keywords value (caller persists it). */
  onApply: (value: string) => void;
  /** svn:mime-type of the target file, when known — keywords only expand in text files. */
  mimeType?: string | null;
  /** svn:eol-style of the target file, when known — presence implies text. */
  eolStyle?: string | null;
}

/**
 * Structured svn:keywords editor (#53): checkbox list of the built-in
 * keywords plus custom entries, with a live client-side preview of how a
 * sample file's keyword anchors expand. Subversion performs the real
 * substitution on commit/touch server-side; the preview is illustrative.
 */
export function KeywordsEditorDialog({
  isOpen,
  onClose,
  path,
  initialValue,
  onApply,
  mimeType,
  eolStyle,
}: KeywordsEditorDialogProps) {
  const [tokens, setTokens] = useState<string[]>([]);
  const [customEntry, setCustomEntry] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sampleRevision, setSampleRevision] = useState('1234');
  const [sampleAuthor, setSampleAuthor] = useState('jordan');

  useEffect(() => {
    if (isOpen) {
      setTokens(parseKeywordsValue(initialValue));
      setCustomEntry('');
      setFieldError(null);
    }
  }, [isOpen, initialValue]);

  const sample = useMemo(
    () => defaultKeywordSample({ revision: Number(sampleRevision) || 0, author: sampleAuthor }),
    [sampleRevision, sampleAuthor]
  );

  const enabledSet = useMemo(() => new Set(tokens.map((token) => token.toLowerCase())), [tokens]);
  const lintIssues = useMemo(() => lintKeywordTokens(tokens), [tokens]);
  const textFile = isTextLikeFile(mimeType, eolStyle);

  const previewText = useMemo(() => {
    const anchors = [
      '$Revision$',
      '$Rev$',
      '$Date$',
      '$Author$',
      '$HeadURL$',
      '$URL$',
      '$Id$',
      '$Header$',
    ];
    return expandKeywordsInText(anchors.join('\n'), tokens, sample);
  }, [tokens, sample]);

  const toggleKeyword = (name: string) => {
    setTokens((current) => {
      const exists = current.some((token) => token.toLowerCase() === name.toLowerCase());
      if (exists) {
        return current.filter((token) => token.toLowerCase() !== name.toLowerCase());
      }
      // Keep any legacy alias spelling the user had; otherwise use the canonical name.
      return [...current, name];
    });
  };

  const addCustomEntry = () => {
    const entry = customEntry.trim();
    if (!entry) {
      setFieldError('Enter a keyword name or a Name=$Rev$-$Date$ definition');
      return;
    }
    if (enabledSet.has(entry.toLowerCase())) {
      setFieldError('Entry already enabled');
      return;
    }
    setTokens((current) => [...current, entry]);
    setCustomEntry('');
    setFieldError(null);
  };

  const removeToken = (token: string) => {
    setTokens((current) => current.filter((candidate) => candidate !== token));
  };

  const handleApply = () => {
    onApply(formatKeywordsValue(tokens));
    onClose();
  };

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <FileCode className="w-5 h-5 text-accent" />
          svn:keywords Editor
        </span>
      }
      dialogId="svn-keywords-editor"
      className="w-[620px] max-h-[85vh] flex flex-col"
      initialFocus="first-control"
    >
      <div className="px-4 py-2 bg-bg-tertiary border-b border-border text-sm text-text-secondary truncate">
        {path}
      </div>

      <div className="modal-body overflow-auto space-y-4">
        {!textFile && (
          <p className="text-xs text-warning flex items-start gap-1.5" role="alert">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            This file looks binary (svn:mime-type
            {mimeType ? ` "${mimeType}"` : ' is not a text type'}). Subversion only substitutes
            keywords in text files.
          </p>
        )}

        <fieldset>
          <legend className="text-sm font-medium text-text-secondary mb-1.5">
            Keywords to expand
          </legend>
          <div className="grid grid-cols-2 gap-1.5">
            {PRIMARY_KEYWORDS.map((keyword) => {
              const enabled = enabledSet.has(keyword.name.toLowerCase());
              return (
                <label
                  key={keyword.name}
                  className="flex items-start gap-2 bg-bg-tertiary rounded-lg px-2.5 py-1.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleKeyword(keyword.name)}
                    aria-label={`${keyword.name} keyword`}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="font-mono text-sm text-text flex items-center gap-1.5">
                      {keyword.name}
                      {keyword.aliases.length > 0 && (
                        <span className="text-xs text-text-faint">
                          ({keyword.aliases.join(', ')})
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-text-muted truncate" title={keyword.description}>
                      {keyword.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Custom entries (enabled tokens that are not primary built-ins) */}
        <div>
          <p className="text-sm font-medium text-text-secondary mb-1.5">Custom entries</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={customEntry}
              onChange={(event) => setCustomEntry(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addCustomEntry();
                }
              }}
              placeholder="BuildVersion=$Rev$-$Date$"
              aria-label="Custom keyword entry"
              className="input flex-1 text-sm"
            />
            <button type="button" onClick={addCustomEntry} className="btn btn-primary btn-sm">
              Add
            </button>
          </div>
          {fieldError && (
            <p className="text-xs text-error mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {fieldError}
            </p>
          )}
          {tokens.filter((token) => !PRIMARY_KEYWORDS.some((k) => k.name.toLowerCase() === token.toLowerCase())).length >
          0 ? (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {tokens
                .filter(
                  (token) =>
                    !PRIMARY_KEYWORDS.some(
                      (k) => k.name.toLowerCase() === token.toLowerCase()
                    )
                )
                .map((token) => (
                  <span
                    key={token}
                    className="flex items-center gap-1 bg-bg-tertiary rounded-full px-2.5 py-0.5"
                  >
                    <span className="font-mono text-xs">{token}</span>
                    {!isKnownKeyword(token) && !token.includes('=') && (
                      <AlertCircle
                        className="w-3 h-3 text-warning"
                        aria-label="Unknown keyword"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeToken(token)}
                      aria-label={`Remove ${token}`}
                      className="text-text-muted hover:text-error"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
            </div>
          ) : (
            <p className="text-xs text-text-faint mt-1.5">
              Legacy aliases (LastChangedBy, …) and custom Name=definition entries appear here.
            </p>
          )}
          {lintIssues.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {lintIssues.map((issue, index) => (
                <li key={index} className="text-xs text-warning flex items-start gap-1">
                  <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span className="font-mono">{issue.token}</span>: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Live preview */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-sm font-medium text-text-secondary">Live preview</p>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <label className="flex items-center gap-1">
                rev
                <input
                  type="text"
                  value={sampleRevision}
                  onChange={(event) => setSampleRevision(event.target.value)}
                  className="input w-16 py-0.5 px-1.5 text-xs"
                  aria-label="Sample revision"
                />
              </label>
              <label className="flex items-center gap-1">
                author
                <input
                  type="text"
                  value={sampleAuthor}
                  onChange={(event) => setSampleAuthor(event.target.value)}
                  className="input w-24 py-0.5 px-1.5 text-xs"
                  aria-label="Sample author"
                />
              </label>
            </div>
          </div>
          <pre
            aria-label="Keyword expansion preview"
            className="text-xs text-text-secondary font-mono bg-bg-secondary border border-border rounded-lg p-2.5 overflow-auto whitespace-pre"
          >
            {previewText}
          </pre>
          <p className="text-xs text-text-faint mt-1">
            Substitution happens when Subversion touches the file (commit, checkout, update) —
            enabled anchors are rewritten to the values known <em>at that moment</em>. This
            preview uses the sample values above.
          </p>
        </div>

        {/* Resulting value */}
        <div>
          <p className="text-sm font-medium text-text-secondary mb-1.5">Resulting value</p>
          <pre className="text-xs font-mono bg-bg-secondary border border-border rounded-lg p-2.5 text-text-secondary whitespace-pre-wrap break-all">
            {formatKeywordsValue(tokens) || '(empty — no keyword substitution)'}
          </pre>
        </div>
      </div>

      <div className="modal-footer">
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={handleApply} className="btn btn-primary">
            <Save className="w-4 h-4" />
            Apply Value
          </button>
        </div>
      </div>
    </DialogBase>
  );
}

