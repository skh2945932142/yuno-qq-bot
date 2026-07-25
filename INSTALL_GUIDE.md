# Installation Guide

Deploy one Koishi + Yuno Node.js application. Do not install AstrBot plugins or run standalone Yuno workers.

Prerequisites: Node.js 22+, MongoDB, a OneBot 11 protocol service, and optional Qdrant/Redis. FFmpeg is required only for voice replies.

Run npm ci, copy env.server.example to .env, configure the variables in docs/environment-variables.md, and begin in shadow mode. Koishi connects to LLBot through the private OneBot WebSocket endpoint.

Cutover is atomic: stop the previous AstrBot and standalone Yuno services, deploy the unified image, point the protocol callback only at Koishi, then enable active mode. Roll back by restoring the previous image and Git revision; never run both delivery paths at once.