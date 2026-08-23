/**
 * Core types for the renderer i18n runtime (#134).
 *
 * A catalog is a (possibly nested) object of messages; nesting is flattened to
 * dotted keys when the catalog is registered, so `t('dialog.title')` resolves
 * `{ dialog: { title: '…' } }` and a flat `{ 'dialog.title': '…' }` alike.
 */

/** Locales are BCP-47-ish tags; `'en'` is the source locale, `'pseudo'` the layout-stress test locale. */
export type Locale = string;

/** The locale every messages are authored in and the last step before key-as-value fallback. */
export const SOURCE_LOCALE: Locale = 'en';

/** Values a `{placeholder}` may be filled with. */
export type TranslationParams = Record<string, string | number>;

/** Messages may be nested objects or plain strings at any depth. */
export type MessageCatalog = { [key: string]: string | MessageCatalog };

/** A catalog after flattening: one dotted key per message. */
export type FlatCatalog = Record<string, string>;

/** Flatten a nested catalog into dotted keys (already-flat catalogs pass through). */
export function flattenCatalog(catalog: MessageCatalog, prefix = ''): FlatCatalog {
  const flat: FlatCatalog = {};
  for (const [name, value] of Object.entries(catalog)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof value === 'string') flat[key] = value;
    else Object.assign(flat, flattenCatalog(value, key));
  }
  return flat;
}

/** Substitute `{name}` placeholders; unknown placeholders are left untouched. */
export function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}
