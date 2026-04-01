import { buildWorkflowContext } from './message-workflow.js';
import { parseCommand } from './command-parser.js';
import { registerQueryTools } from './query-tools.js';
import { createTraceContext } from './runtime-tracing.js';
import { toolRegistry } from './tools/registry.js';

registerQueryTools(toolRegistry);

export function createYunoStatusPlugin({
  runConversation,
  buildContext = buildWorkflowContext,
  registry = toolRegistry,
  createTrace = createTraceContext,
} = {}) {
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

      const trace = createTrace('status-plugin', {
        chatId: event.chatId,
        userId: event.userId,
      });
      const workflowContext = await buildContext(event, trace, {
        toolRegistry: registry,
      });
      const toolResult = await registry.execute(command.toolName, command.toolArgs || {}, {
        relation: workflowContext.relation,
        userState: workflowContext.userState,
        userProfile: workflowContext.userProfile,
        groupState: workflowContext.groupState,
        event,
      }, trace);

      return runConversation(input, {
        responseMode: 'capture',
        toolResult: {
          tool: toolResult.tool || command.toolName,
          payload: toolResult.payload || toolResult.data || {},
          summary: toolResult.summary || toolResult.text || '',
          priority: toolResult.priority || 'normal',
          visibility: toolResult.visibility || 'default',
          followUpHint: toolResult.followUpHint || '',
          safetyFlags: toolResult.safetyFlags || [],
        },
      });
    },
  };
}
