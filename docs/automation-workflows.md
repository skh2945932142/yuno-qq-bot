# Automation Workflows

This repo includes lightweight automations that turn existing code signals into practical development suggestions.

## Local Commands

- `npm run automation:ideas` prints a Yuno experience radar report.
- `npm run automation:ideas -- --write reports/experience-ideas.md` writes the report to a file.
- `npm run automation:dev-health` prints a development health report.
- `npm run automation:dev-health -- --write reports/dev-health.md` writes the report to a file.
- `npm run eval:report` runs the existing eval suite and writes `reports/eval-experience.md`.

## GitHub Actions

- `CI` keeps the correctness and security gate: tests, mock smoke, dependency audit, and secret scan.
- `Experience Radar` runs every Monday and can also be triggered manually.
- The scheduled radar run uploads markdown reports and opens a GitHub issue with the eval experience scorecard, concrete product ideas, and developer-efficiency risks.

## What The Radar Looks For

- Eval scenario coverage, correctness, and four experience dimensions: naturalness, memory use, false-trigger control, and reply-length fit.
- Prompt and workflow guards such as hidden-reasoning rules, memory context, and reply budget.
- Command surface area, TODO/FIXME/HACK markers, security automation, and docs coverage.
- Product ideas that improve companion quality without forcing the bot to speak more often.

## Operational Notes

- The radar does not call external AI APIs; suggestions are deterministic and safe to run in CI.
- `expectedExperience` is optional in `evals/scenarios.json`; the eval runner infers defaults from route/category when it is absent.
- Generated reports go under `reports/` and are not meant to be committed by default.
- If GitHub issue creation is too noisy, disable the `Create weekly idea issue` step and keep artifact uploads only.
