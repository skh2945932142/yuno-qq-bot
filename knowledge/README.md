# Knowledge Base

This directory stores Markdown documents for persona, rules, FAQ, and world knowledge.

Each file can optionally include:

- `Tags: tag1, tag2`
- `Priority: 1`

The `npm run kb:sync` command reads this directory, chunks the documents, embeds them, and uploads them to Qdrant.
