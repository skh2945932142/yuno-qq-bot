# Quick Start

1. Run npm ci and copy env.server.example to .env.
2. Set the required Koishi, LLBot WebSocket, MongoDB, metrics, and model variables.
3. Configure ONEBOT_TRANSPORT=ws and ONEBOT_ENDPOINT=ws://<llbot-host>:3000 on the private network.
4. Start with YUNO_PLUGIN_MODE=shadow and validate group/private, mention, reply, attachment, poke, and member-added mappings.
5. Change to active, then run npm run doctor, npm run smoke:mock, and npm test.

The unified runtime does not use AstrBot or a Yuno HTTP bridge.