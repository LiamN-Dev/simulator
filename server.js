const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Auto-run schema migrations on startup
async function initDB() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    
    // Seed initial admin user if not exists
    const adminCheck = await pool.query("SELECT * FROM users WHERE username = 'admin'");
    if (adminCheck.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await pool.query(
        "INSERT INTO users (display_name, username, password_hash, role, status) VALUES ($1, $2, $3, $4, $5)",
        ['Admin', 'admin', hash, 'admin', 'approved']
      );
      console.log('Default admin created: admin / admin123');
    }
  } catch (err) {
    console.error('Database initialization failed:', err);
  }
}
initDB();

// Middleware: Auth Token Verification
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });

  jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// AUTH ROUTES
app.post('/api/auth/register', async (req, res) => {
  const { display_name, username, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO users (display_name, username, password_hash) VALUES ($1, $2, $3)",
      [display_name, username, hash]
    );
    res.json({ message: 'Registration submitted! Awaiting admin approval.' });
  } catch (err) {
    res.status(400).json({ error: 'Username already taken or invalid data' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  if (result.rows.length === 0) return res.status(400).json({ error: 'User not found' });

  const user = result.rows[0];
  if (user.status !== 'approved') return res.status(403).json({ error: 'Account pending admin approval or suspended' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(400).json({ error: 'Incorrect password' });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
    process.env.JWT_SECRET || 'secret'
  );
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, display_name: user.display_name } });
});

// POPUP ACKNOWLEDGMENT ROUTE
app.get('/api/popups/active', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const result = await pool.query(`
    SELECT p.* FROM popups p
    LEFT JOIN popup_acknowledgments pa ON p.id = pa.popup_id AND pa.user_id = $1
    WHERE p.is_active = TRUE 
      AND pa.popup_id IS NULL
      AND (p.target_type = 'global' OR (p.target_type = 'user' AND p.target_id = $1))
  `, [userId]);
  res.json(result.rows);
});

app.post('/api/popups/:id/acknowledge', authenticateToken, async (req, res) => {
  await pool.query(
    "INSERT INTO popup_acknowledgments (popup_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [req.params.id, req.user.id]
  );
  res.json({ success: true });
});

// SERVE FRONTEND STATICS
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
