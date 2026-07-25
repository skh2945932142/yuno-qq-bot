# LLBot and Koishi/Yuno Deployment Checklist

## Phase A: LLBot replaces NapCat

- [ ] Deploy `deploy/llbot/zeabur-template.yaml`; it pins LLBot 8.1.0 by OCI digest and mounts `/app/llbot/data`.
- [ ] Store the acquired token only as the Zeabur Secret `LLBOT_AUTH_TOKEN`, then map the container variable `AUTH_TOKEN` to that secret.
- [ ] Keep the LLBot WebUI on port 3080 private or temporarily access-controlled; never publish the auth token.
- [ ] Resolve required external QQ/LLBot hosts plus `mongodb`, `Qdrant-omiste`, and `AstrBot` from the LLBot container before stopping anything.
- [ ] Confirm the LLBot WebUI reports a valid auth token, then complete QR login and verify the actual QQ matches `SELF_QQ`.
- [ ] Configure LLBot reverse WebSocket to AstrBot with array messages and self-message reporting.
- [ ] Stop NapCat only after LLBot is ready to log in; verify AstrBot receives and replies through LLBot.
- [ ] Validate group/private, mention, reply, image, voice, video, file, face, poke, member-added, reminders, and proactive delivery.
- [ ] Delete NapCat service and residual cache/log volume after AstrBot is stable on LLBot.

## Phase B: Koishi/Yuno replaces AstrBot

- [ ] Configure ONEBOT_TRANSPORT=ws, ONEBOT_ENDPOINT=ws://llbot:3000, ONEBOT_TOKEN, and separate koishi/yuno Mongo databases.
- [ ] Run Koishi/Yuno shadow mode against LLBot and validate the complete Session mapping without replies.
- [ ] Deploy the unified image with YUNO_PLUGIN_MODE=active and verify /health, /ready, /metrics, /koishi status, normal replies, media delivery, and scheduled delivery.
- [ ] Disable LLBot's AstrBot reverse WebSocket before stopping AstrBot to prevent duplicate replies.
- [ ] Confirm no duplicate scheduler, queue worker, or delivery ledger claim exists.

## Final cleanup

- [ ] Delete AstrBot and yuno-koishi-shadow services and their residual volumes.
- [ ] Drop only MongoDB koishi-shadow; retain yuno, koishi, Qdrant, and MemeAsset data.
- [ ] Retain only mongodb, llbot, yuno-qq-bot, and Qdrant-omiste services.
