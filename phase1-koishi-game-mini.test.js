import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAME_MINI_COMMAND_NAMES,
  GAME_MINI_INACTIVITY_SECONDS,
  assertGameMiniPrerequisites,
  createGameMiniConfig,
  createGameMiniSessionController,
  isGameMiniDirectCommand,
  shouldInstallGameMini,
} from './src/koishi-game-mini.js';

test('game-mini configuration enables only the offline group games', () => {
  const gameConfig = createGameMiniConfig();

  assert.equal(gameConfig.enableNumberGuess, true);
  assert.equal(gameConfig.enableCalc24, true);
  assert.equal(gameConfig.enableWzHero, false);
  assert.equal(gameConfig.enableChengyuJielong, false);
  assert.equal(gameConfig.enableTurtleSoup, false);
  assert.equal(gameConfig.enableCharacterGame, false);
  assert.deepEqual(gameConfig.privateGame, {
    enableNumberGuess: false,
    enableWzHero: false,
    enableChengyuJielong: false,
    enableCalc24: false,
    enableTurtleSoup: false,
    enableCharacterGame: false,
  });
  assert.equal(gameConfig.rank.enableCommand, false);
  assert.equal(gameConfig.guessNumber.botParticipateInGroup, false);
  assert.equal(gameConfig.guessNumber.autoStopInactiveTime, GAME_MINI_INACTIVITY_SECONDS);
  assert.equal(gameConfig.guessNumber.showRank, true);
  assert.equal(gameConfig.calc24.autoStopInactiveTime, GAME_MINI_INACTIVITY_SECONDS);
  assert.equal(gameConfig.calc24.showRank, true);
});

test('game-mini direct-command boundary covers enabled and disabled plugin commands', () => {
  assert.deepEqual([...GAME_MINI_COMMAND_NAMES], [
    '猜数字',
    '猜王者英雄',
    '成语接龙',
    '算24点',
    '海龟汤',
    '性格推理',
    '排行榜',
    '清零',
  ]);
  assert.equal(isGameMiniDirectCommand({ argv: { command: { name: '猜数字' } } }), true);
  assert.equal(isGameMiniDirectCommand({ argv: { command: { name: '海龟汤' } } }), true);
  assert.equal(isGameMiniDirectCommand({ argv: { command: { name: 'koishi' } } }), false);
  assert.equal(isGameMiniDirectCommand({}), false);
});


test('game-mini session controller keeps only active group games exclusive and expires them', () => {
  let now = 0;
  const cancelled = new Set();
  const controller = createGameMiniSessionController({
    inactivityMs: 10,
    now: () => now,
    schedule: (callback, delay) => ({ callback, delay }),
    cancel: (timer) => cancelled.add(timer),
  });
  const group = (content, argv) => ({
    channelId: '30000',
    content,
    guildId: '30000',
    platform: 'onebot',
    argv,
  });

  const start = group('/猜数字 开始', { command: { name: '猜数字' }, args: ['开始'] });
  assert.equal(controller.observe(start), true);
  assert.equal(controller.isActive(group('普通聊天')), true);

  const unrelatedEnd = group('/算24点 结束', { command: { name: '算24点' }, args: ['结束'] });
  assert.equal(controller.observe(unrelatedEnd), false);
  assert.equal(controller.isActive(group('仍在猜数字')), true);

  const privateStart = {
    channelId: 'private:20000',
    content: '/算24点 开始',
    isDirect: true,
    argv: { command: { name: '算24点' }, args: ['开始'] },
  };
  assert.equal(controller.observe(privateStart), false);
  assert.equal(controller.isActive(privateStart), false);

  assert.equal(controller.observeGameOutput(group(''), '比赛结束！'), true);
  assert.equal(controller.isActive(group('普通聊天')), false);

  controller.observe(start);
  now = 11;
  assert.equal(controller.isActive(group('超时后聊天')), false);
  assert.equal(cancelled.size > 0, true);
  controller.dispose();
});

test('game-mini loads only in active mode and requires the Koishi Console service', () => {
  const enabledConfig = { gameMiniEnabled: true, koishiConsoleEnabled: true };

  assert.equal(shouldInstallGameMini(enabledConfig, 'active'), true);
  assert.equal(shouldInstallGameMini(enabledConfig, 'shadow'), false);
  assert.equal(shouldInstallGameMini({ ...enabledConfig, gameMiniEnabled: false }, 'active'), false);
  assert.doesNotThrow(() => assertGameMiniPrerequisites(enabledConfig, 'active'));
  assert.throws(
    () => assertGameMiniPrerequisites({ gameMiniEnabled: true, koishiConsoleEnabled: false }, 'active'),
    /GAME_MINI_REQUIRES_KOISHI_CONSOLE/
  );
});
