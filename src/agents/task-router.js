import { parseCommand } from '../services/commands.js';
import { mapCommandToTool } from '../tools/query-tools.js';

export function planIncomingTask({ text, analysis }) {
  const command = parseCommand(text);
  const tool = mapCommandToTool(command);

  if (tool) {
    return {
      type: 'tool',
      toolName: tool.name,
      toolArgs: tool.args,
      requiresModel: false,
      reason: `command:${command.type}`,
    };
  }

  if (!analysis.shouldRespond) {
    return {
      type: 'ignore',
      requiresModel: false,
      reason: analysis.reason,
    };
  }

  return {
    type: 'chat',
    requiresModel: true,
    reason: analysis.reason,
  };
}
