import mongoose from 'mongoose';

// 群成员关系档案
const RelationSchema = new mongoose.Schema({
  groupId:       String,
  userId:        String,
  affection:     { type: Number, default: 30 },
  tags:          { type: [String], default: [] },
  memorySummary: { type: String, default: '' },
  lastInteract:  { type: Date, default: Date.now },
});
RelationSchema.index({ groupId: 1, userId: 1 }, { unique: true });
export const Relation = mongoose.model('Relation', RelationSchema);

// 对话历史
const HistorySchema = new mongoose.Schema({
  groupId:  String,
  userId:   String,
  messages: [{
    role:    String,
    content: String,
    time:    { type: Date, default: Date.now },
  }],
});
HistorySchema.index({ groupId: 1, userId: 1 }, { unique: true });
export const History = mongoose.model('History', HistorySchema);

// 群体事件日志
const GroupEventSchema = new mongoose.Schema({
  groupId:   String,
  summary:   String,
  createdAt: { type: Date, default: Date.now },
});
export const GroupEvent = mongoose.model('GroupEvent', GroupEventSchema);