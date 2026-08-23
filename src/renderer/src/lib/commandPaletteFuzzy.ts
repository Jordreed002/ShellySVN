/**
 * Fuzzy matching and ranking for the command palette (#77).
 *
 * A query matches an entry when it is (case-insensitively) equal to a field, a
 * prefix of it, contained in it, or a subsequence of its characters. Each tier
 * scores strictly above the one below it so a title hit always outranks a
 * loose character scatter, and field weights make title > keywords >
 * description > category at equal tiers.
 */

/** Fields of a palette entry that participate in matching. */
export interface FuzzyCommandFields {
  id: string;
  title: string;
  description?: string;
  category?: string;
  keywords?: string[];
}

/** Match-quality tiers. Higher always wins over any lower tier. */
const SCORE_EXACT = 10_000;
const SCORE_PREFIX = 6_000;
const SCORE_WORD_START = 4_000;
const SCORE_SUBSTRING = 2_500;
const SCORE_SUBSEQUENCE = 900;
/** Subsequence quality is bounded so it can never overtake a substring hit. */
const SCORE_SUBSEQUENCE_MAX = 2_000;

/** Field weights applied multiplicatively to a field's tier score. */
const WEIGHT_TITLE = 5;
const WEIGHT_KEYWORD = 3;
const WEIGHT_DESCRIPTION = 2;
const WEIGHT_CATEGORY = 1;

/** Recent-usage boost stays small enough to lift within a tier, never across tiers. */
const RECENT_USAGE_BOOST = 1_200;
const RECENT_USAGE_BOOST_STEP = 300;

const WORD_START = /[\s/\\._-]+/;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Score one query against one piece of text.
 * Returns `null` when the query does not match the text at all.
 */
export function fuzzyScoreText(query: string, text: string): number | null {
  const q = normalize(query);
  const t = normalize(text);
  if (!q) return 0;
  if (!t) return null;

  if (q === t) return SCORE_EXACT;

  if (t.startsWith(q)) {
    // Shorter targets that share the prefix are more specific.
    return SCORE_PREFIX + Math.round(100 * (1 - q.length / t.length));
  }

  const wordStartIndex = t
    .split(WORD_START)
    .findIndex((word) => word.startsWith(q));
  if (wordStartIndex !== -1) {
    return SCORE_WORD_START - wordStartIndex * 50;
  }

  const substringIndex = t.indexOf(q);
  if (substringIndex !== -1) {
    // Earlier occurrences rank higher, but never below the subsequence ceiling.
    return Math.max(SCORE_SUBSEQUENCE_MAX + 1, SCORE_SUBSTRING - substringIndex * 10);
  }

  return fuzzySubsequenceScore(q, t);
}

/**
 * Subsequence scoring: every query character must appear in order. Consecutive
 * runs and matches near the start score higher; the total is clamped below the
 * substring tier.
 */
function fuzzySubsequenceScore(query: string, text: string): number | null {
  let textIndex = 0;
  let score = SCORE_SUBSEQUENCE;
  let runLength = 0;

  for (const char of query) {
    const found = text.indexOf(char, textIndex);
    if (found === -1) return null;

    score += runLength > 0 ? 120 : 30;
    if (found === 0) score += 80;
    runLength = found === textIndex ? runLength + 1 : 0;
    textIndex = found + 1;
  }

  // Denser matches (less skipped text) score higher.
  const density = query.length / Math.max(textIndex, 1);
  score += Math.round(density * 200);

  return Math.min(score, SCORE_SUBSEQUENCE_MAX);
}

/**
 * Best score for a whole palette entry: the strongest weighted field score.
 * Returns `null` when no field matches.
 */
export function fuzzyScoreCommand<T extends FuzzyCommandFields>(
  query: string,
  command: T
): number | null {
  const candidates: Array<{ text: string; weight: number }> = [
    { text: command.title, weight: WEIGHT_TITLE },
    { text: command.category ?? '', weight: WEIGHT_CATEGORY },
    { text: command.description ?? '', weight: WEIGHT_DESCRIPTION },
    ...(command.keywords ?? []).map((keyword) => ({
      text: keyword,
      weight: WEIGHT_KEYWORD,
    })),
  ];

  let best: number | null = null;
  for (const candidate of candidates) {
    if (!candidate.text) continue;
    const score = fuzzyScoreText(query, candidate.text);
    if (score === null) continue;
    const weighted = score * candidate.weight;
    if (best === null || weighted > best) best = weighted;
  }
  return best;
}

/**
 * Recent-usage boost for one entry, given a map of `id -> last-used-at`.
 * The most recently used entry gets the full boost; older ones decay.
 */
export function recentUsageBoost(id: string, recentUsage: Record<string, number>): number {
  const usedAt = recentUsage[id];
  if (!usedAt) return 0;

  const newer = Object.values(recentUsage).filter((timestamp) => timestamp > usedAt).length;
  return Math.max(0, RECENT_USAGE_BOOST - newer * RECENT_USAGE_BOOST_STEP);
}

/**
 * Filter and sort palette entries for a query. Empty queries return the
 * entries in registration order. Ties break alphabetically by title so the
 * result is stable across renders.
 */
export function rankCommands<T extends FuzzyCommandFields>(
  commands: T[],
  query: string,
  recentUsage: Record<string, number> = {}
): T[] {
  const q = normalize(query);
  if (!q) return commands;

  const scored: Array<{ command: T; score: number }> = [];
  for (const command of commands) {
    const base = fuzzyScoreCommand(query, command);
    if (base === null) continue;
    scored.push({ command, score: base + recentUsageBoost(command.id, recentUsage) });
  }

  const ranked = scored.toSorted(
    (a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title)
  );
  return ranked.map((entry) => entry.command);
}
