import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, normalize } from 'node:path';

const SCHEMA_VERSION = 1;
const MIN_CATEGORY_PARTS = 3;
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
    } else {
      args[key] = value;
      index += 1;
    }
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

  if (parts.length >= MIN_CATEGORY_PARTS) {
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

const normalizeDiagnostic = diagnostic => {
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

const sortDiagnostics = (left, right) => {
  const pathCompare = left.filePath.localeCompare(right.filePath);
  if (pathCompare !== 0) {
    return pathCompare;
  }

  const lineCompare = left.line - right.line;
  if (lineCompare !== 0) {
    return lineCompare;
  }

  const colCompare = left.column - right.column;
  if (colCompare !== 0) {
    return colCompare;
  }

  const ruleCompare = left.rule.localeCompare(right.rule);
  if (ruleCompare !== 0) {
    return ruleCompare;
  }

  return left.fingerprint.localeCompare(right.fingerprint);
};

const processDiagnostics = parsed => {
  const rawDiagnostics = Array.isArray(parsed?.diagnostics)
    ? parsed.diagnostics
    : [];
  return rawDiagnostics.map(normalizeDiagnostic).sort(sortDiagnostics);
};

const createRunMetadata = args => ({
  baseSha: args['base-sha'] ?? '',
  biomeVersion: args['biome-version'] ?? '',
  prNumber: args.pr ?? '',
  repo: args.repo ?? 'unknown',
  runId: args['run-id'] ?? '',
  sha: args.sha ?? '',
  sharedConfigVersion: args['shared-config-version'] ?? '',
  localConfigHash: args['local-config-hash'] ?? '',
  timestamp: args.timestamp ?? new Date().toISOString(),
});

const createSummary = (parsed, diagnostics) => ({
  diagnostics: diagnostics.length,
  errors: Number(parsed?.summary?.errors ?? 0),
  fixable: diagnostics.filter(d => d.fixable).length,
  infos: Number(parsed?.summary?.infos ?? 0),
  warnings: Number(parsed?.summary?.warnings ?? 0),
});

const loadBiomeOutput = async inputPath => {
  let rawContent;
  try {
    rawContent = await readFile(inputPath, 'utf8');
  } catch {
    return { diagnostics: [], summary: { errors: 0, warnings: 0, infos: 0 } };
  }

  try {
    return JSON.parse(rawContent);
  } catch {
    return { diagnostics: [], summary: { errors: 0, warnings: 0, infos: 0 } };
  }
};

const main = async () => {
  const args = parseArguments(process.argv.slice(2));
  const inputPath = args.input;
  const outputPath = args.output;

  if (!(inputPath && outputPath)) {
    throw new Error(
      'Usage: node normalize.mjs --input <biome.json> --output <normalized.json>',
    );
  }

  const parsed = await loadBiomeOutput(inputPath);
  const diagnostics = processDiagnostics(parsed);

  const normalized = {
    generatedAt: new Date().toISOString(),
    run: createRunMetadata(args),
    schemaVersion: SCHEMA_VERSION,
    summary: createSummary(parsed, diagnostics),
    diagnostics,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(normalized, null, 2)}\n`);
};

await main();
