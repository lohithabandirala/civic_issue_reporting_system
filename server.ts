import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import multer from 'multer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'civic-connect-secret-key-2026';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/civic_issue';

// Initialize Database
mongoose.connect(MONGODB_URI).then(async () => {
  console.log('Connected to MongoDB');
  
  // Seed some worker teams
  const count = await WorkerTeam.countDocuments();
  if (count === 0) {
    await WorkerTeam.insertMany([
      { id: 'team-001', name: 'Sanitation Alpha', members: ["John Doe", "Jane Smith"] },
      { id: 'team-002', name: 'Road Repair Delta', members: ["Mike Ross", "Harvey Specter"] },
      { id: 'team-003', name: 'Drainage Specialists', members: ["Ross Geller", "Chandler Bing"] }
    ]);
  }
}).catch(err => console.error('MongoDB connection error:', err));

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

const issueSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  userId: { type: String },
  username: { type: String },
  category: { type: String },
  description: { type: String },
  imageUrl: { type: String },
  locationAddress: { type: String },
  latitude: { type: Number },
  longitude: { type: Number },
  priority: { type: String },
  status: { type: String },
  timestamp: { type: String },
  upvotes: { type: Number, default: 0 },
  votedBy: { type: [String], default: [] },
  voteCountResolved: { type: Number, default: 0 },
  voteCountNotResolved: { type: Number, default: 0 },
  citizenVerification: { type: Object, default: null },
  communityVotes: { type: [Object], default: [] },
  assignedTeam: { type: String },
  workerImageUrl: { type: String },
  resolutionImage: { type: String },
  adminNotes: { type: String },
  isFake: { type: Number, default: 0 },
  resolvedAt: { type: String },
  proofImageUrl: { type: String },
  isDuplicate: { type: Boolean, default: false },
  duplicateOf: { type: String },
  division: { type: String },
  prabhag: { type: String },
  userEmail: { type: String }
});

const workerTeamSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: { type: String },
  members: { type: [String], default: [] },
  activeTasks: { type: Number, default: 0 }
});

const voteSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  issueId: { type: String },
  userId: { type: String },
  vote: { type: String },
  comment: { type: String },
  proofImage: { type: String },
  timestamp: { type: String }
});

const User = mongoose.model('User', userSchema);
const Issue = mongoose.model('Issue', issueSchema);
const WorkerTeam = mongoose.model('WorkerTeam', workerTeamSchema);
const Vote = mongoose.model('Vote', voteSchema);

const app = express();
app.use(express.json({ limit: '50mb' }));

// Setup Multer for image uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

app.use('/uploads', express.static(uploadDir));

app.get('/api/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// Auth Middleware
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// Role-based auth
const isAdmin = (req: any, res: any, next: any) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
};

app.post('/api/upload', authenticateToken, upload.single('image'), (req: any, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ imageUrl });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Priority Classifier Logic
function classifyPriority(category: string, description: string) {
  const emergencyKeywords = ['gas leak', 'structural collapse', 'live wire', 'emergency', 'danger', 'flood', 'accident'];
  const highKeywords = ['deep pothole', 'garbage heap', 'clogged drain', 'broken pipe', 'sanitation', 'vandalism', 'security'];
  
  const desc = description.toLowerCase();
  
  if (emergencyKeywords.some(k => desc.includes(k)) || category === 'Electricity') return 'Emergency';
  if (highKeywords.some(k => desc.includes(k)) || category === 'Roads' || category === 'Sanitation') return 'High';
  return 'Normal';
}

// --- Auth Routes ---

app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  const id = Math.random().toString(36).substr(2, 9);
  const hashedPassword = await bcrypt.hash(password, 10);
  
  const userCount = await User.countDocuments();
  const role = userCount === 0 ? 'admin' : 'citizen';

  try {
    await User.create({ id, username, email, password: hashedPassword, role });
    const token = jwt.sign({ id, username, email, role }, JWT_SECRET);
    res.json({ token, user: { id, username, email, reputationPoints: 0, badges: [], role, reportedIssuesCount: 0 } });
  } catch (err: any) {
    res.status(400).json({ error: 'Username or email already exists' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  const user = await User.findOne({ username }).lean();
  if (!user) return res.status(400).json({ error: 'User not found' });
  
  if (user.isBlocked) return res.status(403).json({ error: 'Your account has been blocked due to repeated false reports.' });

  const validPassword = await bcrypt.compare(password, user.password as string);
  if (!validPassword) return res.status(400).json({ error: 'Invalid password' });

  const token = jwt.sign({ id: user.id, username: user.username, email: user.email, role: user.role }, JWT_SECRET);
  
  const { password: _, _id, __v, ...userProfile } = user as any;
  
  res.json({ token, user: userProfile });
});

app.get('/api/me', authenticateToken, async (req: any, res) => {
  try {
    const user = await User.findOne({ id: req.user.id }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const { password: _, _id, __v, ...userProfile } = user as any;
    res.json(userProfile);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/user/location', authenticateToken, async (req: any, res) => {
  const { locationAddress, latitude, longitude } = req.body;
  await User.updateOne({ id: req.user.id }, { locationAddress, latitude, longitude });
  res.json({ success: true });
});

// --- Issue Routes ---

app.get('/api/issues', authenticateToken, async (req, res) => {
  const issues = await Issue.find().sort({ timestamp: -1 }).lean();
  const formattedIssues = issues.map((i: any) => {
    const { _id, __v, ...rest } = i;
    return rest;
  });
  res.json(formattedIssues);
});

// Alias for GET /allIssues
app.get('/api/allIssues', authenticateToken, async (req, res) => {
  const issues = await Issue.find().sort({ timestamp: -1 }).lean();
  const formattedIssues = issues.map((i: any) => {
    const { _id, __v, ...rest } = i;
    return rest;
  });
  res.json(formattedIssues);
});

app.get('/api/userIssues', authenticateToken, async (req: any, res) => {
  const issues = await Issue.find({ userId: req.user.id }).sort({ timestamp: -1 }).lean();
  const formattedIssues = issues.map((i: any) => {
    const { _id, __v, ...rest } = i;
    return rest;
  });
  res.json(formattedIssues);
});

app.post('/api/reportIssue', authenticateToken, async (req: any, res) => {
  try {
    const { category, description, imageUrl, locationAddress, latitude, longitude, priority, division, prabhag } = req.body;
    const id = Math.random().toString(36).substr(2, 9);
    const timestamp = new Date().toISOString();
    
    // AI Pre-Processing: Severity Detection
    const finalPriority = priority || classifyPriority(category, description);

    // AI Pre-Processing: Duplicate Detection (within ~200m)
    let isDuplicate = false;
    let duplicateOf = undefined;
    if (latitude && longitude) {
      const duplicateRadius = 0.002;
      const recentDuplicate = await Issue.findOne({
        category,
        latitude: { $gte: latitude - duplicateRadius, $lte: latitude + duplicateRadius },
        longitude: { $gte: longitude - duplicateRadius, $lte: longitude + duplicateRadius },
        status: { $in: ['Pending', 'Assigned', 'In Progress'] }
      });
      if (recentDuplicate) {
        isDuplicate = true;
        duplicateOf = recentDuplicate.id;
      }
    }

    // Intelligent Routing
    let assignedTeam = undefined;
    let initialStatus = 'Pending';
    if (!isDuplicate) {
      if (category === 'Sanitation') assignedTeam = 'team-001';
      else if (category === 'Roads') assignedTeam = 'team-002';
      else if (category === 'Drainage') assignedTeam = 'team-003';
      
      if (assignedTeam) {
        initialStatus = 'Assigned';
        // Increment active tasks for team
        await WorkerTeam.updateOne({ id: assignedTeam }, { $inc: { activeTasks: 1 } });
      }
    }

    await Issue.create({
      id, userId: req.user.id, username: req.user.username, userEmail: req.user.email, category, description,
      imageUrl, locationAddress, latitude, longitude, priority: finalPriority,
      division, prabhag,
      status: initialStatus, timestamp, assignedTeam, isDuplicate, duplicateOf
    });
    
    const user = await User.findOne({ id: req.user.id });
    if (user) {
      if (!user.badges.includes('First Responder')) {
        user.badges.push('First Responder');
      }
      user.reputationPoints += 10;
      user.reportedIssuesCount += 1;
      await user.save();
    }
    
    res.json({ id, priority: finalPriority, status: initialStatus, isDuplicate, duplicateOf });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'Failed to report issue' });
  }
});

// Legacy endpoint support
app.post('/api/issues', authenticateToken, (req: any, res) => {
  res.redirect(307, '/api/reportIssue');
});

app.post('/api/setLocation', authenticateToken, async (req: any, res) => {
  const { locationAddress, latitude, longitude } = req.body;
  await User.updateOne({ id: req.user.id }, { locationAddress, latitude, longitude });
  res.json({ success: true });
});

// --- Admin Routes ---

app.get('/api/admin/issues', authenticateToken, isAdmin, async (req, res) => {
  const { status, category } = req.query;
  const filter: any = {};
  if (status) filter.status = status;
  if (category) filter.category = category;

  const issues = await Issue.find(filter).sort({ timestamp: -1 }).lean();
  const formattedIssues = issues.map((i: any) => {
    const { _id, __v, ...rest } = i;
    return rest;
  });
  res.json(formattedIssues);
});

app.put('/api/admin/issues/:id', authenticateToken, isAdmin, async (req: any, res) => {
  const { status, assignedTeam, resolutionImage, adminNotes, isFake } = req.body;
  const issueId = req.params.id;

  const updates: any = {};

  if (status) {
    if (status === 'Resolved') {
      updates.status = 'Pending Citizen Confirmation';
      updates.resolvedAt = new Date().toISOString();
    } else {
      updates.status = status;
    }
  }
  if (assignedTeam) {
    updates.assignedTeam = assignedTeam;
    const currentIssue = await Issue.findOne({ id: issueId });
    if (currentIssue?.status === 'Pending' || !currentIssue?.status) {
      if (!status) updates.status = 'Assigned';
    }
  }
  if (resolutionImage) updates.resolutionImage = resolutionImage;
  if (adminNotes) updates.adminNotes = adminNotes;
  if (isFake !== undefined) {
    updates.isFake = isFake ? 1 : 0;
    if (isFake) {
      const issue = await Issue.findOne({ id: issueId });
      if (issue) {
        const fakeCount = await Issue.countDocuments({ userId: issue.userId, isFake: 1 });
        if (fakeCount >= 3) {
          await User.updateOne({ id: issue.userId }, { isBlocked: 1 });
        }
      }
    }
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No updates provided' });

  await Issue.updateOne({ id: issueId }, { $set: updates });
  res.json({ success: true });
});

app.get('/api/admin/teams', authenticateToken, isAdmin, async (req, res) => {
  const teams = await WorkerTeam.find().lean();
  const formatted = teams.map((t: any) => {
    const { _id, __v, ...rest } = t;
    return rest;
  });
  res.json(formatted);
});

app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
  const total = await Issue.countDocuments();
  const resolved = await Issue.countDocuments({ status: { $in: ['Resolved', 'Confirmed Resolved'] } });
  const pending = await Issue.countDocuments({ status: 'Pending' });
  
  const categoryStatsRaw = await Issue.aggregate([
    { $group: { _id: "$category", count: { $sum: 1 } } }
  ]);
  const categories = categoryStatsRaw.map(c => ({ category: c._id, count: c.count }));
  
  res.json({ total, resolved, pending, categories });
});

app.get('/api/public/stats', async (req, res) => {
  const total = await Issue.countDocuments();
  const resolved = await Issue.countDocuments({ status: { $in: ['Resolved', 'Confirmed Resolved'] } });
  const inProgress = await Issue.countDocuments({ status: { $in: ['Assigned', 'In Progress'] } });
  const pending = await Issue.countDocuments({ status: 'Pending' });
  
  res.json({ total, resolved, inProgress, pending });
});

app.get('/api/issueHeatmapData', authenticateToken, async (req, res) => {
  const points = await Issue.find({}, { latitude: 1, longitude: 1, priority: 1, _id: 0 }).lean();
  res.json(points);
});

app.post('/api/issues/:id/upvote', authenticateToken, async (req: any, res) => {
  const issueId = req.params.id;
  const issue = await Issue.findOne({ id: issueId });
  if (!issue) return res.status(404).json({ error: 'Issue not found' });

  if (issue.votedBy.includes(req.user.id)) {
    return res.status(400).json({ error: 'Already upvoted' });
  }

  issue.votedBy.push(req.user.id);
  issue.upvotes += 1;
  await issue.save();
  
  await User.updateOne({ id: issue.userId }, { $inc: { reputationPoints: 2 } });
  
  res.json({ success: true });
});

// Helper for distance calculation (Haversine formula)
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

app.post('/api/votes', authenticateToken, async (req: any, res) => {
  const { issueId, vote, comment, proofImage } = req.body;
  
  const issue = await Issue.findOne({ id: issueId });
  const user = await User.findOne({ id: req.user.id });
  
  if (!issue || !user) return res.status(404).json({ error: 'Issue or user not found' });
  
  if (user.latitude && user.longitude && issue.latitude && issue.longitude) {
    const distance = getDistance(user.latitude, user.longitude, issue.latitude, issue.longitude);
    if (distance > 5) {
      return res.status(403).json({ error: 'You must be within 5km of the issue to verify it.' });
    }
  }

  const id = Math.random().toString(36).substr(2, 9);
  const timestamp = new Date().toISOString();

  await Vote.create({ id, issueId, userId: req.user.id, vote, comment, proofImage, timestamp });

  if (proofImage) {
    await Issue.updateOne({ id: issueId }, { proofImageUrl: proofImage });
  }

  if (!user.badges.includes('Eagle Eye')) {
    user.badges.push('Eagle Eye');
  }
  
  const verifications = await Vote.countDocuments({ userId: req.user.id });
  if (verifications >= 3 && !user.badges.includes('Locality Hero')) {
    user.badges.push('Locality Hero');
  }

  user.reputationPoints += 5;
  await user.save();

  res.json({ id });
});

app.post('/api/issues/:id/admin', authenticateToken, async (req: any, res) => {
  const { decision } = req.body;
  const issueId = req.params.id;
  const status = decision === 'Confirm Resolved' ? 'Confirmed Resolved' : 'Reopened';
  
  await Issue.updateOne({ id: issueId }, { status });
  
  if (status === 'Confirmed Resolved') {
    const issue = await Issue.findOne({ id: issueId });
    if (issue) {
      const user = await User.findOne({ id: issue.userId });
      if (user) {
        if (!user.badges.includes('Active Citizen')) user.badges.push('Active Citizen');
        user.reputationPoints += 50;
        await user.save();
      }
    }
  }
  
  res.json({ success: true });
});

app.post('/api/verifyResolution', authenticateToken, async (req: any, res) => {
  const { issueId, vote, comment, verificationImage } = req.body;

  if (vote === 'Not Resolved' && !verificationImage) {
    return res.status(400).json({ error: 'Photo is mandatory when reporting as Not Resolved.' });
  }

  const citizenVerification = {
    vote,
    comment,
    verificationImage,
    timestamp: new Date().toISOString()
  };

  const status = vote === 'Resolved Properly' ? 'Confirmed Resolved' : 'Reopened';

  await Issue.updateOne({ id: issueId }, { citizenVerification, status });
  await User.updateOne({ id: req.user.id }, { $inc: { reputationPoints: 15 } });

  res.json({ success: true });
});

app.post('/api/communityVote', authenticateToken, async (req: any, res) => {
  const { issueId, vote, comment, image } = req.body;

  const issue = await Issue.findOne({ id: issueId });
  if (!issue) return res.status(404).json({ error: 'Issue not found' });

  if (issue.communityVotes.some((v: any) => v.userId === req.user.id)) {
    return res.status(400).json({ error: 'You have already voted on this resolution.' });
  }

  issue.communityVotes.push({
    userId: req.user.id,
    username: req.user.username,
    vote,
    comment,
    image,
    timestamp: new Date().toISOString()
  });

  if (vote === 'Resolved') issue.voteCountResolved += 1;
  if (vote === 'Not Resolved') issue.voteCountNotResolved += 1;

  await issue.save();

  await User.updateOne({ id: req.user.id }, { $inc: { reputationPoints: 5 } });

  const updatedIssue = await Issue.findOne({ id: issueId }).lean();
  if (updatedIssue) {
    const { _id, __v, ...rest } = updatedIssue as any;
    res.json({ success: true, issue: rest });
  } else {
    res.json({ success: true });
  }
});

// Citizen Confirmation Route
app.post('/api/issues/:id/confirm', authenticateToken, async (req: any, res) => {
  const { isResolved, feedback, verificationImage } = req.body;
  const issueId = req.params.id;
  
  const issue = await Issue.findOne({ id: issueId });
  if (!issue) return res.status(404).json({ error: 'Issue not found' });
  
  if (issue.userId !== req.user.id) return res.status(403).json({ error: 'Only reporter can confirm resolution' });
  if (issue.status !== 'Pending Citizen Confirmation') return res.status(400).json({ error: 'Issue is not pending confirmation' });
  
  if (isResolved) {
    await Issue.updateOne({ id: issueId }, { 
      status: 'Confirmed Resolved', 
      citizenVerification: { vote: 'Resolved Properly', confirmed: true, feedback, verificationImage, timestamp: new Date().toISOString() } 
    });
    // Reward user for verifying
    await User.updateOne({ id: req.user.id }, { $inc: { reputationPoints: 5 } });
  } else {
    await Issue.updateOne({ id: issueId }, { 
      status: 'In Progress', 
      citizenVerification: { vote: 'Not Resolved', confirmed: false, feedback, verificationImage, timestamp: new Date().toISOString() } 
    });
  }
  res.json({ success: true });
});

async function startServer() {
  try {
    console.log('Starting server initialization...');
    if (process.env.NODE_ENV !== 'production') {
      console.log('Initializing Vite middleware...');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      console.log('Serving production build from dist/');
      app.use(express.static(path.join(__dirname, 'dist')));
      app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
      });
    }

    app.listen(3000, '0.0.0.0', () => {
      console.log('Server running on http://localhost:3000');
    });
  } catch (err) {
    console.error('SERVER FATAL STARTUP ERROR:', err);
  }
}

startServer();
