# Quick Start

1. Run npm ci and copy env.server.example to .env.
2. Set the required Koishi, OneBot, MongoDB, metrics, and model variables.
3. Configure the OneBot event callback as http://<koishi-host>:5140/onebot.
4. Start with YUNO_PLUGIN_MODE=shadow and validate group/private, mention, reply, attachment, poke, and member-added mappings.
5. Change to active, then run npm run doctor, npm run smoke:mock, and npm test.

The unified runtime does not use AstrBot or a Yuno HTTP bridge.