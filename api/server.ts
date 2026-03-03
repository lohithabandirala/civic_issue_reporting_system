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

// Import Models
import { User } from '../backend/models/User.js';
import { Issue } from '../backend/models/Issue.js';
import { WorkerTeam } from '../backend/models/WorkerTeam.js';
import { Vote } from '../backend/models/Vote.js';
import { Notification } from '../backend/models/Notification.js';
import { analyzeIssue } from '../backend/services/ai.js';
import { sendNotification } from '../backend/services/notification.js';

import os from 'os';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'civic-connect-secret-key-2026';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/civic_issue';
const PORT = process.env.PORT || 3000;

// Initialize Database (Serverless friendly)
let isConnected = false;
const connectDB = async () => {
  if (isConnected) return;
  try {
    const db = await mongoose.connect(MONGODB_URI);
    isConnected = db.connections[0].readyState === 1;
    console.log('✅ Connected to MongoDB');
    
    // Seed some worker teams if none exist
    const count = await (WorkerTeam as any).countDocuments();
    if (count === 0) {
      console.log('🌱 Seeding worker teams...');
      await (WorkerTeam as any).insertMany([
        { id: 'team-001', name: 'Sanitation Alpha', members: ["John Doe", "Jane Smith"], activeTasks: 0 },
        { id: 'team-002', name: 'Road Repair Delta', members: ["Mike Ross", "Harvey Specter"], activeTasks: 0 },
        { id: 'team-003', name: 'Drainage Specialists', members: ["Ross Geller", "Chandler Bing"], activeTasks: 0 }
      ]);
    }
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
  }
};

if (!process.env.VERCEL) {
  connectDB();
}

const app = express();
app.use(express.json({ limit: '50mb' }));

// Middleware to ensure DB connection on serverless
app.use(async (req, res, next) => {
  if (process.env.VERCEL) {
    await connectDB();
  }
  next();
});

// Setup Multer for image uploads
const uploadDir = process.env.VERCEL ? os.tmpdir() : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
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

// --- Auth Middleware ---
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

const isAdmin = (req: any, res: any, next: any) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
};

// --- Helpers ---
function classifyPriority(category: string, description: string) {
  const emergencyKeywords = ['gas leak', 'structural collapse', 'live wire', 'emergency', 'danger', 'flood', 'accident'];
  const highKeywords = ['deep pothole', 'garbage heap', 'clogged drain', 'broken pipe', 'sanitation', 'vandalism', 'security'];
  const desc = description.toLowerCase();
  
  if (emergencyKeywords.some(k => desc.includes(k)) || category === 'Electricity') return 'Emergency';
  if (highKeywords.some(k => desc.includes(k)) || category === 'Roads' || category === 'Sanitation') return 'High';
  return 'Normal';
}

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// --- API Routes ---

app.get('/api/health', (req, res) => res.json({ ok: true, database: 'MongoDB', timestamp: new Date().toISOString() }));

app.post('/api/upload', authenticateToken, upload.single('image'), (req: any, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  res.json({ imageUrl: `/uploads/${req.file.filename}` });
});

// --- Auth Routes ---
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const userCount = await (User as any).countDocuments();
    const role = userCount === 0 ? 'admin' : 'citizen';
    const id = Math.random().toString(36).substr(2, 9);

    const user = await (User as any).create({ id, username, email, password: hashedPassword, role });
    const token = jwt.sign({ id, username, email, role }, JWT_SECRET);
    
    res.json({ token, user: { id, username, email, role, reputationPoints: 0, badges: [] } });
  } catch (err: any) {
    console.error('Registration Error:', err);
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0];
      res.status(400).json({ error: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists` });
    } else {
      res.status(500).json({ error: err.message || 'Internal server error during registration' });
    }
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user: any = await (User as any).findOne({ username }).lean();
  
  if (!user) return res.status(400).json({ error: 'User not found' });
  if (user.isBlocked) return res.status(403).json({ error: 'Account blocked' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, username: user.username, email: user.email, role: user.role }, JWT_SECRET);
  const { password: _, ...profile } = user;
  res.json({ token, user: profile });
});

app.get('/api/me', authenticateToken, async (req: any, res) => {
  const user = await (User as any).findOne({ id: req.user.id }, { password: 0 }).lean();
  res.json(user);
});

app.put('/api/user/location', authenticateToken, async (req: any, res) => {
  const { locationAddress, latitude, longitude } = req.body;
  await (User as any).updateOne({ id: req.user.id }, { locationAddress, latitude, longitude });
  res.json({ success: true });
});

// --- Issue Routes ---
app.get('/api/issues', authenticateToken, async (req, res) => {
  const issues = await (Issue as any).find().sort({ timestamp: -1 }).lean();
  res.json(issues);
});

app.post('/api/issues/:id/upvote', authenticateToken, async (req: any, res) => {
  try {
    const issueId = req.params.id;
    const userId = req.user.id;
    
    const issue = await (Issue as any).findOne({ id: issueId });
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    
    // Check if user already upvoted
    if (issue.votedBy && issue.votedBy.includes(userId)) {
      // Remove vote (toggle)
      await (Issue as any).updateOne(
        { id: issueId },
        { 
          $inc: { upvotes: -1 },
          $pull: { votedBy: userId }
        }
      );
      return res.json({ success: true, message: 'Upvote removed' });
    }
    
    // Add vote
    await (Issue as any).updateOne(
      { id: issueId },
      { 
        $inc: { upvotes: 1 },
        $push: { votedBy: userId }
      }
    );
    res.json({ success: true, message: 'Upvote added' });
  } catch (err) {
    console.error("Upvote Error:", err);
    res.status(500).json({ error: 'Failed to upvote' });
  }
});

app.post('/api/communityVote', authenticateToken, async (req: any, res) => {
  try {
    const { issueId, vote, comment, proofUrl } = req.body;
    const userId = req.user.id;
    const username = req.user.username;

    const issue = await (Issue as any).findOne({ id: issueId });
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    // Check if user already voted
    const existingVote = issue.communityVotes?.find((v: any) => v.userId === userId);
    if (existingVote) {
      return res.status(400).json({ error: 'You have already voted on this issue.' });
    }

    const voteObj = { userId, username, vote, comment, proofUrl, timestamp: new Date().toISOString() };
    const updateQuery: any = { $push: { communityVotes: voteObj } };
    
    if (vote === 'Resolved') {
      updateQuery.$inc = { voteCountResolved: 1 };
    } else {
      updateQuery.$inc = { voteCountNotResolved: 1 };
    }

    await (Issue as any).updateOne({ id: issueId }, updateQuery);
    res.json({ success: true, message: 'Vote submitted successfully' });
  } catch (err) {
    console.error("Community Vote Error:", err);
    res.status(500).json({ error: 'Failed to submit vote' });
  }
});

app.post('/api/reportIssue', authenticateToken, async (req: any, res) => {
  try {
    const { category, description, imageUrl, locationAddress, latitude, longitude, priority, division, prabhag } = req.body;
    
    // AI Analysis
    const aiResult = await analyzeIssue(description, imageUrl);
    const finalCategory = aiResult?.category || category || 'Other';
    const finalPriority = aiResult?.priority || priority || classifyPriority(finalCategory, description);
    const isFake = aiResult?.isLikelyFake ? 1 : 0;
    const aiSummary = aiResult?.summary || '';

    const id = Math.random().toString(36).substr(2, 9);
    
    // Duplicate Detection
    let isDuplicate = false;
    let duplicateOf = undefined;
    if (latitude && longitude) {
      const existing = await (Issue as any).findOne({
        category: finalCategory,
        latitude: { $gte: latitude - 0.002, $lte: latitude + 0.002 },
        longitude: { $gte: longitude - 0.002, $lte: longitude + 0.002 },
        status: { $ne: 'Resolved' }
      });
      if (existing) { isDuplicate = true; duplicateOf = existing.id; }
    }

    // Routing
    let assignedTeam = undefined;
    let status = 'Pending';
    if (!isDuplicate) {
      const catLower = finalCategory.toLowerCase();
      if (catLower.includes('sanitation') || catLower.includes('garbage')) {
        assignedTeam = 'team-001';
      } else if (catLower.includes('road') || catLower.includes('pothole')) {
        assignedTeam = 'team-002';
      } else if (catLower.includes('drainage') || catLower.includes('water')) {
        assignedTeam = 'team-003';
      }
      
      if (assignedTeam) { 
        status = 'Assigned'; 
        await WorkerTeam.updateOne({ id: assignedTeam }, { $inc: { activeTasks: 1 } }); 
      }
    }

    await (Issue as any).create({
      id, userId: req.user.id, username: req.user.username, userEmail: req.user.email,
      category: finalCategory, description, imageUrl, locationAddress, latitude, longitude,
      priority: finalPriority, status, division, prabhag, isDuplicate, duplicateOf,
      isFake, adminNotes: aiSummary,
      timestamp: new Date().toISOString(), assignedTeam
    });

    await (User as any).updateOne({ id: req.user.id }, { $inc: { reputationPoints: 10, reportedIssuesCount: 1 } });

    // Send Notifications
    if (!isFake && !isDuplicate) {
      if (assignedTeam) {
        await sendNotification(assignedTeam, 'New Task Assigned', `A new ${finalCategory} issue has been assigned to your team.`, id);
      }
      await sendNotification('admin', 'New Civic Issue', `A new ${finalPriority} priority issue has been reported in ${finalCategory}.`, id);
    } else if (isDuplicate) {
      await sendNotification(req.user.id, 'Duplicate Report', `Your report has been marked as a duplicate of issue #${duplicateOf}.`, id);
    }

    res.json({ success: true, id, status, aiAnalysis: { category: finalCategory, priority: finalPriority, isFake: !!isFake } });
  } catch (err) {
    console.error("Report Error:", err);
    res.status(500).json({ error: 'Failed to report' });
  }
});

// --- Admin & Voting ---
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
  const total = await (Issue as any).countDocuments();
  const resolved = await (Issue as any).countDocuments({ status: { $in: ['Resolved', 'Confirmed Resolved'] } });
  const pending = await (Issue as any).countDocuments({ status: 'Pending' });
  const categories = await (Issue as any).aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }]);
  res.json({ total, resolved, pending, categories: categories.map(c => ({ category: c._id, count: c.count })) });
});

app.get('/api/public/stats', async (req, res) => {
  const total = await (Issue as any).countDocuments();
  const resolved = await (Issue as any).countDocuments({ status: { $in: ['Resolved', 'Confirmed Resolved'] } });
  const inProgress = await (Issue as any).countDocuments({ status: { $in: ['Assigned', 'In Progress'] } });
  const pending = await (Issue as any).countDocuments({ status: 'Pending' });
  res.json({ total, resolved, inProgress, pending });
});

// Fallback for SPA
// Export the app for Vercel
export default app;

async function startServer() {
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
  }
}

// Start server only if not on Vercel and not being imported as a module
if (!process.env.VERCEL) {
  startServer();
}
