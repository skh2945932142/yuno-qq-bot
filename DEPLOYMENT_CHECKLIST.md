# Unified Koishi + Yuno Deployment Checklist

## Before cutover

- [ ] Back up the previous image and record its Git revision.
- [ ] Configure separate MongoDB databases for koishi and yuno.
- [ ] Set SELF_QQ, ADMIN_QQ, ONEBOT_ENDPOINT, ONEBOT_TOKEN, ONEBOT_SECRET, console credentials, and METRICS_AUTH_TOKEN.
- [ ] Validate shadow mode with group/private, mention, reply, image, voice, video, file, face, poke, and member-added events.

## Active cutover

- [ ] Stop AstrBot and the old Yuno HTTP runtime.
- [ ] Deploy the unified image with YUNO_PLUGIN_MODE=active.
- [ ] Point the protocol event callback only to /onebot on the Koishi application.
- [ ] Verify /health, /ready, /metrics, /koishi status, normal reply, and scheduled delivery.
- [ ] Confirm no duplicate scheduler or queue worker exists.

## LLBot migration

- [ ] Record a 24-hour NapCat memory baseline.
- [ ] Change only the protocol service and ONEBOT_ENDPOINT.
- [ ] Verify normal delivery, proactive delivery, and fetch_custom_face for 24 hours before finalizing.