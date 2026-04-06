import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, normalize } from 'node:path';

const SCHEMA_VERSION = 1;
const CATEGORY_SEGMENTS_MIN = 3;
const FINGERPRINT_LENGTH = 16;

const parseArguments = argv => {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith('--')) {
      args[key] = 'true';
      continue;
    }

    args[key] = value;
    index += 1;
  }

  return args;
};

const classifyPathFamily = value => {
  const filePath = value.toLowerCase();

  if (
    filePath.includes('__generated__') ||
    filePath.includes('/generated/') ||
    filePath.includes('/codegen/') ||
    filePath.endsWith('.generated.ts') ||
    filePath.endsWith('.generated.tsx')
  ) {
    return 'generated';
  }

  if (
    filePath.includes('/__tests__/') ||
    filePath.includes('.test.') ||
    filePath.includes('.spec.')
  ) {
    return 'test';
  }

  if (filePath.endsWith('.md') || filePath.endsWith('.mdx')) {
    return 'docs';
  }

  if (
    filePath.endsWith('package.json') ||
    filePath.endsWith('tsconfig.json') ||
    filePath.endsWith('.yaml') ||
    filePath.endsWith('.yml')
  ) {
    return 'config';
  }

  if (filePath.includes('/scripts/') || filePath.includes('/bin/')) {
    return 'scripts';
  }

  return 'core';
};

const extractRule = category => {
  if (typeof category !== 'string') {
    return { domain: 'unknown', rule: 'unknown', category: 'unknown' };
  }

  const normalizedCategory = category.trim();
  const parts = normalizedCategory.split('/');

  if (parts.length >= CATEGORY_SEGMENTS_MIN) {
    return {
      category: normalizedCategory,
      domain: parts[1] ?? 'unknown',
      rule: parts[2] ?? 'unknown',
    };
  }

  return {
    category: normalizedCategory,
    domain: parts[0] ?? 'unknown',
    rule: parts[1] ?? parts[0] ?? 'unknown',
  };
};

const extractPath = location => {
  const locationPath = location?.path;

  if (typeof locationPath === 'string') {
    return normalize(locationPath);
  }

  if (typeof locationPath?.file === 'string') {
    return normalize(locationPath.file);
  }

  if (typeof location?.resource === 'string') {
    return normalize(location.resource);
  }

  return 'unknown';
};

const extractLineAndColumn = location => {
  if (location?.start && typeof location.start.line === 'number') {
    return {
      line: location.start.line,
      column: location.start.column ?? 1,
    };
  }

  const span = location?.span;

  if (span?.start && typeof span.start.line === 'number') {
    return {
      line: span.start.line,
      column: span.start.column ?? 1,
    };
  }

  if (Array.isArray(span) && typeof span[0]?.line === 'number') {
    return {
      line: span[0].line,
      column: span[0].column ?? 1,
    };
  }

  return { line: 1, column: 1 };
};

const normalizeMessage = value => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim();
};

const isFixableDiagnostic = diagnostic => {
  const tags = Array.isArray(diagnostic?.tags)
    ? diagnostic.tags.map(tag => String(tag).toLowerCase())
    : [];

  if (tags.some(tag => tag.includes('fix'))) {
    return true;
  }

  if (Array.isArray(diagnostic?.suggestedFixes)) {
    return diagnostic.suggestedFixes.length > 0;
  }

  if (Array.isArray(diagnostic?.fixes)) {
    return diagnostic.fixes.length > 0;
  }

  if (diagnostic?.fix) {
    return true;
  }

  if (Array.isArray(diagnostic?.advices)) {
    return diagnostic.advices.some(advice => advice?.category === 'action');
  }

  return false;
};

const createFingerprint = input => {
  return createHash('sha256')
    .update(input)
    .digest('hex')
    .slice(0, FINGERPRINT_LENGTH);
};

const createNormalizedDiagnostic = diagnostic => {
  const location = diagnostic?.location ?? {};
  const filePath = extractPath(location);
  const { domain, rule, category } = extractRule(diagnostic?.category);
  const { line, column } = extractLineAndColumn(location);
  const message = normalizeMessage(
    diagnostic?.description ?? diagnostic?.message,
  );
  const severity = String(diagnostic?.severity ?? 'unknown').toLowerCase();
  const fixable = isFixableDiagnostic(diagnostic);
  const pathFamily = classifyPathFamily(filePath);

  const fingerprint = createFingerprint(
    `${category}|${filePath}|${line}|${column}|${message}`,
  );

  return {
    category,
    column,
    domain,
    filePath,
    fingerprint,
    fixable,
    line,
    message,
    pathFamily,
    rule,
    severity,
  };
};

const ensureOutputDirectory = async outputPath => {
  await mkdir(dirname(outputPath), { recursive: true });
};

const createSortedDiagnostics = parsed => {
  const rawDiagnostics = Array.isArray(parsed?.diagnostics)
    ? parsed.diagnostics
    : [];

  return rawDiagnostics.map(createNormalizedDiagnostic).sort((left, right) => {
    if (left.filePath !== right.filePath) {
      return left.filePath.localeCompare(right.filePath);
    }

    if (left.line !== right.line) {
      return left.line - right.line;
    }

    if (left.column !== right.column) {
      return left.column - right.column;
    }

    if (left.rule !== right.rule) {
      return left.rule.localeCompare(right.rule);
    }

    return left.fingerprint.localeCompare(right.fingerprint);
  });
};

const createRunMetadata = args => {
  return {
    baseSha: args['base-sha'] ?? '',
    biomeVersion: args['biome-version'] ?? '',
    prNumber: args.pr ?? '',
    repo: args.repo ?? 'unknown',
    runId: args['run-id'] ?? '',
    sha: args.sha ?? '',
    sharedConfigVersion: args['shared-config-version'] ?? '',
    localConfigHash: args['local-config-hash'] ?? '',
    driftOwnerNote: args['drift-owner-note'] ?? '',
    timestamp: args.timestamp ?? new Date().toISOString(),
  };
};

const createSummary = (parsed, diagnostics) => {
  return {
    diagnostics: diagnostics.length,
    errors: Number(parsed?.summary?.errors ?? 0),
    fixable: diagnostics.filter(diagnostic => diagnostic.fixable).length,
    infos: Number(parsed?.summary?.infos ?? 0),
    warnings: Number(parsed?.summary?.warnings ?? 0),
  };
};

const main = async () => {
  const args = parseArguments(process.argv.slice(2));
  const inputPath = args.input;
  const outputPath = args.output;

  if (!(inputPath && outputPath)) {
    throw new Error(
      'Usage: node normalize.mjs --input <biome.json> --output <normalized.json> [--repo <name>] [--sha <sha>] [--pr <number>]',
    );
  }

  const rawContent = await readFile(inputPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    // If it's not valid JSON, it might be empty or contain error text
    // Create an empty result
    parsed = {
      diagnostics: [],
      summary: { errors: 0, warnings: 0, infos: 0 },
    };
  }
  const diagnostics = createSortedDiagnostics(parsed);

  const normalized = {
    generatedAt: new Date().toISOString(),
    run: createRunMetadata(args),
    schemaVersion: SCHEMA_VERSION,
    summary: createSummary(parsed, diagnostics),
    diagnostics,
  };

  await ensureOutputDirectory(outputPath);
  await writeFile(outputPath, `${JSON.stringify(normalized, null, 2)}\n`);
};

await main();
