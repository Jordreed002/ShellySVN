import { memo, useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeHighlighterProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  maxHeight?: string;
  className?: string;
}

/**
 * Maps file extensions to syntax highlighter language identifiers
 */
function getLanguageFromExtension(ext: string): string {
  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    mjs: 'javascript',
    cjs: 'javascript',
    // Web
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',
    vue: 'vue',
    svelte: 'svelte',
    // Data formats
    json: 'json',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    ini: 'ini',
    // Programming languages
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    pl: 'perl',
    pm: 'perl',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    ps1: 'powershell',
    // Shell/Config
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    cmake: 'cmake',
    gradle: 'gradle',
    // Markup
    md: 'markdown',
    mdx: 'mdx',
    rst: 'rest',
    txt: 'text',
    // Other
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
    ex: 'elixir',
    exs: 'elixir',
    erl: 'erlang',
    hrl: 'erlang',
    lua: 'lua',
    r: 'r',
    scala: 'scala',
    clj: 'clojure',
    hs: 'haskell',
    ml: 'ocaml',
    fs: 'fsharp',
    vim: 'vim',
    log: 'log',
  };
  return languageMap[ext] || 'text';
}

/**
 * Detects language from file path
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return getLanguageFromExtension(ext);
}

export const CodeHighlighter = memo(function CodeHighlighter({
  code,
  language = 'text',
  showLineNumbers = true,
  maxHeight = '100%',
  className = '',
}: CodeHighlighterProps) {
  // Custom style adjustments for the theme
  const customStyle = useMemo(
    () => ({
      margin: 0,
      padding: '1rem',
      background: 'transparent',
      fontSize: '0.75rem',
      lineHeight: '1.5',
      maxHeight,
      overflow: 'auto' as const,
    }),
    [maxHeight]
  );

  // Use light theme (could be made configurable with app theme)
  const style = oneLight;

  return (
    <div className={`code-highlighter ${className}`}>
      <SyntaxHighlighter
        language={language}
        style={style}
        showLineNumbers={showLineNumbers}
        customStyle={customStyle}
        codeTagProps={{
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          },
        }}
        lineNumberStyle={{
          minWidth: '2.5em',
          paddingRight: '1em',
          color: '#94a3b8',
          userSelect: 'none',
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
});
