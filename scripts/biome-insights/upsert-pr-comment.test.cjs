const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const { upsertBiomeChangedFilesComment } = require('./upsert-pr-comment.cjs');

const UPDATED_COMMENT_ID = 1337;
const ERRORS_ON_CHANGED_FILES_PATTERN = /Errors on changed files: \*\*1\*\*/;
const CHANGED_FILES_WITH_ERRORS_PATTERN =
  /Changed files with errors: \*\*1\*\*/;
const INCLUDED_FILE_PATTERN = /`src\/one.ts`/;
const EXCLUDED_UNTOUCHED_FILE_PATTERN = /src\/not-touched.ts/;
const EXCLUDED_WARNING_FILE_PATTERN = /src\/two.ts/;

const noop = () => undefined;

const createArtifact = async (directory, diagnostics) => {
  const artifactPath = join(directory, 'biome-normalized.json');
  const payload = {
    diagnostics,
  };

  await writeFile(artifactPath, `${JSON.stringify(payload)}\n`);
  return artifactPath;
};

test('creates PR comment with touched-file errors only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'biome-pr-comment-'));

  try {
    const artifactPath = await createArtifact(directory, [
      {
        category: 'lint/suspicious/noDebugger',
        domain: 'suspicious',
        filePath: 'src/one.ts',
        fingerprint: 'a',
        line: 5,
        message: 'Avoid debugger statement',
        rule: 'noDebugger',
        severity: 'error',
      },
      {
        category: 'lint/style/useTemplate',
        domain: 'style',
        filePath: 'src/two.ts',
        fingerprint: 'b',
        line: 7,
        message: 'Use template strings',
        rule: 'useTemplate',
        severity: 'warning',
      },
      {
        category: 'lint/style/useTemplate',
        domain: 'style',
        filePath: 'src/not-touched.ts',
        fingerprint: 'c',
        line: 2,
        message: 'Use template strings',
        rule: 'useTemplate',
        severity: 'error',
      },
    ]);

    let createdBody = '';
    const github = {
      paginate: endpoint => {
        if (endpoint === 'listFiles') {
          return Promise.resolve([
            { filename: 'src/one.ts', status: 'modified' },
            { filename: 'src/two.ts', status: 'modified' },
          ]);
        }

        if (endpoint === 'listComments') {
          return Promise.resolve([]);
        }

        return Promise.resolve([]);
      },
      rest: {
        pulls: {
          listFiles: 'listFiles',
        },
        issues: {
          createComment: ({ body }) => {
            createdBody = body;
            return Promise.resolve();
          },
          listComments: 'listComments',
          updateComment: () => Promise.resolve(),
        },
      },
    };

    const context = {
      payload: {
        pull_request: {
          number: 42,
        },
      },
      repo: {
        owner: 'nivalis-studio',
        repo: 'example',
      },
    };

    const core = { info: noop, warning: noop };

    await upsertBiomeChangedFilesComment({
      artifactPath,
      context,
      core,
      github,
    });

    assert.match(createdBody, ERRORS_ON_CHANGED_FILES_PATTERN);
    assert.match(createdBody, CHANGED_FILES_WITH_ERRORS_PATTERN);
    assert.match(createdBody, INCLUDED_FILE_PATTERN);
    assert.doesNotMatch(createdBody, EXCLUDED_UNTOUCHED_FILE_PATTERN);
    assert.doesNotMatch(createdBody, EXCLUDED_WARNING_FILE_PATTERN);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('updates existing marker comment when present', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'biome-pr-comment-'));

  try {
    const artifactPath = await createArtifact(directory, [
      {
        category: 'lint/suspicious/noDebugger',
        domain: 'suspicious',
        filePath: 'src/one.ts',
        fingerprint: 'a',
        line: 5,
        message: 'Avoid debugger statement',
        rule: 'noDebugger',
        severity: 'error',
      },
    ]);

    let updatedCommentId = null;
    const github = {
      paginate: endpoint => {
        if (endpoint === 'listFiles') {
          return Promise.resolve([
            { filename: 'src/one.ts', status: 'modified' },
          ]);
        }

        if (endpoint === 'listComments') {
          return Promise.resolve([
            {
              body: '<!-- nivalis-biome-insights:changed-files-errors:v1 -->',
              id: UPDATED_COMMENT_ID,
            },
          ]);
        }

        return Promise.resolve([]);
      },
      rest: {
        pulls: {
          listFiles: 'listFiles',
        },
        issues: {
          createComment: () => Promise.resolve(),
          listComments: 'listComments',
          updateComment: ({ comment_id }) => {
            updatedCommentId = comment_id;
            return Promise.resolve();
          },
        },
      },
    };

    const context = {
      payload: {
        pull_request: {
          number: 42,
        },
      },
      repo: {
        owner: 'nivalis-studio',
        repo: 'example',
      },
    };

    const core = { info: noop, warning: noop };

    await upsertBiomeChangedFilesComment({
      artifactPath,
      context,
      core,
      github,
    });

    assert.equal(updatedCommentId, UPDATED_COMMENT_ID);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
