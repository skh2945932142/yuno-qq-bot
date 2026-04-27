import mongoose from 'mongoose';

const RelationSchema = new mongoose.Schema({
  platform: { type: String, default: 'qq' },
  chatType: { type: String, default: 'group' },
  chatId: { type: String, default: '' },
  sessionKey: { type: String, default: '' },
  groupId: { type: String, required: true },
  userId: { type: String, required: true },
  affection: { type: Number, default: 30 },
  tags: { type: [String], default: [] },
  memorySummary: { type: String, default: '' },
  preferences: { type: [String], default: [] },
  favoriteTopics: { type: [String], default: [] },
  activeScore: { type: Number, default: 0 },
  interactionCount: { type: Number, default: 0 },
  lastSentiment: { type: String, default: 'neutral' },
  lastInteract: { type: Date, default: Date.now },
}, { minimize: false });
RelationSchema.index({ groupId: 1, userId: 1 }, { unique: true });
export const Relation = mongoose.model('Relation', RelationSchema);

const HistorySchema = new mongoose.Schema({
  platform: { type: String, default: 'qq' },
  chatType: { type: String, default: 'group' },
  chatId: { type: String, default: '' },
  sessionKey: { type: String, default: '' },
  groupId: { type: String, required: true },
  userId: { type: String, required: true },
  messages: [{
    role: String,
    content: String,
    time: { type: Date, default: Date.now },
  }],
}, { minimize: false });
HistorySchema.index({ groupId: 1, userId: 1 }, { unique: true });
export const History = mongoose.model('History', HistorySchema);

const UserStateSchema = new mongoose.Schema({
  platform: { type: String, default: 'qq' },
  chatType: { type: String, default: 'group' },
  chatId: { type: String, default: '' },
  sessionKey: { type: String, default: '' },
  groupId: { type: String, required: true },
  userId: { type: String, required: true },
  currentEmotion: { type: String, default: 'CALM' },
  intensity: { type: Number, default: 0.35 },
  triggerReason: { type: String, default: 'baseline' },
  lastIntent: { type: String, default: 'chat' },
  lastSentiment: { type: String, default: 'neutral' },
  decayAt: { type: Date, default: Date.now },
  lastUpdated: { type: Date, default: Date.now },
}, { minimize: false });
UserStateSchema.index({ groupId: 1, userId: 1 }, { unique: true });
export const UserState = mongoose.model('UserState', UserStateSchema);

const GroupStateSchema = new mongoose.Schema({
  groupId: { type: String, required: true, unique: true },
  mood: { type: String, default: 'CALM' },
  moodIntensity: { type: Number, default: 0.3 },
  activityLevel: { type: Number, default: 0 },
  recentTopics: { type: [String], default: [] },
  lastProactiveAt: { type: Date, default: null },
  lastMessageAt: { type: Date, default: Date.now },
  lastActiveWindowAt: { type: Date, default: null },
  lastInteractionSummary: { type: String, default: '' },
}, { minimize: false });
export const GroupState = mongoose.model('GroupState', GroupStateSchema);

const GroupEventSchema = new mongoose.Schema({
  groupId: { type: String, required: true },
  userId: { type: String, default: '' },
  username: { type: String, default: '' },
  type: { type: String, default: 'message' },
  eventSource: { type: String, default: 'message' },
  messageId: { type: String, default: '' },
  rawText: { type: String, default: '' },
  sentiment: { type: String, default: 'neutral' },
  summary: { type: String, required: true },
  topics: { type: [String], default: [] },
  keywordHits: { type: [String], default: [] },
  anomalyType: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { minimize: false });
GroupEventSchema.index({ groupId: 1, createdAt: -1 });
export const GroupEvent = mongoose.model('GroupEvent', GroupEventSchema);

const ConversationStateSchema = new mongoose.Schema({
  platform: { type: String, default: 'qq' },
  chatType: { type: String, default: 'group' },
  chatId: { type: String, required: true },
  sessionKey: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  rollingSummary: { type: String, default: '' },
  messages: [{
    role: String,
    content: String,
    time: { type: Date, default: Date.now },
  }],
  lastSummarizedAt: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now },
}, { minimize: false });
export const ConversationState = mongoose.model('ConversationState', ConversationStateSchema);

const UserProfileMemorySchema = new mongoose.Schema({
  platform: { type: String, default: 'qq' },
  userId: { type: String, required: true },
  profileKey: { type: String, required: true, unique: true },
  displayName: { type: String, default: '' },
  preferredName: { type: String, default: '' },
  tonePreference: { type: String, default: '' },
  favoriteTopics: { type: [String], default: [] },
  dislikes: { type: [String], default: [] },
  roleplaySettings: { type: [String], default: [] },
  relationshipPreference: { type: String, default: '' },
  personaMode: { type: String, default: '' },
  specialBondSummary: { type: String, default: '' },
  bondMemories: { type: [String], default: [] },
  specialNicknames: { type: [String], default: [] },
  speakingStyleSummary: { type: String, default: '' },
  frequentPhrases: { type: [String], default: [] },
  emojiStyle: { type: String, default: '' },
  responsePreference: { type: String, default: '' },
  humorStyle: { type: String, default: '' },
  styleLastUpdated: { type: Date, default: null },
  profileSummary: { type: String, default: '' },
  lastUpdated: { type: Date, default: Date.now },
}, { minimize: false });
UserProfileMemorySchema.index({ platform: 1, userId: 1 }, { unique: true });
export const UserProfileMemory = mongoose.model('UserProfileMemory', UserProfileMemorySchema);

const UserMemoryEventSchema = new mongoose.Schema({
  memoryId: { type: String, required: true, unique: true },
  platform: { type: String, default: 'qq' },
  userId: { type: String, required: true },
  chatId: { type: String, default: '' },
  groupId: { type: String, default: '' },
  eventType: { type: String, default: 'milestone' },
  summary: { type: String, required: true },
  rawExcerpt: { type: String, default: '' },
  tags: { type: [String], default: [] },
  importanceScore: { type: Number, default: 0.5 },
  confidence: { type: Number, default: 0.5 },
  sourceMessageIds: { type: [String], default: [] },
  embeddingSourceText: { type: String, default: '' },
  lastReferencedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: null },
}, { minimize: false });
UserMemoryEventSchema.index({ platform: 1, userId: 1, createdAt: -1 });
UserMemoryEventSchema.index({ platform: 1, userId: 1, expiresAt: 1 });
export const UserMemoryEvent = mongoose.model('UserMemoryEvent', UserMemoryEventSchema);

const MemeAssetSchema = new mongoose.Schema({
  assetId: { type: String, required: true, unique: true },
  platform: { type: String, default: 'qq' },
  chatId: { type: String, required: true },
  userId: { type: String, default: '' },
  sourceMessageId: { type: String, default: '' },
  type: { type: String, default: 'image' },
  origin: { type: String, default: 'upload' },
  quoteText: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  storagePath: { type: String, default: '' },
  avatarUrl: { type: String, default: '' },
  tags: { type: [String], default: [] },
  ocrText: { type: String, default: '' },
  caption: { type: String, default: '' },
  semanticTags: { type: [String], default: [] },
  usageContext: { type: String, default: '' },
  embeddingSourceText: { type: String, default: '' },
  emotion: { type: String, default: 'funny' },
  safetyStatus: { type: String, default: 'safe' },
  disabled: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: null },
  lastAnalyzedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  usageCount: { type: Number, default: 0 },
}, { minimize: false });
MemeAssetSchema.index({ chatId: 1, createdAt: -1 });
MemeAssetSchema.index({ chatId: 1, userId: 1, createdAt: -1 });
export const MemeAsset = mongoose.model('MemeAsset', MemeAssetSchema);

const GroupAutomationRuleSchema = new mongoose.Schema({
  ruleId: { type: String, required: true, unique: true },
  groupId: { type: String, required: true },
  ruleType: { type: String, required: true },
  label: { type: String, default: '' },
  enabled: { type: Boolean, default: true },
  pattern: { type: String, default: '' },
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdBy: { type: String, default: '' },
  lastTriggeredAt: { type: Date, default: null },
}, {
  minimize: false,
  timestamps: true,
});
GroupAutomationRuleSchema.index({ groupId: 1, ruleType: 1, enabled: 1 });
export const GroupAutomationRule = mongoose.model('GroupAutomationRule', GroupAutomationRuleSchema);

const AutomationTaskSchema = new mongoose.Schema({
  taskId: { type: String, required: true, unique: true },
  platform: { type: String, default: 'qq' },
  chatType: { type: String, default: 'private' },
  chatId: { type: String, required: true },
  groupId: { type: String, default: '' },
  userId: { type: String, default: '' },
  taskType: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  triggerAt: { type: Date, default: null },
  nextRunAt: { type: Date, default: null },
  repeatIntervalMinutes: { type: Number, default: 0 },
  sourceType: { type: String, default: 'manual' },
  target: { type: String, default: '' },
  summary: { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastTriggeredAt: { type: Date, default: null },
  lastDeliveredKey: { type: String, default: '' },
}, {
  minimize: false,
  timestamps: true,
});
AutomationTaskSchema.index({ enabled: 1, nextRunAt: 1 });
AutomationTaskSchema.index({ chatId: 1, taskType: 1, enabled: 1 });
AutomationTaskSchema.index({ userId: 1, taskType: 1, enabled: 1 });
export const AutomationTask = mongoose.model('AutomationTask', AutomationTaskSchema);
