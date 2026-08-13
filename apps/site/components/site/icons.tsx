/**
 * A single inline SVG sprite, rendered once per document in the root layout,
 * plus a thin <Icon /> wrapper that references it.
 *
 * Sprite rather than per-icon components because these marks are used heavily
 * inside the app-window rendering, where a dozen copies of the same path would
 * otherwise ship in the HTML.
 */

export type IconName =
  | 'shell'
  | 'repo'
  | 'folder'
  | 'file'
  | 'image'
  | 'search'
  | 'chev'
  | 'chevd'
  | 'up'
  | 'refresh'
  | 'dl'
  | 'check'
  | 'warn'
  | 'ext'
  | 'code'
  | 'eye-off'
  | 'disk'
  | 'branch'
  | 'lock'
  | 'plus'
  | 'side'
  | 'cog'
  | 'book'
  | 'arrow'
  | 'flag'
  | 'help'
  | 'apple'
  | 'windows'
  | 'linux';

export function Icon({
  name,
  className,
  style,
}: {
  name: IconName;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg className={className} style={style} aria-hidden focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconSprite() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" style={{ display: 'none' }} aria-hidden>
      <symbol
        id="i-shell"
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.3}
        strokeLinecap="round"
      >
        <circle cx="24" cy="24" r="20" fill="currentColor" fillOpacity=".13" />
        <path d="M16 16s4-4 8-4 8 4 8 8-4 8-8 8-6-2-6-4 2-4 4-4" opacity=".85" />
        <path d="M24 20v12M18 24h12" opacity=".38" strokeWidth={1.7} />
      </symbol>
      <symbol id="i-repo" viewBox="0 0 24 24" {...stroke}>
        <path d="M12 2.8 20.5 7v10L12 21.2 3.5 17V7Z" />
        <path d="M3.5 7 12 11.4 20.5 7M12 11.4v9.8" />
      </symbol>
      <symbol id="i-folder" viewBox="0 0 24 24" {...stroke}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      </symbol>
      <symbol id="i-file" viewBox="0 0 24 24" {...stroke}>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
        <path d="M14 3v5h5" />
      </symbol>
      <symbol id="i-image" viewBox="0 0 24 24" {...stroke}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9.5" r="1.5" />
        <path d="m4 17 5-4 4 3 3-2 4 3" />
      </symbol>
      <symbol id="i-search" viewBox="0 0 24 24" {...stroke}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.6-3.6" />
      </symbol>
      <symbol id="i-chev" viewBox="0 0 24 24" {...stroke} strokeWidth={2.4}>
        <path d="m9 6 6 6-6 6" />
      </symbol>
      <symbol id="i-chevd" viewBox="0 0 24 24" {...stroke} strokeWidth={2.2}>
        <path d="m6 9 6 6 6-6" />
      </symbol>
      <symbol id="i-up" viewBox="0 0 24 24" {...stroke}>
        <path d="M12 19V5M5 12l7-7 7 7" />
      </symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24" {...stroke}>
        <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
      </symbol>
      <symbol id="i-dl" viewBox="0 0 24 24" {...stroke}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24" {...stroke} strokeWidth={2.3}>
        <path d="m4 12 5 5L20 6" />
      </symbol>
      <symbol id="i-warn" viewBox="0 0 24 24" {...stroke}>
        <path d="M12 4 3 20h18Z" />
        <path d="M12 10v5m0 3v.4" />
      </symbol>
      <symbol id="i-ext" viewBox="0 0 24 24" {...stroke}>
        <path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
      </symbol>
      <symbol id="i-code" viewBox="0 0 24 24" {...stroke}>
        <path d="m9 18-6-6 6-6M15 6l6 6-6 6" />
      </symbol>
      <symbol id="i-eye-off" viewBox="0 0 24 24" {...stroke}>
        <path d="M4 4l16 16" />
        <path d="M9.6 5.3A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.5 3.3M6.6 6.7A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 3.3-.55" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      </symbol>
      <symbol id="i-disk" viewBox="0 0 24 24" {...stroke}>
        <ellipse cx="12" cy="6" rx="8" ry="3" />
        <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
        <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
      </symbol>
      <symbol id="i-branch" viewBox="0 0 24 24" {...stroke}>
        <circle cx="6" cy="4" r="2" />
        <circle cx="6" cy="20" r="2" />
        <circle cx="18" cy="8" r="2" />
        <path d="M6 6v12M18 10c0 4-6 3-6 8" />
      </symbol>
      <symbol id="i-lock" viewBox="0 0 24 24" {...stroke}>
        <rect x="4" y="10" width="16" height="11" rx="2.4" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </symbol>
      <symbol id="i-plus" viewBox="0 0 24 24" {...stroke}>
        <path d="M12 5v14M5 12h14" />
      </symbol>
      <symbol id="i-side" viewBox="0 0 24 24" {...stroke}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
      </symbol>
      <symbol id="i-cog" viewBox="0 0 24 24" {...stroke}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" />
      </symbol>
      <symbol id="i-book" viewBox="0 0 24 24" {...stroke}>
        <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z" />
        <path d="M4 19a2 2 0 0 1 2-2h13" />
      </symbol>
      <symbol id="i-arrow" viewBox="0 0 24 24" {...stroke}>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </symbol>
      <symbol id="i-flag" viewBox="0 0 24 24" {...stroke}>
        <path d="M5 21V4h13l-2.5 4L18 12H5" />
      </symbol>
      <symbol id="i-help" viewBox="0 0 24 24" {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.3" />
        <path d="M12 17.2v.2" />
      </symbol>
      <symbol id="i-apple" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16.4 12.7c0-2.5 2-3.7 2.1-3.8-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.1-2.8.9-3.5.9s-1.9-.9-3.1-.8C6.7 7.1 5.2 8 4.4 9.5c-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.1.8 2.1-1.1 2.9-2.3c.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.7-1-2.7-3.7ZM14.3 5.4c.6-.8 1.1-1.9 1-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2-.5 2.7-1.3Z" />
      </symbol>
      <symbol id="i-windows" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 4.6l7.6-1v8.1H3V4.6Zm0 14.8l7.6 1v-8H3v7Zm8.9 1.2L21 22V12.7h-9.1v7.9ZM11.9 3v8.4H21V2l-9.1 1Z" />
      </symbol>
      <symbol id="i-linux" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2c-2 0-3.2 1.7-3.2 3.9 0 1.3.3 2 .3 2.8 0 1-1 2-1.9 3.6-.9 1.5-1.6 3-2.3 3.9-.6.9-.4 1.9.5 2.2.7.3 1.1 0 1.6.6.6.7 1.7 1.4 3.4 1.4 1.9 0 2.6-.7 3.3-1.4.6-.6 1-.3 1.7-.6.9-.3 1.1-1.3.5-2.2-.7-.9-1.4-2.4-2.3-3.9-.9-1.6-1.9-2.6-1.9-3.6 0-.8.3-1.5.3-2.8C15.3 3.7 14 2 12 2Zm-1.4 3.2c.4 0 .7.4.7 1s-.3 1-.7 1-.7-.4-.7-1 .3-1 .7-1Zm2.8 0c.4 0 .7.4.7 1s-.3 1-.7 1-.7-.4-.7-1 .3-1 .7-1Z" />
      </symbol>
    </svg>
  );
}
