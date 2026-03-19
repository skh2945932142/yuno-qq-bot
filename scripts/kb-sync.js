import { syncKnowledgeBase } from '../src/knowledge-base.js';

async function main() {
  const result = await syncKnowledgeBase();
  const summary = result.enabled
    ? `knowledge sync completed: ${result.count} chunks -> ${result.collection}`
    : `knowledge sync skipped: ${result.reason}`;

  console.log(summary);
}

main().catch((error) => {
  console.error(`knowledge sync failed: ${error.message}`);
  process.exit(1);
});
