import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';

const DAYS_PER_WEEK = 7;
const ISO_WEEK_OFFSET = 4;
const MILLISECONDS_PER_DAY = 86_400_000;
const PERCENT_SCALE = 100;
const PERCENT_DIGITS = 1;
const TOP_NOISY_RULES_PER_REPO = 5;
const TOP_AUTOFIX_RULES = 20;

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

const toIsoWeek = dateValue => {
  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }

  const workingDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = workingDate.getUTCDay() || DAYS_PER_WEEK;

  workingDate.setUTCDate(workingDate.getUTCDate() + ISO_WEEK_OFFSET - day);

  const yearStart = new Date(Date.UTC(workingDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(
    ((workingDate - yearStart) / MILLISECONDS_PER_DAY + 1) / DAYS_PER_WEEK,
  );
  const week = String(weekNumber).padStart(2, '0');

  return `${workingDate.getUTCFullYear()}-W${week}`;
};

const collectJsonFiles = async root => {
  const entries = await readdir(root, { withFileTypes: true });

  const nestedLists = await Promise.all(
    entries.map(entry => {
      const absolutePath = join(root, entry.name);

      if (entry.isDirectory()) {
        return collectJsonFiles(absolutePath);
      }

      if (entry.isFile() && extname(entry.name) === '.json') {
        return [absolutePath];
      }

      return [];
    }),
  );

  return nestedLists.flat();
};

const loadArtifacts = async inputDirectory => {
  const files = await collectJsonFiles(inputDirectory);
  const parsedFiles = await Promise.all(
    files.map(async file => {
      const rawContent = await readFile(file, 'utf8');
      return JSON.parse(rawContent);
    }),
  );

  const artifacts = parsedFiles.filter(parsed => {
    return Array.isArray(parsed?.diagnostics) && parsed?.run?.repo;
  });

  return artifacts.sort((left, right) => {
    return String(left.run.repo).localeCompare(String(right.run.repo));
  });
};

const formatPercent = value => {
  return `${(value * PERCENT_SCALE).toFixed(PERCENT_DIGITS)}%`;
};

const topNoisyRulesByRepo = artifacts => {
  const map = new Map();

  for (const artifact of artifacts) {
    const repo = artifact.run.repo;

    if (!map.has(repo)) {
      map.set(repo, new Map());
    }

    const repoRules = map.get(repo);

    for (const diagnostic of artifact.diagnostics) {
      const ruleKey = `${diagnostic.domain}/${diagnostic.rule}`;
      const current = repoRules.get(ruleKey) ?? 0;
      repoRules.set(ruleKey, current + 1);
    }
  }

  const rows = [];

  for (const [repo, rules] of map.entries()) {
    const topRules = Array.from(rules.entries())
      .sort((left, right) => {
        if (left[1] !== right[1]) {
          return right[1] - left[1];
        }

        return left[0].localeCompare(right[0]);
      })
      .slice(0, TOP_NOISY_RULES_PER_REPO);

    for (const [rule, count] of topRules) {
      rows.push({ count, repo, rule });
    }
  }

  return rows.sort((left, right) => {
    if (left.repo !== right.repo) {
      return left.repo.localeCompare(right.repo);
    }

    if (left.count !== right.count) {
      return right.count - left.count;
    }

    return left.rule.localeCompare(right.rule);
  });
};

const autofixRateByRule = artifacts => {
  const map = new Map();

  for (const artifact of artifacts) {
    for (const diagnostic of artifact.diagnostics) {
      const key = `${diagnostic.domain}/${diagnostic.rule}`;

      if (!map.has(key)) {
        map.set(key, { fixable: 0, total: 0 });
      }

      const item = map.get(key);
      item.total += 1;

      if (diagnostic.fixable) {
        item.fixable += 1;
      }
    }
  }

  return Array.from(map.entries())
    .map(([rule, metrics]) => {
      const rate = metrics.total === 0 ? 0 : metrics.fixable / metrics.total;

      return {
        fixable: metrics.fixable,
        rate,
        rule,
        total: metrics.total,
      };
    })
    .sort((left, right) => {
      if (left.total !== right.total) {
        return right.total - left.total;
      }

      if (left.rate !== right.rate) {
        return right.rate - left.rate;
      }

      return left.rule.localeCompare(right.rule);
    })
    .slice(0, TOP_AUTOFIX_RULES);
};

const configDriftRows = artifacts => {
  const latestByRepo = new Map();

  for (const artifact of artifacts) {
    const repo = artifact.run.repo;
    const timestamp = Date.parse(
      artifact.run.timestamp ?? artifact.generatedAt ?? '',
    );
    const existing = latestByRepo.get(repo);

    if (!existing) {
      latestByRepo.set(repo, artifact);
      continue;
    }

    const existingTimestamp = Date.parse(
      existing.run.timestamp ?? existing.generatedAt ?? '',
    );

    if (
      (Number.isFinite(timestamp) ? timestamp : 0) >
      (Number.isFinite(existingTimestamp) ? existingTimestamp : 0)
    ) {
      latestByRepo.set(repo, artifact);
    }
  }

  return Array.from(latestByRepo.entries())
    .map(([repo, artifact]) => {
      const shared = artifact.run.sharedConfigVersion || 'unknown';
      const local = artifact.run.localConfigHash || 'unknown';

      let status = 'unknown';

      if (shared !== 'unknown' && local !== 'unknown') {
        status = shared === local ? 'aligned' : 'drift';
      }

      return {
        local,
        note: artifact.run.driftOwnerNote || 'none',
        repo,
        shared,
        status,
      };
    })
    .sort((left, right) => left.repo.localeCompare(right.repo));
};

const weeklyTrendRows = artifacts => {
  const repoWeekCount = new Map();

  for (const artifact of artifacts) {
    const repo = artifact.run.repo;
    const week = toIsoWeek(artifact.run.timestamp ?? artifact.generatedAt);

    if (!repoWeekCount.has(repo)) {
      repoWeekCount.set(repo, new Map());
    }

    const weekMap = repoWeekCount.get(repo);
    const previous = weekMap.get(week) ?? 0;
    weekMap.set(week, previous + artifact.diagnostics.length);
  }

  const rows = [];

  for (const [repo, weeks] of repoWeekCount.entries()) {
    const orderedWeeks = Array.from(weeks.entries()).sort((left, right) => {
      return left[0].localeCompare(right[0]);
    });

    const current = orderedWeeks.at(-1) ?? ['unknown', 0];
    const previous = orderedWeeks.at(-2) ?? ['unknown', 0];
    const delta = current[1] - previous[1];
    let direction = 'flat';

    if (delta > 0) {
      direction = 'up';
    } else if (delta < 0) {
      direction = 'down';
    }

    rows.push({
      currentCount: current[1],
      currentWeek: current[0],
      delta,
      direction,
      previousCount: previous[1],
      previousWeek: previous[0],
      repo,
    });
  }

  return rows.sort((left, right) => left.repo.localeCompare(right.repo));
};

const renderTable = (headers, rows) => {
  const lines = [];

  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);

  for (const row of rows) {
    lines.push(`| ${row.join(' | ')} |`);
  }

  return lines.join('\n');
};

const main = async () => {
  const args = parseArguments(process.argv.slice(2));
  const inputDirectory = args['input-dir'];
  const outputPath = args.output;

  if (!(inputDirectory && outputPath)) {
    throw new Error(
      'Usage: node summarize.mjs --input-dir <directory> --output <summary.md>',
    );
  }

  const artifacts = await loadArtifacts(inputDirectory);
  const noisyRules = topNoisyRulesByRepo(artifacts);
  const autofixRows = autofixRateByRule(artifacts);
  const driftRows = configDriftRows(artifacts);
  const trendRows = weeklyTrendRows(artifacts);

  const totalDiagnostics = artifacts.reduce((count, artifact) => {
    return count + artifact.diagnostics.length;
  }, 0);

  const markdownLines = [];

  markdownLines.push('# Biome Insights Summary');
  markdownLines.push('');
  markdownLines.push(`Generated: ${new Date().toISOString()}`);
  markdownLines.push(`Artifacts processed: ${artifacts.length}`);
  markdownLines.push(`Diagnostics processed: ${totalDiagnostics}`);
  markdownLines.push('');

  markdownLines.push('## Top noisy rules by repo');
  markdownLines.push('');

  if (noisyRules.length === 0) {
    markdownLines.push('No diagnostics found.');
  } else {
    markdownLines.push(
      renderTable(
        ['Repo', 'Rule', 'Count'],
        noisyRules.map(row => [row.repo, row.rule, String(row.count)]),
      ),
    );
  }

  markdownLines.push('');
  markdownLines.push('## Autofix rate by rule');
  markdownLines.push('');

  if (autofixRows.length === 0) {
    markdownLines.push('No diagnostics found.');
  } else {
    markdownLines.push(
      renderTable(
        ['Rule', 'Total', 'Fixable', 'Autofix rate'],
        autofixRows.map(row => [
          row.rule,
          String(row.total),
          String(row.fixable),
          formatPercent(row.rate),
        ]),
      ),
    );
  }

  markdownLines.push('');
  markdownLines.push('## Config drift matrix');
  markdownLines.push('');

  if (driftRows.length === 0) {
    markdownLines.push('No artifacts found.');
  } else {
    markdownLines.push(
      renderTable(
        ['Repo', 'Shared config', 'Local config', 'Status', 'Owner note'],
        driftRows.map(row => [
          row.repo,
          row.shared,
          row.local,
          row.status,
          row.note,
        ]),
      ),
    );
  }

  markdownLines.push('');
  markdownLines.push('## Weekly trend');
  markdownLines.push('');

  if (trendRows.length === 0) {
    markdownLines.push('No artifacts found.');
  } else {
    markdownLines.push(
      renderTable(
        [
          'Repo',
          'Current week',
          'Current',
          'Previous week',
          'Previous',
          'Delta',
          'Direction',
        ],
        trendRows.map(row => [
          row.repo,
          row.currentWeek,
          String(row.currentCount),
          row.previousWeek,
          String(row.previousCount),
          String(row.delta),
          row.direction,
        ]),
      ),
    );
  }

  markdownLines.push('');

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${markdownLines.join('\n')}\n`);
};

await main();
