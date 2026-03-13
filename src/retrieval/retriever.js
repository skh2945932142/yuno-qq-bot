export async function retrieveKnowledge(query, options = {}) {
  return {
    enabled: false,
    query,
    source: 'none',
    documents: [],
    reason: options.reason || 'No retrieval pipeline is configured yet',
  };
}
