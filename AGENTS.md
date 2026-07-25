# Repository Guidelines

## Project Overview

This repository is a Node.js ES module QQ bot with a unified Koishi + Yuno runtime.

~~~text
src/index.js -> src/koishi-app.js -> Koishi adapters + Yuno runtime -> src/message-workflow.js
~~~

Koishi is the only OneBot client and delivery boundary. Yuno owns persona, memory, RAG, tools, queue workers, scheduler, and reply formatting. Do not add AstrBot, HTTP bridge, or direct OneBot delivery paths.

## Common Commands

- npm install
- npm run doctor
- npm run smoke:mock
- npm test
- npm start

## Development Guidance

- Keep Session conversion in src/koishi-session-adapter.js.
- Keep delivery and protocol calls behind src/koishi-adapters.js and src/sender.js.
- Keep business behavior in the central Yuno workflow modules.
- Add regression tests for behavior changes and do not commit .env or generated runtime data.