export interface AiQualityIssue {
  code: string;
  message: string;
}

export interface AiQualityReviewFinding {
  filePath: string;
  confidence: number;
  evidence: Array<{ filePath: string; excerpt: string }>;
}

export function validateStructuredOutput(
  schema: Record<string, unknown>,
  value: unknown,
  location = '$'
): AiQualityIssue[] {
  const issues: AiQualityIssue[] = [];
  const type = schema.type;
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return [{ code: 'schema-type', message: `${location} must be an object.` }];
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const required of (schema.required ?? []) as string[]) {
      if (!(required in object))
        issues.push({ code: 'schema-required', message: `${location}.${required} is required.` });
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(object))
        if (!(key in properties))
          issues.push({ code: 'schema-additional', message: `${location}.${key} is not allowed.` });
    }
    for (const [key, child] of Object.entries(properties))
      if (key in object)
        issues.push(...validateStructuredOutput(child, object[key], `${location}.${key}`));
  } else if (type === 'array') {
    if (!Array.isArray(value))
      return [{ code: 'schema-type', message: `${location} must be an array.` }];
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
      issues.push({ code: 'schema-limit', message: `${location} has too many items.` });
    const itemSchema = schema.items as Record<string, unknown> | undefined;
    if (itemSchema)
      value.forEach((item, index) =>
        issues.push(...validateStructuredOutput(itemSchema, item, `${location}[${index}]`))
      );
  } else if (type === 'string') {
    if (typeof value !== 'string')
      issues.push({ code: 'schema-type', message: `${location} must be a string.` });
    else {
      if (typeof schema.maxLength === 'number' && value.length > schema.maxLength)
        issues.push({ code: 'schema-limit', message: `${location} is too long.` });
      if (typeof schema.minLength === 'number' && value.length < schema.minLength)
        issues.push({ code: 'schema-limit', message: `${location} is too short.` });
      if (Array.isArray(schema.enum) && !schema.enum.includes(value))
        issues.push({ code: 'schema-enum', message: `${location} is not an allowed value.` });
    }
  } else if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || (type === 'integer' && !Number.isInteger(value)))
      issues.push({ code: 'schema-type', message: `${location} must be ${type}.` });
    else {
      if (typeof schema.minimum === 'number' && value < schema.minimum)
        issues.push({ code: 'schema-range', message: `${location} is below its minimum.` });
      if (typeof schema.maximum === 'number' && value > schema.maximum)
        issues.push({ code: 'schema-range', message: `${location} is above its maximum.` });
    }
  }
  return issues;
}

export function evaluateReviewFindings(
  findings: AiQualityReviewFinding[],
  allowedPaths: readonly string[],
  boundedDiff: string
): AiQualityIssue[] {
  const allowed = new Set(allowedPaths);
  const issues: AiQualityIssue[] = [];
  for (const finding of findings) {
    if (!allowed.has(finding.filePath))
      issues.push({
        code: 'unsupported-path',
        message: `Finding uses unsupported path ${finding.filePath}.`,
      });
    if (finding.confidence < 0 || finding.confidence > 1)
      issues.push({
        code: 'confidence-range',
        message: 'Finding confidence must be between 0 and 1.',
      });
    for (const evidence of finding.evidence) {
      if (!allowed.has(evidence.filePath))
        issues.push({
          code: 'unsupported-evidence-path',
          message: `Evidence uses unsupported path ${evidence.filePath}.`,
        });
      if (!evidence.excerpt || !boundedDiff.includes(evidence.excerpt))
        issues.push({
          code: 'unsupported-evidence',
          message: 'Evidence excerpt is not present in the bounded diff.',
        });
    }
  }
  return issues;
}

export function evaluateCommitMessage(
  subject: string,
  body: string,
  style: { subjectMaxLength: number; prefixes?: string[] }
): AiQualityIssue[] {
  const issues: AiQualityIssue[] = [];
  if (!subject.trim() || /[\r\n]/.test(subject))
    issues.push({ code: 'invalid-subject', message: 'Subject must be one non-empty line.' });
  if (subject.length > style.subjectMaxLength)
    issues.push({
      code: 'subject-length',
      message: `Subject exceeds ${style.subjectMaxLength} characters.`,
    });
  if (style.prefixes?.length && !style.prefixes.some((prefix) => subject.startsWith(prefix)))
    issues.push({
      code: 'repository-style',
      message: 'Subject does not match an approved repository prefix.',
    });
  if (body.length > 100_000)
    issues.push({ code: 'body-length', message: 'Body exceeds the evaluation safety limit.' });
  return issues;
}

export function evaluateConflictProposal(
  proposal: { proposedMergedText: string; unresolvedQuestions: string[] },
  options: { allowConflictMarkers: boolean; expectUnresolvedQuestions: boolean }
): AiQualityIssue[] {
  const issues: AiQualityIssue[] = [];
  if (!options.allowConflictMarkers && /^(?:<{7}|={7}|>{7})/m.test(proposal.proposedMergedText))
    issues.push({
      code: 'conflict-marker',
      message: 'Proposal contains unresolved conflict markers.',
    });
  if (options.expectUnresolvedQuestions && proposal.unresolvedQuestions.length === 0)
    issues.push({
      code: 'missing-question',
      message: 'Ambiguous conflict should retain an unresolved question.',
    });
  return issues;
}

export function evaluateReleaseTraceability(
  references: readonly string[],
  fixtureRevisions: readonly number[]
): AiQualityIssue[] {
  const issues: AiQualityIssue[] = [];
  const allowed = new Set(fixtureRevisions);
  const mentioned = new Set<number>();
  for (const reference of references) {
    for (const match of reference.matchAll(/\br(\d+)\b/gi)) {
      const revision = Number(match[1]);
      mentioned.add(revision);
      if (!allowed.has(revision))
        issues.push({ code: 'unsupported-revision', message: `Reference invents r${revision}.` });
    }
  }
  for (const revision of allowed)
    if (!mentioned.has(revision))
      issues.push({
        code: 'missing-revision',
        message: `Release output does not trace to r${revision}.`,
      });
  return issues;
}
