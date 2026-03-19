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
  sentiment: { type: String, default: 'neutral' },
  summary: { type: String, required: true },
  topics: { type: [String], default: [] },
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
  profileSummary: { type: String, default: '' },
  lastUpdated: { type: Date, default: Date.now },
}, { minimize: false });
UserProfileMemorySchema.index({ platform: 1, userId: 1 }, { unique: true });
export const UserProfileMemory = mongoose.model('UserProfileMemory', UserProfileMemorySchema);
