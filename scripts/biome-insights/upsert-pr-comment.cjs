const fs = require('node:fs');
const path = require('node:path');

const MARKER = '<!-- nivalis-biome-insights:changed-files-errors:v1 -->';
const MAX_ROWS = 50;
const MESSAGE_MAX_LENGTH = 160;
const LEADING_DOT_SLASH_PATTERN = /^\.\//;
const LEADING_SLASH_PATTERN = /^\//;

const normalizePath = value => {
  return String(value ?? '')
    .replaceAll('\\', '/')
    .replace(LEADING_DOT_SLASH_PATTERN, '')
    .replace(LEADING_SLASH_PATTERN, '');
};

const sortDiagnostics = (left, right) => {
  const leftPath = normalizePath(left.filePath);
  const rightPath = normalizePath(right.filePath);

  if (leftPath !== rightPath) {
    return leftPath.localeCompare(rightPath);
  }

  const leftLine = Number(left.line ?? 0);
  const rightLine = Number(right.line ?? 0);

  if (leftLine !== rightLine) {
    return leftLine - rightLine;
  }

  const leftRule = `${left.domain}/${left.rule}`;
  const rightRule = `${right.domain}/${right.rule}`;

  if (leftRule !== rightRule) {
    return leftRule.localeCompare(rightRule);
  }

  return String(left.fingerprint ?? '').localeCompare(
    String(right.fingerprint ?? ''),
  );
};

const formatRule = diagnostic => {
  return `${diagnostic.domain}/${diagnostic.rule}`;
};

const formatMessage = diagnostic => {
  return String(diagnostic.message ?? '')
    .replace(/\s+/g, ' ')
    .trim();
};

const buildCommentBody = touchedErrors => {
  const filesWithErrors = new Set(
    touchedErrors.map(diagnostic => normalizePath(diagnostic.filePath)),
  );

  const displayRows = touchedErrors.slice(0, MAX_ROWS);
  const hiddenCount = touchedErrors.length - displayRows.length;
  const lines = [
    MARKER,
    '## Biome summary (changed files)',
    '',
    `- Errors on changed files: **${touchedErrors.length}**`,
    `- Changed files with errors: **${filesWithErrors.size}**`,
    '',
  ];

  if (touchedErrors.length === 0) {
    lines.push('No Biome errors found on touched files in this PR.');
  } else {
    lines.push('| File | Line | Rule | Message |');
    lines.push('| --- | --- | --- | --- |');

    for (const diagnostic of displayRows) {
      const filePath = normalizePath(diagnostic.filePath);
      const line = Number(diagnostic.line ?? 1);
      const rule = formatRule(diagnostic);
      const message = formatMessage(diagnostic)
        .replaceAll('|', '\\|')
        .slice(0, MESSAGE_MAX_LENGTH);

      lines.push(`| \`${filePath}\` | ${line} | \`${rule}\` | ${message} |`);
    }

    if (hiddenCount > 0) {
      lines.push('');
      lines.push(
        `Showing first ${MAX_ROWS} findings. ${hiddenCount} additional findings are omitted.`,
      );
    }
  }

  lines.push('');
  lines.push('_This comment is updated on each workflow run._');

  return lines.join('\n');
};

const getDiagnostics = (core, artifactPath) => {
  const resolvedPath = path.resolve(artifactPath);

  if (!fs.existsSync(resolvedPath)) {
    core.warning(`No normalized artifact found at ${resolvedPath}.`);
    return [];
  }

  const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  return Array.isArray(parsed?.diagnostics) ? parsed.diagnostics : [];
};

const getTouchedPaths = async (github, context, pullNumber) => {
  const changedFiles = await github.paginate(github.rest.pulls.listFiles, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  const touchedPaths = new Set();

  for (const file of changedFiles) {
    if (file.status !== 'removed') {
      touchedPaths.add(normalizePath(file.filename));
    }

    if (file.status === 'renamed' && file.previous_filename) {
      touchedPaths.add(normalizePath(file.previous_filename));
    }
  }

  return touchedPaths;
};

const upsertComment = async (github, context, pullNumber, body) => {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: pullNumber,
    per_page: 100,
  });

  const existingComment = comments.find(comment => {
    return comment.body?.includes(MARKER);
  });

  if (!existingComment) {
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: pullNumber,
      body,
    });

    return { created: true };
  }

  await github.rest.issues.updateComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    comment_id: existingComment.id,
    body,
  });

  return { commentId: existingComment.id, created: false };
};

const upsertBiomeChangedFilesComment = async ({
  artifactPath = '.biome-insights/biome-normalized.json',
  context,
  core,
  github,
}) => {
  const diagnostics = getDiagnostics(core, artifactPath);
  const pullNumber = context.payload.pull_request?.number;

  if (!pullNumber) {
    core.info('No pull request context found. Skipping comment.');
    return;
  }

  const touchedPaths = await getTouchedPaths(github, context, pullNumber);
  const touchedErrors = diagnostics
    .filter(diagnostic => {
      return (
        String(diagnostic?.severity).toLowerCase() === 'error' &&
        touchedPaths.has(normalizePath(diagnostic?.filePath))
      );
    })
    .sort(sortDiagnostics);

  const body = buildCommentBody(touchedErrors);
  const result = await upsertComment(github, context, pullNumber, body);

  if (result.created) {
    core.info('Created PR comment.');
    return;
  }

  core.info(`Updated PR comment ${result.commentId}.`);
};

module.exports = {
  upsertBiomeChangedFilesComment,
};
