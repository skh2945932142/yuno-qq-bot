import {
  collectRepoFiles,
  countMatches,
  isCliEntrypoint,
  parseWriteArg,
  readJsonFile,
  readTextFile,
  writeReport,
} from './automation-utils.js';

function statusLabel(ok) {
  return ok ? 'PASS' : 'CHECK';
}

function daysUntil(dateText) {
  const timestamp = Date.parse(`${dateText}T23:59:59Z`);
  if (!Number.isFinite(timestamp)) return null;
  return Math.ceil((timestamp - Date.now()) / (24 * 60 * 60 * 1000));
}

export function collectDevHealthSignals() {
  const files = collectRepoFiles();
  const packageJson = readJsonFile('package.json', {});
  const allowlist = readJsonFile('security/audit-allowlist.json', {});
  const ci = readTextFile('.github/workflows/ci.yml');
  const circle = readTextFile('.circleci/config.yml');
  const readme = readTextFile('README.md');

  return {
    scripts: Object.keys(packageJson.scripts || {}),
    testFiles: files.filter((file) => /^phase1-.*\.test\.js$/.test(file) || file.startsWith('test/')).length,
    workflowCount: files.filter((file) => file.startsWith('.github/workflows/') && file.endsWith('.yml')).length,
    hasCircleCi: Boolean(circle.trim()),
    hasSecurityAudit: Boolean(packageJson.scripts?.['security:audit']),
    hasSecretScan: Boolean(packageJson.scripts?.['security:secrets']),
    hasMockSmoke: Boolean(packageJson.scripts?.['smoke:mock']),
    hasEval: Boolean(packageJson.scripts?.eval),
    allowlistExpiresOn: allowlist.expiresOn || '',
    allowlistDaysLeft: allowlist.expiresOn ? daysUntil(allowlist.expiresOn) : null,
    todoCount: countMatches(files.filter((file) => /\.(js|md|yml|json)$/.test(file)), /\b(?:TODO|FIXME|HACK)\b/g),
    docsMentionSecurity: /ONEBOT_WEBHOOK_SECRET|security:audit|METRICS_AUTH_TOKEN/.test(readme),
    ciRunsSecurity: /security:audit/.test(ci) && /security:secrets/.test(ci),
  };
}

export function renderDevHealthReport(signals = collectDevHealthSignals()) {
  const checks = [
    ['Unit/integration test script', signals.scripts.includes('test')],
    ['Eval scenarios script', signals.hasEval],
    ['Mock smoke script', signals.hasMockSmoke],
    ['Security audit script', signals.hasSecurityAudit],
    ['Secret scan script', signals.hasSecretScan],
    ['GitHub Actions security gates', signals.ciRunsSecurity],
    ['CircleCI config present', signals.hasCircleCi],
    ['Security docs present', signals.docsMentionSecurity],
    ['Audit allowlist has expiry', Boolean(signals.allowlistExpiresOn)],
  ];

  const checkRows = checks.map(([name, ok]) => (
    `| ${name} | ${statusLabel(ok)} |`
  )).join('\n');

  const risks = [];
  if (signals.allowlistDaysLeft !== null && signals.allowlistDaysLeft <= 30) {
    risks.push(`- Audit allowlist expires in ${signals.allowlistDaysLeft} days; review dependency fixes.`);
  }
  if (signals.todoCount > 0) {
    risks.push(`- ${signals.todoCount} TODO/FIXME/HACK markers remain; triage them before larger refactors.`);
  }
  if (!signals.hasCircleCi) {
    risks.push('- CircleCI config is missing; GitHub Actions is the only CI path.');
  }

  return [
    '# Yuno Development Health',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    '## Checks',
    '',
    '| Check | Status |',
    '|---|---|',
    checkRows,
    '',
    '## Metrics',
    '',
    `- npm scripts: ${signals.scripts.length}`,
    `- test files: ${signals.testFiles}`,
    `- GitHub workflow files: ${signals.workflowCount}`,
    `- security allowlist expiry: ${signals.allowlistExpiresOn || 'not set'}`,
    `- TODO/FIXME/HACK count: ${signals.todoCount}`,
    '',
    '## Risks To Triage',
    '',
    risks.length ? risks.join('\n') : '- No immediate automation risks detected.',
    '',
  ].join('\n');
}

if (isCliEntrypoint(import.meta.url)) {
  const report = renderDevHealthReport();
  const outputPath = parseWriteArg();
  if (outputPath) {
    const absolutePath = writeReport(outputPath, report);
    console.log(`Development health report written to ${absolutePath}`);
  } else {
    console.log(report);
  }
}
