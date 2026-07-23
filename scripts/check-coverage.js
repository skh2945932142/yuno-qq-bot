import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32'
  ? (process.env.ComSpec || 'cmd.exe')
  : 'npm';
const npmArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm run test:coverage']
  : ['run', 'test:coverage'];
const coverageRun = spawnSync(npmCommand, npmArgs, {
  stdio: 'inherit',
  shell: false,
});

if (coverageRun.error) {
  console.error(`Failed to run coverage: ${coverageRun.error.message}`);
  process.exit(1);
}

if (coverageRun.status !== 0) {
  process.exit(coverageRun.status || 1);
}

const summaryPath = path.resolve('coverage', 'coverage-summary.json');
if (!fs.existsSync(summaryPath)) {
  console.error(`Coverage summary not found: ${summaryPath}`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const metrics = ['lines', 'branches', 'functions'];
const srcEntries = Object.entries(summary).filter(([filePath]) => {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.includes('/src/');
});

function aggregate(entries) {
  return Object.fromEntries(metrics.map((metric) => {
    const total = entries.reduce((sum, [, item]) => sum + item[metric].total, 0);
    const covered = entries.reduce((sum, [, item]) => sum + item[metric].covered, 0);
    return [metric, { total, covered, pct: total === 0 ? 100 : (covered / total) * 100 }];
  }));
}

function formatPct(value) {
  return `${value.toFixed(2)}%`;
}

function assertMetric(label, actual, minimum, failures) {
  if (actual.pct < minimum) {
    failures.push(`${label}: ${formatPct(actual.pct)} < ${minimum}%`);
  }
}

const failures = [];
const srcSummary = aggregate(srcEntries);
assertMetric('src lines', srcSummary.lines, 80, failures);
assertMetric('src branches', srcSummary.branches, 70, failures);
assertMetric('src functions', srcSummary.functions, 80, failures);

const criticalFiles = [
  'src/message-workflow.js',
  'src/message-analysis.js',
  'src/sender.js',
  'src/queue-manager.js',
  'src/astrbot-yuno-http-plugin.js',
];

for (const suffix of criticalFiles) {
  const entry = Object.entries(summary).find(([filePath]) => (
    filePath.replaceAll('\\', '/').endsWith(`/${suffix}`)
  ));
  if (!entry) {
    failures.push(`${suffix}: coverage entry missing`);
    continue;
  }
  const [, fileSummary] = entry;
  assertMetric(`${suffix} lines`, fileSummary.lines, 80, failures);
  assertMetric(`${suffix} branches`, fileSummary.branches, 70, failures);
}

console.log(`src coverage: lines=${formatPct(srcSummary.lines.pct)}, branches=${formatPct(srcSummary.branches.pct)}, functions=${formatPct(srcSummary.functions.pct)}`);

if (failures.length > 0) {
  console.error('Coverage gates failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Coverage gates passed.');
