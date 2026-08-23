import { useState, useEffect } from 'react';
import { X, Settings, Plus, Trash2, AlertCircle, Loader2, Check, Save, Eye, FileCode, Link2 } from 'lucide-react';
import { confirmAppAction } from '../../utils/dialogs';
import { assertSuccessfulSvnRead } from '../../utils/svnReadResult';
import { KeywordsEditorDialog } from './KeywordsEditorDialog';
import { ExternalsManagerDialog } from './ExternalsManagerDialog';
import { IgnoreDialog } from './IgnoreDialog';

interface PropertiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  path: string;
  revision?: string;
  allowRemoteChanges?: boolean;
}

interface SvnProperty {
  name: string;
  value: string;
  inherited?: boolean;
  inheritedFrom?: string;
}

const COMMON_PROPERTIES = [
  { name: 'svn:ignore', description: 'List of file patterns to ignore' },
  { name: 'svn:global-ignores', description: 'Recursive ignore patterns' },
  { name: 'svn:externals', description: 'External repository references' },
  { name: 'svn:keywords', description: 'Keywords to expand (Id, Rev, Date, etc.)' },
  { name: 'svn:eol-style', description: 'Line ending style (LF, CRLF, native)' },
  { name: 'svn:mime-type', description: 'MIME type of the file' },
  { name: 'svn:needs-lock', description: 'Require lock before editing' },
  { name: 'svn:executable', description: 'Set executable bit' },
];

export function PropertiesDialog({
  isOpen,
  onClose,
  path,
  revision = 'HEAD',
  allowRemoteChanges = true,
}: PropertiesDialogProps) {
  const isRemote = /^(?:https?|svn(?:\+ssh)?|file):\/\//i.test(path);
  const [properties, setProperties] = useState<SvnProperty[]>([]);
  const [originalProperties, setOriginalProperties] = useState<SvnProperty[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newPropName, setNewPropName] = useState('');
  const [newPropValue, setNewPropValue] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [revisionPropertyName, setRevisionPropertyName] = useState('svn:log');
  const [revisionPropertyValue, setRevisionPropertyValue] = useState('');
  const [isRevisionPropertyLoaded, setIsRevisionPropertyLoaded] = useState(false);
  const [isSavingRevisionProperty, setIsSavingRevisionProperty] = useState(false);
  /** Which structured property editor is open (keywords / externals / ignore patterns). */
  const [structuredEditor, setStructuredEditor] = useState<
    'keywords' | 'externals' | 'ignore' | null
  >(null);

  useEffect(() => {
    if (isOpen) {
      setCommitMessage('');
      setRevisionPropertyName('svn:log');
      setRevisionPropertyValue('');
      setIsRevisionPropertyLoaded(false);
      setStructuredEditor(null);
      loadProperties();
    }
  }, [isOpen, path]);

  /**
   * Structured editors (keywords / externals / ignore patterns) apply their
   * result to the draft; the existing "Save Changes" flow performs the single
   * actual propset, so there is exactly one write path.
   */
  const applyStructuredValue = (name: string, value: string) => {
    setProperties((current) =>
      current.map((prop) => (prop.name === name && !prop.inherited ? { ...prop, value } : prop))
    );
    setStructuredEditor(null);
  };

  const structuredEditorTarget = (name: string) =>
    properties.find((prop) => prop.name === name && !prop.inherited);

  const loadProperties = async () => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = assertSuccessfulSvnRead(
        await window.api.svn.proplist(
          path,
          isRemote ? { revision, showInherited: true } : undefined
        )
      );
      const propList: SvnProperty[] = result.properties.map((p) => ({
        name: p.name,
        value: p.value,
        inherited: p.inherited,
        inheritedFrom: p.inheritedFrom,
      }));
      setProperties(propList);
      setOriginalProperties(propList.map((property) => ({ ...property })));
    } catch (err) {
      setError((err as Error).message || 'Failed to load properties');
      setProperties([]);
      setOriginalProperties([]);
    } finally {
      setIsLoading(false);
    }
  };

  const hasChanges = () => {
    if (properties.length !== originalProperties.length) return true;
    return properties.some(
      (prop, index) =>
        prop.name !== originalProperties[index]?.name ||
        prop.value !== originalProperties[index]?.value
    );
  };

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setEditValue(properties[index].value);
  };

  const handleSaveEdit = () => {
    if (editingIndex !== null) {
      setProperties((currentProperties) =>
        currentProperties.map((property, index) =>
          index === editingIndex ? { ...property, value: editValue } : property
        )
      );
      setEditingIndex(null);
      setEditValue('');
    }
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditValue('');
  };

  const handleDelete = async (index: number) => {
    if (
      await confirmAppAction({
        type: 'warning',
        message: `Delete property "${properties[index].name}"?`,
        confirmLabel: 'Delete',
      })
    ) {
      const propName = properties[index].name;
      if (properties[index].inherited) {
        setError('Inherited properties must be changed on the parent where they are defined.');
        return;
      }

      if (isRemote) {
        setProperties(properties.filter((_, propertyIndex) => propertyIndex !== index));
        return;
      }

      setIsSaving(true);
      setError(null);

      try {
        await window.api.svn.propdel(path, propName);
        const newProps = properties.filter((_, i) => i !== index);
        setProperties(newProps);
        setOriginalProperties(newProps);
        setSuccess(`Property "${propName}" deleted`);
      } catch (err) {
        setError((err as Error).message || 'Failed to delete property');
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleAddProperty = () => {
    if (!newPropName.trim()) {
      setError('Property name is required');
      return;
    }

    if (properties.some((p) => p.name === newPropName.trim())) {
      setError('Property already exists');
      return;
    }

    setProperties([...properties, { name: newPropName.trim(), value: newPropValue }]);
    setNewPropName('');
    setNewPropValue('');
    setIsAdding(false);
    setError(null);
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (isRemote && !commitMessage.trim()) {
        setError('A commit message is required for repository property changes.');
        return;
      }

      // Find properties to add/update
      for (const prop of properties.filter((property) => !property.inherited)) {
        const original = originalProperties.find((o) => o.name === prop.name);
        if (!original) {
          // New property
          if (isRemote) {
            await window.api.svn.propsetRemote(path, prop.name, prop.value, commitMessage.trim());
          } else {
            await window.api.svn.propset(path, prop.name, prop.value);
          }
        } else if (original.value !== prop.value) {
          // Updated property
          if (isRemote) {
            await window.api.svn.propsetRemote(path, prop.name, prop.value, commitMessage.trim());
          } else {
            await window.api.svn.propset(path, prop.name, prop.value);
          }
        }
      }

      // Find properties to delete
      for (const original of originalProperties.filter((property) => !property.inherited)) {
        if (!properties.find((p) => p.name === original.name)) {
          if (isRemote) {
            await window.api.svn.propdelRemote(path, original.name, commitMessage.trim());
          } else {
            await window.api.svn.propdel(path, original.name);
          }
        }
      }

      setOriginalProperties([...properties]);
      setCommitMessage('');
      setSuccess('All properties saved successfully');
    } catch (err) {
      setError((err as Error).message || 'Failed to save properties');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadRevisionProperty = async () => {
    if (!revisionPropertyName.trim()) {
      setError('Revision property name is required');
      return;
    }
    setIsSavingRevisionProperty(true);
    setError(null);
    try {
      const result = assertSuccessfulSvnRead(
        await window.api.svn.revpropget(path, revisionPropertyName.trim(), revision)
      );
      setRevisionPropertyValue(result.value ?? '');
      setIsRevisionPropertyLoaded(true);
    } catch (err) {
      setError((err as Error).message || 'Failed to load revision property');
      setIsRevisionPropertyLoaded(false);
    } finally {
      setIsSavingRevisionProperty(false);
    }
  };

  const handleSaveRevisionProperty = async () => {
    const confirmed = await confirmAppAction({
      type: 'warning',
      message: `Change revision property "${revisionPropertyName}" on r${revision}? This rewrites repository revision metadata and may be blocked by server hooks.`,
      confirmLabel: 'Change Revision Property',
    });
    if (!confirmed) return;

    setIsSavingRevisionProperty(true);
    setError(null);
    try {
      await window.api.svn.revpropset(
        path,
        revisionPropertyName.trim(),
        revisionPropertyValue,
        revision
      );
      setSuccess(`Revision property "${revisionPropertyName}" saved`);
    } catch (err) {
      setError((err as Error).message || 'Failed to save revision property');
    } finally {
      setIsSavingRevisionProperty(false);
    }
  };

  const handleDeleteRevisionProperty = async () => {
    const confirmed = await confirmAppAction({
      type: 'warning',
      message: `Delete revision property "${revisionPropertyName}" from r${revision}? This rewrites repository revision metadata and may be blocked by server hooks.`,
      confirmLabel: 'Delete Revision Property',
    });
    if (!confirmed) return;

    setIsSavingRevisionProperty(true);
    setError(null);
    try {
      await window.api.svn.revpropdel(path, revisionPropertyName.trim(), revision);
      setRevisionPropertyValue('');
      setIsRevisionPropertyLoaded(false);
      setSuccess(`Revision property "${revisionPropertyName}" deleted`);
    } catch (err) {
      setError((err as Error).message || 'Failed to delete revision property');
    } finally {
      setIsSavingRevisionProperty(false);
    }
  };

  if (!isOpen) return null;

  const keywordsTarget = structuredEditorTarget('svn:keywords');
  const externalsTarget = structuredEditorTarget('svn:externals');
  const ignoreTarget =
    structuredEditorTarget('svn:ignore') ?? structuredEditorTarget('svn:global-ignores');
  const mimeType = properties.find(
    (prop) => prop.name === 'svn:mime-type' && !prop.inherited
  )?.value;
  const eolStyle = properties.find(
    (prop) => prop.name === 'svn:eol-style' && !prop.inherited
  )?.value;

  return (
    <>
      {structuredEditor === 'keywords' && keywordsTarget && (
        <KeywordsEditorDialog
          isOpen
          onClose={() => setStructuredEditor(null)}
          path={path}
          initialValue={keywordsTarget.value}
          mimeType={mimeType ?? null}
          eolStyle={eolStyle ?? null}
          onApply={(value) => applyStructuredValue('svn:keywords', value)}
        />
      )}
      {structuredEditor === 'externals' && externalsTarget && (
        <ExternalsManagerDialog
          isOpen
          onClose={() => setStructuredEditor(null)}
          path={path}
          initialValue={externalsTarget.value}
          onApply={(value) => applyStructuredValue('svn:externals', value)}
        />
      )}
      {structuredEditor === 'ignore' && ignoreTarget && (
        <IgnoreDialog
          isOpen
          onClose={() => setStructuredEditor(null)}
          path={path}
          propertyName={
            ignoreTarget.name === 'svn:global-ignores' ? 'svn:global-ignores' : 'svn:ignore'
          }
          initialValue={ignoreTarget.value}
          onApplyValue={(value) => applyStructuredValue(ignoreTarget.name, value)}
        />
      )}
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal w-[600px] max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <Settings className="w-5 h-5 text-accent" />
            Properties
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Path */}
        <div className="px-4 py-2 bg-bg-tertiary border-b border-border text-sm text-text-secondary truncate">
          {path}
        </div>

        {/* Content */}
        <div className="modal-body overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Existing properties */}
              {properties.map((prop, index) => (
                <div key={prop.name} className="bg-bg-tertiary rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-text">{prop.name}</span>
                    {prop.inherited && (
                      <span className="ml-2 text-xs text-text-muted">
                        Inherited from {prop.inheritedFrom || 'parent'}
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      {!prop.inherited && (!isRemote || allowRemoteChanges) && (
                        <>
                          {prop.name === 'svn:keywords' && (
                            <button
                              onClick={() => setStructuredEditor('keywords')}
                              className="btn-icon-sm"
                              title="Keyword editor (checkbox list + live expansion preview)"
                              aria-label="Open keyword editor"
                            >
                              <FileCode className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {prop.name === 'svn:externals' && (
                            <button
                              onClick={() => setStructuredEditor('externals')}
                              className="btn-icon-sm"
                              title="Externals manager (table editor with peg/operative revisions)"
                              aria-label="Open externals manager"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {(prop.name === 'svn:ignore' || prop.name === 'svn:global-ignores') && (
                            <button
                              onClick={() => setStructuredEditor('ignore')}
                              className="btn-icon-sm"
                              title="Pattern editor (lint + live match preview)"
                              aria-label="Open ignore pattern editor"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleEdit(index)}
                            className="btn-icon-sm"
                            title="Edit"
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(index)}
                            className="btn-icon-sm hover:text-error"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {editingIndex === index ? (
                    <div className="space-y-2">
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="input h-24 resize-none text-sm"
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={handleCancelEdit} className="btn btn-secondary btn-sm">
                          Cancel
                        </button>
                        <button onClick={handleSaveEdit} className="btn btn-primary btn-sm">
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono bg-bg-secondary rounded p-2 max-h-32 overflow-auto">
                      {prop.value || '(empty)'}
                    </pre>
                  )}
                </div>
              ))}

              {/* Add property form */}
              {isAdding ? (
                <div className="bg-bg-tertiary rounded-lg p-3 space-y-3">
                  <div>
                    <label
                      htmlFor="property-name"
                      className="text-xs font-medium text-text-secondary mb-1 block"
                    >
                      Property name
                    </label>
                    <input
                      id="property-name"
                      type="text"
                      value={newPropName}
                      onChange={(e) => setNewPropName(e.target.value)}
                      placeholder="svn:ignore"
                      className="input text-sm"
                      list="common-properties"
                    />
                    <datalist id="common-properties">
                      {COMMON_PROPERTIES.map((p) => (
                        <option key={p.name} value={p.name} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label
                      htmlFor="property-value"
                      className="text-xs font-medium text-text-secondary mb-1 block"
                    >
                      Value
                    </label>
                    <textarea
                      id="property-value"
                      value={newPropValue}
                      onChange={(e) => setNewPropValue(e.target.value)}
                      placeholder="Enter property value…"
                      className="input h-24 resize-none text-sm"
                    />
                  </div>

                  {error && (
                    <div className="text-xs text-error flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {error}
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setIsAdding(false);
                        setNewPropName('');
                        setNewPropValue('');
                        setError(null);
                      }}
                      className="btn btn-secondary btn-sm"
                    >
                      Cancel
                    </button>
                    <button onClick={handleAddProperty} className="btn btn-primary btn-sm">
                      Add Property
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsAdding(true)}
                  disabled={isRemote && !allowRemoteChanges}
                  className="w-full py-2 border-2 border-dashed border-border rounded-lg text-sm text-text-muted hover:border-accent hover:text-accent transition-fast"
                >
                  <Plus className="w-4 h-4 inline mr-1" />
                  Add Property
                </button>
              )}

              {/* Common properties help */}
              {isRemote && (
                <div>
                  {!allowRemoteChanges && (
                    <p className="mb-2 rounded bg-warning/10 px-2 py-1 text-xs text-warning">
                      Repository properties are read-only because the svnmucc companion client is
                      unavailable.
                    </p>
                  )}
                  <label
                    htmlFor="property-commit-message"
                    className="text-xs font-medium text-text-secondary mb-1 block"
                  >
                    Commit message
                  </label>
                  <textarea
                    id="property-commit-message"
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    placeholder="Describe the repository property changes"
                    className="input h-20 resize-y text-sm"
                  />
                  {revision !== 'HEAD' && (
                    <p className="mt-1 text-xs text-warning">
                      Properties are shown at r{revision}; saved changes apply to HEAD.
                    </p>
                  )}
                </div>
              )}

              {isRemote && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium text-text">Revision properties</p>
                    <p className="text-xs text-text-muted">
                      Read or explicitly rewrite unversioned metadata on r{revision}.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      aria-label="Revision property name"
                      value={revisionPropertyName}
                      onChange={(event) => {
                        setRevisionPropertyName(event.target.value);
                        setIsRevisionPropertyLoaded(false);
                      }}
                      className="input flex-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={handleLoadRevisionProperty}
                      disabled={isSavingRevisionProperty || !revisionPropertyName.trim()}
                      className="btn btn-secondary text-xs"
                    >
                      Load
                    </button>
                  </div>
                  {isRevisionPropertyLoaded && (
                    <>
                      <textarea
                        aria-label="Revision property value"
                        value={revisionPropertyValue}
                        onChange={(event) => setRevisionPropertyValue(event.target.value)}
                        className="input h-24 resize-y text-sm"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={handleDeleteRevisionProperty}
                          disabled={isSavingRevisionProperty}
                          className="btn btn-secondary text-xs text-error"
                        >
                          Delete Revision Property
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveRevisionProperty}
                          disabled={isSavingRevisionProperty}
                          className="btn btn-primary text-xs"
                        >
                          Save Revision Property
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="text-xs text-text-faint">
                <p className="font-medium mb-1">Common properties:</p>
                <ul className="space-y-1">
                  {COMMON_PROPERTIES.slice(0, 4).map((p) => (
                    <li key={p.name}>
                      <span className="text-text-secondary">{p.name}</span> - {p.description}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          {success && (
            <span className="text-sm text-success flex items-center gap-1">
              <Check className="w-4 h-4" />
              {success}
            </span>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-secondary">
              Close
            </button>
            <button
              onClick={handleSaveAll}
              disabled={
                !hasChanges() ||
                isSaving ||
                (isRemote && !commitMessage.trim()) ||
                (isRemote && !allowRemoteChanges)
              }
              className="btn btn-primary"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
