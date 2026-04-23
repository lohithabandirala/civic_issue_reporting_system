import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import multer from 'multer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database('civic.db');
const JWT_SECRET = process.env.JWT_SECRET || 'civic-connect-secret-key-2026';

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT,
    locationAddress TEXT,
    latitude REAL,
    longitude REAL,
    reputationPoints INTEGER DEFAULT 0,
    badges TEXT DEFAULT '[]',
    role TEXT DEFAULT 'citizen',
    reportedIssuesCount INTEGER DEFAULT 0,
    isBlocked INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    userId TEXT,
    username TEXT,
    category TEXT,
    description TEXT,
    imageUrl TEXT,
    locationAddress TEXT,
    latitude REAL,
    longitude REAL,
    priority TEXT,
    status TEXT,
    timestamp TEXT,
    upvotes INTEGER DEFAULT 0,
    votedBy TEXT DEFAULT '[]',
    voteCountResolved INTEGER DEFAULT 0,
    voteCountNotResolved INTEGER DEFAULT 0,
    citizenVerification TEXT,
    communityVotes TEXT DEFAULT '[]',
    assignedTeam TEXT,
    workerImageUrl TEXT,
    resolutionImage TEXT,
    adminNotes TEXT,
    isFake INTEGER DEFAULT 0,
    resolvedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS worker_teams (
    id TEXT PRIMARY KEY,
    name TEXT,
    members TEXT DEFAULT '[]',
    activeTasks INTEGER DEFAULT 0
  );

  -- Seed some worker teams
  INSERT OR IGNORE INTO worker_teams (id, name, members) VALUES 
  ('team-001', 'Sanitation Alpha', '["John Doe", "Jane Smith"]'),
  ('team-002', 'Road Repair Delta', '["Mike Ross", "Harvey Specter"]'),
  ('team-003', 'Drainage Specialists', '["Ross Geller", "Chandler Bing"]');
`);

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
  
  // Default first user to admin for testing purposes
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
  const role = userCount.count === 0 ? 'admin' : 'citizen';

  try {
    const stmt = db.prepare('INSERT INTO users (id, username, email, password, role) VALUES (?, ?, ?, ?, ?)');
    stmt.run(id, username, email, hashedPassword, role);
    
    const token = jwt.sign({ id, username, email, role }, JWT_SECRET);
    res.json({ token, user: { id, username, email, reputationPoints: 0, badges: [], role, reportedIssuesCount: 0 } });
  } catch (err: any) {
    res.status(400).json({ error: 'Username or email already exists' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body; // Changed to username + password per requirement
  
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  if (!user) return res.status(400).json({ error: 'User not found' });
  
  if (user.isBlocked) return res.status(403).json({ error: 'Your account has been blocked due to repeated false reports.' });

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) return res.status(400).json({ error: 'Invalid password' });

  const token = jwt.sign({ id: user.id, username: user.username, email: user.email, role: user.role }, JWT_SECRET);
  
  // Clean user object for response
  const { password: _, ...userProfile } = user;
  userProfile.badges = JSON.parse(userProfile.badges || '[]');
  
  res.json({ token, user: userProfile });
});

app.get('/api/me', authenticateToken, (req: any, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const { password: _, ...userProfile } = user;
    userProfile.badges = JSON.parse(userProfile.badges || '[]');
    res.json(userProfile);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/user/location', authenticateToken, (req: any, res) => {
  const { locationAddress, latitude, longitude } = req.body;
  const stmt = db.prepare('UPDATE users SET locationAddress = ?, latitude = ?, longitude = ? WHERE id = ?');
  stmt.run(locationAddress, latitude, longitude, req.user.id);
  res.json({ success: true });
});

// --- Issue Routes ---

app.get('/api/issues', authenticateToken, (req, res) => {
  const issues = db.prepare('SELECT * FROM issues ORDER BY timestamp DESC').all() as any[];
  const formattedIssues = issues.map(i => ({
    ...i,
    votedBy: JSON.parse(i.votedBy),
    communityVotes: JSON.parse(i.communityVotes || '[]'),
    citizenVerification: i.citizenVerification ? JSON.parse(i.citizenVerification) : null
  }));
  res.json(formattedIssues);
});

// Alias for GET /allIssues
app.get('/api/allIssues', authenticateToken, (req, res) => {
  const issues = db.prepare('SELECT * FROM issues ORDER BY timestamp DESC').all() as any[];
  const formattedIssues = issues.map(i => ({
    ...i,
    votedBy: JSON.parse(i.votedBy),
    communityVotes: JSON.parse(i.communityVotes || '[]'),
    citizenVerification: i.citizenVerification ? JSON.parse(i.citizenVerification) : null
  }));
  res.json(formattedIssues);
});

app.get('/api/userIssues', authenticateToken, (req: any, res) => {
  const issues = db.prepare('SELECT * FROM issues WHERE userId = ? ORDER BY timestamp DESC').all(req.user.id) as any[];
  const formattedIssues = issues.map(i => ({
    ...i,
    votedBy: JSON.parse(i.votedBy),
    communityVotes: JSON.parse(i.communityVotes || '[]'),
    citizenVerification: i.citizenVerification ? JSON.parse(i.citizenVerification) : null
  }));
  res.json(formattedIssues);
});

app.post('/api/reportIssue', authenticateToken, (req: any, res) => {
  try {
    const { category, description, imageUrl, locationAddress, latitude, longitude, priority } = req.body;
    const id = Math.random().toString(36).substr(2, 9);
    const timestamp = new Date().toISOString();
    
    // Use provided priority if available, otherwise classify
    const finalPriority = priority || classifyPriority(category, description);

    const stmt = db.prepare(`
      INSERT INTO issues (id, userId, username, category, description, imageUrl, locationAddress, latitude, longitude, priority, status, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(id, req.user.id, req.user.username, category, description, imageUrl, locationAddress, latitude, longitude, finalPriority, 'Pending', timestamp);
    
    // Update reputation and counts
    const user = db.prepare('SELECT badges, reportedIssuesCount FROM users WHERE id = ?').get(req.user.id) as any;
    if (user) {
      const badges = JSON.parse(user.badges || '[]');
      if (!badges.includes('First Responder')) {
        badges.push('First Responder');
      }
      
      db.prepare('UPDATE users SET reputationPoints = reputationPoints + 10, badges = ?, reportedIssuesCount = reportedIssuesCount + 1 WHERE id = ?')
        .run(JSON.stringify(badges), req.user.id);
    }
    
    res.json({ id, priority: finalPriority, status: 'Pending' });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'Failed to report issue' });
  }
});

// Legacy endpoint support
app.post('/api/issues', authenticateToken, (req: any, res) => {
  res.redirect(307, '/api/reportIssue');
});

app.post('/api/setLocation', authenticateToken, (req: any, res) => {
  const { locationAddress, latitude, longitude } = req.body;
  const stmt = db.prepare('UPDATE users SET locationAddress = ?, latitude = ?, longitude = ? WHERE id = ?');
  stmt.run(locationAddress, latitude, longitude, req.user.id);
  res.json({ success: true });
});

// --- Admin Routes ---

app.get('/api/admin/issues', authenticateToken, isAdmin, (req, res) => {
  const { status, category } = req.query;
  let query = 'SELECT * FROM issues';
  const params: any[] = [];

  if (status || category) {
    query += ' WHERE';
    if (status) {
      query += ' status = ?';
      params.push(status);
    }
    if (category) {
      if (status) query += ' AND';
      query += ' category = ?';
      params.push(category);
    }
  }

  query += ' ORDER BY timestamp DESC';
  const issues = db.prepare(query).all(...params) as any[];
  const formattedIssues = issues.map(i => ({
    ...i,
    votedBy: JSON.parse(i.votedBy || '[]'),
    communityVotes: JSON.parse(i.communityVotes || '[]'),
    citizenVerification: i.citizenVerification ? JSON.parse(i.citizenVerification) : null
  }));
  res.json(formattedIssues);
});

app.put('/api/admin/issues/:id', authenticateToken, isAdmin, (req: any, res) => {
  const { status, assignedTeam, resolutionImage, adminNotes, isFake } = req.body;
  const issueId = req.params.id;

  const updates: string[] = [];
  const params: any[] = [];

  if (status) {
    updates.push('status = ?');
    params.push(status);
    if (status === 'Resolved') {
      updates.push('resolvedAt = ?');
      params.push(new Date().toISOString());
    }
  }
  if (assignedTeam) {
    updates.push('assignedTeam = ?');
    params.push(assignedTeam);
    // Automatically update status to 'Assigned' if it was 'Pending' or not set
    const currentStatus = db.prepare('SELECT status FROM issues WHERE id = ?').get(issueId) as any;
    if (currentStatus?.status === 'Pending' || !currentStatus?.status) {
      if (!status) { // Only if status wasn't explicitly changed in the same request
        updates.push('status = ?');
        params.push('Assigned');
      }
    }
  }
  if (resolutionImage) {
    updates.push('resolutionImage = ?');
    params.push(resolutionImage);
  }
  if (adminNotes) {
    updates.push('adminNotes = ?');
    params.push(adminNotes);
  }
  if (isFake !== undefined) {
    updates.push('isFake = ?');
    params.push(isFake ? 1 : 0);
    
    // If fake, potentially block user if they have multiple fakes
    if (isFake) {
      const issue = db.prepare('SELECT userId FROM issues WHERE id = ?').get(issueId) as any;
      const fakeCount = db.prepare('SELECT COUNT(*) as count FROM issues WHERE userId = ? AND isFake = 1').get(issue.userId) as any;
      if (fakeCount.count >= 3) {
        db.prepare('UPDATE users SET isBlocked = 1 WHERE id = ?').run(issue.userId);
      }
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No updates provided' });

  params.push(issueId);
  db.prepare(`UPDATE issues SET ${updates.join(', ')} WHERE id = ?`).run(params);
  res.json({ success: true });
});

app.get('/api/admin/teams', authenticateToken, isAdmin, (req, res) => {
  const teams = db.prepare('SELECT * FROM worker_teams').all();
  res.json(teams);
});

app.get('/api/admin/stats', authenticateToken, isAdmin, (req, res) => {
  const totalIssues = db.prepare('SELECT COUNT(*) as count FROM issues').get() as any;
  const resolvedIssues = db.prepare("SELECT COUNT(*) as count FROM issues WHERE status = 'Resolved' OR status = 'Confirmed Resolved'").get() as any;
  const pendingIssues = db.prepare("SELECT COUNT(*) as count FROM issues WHERE status = 'Pending'").get() as any;
  
  const categoryStats = db.prepare('SELECT category, COUNT(*) as count FROM issues GROUP BY category').all();
  
  res.json({
    total: totalIssues.count,
    resolved: resolvedIssues.count,
    pending: pendingIssues.count,
    categories: categoryStats
  });
});

app.get('/api/issueHeatmapData', authenticateToken, (req, res) => {
  const points = db.prepare('SELECT latitude, longitude, priority FROM issues').all() as any[];
  res.json(points);
});

app.post('/api/issues/:id/upvote', authenticateToken, (req: any, res) => {
  const issueId = req.params.id;
  const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId) as any;
  if (!issue) return res.status(404).json({ error: 'Issue not found' });

  const votedBy = JSON.parse(issue.votedBy);
  if (votedBy.includes(req.user.id)) {
    return res.status(400).json({ error: 'Already upvoted' });
  }

  votedBy.push(req.user.id);
  db.prepare('UPDATE issues SET upvotes = upvotes + 1, votedBy = ? WHERE id = ?').run(JSON.stringify(votedBy), issueId);
  
  // Award points to the reporter (+2 for being helpful)
  db.prepare('UPDATE users SET reputationPoints = reputationPoints + 2 WHERE id = ?').run(issue.userId);
  
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

app.post('/api/votes', authenticateToken, (req: any, res) => {
  const { issueId, vote, comment, proofImage } = req.body;
  
  // Check locality
  const issue = db.prepare('SELECT latitude, longitude FROM issues WHERE id = ?').get(issueId) as any;
  const user = db.prepare('SELECT latitude, longitude, badges, reputationPoints FROM users WHERE id = ?').get(req.user.id) as any;
  
  if (!issue || !user) return res.status(404).json({ error: 'Issue or user not found' });
  
  const distance = getDistance(user.latitude, user.longitude, issue.latitude, issue.longitude);
  if (distance > 5) {
    return res.status(403).json({ error: 'You must be within 5km of the issue to verify it.' });
  }

  const id = Math.random().toString(36).substr(2, 9);
  const timestamp = new Date().toISOString();

  const stmt = db.prepare('INSERT INTO votes (id, issueId, userId, vote, comment, proofImage, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)');
  stmt.run(id, issueId, req.user.id, vote, comment, proofImage, timestamp);

  if (vote === 'Resolved Properly') {
    db.prepare('UPDATE issues SET resolvedVotes = resolvedVotes + 1 WHERE id = ?').run(issueId);
  } else {
    db.prepare('UPDATE issues SET unresolvedVotes = unresolvedVotes + 1 WHERE id = ?').run(issueId);
  }

  if (proofImage) {
    db.prepare('UPDATE issues SET proofImageUrl = ? WHERE id = ?').run(proofImage, issueId);
  }

  // Award points for verifying (+5 for community service) and check for "Eagle Eye" badge
  const badges = JSON.parse(user.badges);
  if (!badges.includes('Eagle Eye')) {
    badges.push('Eagle Eye');
  }
  
  // Check for "Locality Hero" badge (3+ verifications in own locality)
  const verifications = db.prepare('SELECT COUNT(*) as count FROM votes WHERE userId = ?').get(req.user.id) as any;
  if (verifications.count >= 3 && !badges.includes('Locality Hero')) {
    badges.push('Locality Hero');
  }

  db.prepare('UPDATE users SET reputationPoints = reputationPoints + 5, badges = ? WHERE id = ?')
    .run(JSON.stringify(badges), req.user.id);

  res.json({ id });
});

app.post('/api/issues/:id/admin', authenticateToken, (req: any, res) => {
  const { decision } = req.body;
  const issueId = req.params.id;
  const status = decision === 'Confirm Resolved' ? 'Confirmed Resolved' : 'Reopened';
  
  db.prepare('UPDATE issues SET status = ? WHERE id = ?').run(status, issueId);
  
  if (status === 'Confirmed Resolved') {
    const issue = db.prepare('SELECT userId FROM issues WHERE id = ?').get(issueId) as any;
    if (issue) {
      const user = db.prepare('SELECT badges FROM users WHERE id = ?').get(issue.userId) as any;
      const badges = JSON.parse(user.badges);
      if (!badges.includes('Active Citizen')) badges.push('Active Citizen');
      
      db.prepare('UPDATE users SET reputationPoints = reputationPoints + 50, badges = ? WHERE id = ?')
        .run(JSON.stringify(badges), issue.userId);
    }
  }
  
  res.json({ success: true });
});

app.post('/api/verifyResolution', authenticateToken, (req: any, res) => {
  const { issueId, vote, comment, verificationImage } = req.body;

  if (vote === 'Not Resolved' && !verificationImage) {
    return res.status(400).json({ error: 'Photo is mandatory when reporting as Not Resolved.' });
  }

  const citizenVerification = JSON.stringify({
    vote,
    comment,
    verificationImage,
    timestamp: new Date().toISOString()
  });

  const status = vote === 'Resolved Properly' ? 'Confirmed Resolved' : 'Reopened';

  db.prepare('UPDATE issues SET citizenVerification = ?, status = ? WHERE id = ?').run(citizenVerification, status, issueId);

  // Award points for verifying
  db.prepare('UPDATE users SET reputationPoints = reputationPoints + 15 WHERE id = ?').run(req.user.id);

  res.json({ success: true });
});

app.post('/api/communityVote', authenticateToken, (req: any, res) => {
  const { issueId, vote, comment, image } = req.body;

  const issue = db.prepare('SELECT communityVotes, voteCountResolved, voteCountNotResolved FROM issues WHERE id = ?').get(issueId) as any;
  if (!issue) return res.status(404).json({ error: 'Issue not found' });

  const communityVotes = JSON.parse(issue.communityVotes || '[]');
  
  // Check if user already voted
  if (communityVotes.some((v: any) => v.userId === req.user.id)) {
    return res.status(400).json({ error: 'You have already voted on this resolution.' });
  }

  communityVotes.push({
    userId: req.user.id,
    username: req.user.username,
    vote,
    comment,
    image,
    timestamp: new Date().toISOString()
  });

  const voteCountResolved = vote === 'Resolved' ? (issue.voteCountResolved || 0) + 1 : (issue.voteCountResolved || 0);
  const voteCountNotResolved = vote === 'Not Resolved' ? (issue.voteCountNotResolved || 0) + 1 : (issue.voteCountNotResolved || 0);

  db.prepare('UPDATE issues SET communityVotes = ?, voteCountResolved = ?, voteCountNotResolved = ? WHERE id = ?')
    .run(JSON.stringify(communityVotes), voteCountResolved, voteCountNotResolved, issueId);

  const updatedIssue = db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId) as any;
  if (updatedIssue) {
    updatedIssue.communityVotes = JSON.parse(updatedIssue.communityVotes || '[]');
    updatedIssue.votedBy = JSON.parse(updatedIssue.votedBy || '[]');
    updatedIssue.citizenVerification = updatedIssue.citizenVerification ? JSON.parse(updatedIssue.citizenVerification) : null;
  }

  // Small reward for community voting
  db.prepare('UPDATE users SET reputationPoints = reputationPoints + 5 WHERE id = ?').run(req.user.id);

  res.json({ success: true, issue: updatedIssue });
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
