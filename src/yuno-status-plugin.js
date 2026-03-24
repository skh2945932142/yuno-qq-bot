import { buildWorkflowContext } from './message-workflow.js';
import { parseCommand } from './command-parser.js';
import { registerQueryTools } from './query-tools.js';
import { toolRegistry } from './tools/registry.js';

registerQueryTools(toolRegistry);

export function createYunoStatusPlugin({ runConversation } = {}) {
  return {
    name: 'yuno-status',
    priority: 30,
    match(context) {
      return Boolean(parseCommand(context.message || context.rawMessage || context.text || ''));
    },
    async handle(context) {
      const input = context.input;
      const event = context.event;
      const command = parseCommand(input.rawMessage);
      if (!command?.toolName) {
        return null;
      }

      const workflowContext = await buildWorkflowContext(event, null, {
        toolRegistry,
      });
      const toolResult = await toolRegistry.execute(command.toolName, {}, {
        relation: workflowContext.relation,
        userState: workflowContext.userState,
        userProfile: workflowContext.userProfile,
        groupState: workflowContext.groupState,
        event,
      });

      return runConversation(input, {
        responseMode: 'capture',
        toolResult: {
          tool: command.toolName,
          payload: toolResult.data || {},
          summary: toolResult.text || '',
          visibility: 'default',
          safetyFlags: [],
        },
      });
    },
  };
}
