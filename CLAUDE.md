# Yuno QQ Bot Development Notes

The application is a single Koishi + Yuno Node.js runtime. Koishi owns OneBot 11 ingress and delivery; Yuno owns workflow, persona, memory, RAG, tools, queue workers, scheduler, and formatting.

Entry: src/index.js -> src/koishi-app.js -> src/koishi-yuno-plugin.js -> src/yuno-runtime.js -> src/message-workflow.js.

Do not add AstrBot plugins, a Yuno HTTP conversation API, standalone worker roles, or direct OneBot HTTP calls. Use src/koishi-session-adapter.js for event conversion, src/koishi-adapters.js for delivery/protocol actions, and src/sender.js as the runtime delivery facade.

Production configuration requires SELF_QQ, ADMIN_QQ, ONEBOT_ENDPOINT, KOISHI_MONGODB_URI, MONGODB_URI, console credentials when enabled, metrics token, and model credentials. Start rollout in YUNO_PLUGIN_MODE=shadow, then switch atomically to active.

Run npm test, npm run smoke:mock, and npm run doctor before deployment.