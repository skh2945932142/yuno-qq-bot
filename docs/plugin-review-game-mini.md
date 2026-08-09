# Game Mini Plugin Review

- Review date: 2026-08-09
- Package: `koishi-plugin-game-mini@0.4.0`
- Integration mode: source-controlled Direct registration in `src/koishi-app.js`

## Approved scope

- Enable only `/猜数字` and `/算24点` in QQ group chats.
- Lock the package version and integrity in `package-lock.json`.
- Use Koishi `Session.send()` for framework command replies; no extra OneBot client, HTTP bridge, or direct protocol sender is introduced.
- Let an active game consume its group answer messages until the game ends or times out.

## Explicitly disabled

- Disabled game modes: 王者英雄猜谜、成语接龙、海龟汤、性格推理.
- No public game API endpoint, AI-game credential, or extra LLM credential is configured; the modes that use those paths remain disabled.
- Private-chat games, game-wide leaderboard, and data-clearing commands.
- Marketplace-managed installation and runtime package changes.

## Runtime controls

- `GAME_MINI_ENABLED` defaults to `false`.
- The plugin loads only when `YUNO_PLUGIN_MODE=active` and Koishi Console is enabled.
- Game command roots are short-circuited before the Yuno conversation workflow, preventing duplicate replies, memory writes, and queue work.
- The dependency declares Console injection, so `@koishijs/client@5.30.11` is pinned to satisfy the installed Console runtime peer dependency.
