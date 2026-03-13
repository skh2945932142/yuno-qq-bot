export function validateToolArgs(tool, args) {
  const schema = tool.inputSchema || { type: 'object', properties: {}, required: [] };
  const normalizedArgs = args && typeof args === 'object' ? args : {};
  const errors = [];

  if (schema.type && schema.type !== 'object') {
    errors.push('Only object tool schemas are supported');
  }

  for (const field of schema.required || []) {
    if (!(field in normalizedArgs)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  for (const [key, config] of Object.entries(schema.properties || {})) {
    if (!(key in normalizedArgs) || normalizedArgs[key] === undefined || normalizedArgs[key] === null) {
      continue;
    }

    const actualType = Array.isArray(normalizedArgs[key]) ? 'array' : typeof normalizedArgs[key];
    if (config.type && actualType !== config.type) {
      errors.push(`Field ${key} should be ${config.type}, got ${actualType}`);
    }

    if (config.enum && !config.enum.includes(normalizedArgs[key])) {
      errors.push(`Field ${key} must be one of: ${config.enum.join(', ')}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
