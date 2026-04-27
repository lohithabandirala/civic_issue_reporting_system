import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  username: { type: String, unique: true },
  email: { type: String, unique: true },
  password: { type: String },
  locationAddress: { type: String },
  latitude: { type: Number },
  longitude: { type: Number },
  reputationPoints: { type: Number, default: 0 },
  badges: { type: [String], default: [] },
  role: { type: String, default: 'citizen' },
  reportedIssuesCount: { type: Number, default: 0 },
  isBlocked: { type: Number, default: 0 }
});

export const User = mongoose.models.User || mongoose.model('User', userSchema);
