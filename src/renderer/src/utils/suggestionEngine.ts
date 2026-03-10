/**
 * Suggestion Engine for Enhanced Commit Dialog
 *
 * Provides AI-powered commit message suggestions and template recommendations
 * based on the files being committed.
 */

import type { SvnStatusChar } from '@shared/types';

/**
 * File category for commit template matching
 */
export type FileCategory =
  | 'javascript'
  | 'typescript'
  | 'web'
  | 'styles'
  | 'config'
  | 'documentation'
  | 'tests'
  | 'database'
  | 'backend'
  | 'assets'
  | 'build'
  | 'other';

/**
 * Change type classification
 */
export type ChangeType =
  | 'feature'
  | 'bugfix'
  | 'refactor'
  | 'docs'
  | 'test'
  | 'chore'
  | 'style'
  | 'perf';

/**
 * File analysis result
 */
export interface FileAnalysis {
  category: FileCategory;
  changeType: ChangeType;
  isNew: boolean;
  isDeleted: boolean;
  isModified: boolean;
  path: string;
  extension: string;
}

/**
 * Commit suggestion result
 */
export interface CommitSuggestion {
  type: ChangeType;
  prefix: string;
  description: string;
  confidence: number; // 0-1
  template: string;
}

/**
 * Template recommendation
 */
export interface TemplateRecommendation {
  id: string;
  name: string;
  template: string;
  confidence: number;
  reason: string;
}

/**
 * File extension to category mapping
 */
const EXTENSION_CATEGORIES: Record<string, FileCategory[]> = {
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  typescript: ['ts', 'tsx', 'mts', 'cts'],
  web: ['html', 'htm', 'vue', 'svelte'],
  styles: ['css', 'scss', 'sass', 'less', 'styl'],
  config: ['json', 'yaml', 'yml', 'toml', 'ini', 'env', 'config.js', 'config.ts'],
  documentation: ['md', 'mdx', 'rst', 'txt', 'adoc'],
  tests: ['test.js', 'test.ts', 'spec.js', 'spec.ts', 'test.jsx', 'test.tsx'],
  database: ['sql', 'prisma', 'graphql', 'gql'],
  backend: ['py', 'rb', 'go', 'rs', 'java', 'kt', 'php', 'cs', 'swift', 'c', 'cpp', 'h'],
  assets: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'woff', 'woff2', 'ttf', 'eot'],
  build: ['dockerfile', 'makefile', 'cmake', 'gradle', 'sh', 'bash', 'ps1', 'bat'],
};

/**
 * Extension to change type hints
 */
const EXTENSION_CHANGE_HINTS: Record<string, ChangeType[]> = {
  javascript: ['feature', 'bugfix', 'refactor'],
  typescript: ['feature', 'bugfix', 'refactor'],
  web: ['feature', 'style'],
  styles: ['style'],
  config: ['chore'],
  documentation: ['docs'],
  tests: ['test'],
  database: ['feature', 'refactor'],
  backend: ['feature', 'bugfix', 'refactor', 'perf'],
  assets: ['assets', 'style'],
  build: ['chore'],
};

/**
 * Path patterns that indicate change type
 */
const PATH_PATTERNS: Array<{ pattern: RegExp; type: ChangeType }> = [
  { pattern: /(^|\/)(test|tests|spec|specs|__tests__|__mocks__)\//i, type: 'test' },
  { pattern: /(^|\/)(docs?|documentation)\//i, type: 'docs' },
  { pattern: /(^|\/)(style|styles|css|scss)\//i, type: 'style' },
  { pattern: /(^|\/)(config|configs|settings)\//i, type: 'chore' },
  { pattern: /(^|\/)(build|dist|scripts)\//i, type: 'chore' },
  { pattern: /(^|\/)(assets|images|img|fonts|icons)\//i, type: 'style' },
  { pattern: /\.(test|spec)\.(js|ts|jsx|tsx)$/i, type: 'test' },
  { pattern: /\.(stories|story)\.(js|ts|jsx|tsx)$/i, type: 'test' },
  { pattern: /(^|\/)benchmark/i, type: 'perf' },
  { pattern: /(^|\/)(fix|bugfix|hotfix)/i, type: 'bugfix' },
  { pattern: /(^|\/)(feature|feat)/i, type: 'feature' },
];

/**
 * Commit prefixes by type (conventional commits style)
 */
const COMMIT_PREFIXES: Record<ChangeType, { prefix: string; description: string }> = {
  feature: { prefix: 'feat', description: 'A new feature' },
  bugfix: { prefix: 'fix', description: 'A bug fix' },
  refactor: {
    prefix: 'refactor',
    description: 'A code change that neither fixes a bug nor adds a feature',
  },
  docs: { prefix: 'docs', description: 'Documentation only changes' },
  test: { prefix: 'test', description: 'Adding missing tests or correcting existing tests' },
  chore: { prefix: 'chore', description: 'Changes to the build process or auxiliary tools' },
  style: { prefix: 'style', description: 'Changes that do not affect the meaning of the code' },
  perf: { prefix: 'perf', description: 'A code change that improves performance' },
};

/**
 * Default templates by change type
 */
const DEFAULT_TEMPLATES: Record<ChangeType, string> = {
  feature: 'feat: [description]\n\n- Added: \n- Changed: \n',
  bugfix: 'fix: [description]\n\n- Issue: \n- Root cause: \n- Solution: \n',
  refactor: 'refactor: [description]\n\n- Before: \n- After: \n- Reason: \n',
  docs: 'docs: [description]\n\n- Updated: \n- Added: \n',
  test: 'test: [description]\n\n- Added: \n- Modified: \n',
  chore: 'chore: [description]\n\n- Updated: \n',
  style: 'style: [description]\n\n- Changed: \n',
  perf: 'perf: [description]\n\n- Improved: \n- Before: \n- After: \n',
};

/**
 * Analyze a single file
 */
export function analyzeFile(path: string, status: SvnStatusChar): FileAnalysis {
  const extension = getExtension(path);
  const category = categorizeFile(path, extension);
  const changeType = inferChangeType(path, category, status);

  return {
    category,
    changeType,
    isNew: status === 'A' || status === '?',
    isDeleted: status === 'D',
    isModified: status === 'M' || status === 'R',
    path,
    extension,
  };
}

/**
 * Get file extension from path
 */
function getExtension(path: string): string {
  const parts = path.split(/[/\\]/);
  const filename = parts[parts.length - 1] || '';

  // Handle compound extensions like .test.js, .d.ts
  if (filename.includes('.')) {
    const dotParts = filename.split('.');
    if (dotParts.length > 2) {
      // Return last two parts for compound extensions
      return `${dotParts[dotParts.length - 2]}.${dotParts[dotParts.length - 1]}`;
    }
    return dotParts[dotParts.length - 1] || '';
  }
  return '';
}

/**
 * Categorize file based on path and extension
 */
function categorizeFile(path: string, extension: string): FileCategory {
  const ext = extension.toLowerCase();

  // Check each category
  for (const [category, extensions] of Object.entries(EXTENSION_CATEGORIES)) {
    if (extensions.includes(ext) || extensions.some((e) => ext.endsWith(e))) {
      return category as FileCategory;
    }
  }

  // Check by path patterns
  const lowerPath = path.toLowerCase();
  if (lowerPath.includes('test') || lowerPath.includes('spec')) {
    return 'tests';
  }
  if (lowerPath.includes('doc')) {
    return 'documentation';
  }
  if (lowerPath.includes('config') || lowerPath.includes('setting')) {
    return 'config';
  }
  if (lowerPath.includes('style') || lowerPath.includes('css')) {
    return 'styles';
  }
  if (lowerPath.includes('asset') || lowerPath.includes('image') || lowerPath.includes('font')) {
    return 'assets';
  }

  return 'other';
}

/**
 * Infer change type from file analysis
 */
function inferChangeType(path: string, category: FileCategory, _status: SvnStatusChar): ChangeType {
  // Check path patterns first (most specific)
  for (const { pattern, type } of PATH_PATTERNS) {
    if (pattern.test(path)) {
      return type;
    }
  }

  // Use category hints
  const hints = EXTENSION_CHANGE_HINTS[category] || ['chore'];
  return hints[0];
}

/**
 * Analyze all files and generate commit suggestions
 */
export function analyzeFiles(files: Array<{ path: string; status: SvnStatusChar }>): {
  analyses: FileAnalysis[];
  suggestions: CommitSuggestion[];
  recommendedTemplate: TemplateRecommendation;
} {
  const analyses = files.map((f) => analyzeFile(f.path, f.status));

  // Count change types
  const typeCounts = new Map<ChangeType, number>();
  for (const analysis of analyses) {
    const count = typeCounts.get(analysis.changeType) || 0;
    typeCounts.set(analysis.changeType, count + 1);
  }

  // Generate suggestions sorted by confidence
  const suggestions = generateSuggestions(analyses, typeCounts);

  // Get recommended template
  const recommendedTemplate = getRecommendedTemplate(analyses, typeCounts);

  return { analyses, suggestions, recommendedTemplate };
}

/**
 * Generate commit message suggestions
 */
function generateSuggestions(
  analyses: FileAnalysis[],
  typeCounts: Map<ChangeType, number>
): CommitSuggestion[] {
  const suggestions: CommitSuggestion[] = [];
  const totalFiles = analyses.length || 1; // Guard against division by zero

  // Generate suggestions for each change type present
  for (const [type, count] of typeCounts) {
    const confidence = count / totalFiles;
    const prefixInfo = COMMIT_PREFIXES[type];

    // Generate description based on files
    const description = generateDescription(
      type,
      analyses.filter((a) => a.changeType === type)
    );

    suggestions.push({
      type,
      prefix: prefixInfo.prefix,
      description,
      confidence,
      template: DEFAULT_TEMPLATES[type],
    });
  }

  // Sort by confidence (highest first)
  suggestions.sort((a, b) => b.confidence - a.confidence);

  return suggestions;
}

/**
 * Generate a description for a set of files
 */
function generateDescription(type: ChangeType, files: FileAnalysis[]): string {
  if (files.length === 0) return '';

  // Get unique categories
  const _categories = new Set(files.map((f) => f.category));

  // Generate description based on type and categories
  if (files.length === 1) {
    const file = files[0];
    const filename = file.path.split(/[/\\]/).pop() || file.path;

    if (file.isNew) {
      return `add ${filename}`;
    }
    if (file.isDeleted) {
      return `remove ${filename}`;
    }
    return `update ${filename}`;
  }

  // Multiple files
  const newCount = files.filter((f) => f.isNew).length;
  const deletedCount = files.filter((f) => f.isDeleted).length;
  const modifiedCount = files.filter((f) => f.isModified).length;

  const parts: string[] = [];
  if (newCount > 0) parts.push(`add ${newCount} file${newCount > 1 ? 's' : ''}`);
  if (deletedCount > 0) parts.push(`remove ${deletedCount} file${deletedCount > 1 ? 's' : ''}`);
  if (modifiedCount > 0) parts.push(`modify ${modifiedCount} file${modifiedCount > 1 ? 's' : ''}`);

  return parts.join(', ');
}

/**
 * Get recommended template based on file analysis
 */
function getRecommendedTemplate(
  analyses: FileAnalysis[],
  typeCounts: Map<ChangeType, number>
): TemplateRecommendation {
  // Find the dominant change type
  let dominantType: ChangeType = 'chore';
  let maxCount = 0;

  for (const [type, count] of typeCounts) {
    if (count > maxCount) {
      maxCount = count;
      dominantType = type;
    }
  }

  const prefixInfo = COMMIT_PREFIXES[dominantType];
  const confidence = analyses.length > 0 ? maxCount / analyses.length : 0;

  // Generate reason
  const filesOfType = analyses.filter((a) => a.changeType === dominantType);
  let reason = '';

  if (filesOfType.length === 1) {
    reason = `Based on changes to ${filesOfType[0].path.split(/[/\\]/).pop()}`;
  } else if (filesOfType.length > 1) {
    const categories = new Set(filesOfType.map((f) => f.category));
    if (categories.size === 1) {
      reason = `Based on ${filesOfType.length} ${Array.from(categories)[0]} file changes`;
    } else {
      reason = `Based on ${filesOfType.length} files (${Math.round(confidence * 100)}% ${dominantType})`;
    }
  }

  return {
    id: dominantType,
    name: `${prefixInfo.prefix}: ${prefixInfo.description}`,
    template: DEFAULT_TEMPLATES[dominantType],
    confidence,
    reason,
  };
}

/**
 * Get all available templates with recommendations
 */
export function getTemplatesWithRecommendations(
  files: Array<{ path: string; status: SvnStatusChar }>
): TemplateRecommendation[] {
  const { _analyses, recommendedTemplate } = analyzeFiles(files);
  const recommendations: TemplateRecommendation[] = [];

  // Add recommended template first
  recommendations.push(recommendedTemplate);

  // Add other templates with lower confidence
  for (const [type, prefixInfo] of Object.entries(COMMIT_PREFIXES)) {
    if (type !== recommendedTemplate.id) {
      recommendations.push({
        id: type,
        name: `${prefixInfo.prefix}: ${prefixInfo.description}`,
        template: DEFAULT_TEMPLATES[type as ChangeType],
        confidence: 0,
        reason: '',
      });
    }
  }

  return recommendations;
}

/**
 * Generate autocomplete suggestions for commit message input
 */
export function getAutocompleteSuggestions(
  input: string,
  files: Array<{ path: string; status: SvnStatusChar }>,
  history: string[]
): string[] {
  const suggestions: string[] = [];

  // If input is empty, suggest prefixes
  if (input.trim() === '') {
    for (const [_type, prefixInfo] of Object.entries(COMMIT_PREFIXES)) {
      suggestions.push(`${prefixInfo.prefix}: `);
    }
    return suggestions;
  }

  // Check if input starts with a prefix
  const prefixMatch = Object.values(COMMIT_PREFIXES).find((p) =>
    input.toLowerCase().startsWith(p.prefix.toLowerCase() + ':')
  );

  // Get file-based suggestions
  const { suggestions: fileSuggestions } = analyzeFiles(files);

  for (const suggestion of fileSuggestions) {
    const fullPrefix = `${suggestion.prefix}: `;

    // If user already has the prefix, suggest the description
    if (prefixMatch && input.toLowerCase().startsWith(prefixMatch.prefix.toLowerCase() + ':')) {
      const currentDesc = input.slice(fullPrefix.length).trim();
      if (
        suggestion.description.toLowerCase().startsWith(currentDesc.toLowerCase()) &&
        currentDesc.length < suggestion.description.length
      ) {
        suggestions.push(fullPrefix + suggestion.description);
      }
    }
    // If input matches the start of a prefix
    else if (
      fullPrefix.toLowerCase().startsWith(input.toLowerCase()) &&
      input.length < fullPrefix.length
    ) {
      suggestions.push(fullPrefix);
    }
  }

  // Add history suggestions
  const lowerInput = input.toLowerCase();
  const historyMatches = history.filter((h) => h.toLowerCase().includes(lowerInput)).slice(0, 5);
  suggestions.push(...historyMatches);

  // Deduplicate and limit
  return [...new Set(suggestions)].slice(0, 10);
}

/**
 * Parse a commit message to extract its type
 */
export function parseCommitType(message: string): ChangeType | null {
  const firstLine = message.split('\n')[0] || '';

  for (const [type, prefixInfo] of Object.entries(COMMIT_PREFIXES)) {
    if (firstLine.toLowerCase().startsWith(prefixInfo.prefix.toLowerCase() + ':')) {
      return type as ChangeType;
    }
  }

  return null;
}

/**
 * Validate a commit message
 */
export function validateCommitMessage(message: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const trimmed = message.trim();

  if (trimmed.length === 0) {
    errors.push('Commit message cannot be empty');
    return { valid: false, errors, warnings };
  }

  if (trimmed.length < 10) {
    warnings.push('Commit message is very short');
  }

  if (trimmed.length > 72) {
    warnings.push('First line of commit message exceeds 72 characters');
  }

  const firstLine = trimmed.split('\n')[0] || '';

  // Check for conventional commit format
  const hasPrefix = Object.values(COMMIT_PREFIXES).some((p) =>
    firstLine.toLowerCase().startsWith(p.prefix.toLowerCase() + ':')
  );

  if (!hasPrefix) {
    warnings.push('Message does not follow conventional commit format (e.g., "feat:", "fix:")');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export { COMMIT_PREFIXES, DEFAULT_TEMPLATES };
