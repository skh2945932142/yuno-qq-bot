export function createToolPort(execute) {
  if (typeof execute !== 'function') throw new Error('TOOL_PORT_EXECUTE_REQUIRED');
  return Object.freeze({ execute });
}
