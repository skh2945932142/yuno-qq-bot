# Koishi/Yuno Production Checklist

## Final service topology

- [ ] Zeabur contains only `mongodb`, `llbot`, `yuno-qq-bot`, and `Qdrant-omiste`.
- [ ] `llbot` uses the pinned OCI digest from `deploy/llbot/zeabur-template.yaml` and persists `/app/llbot/data`.
- [ ] LLBot OneBot 11 listens only on the private network at port `3000`; the WebUI has no public domain.
- [ ] Only one QQ protocol process owns the bot session.

## LLBot

- [ ] The logged-in QQ equals `SELF_QQ`.
- [ ] OneBot uses array messages, a non-empty token, and positive WebSocket mode.
- [ ] `AUTH_TOKEN`, the WebUI password, and `ONEBOT_TOKEN` are stored only as deployment secrets.
- [ ] Login session files are retained; expired QR images and runtime logs are removed after cutover.

## Koishi/Yuno

- [ ] `ONEBOT_TRANSPORT=ws` and `ONEBOT_ENDPOINT=ws://llbot.zeabur.internal:3000`.
- [ ] `YUNO_PLUGIN_MODE=active`, `MEME_PROVIDER=local-cache`, and production runs one application replica.
- [ ] `/ready` returns HTTP 200 with MongoDB, Bot, Queue, and Scheduler ready.
- [ ] `/metrics` rejects missing credentials and succeeds with `x-yuno-metrics-token`.
- [ ] Group/private, mention, reply, image, voice, video, file, face, poke, and member-added events are accepted.
- [ ] A real reply completes `send-text` once and its Delivery Ledger record is `sent` with one attempt.
- [ ] `/koishi status` is limited to `ADMIN_QQ`; reminders and scheduled delivery use the same Koishi adapter.

## Data retention

- [ ] Retain the production Koishi and Yuno MongoDB databases, Qdrant collections, MemeAsset records, and LLBot session data.
- [ ] Remove only temporary shadow databases, legacy service volumes, expired login QR files, and obsolete logs/caches.
- [ ] Do not restore HTTP OneBot callbacks, direct Yuno OneBot delivery, standalone workers, or a second scheduler.
