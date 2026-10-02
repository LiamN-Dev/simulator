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

// Auto-run schema migrations on database connect
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
      console.log('Admin seeded: username "admin", password "admin123"');
    }
  } catch (err) {
    console.error('Database migration failed:', err);
  }
}
initDB();

// Middleware: Authenticate JWT Token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });

  jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired session' });
    req.user = user;
    next();
  });
}

// Middleware: Admin Authorization Check
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// --- AUTHENTICATION ENDPOINTS ---

app.post('/api/auth/register', async (req, res) => {
  const { display_name, username, password } = req.body;
  if (!display_name || !username || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO users (display_name, username, password_hash) VALUES ($1, $2, $3)",
      [display_name, username.toLowerCase().trim(), hash]
    );
    res.json({ message: 'Account request submitted! Awaiting admin approval.' });
  } catch (err) {
    res.status(400).json({ error: 'Username already taken' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query("SELECT * FROM users WHERE username = $1", [username.toLowerCase().trim()]);
  if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid username or password' });

  const user = result.rows[0];
  if (user.status === 'pending') return res.status(403).json({ error: 'Account is pending admin approval' });
  if (user.status === 'suspended') return res.status(403).json({ error: 'Account has been locked by admin' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(400).json({ error: 'Invalid username or password' });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
    process.env.JWT_SECRET || 'secret'
  );
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, display_name: user.display_name } });
});

// --- STUDENT DASHBOARD & COURSES ---

app.get('/api/courses', authenticateToken, async (req, res) => {
  try {
    let query;
    let params = [];
    if (req.user.role === 'admin') {
      query = "SELECT * FROM courses ORDER BY id ASC";
    } else {
      query = `
        SELECT c.* FROM courses c
        JOIN user_courses uc ON c.id = uc.course_id
        WHERE uc.user_id = $1
        ORDER BY c.id ASC`;
      params = [req.user.id];
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/courses/:id/units', authenticateToken, async (req, res) => {
  const courseId = req.params.id;
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';

  try {
    // Fetch units
    let unitQuery = "SELECT * FROM units WHERE course_id = $1";
    if (!isAdmin) unitQuery += " AND is_visible = TRUE";
    unitQuery += " ORDER BY order_index ASC, id ASC";
    const units = await pool.query(unitQuery, [courseId]);

    // Fetch resources with individual visibility calculations
    const resourcesQuery = `
      SELECT r.*, 
        CASE 
          WHEN $2 = true THEN true
          WHEN r.visibility_scope = 'draft' THEN false
          WHEN r.lock_after IS NOT NULL AND CURRENT_TIMESTAMP > r.lock_after THEN false
          WHEN r.unlock_at IS NOT NULL AND CURRENT_TIMESTAMP < r.unlock_at THEN false
          WHEN r.visibility_scope = 'course' THEN true
          WHEN r.visibility_scope = 'restricted' AND EXISTS (
            SELECT 1 FROM resource_permissions rp WHERE rp.resource_id = r.id AND rp.user_id = $1
          ) THEN true
          WHEN EXISTS (
            SELECT 1 FROM unlock_requests ur 
            WHERE ur.resource_id = r.id AND ur.user_id = $1 AND ur.status = 'approved' 
              AND (ur.expires_at IS NULL OR ur.expires_at > CURRENT_TIMESTAMP)
          ) THEN true
          ELSE false
        END AS is_unlocked
      FROM resources r
      JOIN units u ON r.unit_id = u.id
      WHERE u.course_id = $3
    `;
    const resources = await pool.query(resourcesQuery, [userId, isAdmin, courseId]);

    // Map resources into units
    const response = units.rows.map(unit => ({
      ...unit,
      resources: resources.rows.filter(r => r.unit_id === unit.id)
    }));

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit Unlock Request
app.post('/api/unlock-requests', authenticateToken, async (req, res) => {
  const { resource_id, reason } = req.body;
  try {
    await pool.query(
      "INSERT INTO unlock_requests (user_id, resource_id, reason) VALUES ($1, $2, $3)",
      [req.user.id, resource_id, reason]
    );
    res.json({ message: 'Unlock request submitted to admin' });
  } catch (err) {
    res.status(400).json({ error: 'Request already pending or invalid resource' });
  }
});

// --- PERSONALIZED BANNER API ---

app.get('/api/banner', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    // 1. Check direct user override
    const userOverride = await pool.query(
      "SELECT * FROM banner_overrides WHERE target_type = 'user' AND target_id = $1 AND is_active = TRUE ORDER BY id DESC LIMIT 1",
      [userId]
    );
    if (userOverride.rows.length > 0) return res.json(userOverride.rows[0]);

    // 2. Check global override
    const globalOverride = await pool.query(
      "SELECT * FROM banner_overrides WHERE target_type = 'global' AND is_active = TRUE ORDER BY id DESC LIMIT 1"
    );
    if (globalOverride.rows.length > 0) return res.json(globalOverride.rows[0]);

    // 3. Automated due-date banner (closest upcoming due item across enrolled courses)
    const autoBanner = await pool.query(`
      SELECT r.title as due_title, r.due_at, c.name as course_name
      FROM resources r
      JOIN units u ON r.unit_id = u.id
      JOIN courses c ON u.course_id = c.id
      JOIN user_courses uc ON c.id = uc.course_id
      WHERE uc.user_id = $1 AND r.due_at >= CURRENT_TIMESTAMP
      ORDER BY r.due_at ASC LIMIT 1
    `, [userId]);

    if (autoBanner.rows.length > 0) {
      const item = autoBanner.rows[0];
      return res.json({
        message: `Upcoming assignment for ${item.course_name}`,
        due_title: item.due_title,
        due_at: item.due_at
      });
    }

    res.json({ message: 'All caught up! No upcoming deadlines.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- MANDATORY POPUP ACKNOWLEDGMENT SYSTEM ---

app.get('/api/popups/active', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(`
      SELECT p.* FROM popups p
      LEFT JOIN popup_acknowledgments pa ON p.id = pa.popup_id AND pa.user_id = $1
      WHERE p.is_active = TRUE 
        AND pa.popup_id IS NULL
        AND (p.target_type = 'global' OR (p.target_type = 'user' AND p.target_id = $1))
      ORDER BY p.id ASC
    `, [userId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/popups/:id/acknowledge', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      "INSERT INTO popup_acknowledgments (popup_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ADMIN CONTROL PANEL API ROUTES ---

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  const users = await pool.query(`
    SELECT u.id, u.display_name, u.username, u.role, u.status, u.created_at,
      ARRAY_REMOVE(ARRAY_AGG(uc.course_id), NULL) as course_ids
    FROM users u
    LEFT JOIN user_courses uc ON u.id = uc.user_id
    GROUP BY u.id
    ORDER BY u.id ASC
  `);
  res.json(users.rows);
});

app.put('/api/admin/users/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  const { status } = req.body;
  await pool.query("UPDATE users SET status = $1 WHERE id = $2", [status, req.params.id]);
  res.json({ success: true });
});

app.put('/api/admin/users/:id/courses', authenticateToken, requireAdmin, async (req, res) => {
  const { course_ids } = req.body;
  const userId = req.params.id;

  await pool.query("DELETE FROM user_courses WHERE user_id = $1", [userId]);
  if (course_ids && course_ids.length > 0) {
    const insertValues = course_ids.map(cid => `(${userId}, ${parseInt(cid)})`).join(',');
    await pool.query(`INSERT INTO user_courses (user_id, course_id) VALUES ${insertValues}`);
  }
  res.json({ success: true });
});

app.post('/api/admin/users/:id/reset-password', authenticateToken, requireAdmin, async (req, res) => {
  const { new_password } = req.body;
  const hash = await bcrypt.hash(new_password, 10);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.params.id]);
  res.json({ message: 'Password updated successfully' });
});

app.get('/api/admin/unlock-requests', authenticateToken, requireAdmin, async (req, res) => {
  const result = await pool.query(`
    SELECT ur.*, u.display_name, u.username, r.title as resource_title
    FROM unlock_requests ur
    JOIN users u ON ur.user_id = u.id
    JOIN resources r ON ur.resource_id = r.id
    ORDER BY ur.created_at DESC
  `);
  res.json(result.rows);
});

app.put('/api/admin/unlock-requests/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { status, hours_valid } = req.body;
  let expires_at = null;
  if (hours_valid) {
    expires_at = new Date(Date.now() + hours_valid * 60 * 60 * 1000);
  }
  await pool.query(
    "UPDATE unlock_requests SET status = $1, expires_at = $2 WHERE id = $3",
    [status, expires_at, req.params.id]
  );
  res.json({ success: true });
});

app.post('/api/admin/courses', authenticateToken, requireAdmin, async (req, res) => {
  const { name, code, period, color_hex } = req.body;
  const result = await pool.query(
    "INSERT INTO courses (name, code, period, color_hex) VALUES ($1, $2, $3, $4) RETURNING *",
    [name, code, period, color_hex || '#3b82f6']
  );
  res.json(result.rows[0]);
});

app.post('/api/admin/units', authenticateToken, requireAdmin, async (req, res) => {
  const { course_id, title, order_index } = req.body;
  const result = await pool.query(
    "INSERT INTO units (course_id, title, order_index) VALUES ($1, $2, $3) RETURNING *",
    [course_id, title, order_index || 1]
  );
  res.json(result.rows[0]);
});

app.post('/api/admin/resources', authenticateToken, requireAdmin, async (req, res) => {
  const { unit_id, title, url, type, visibility_scope, unlock_at, lock_after, due_at, user_ids } = req.body;
  const resource = await pool.query(
    `INSERT INTO resources (unit_id, title, url, type, visibility_scope, unlock_at, lock_after, due_at) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [unit_id, title, url, type || 'link', visibility_scope || 'course', unlock_at || null, lock_after || null, due_at || null]
  );

  if (visibility_scope === 'restricted' && user_ids && user_ids.length > 0) {
    const resourceId = resource.rows[0].id;
    const values = user_ids.map(uid => `(${resourceId}, ${parseInt(uid)})`).join(',');
    await pool.query(`INSERT INTO resource_permissions (resource_id, user_id) VALUES ${values}`);
  }
  res.json(resource.rows[0]);
});

app.post('/api/admin/popups', authenticateToken, requireAdmin, async (req, res) => {
  const { title, message, target_type, target_id } = req.body;
  await pool.query(
    "INSERT INTO popups (title, message, target_type, target_id) VALUES ($1, $2, $3, $4)",
    [title, message, target_type || 'global', target_id || null]
  );
  res.json({ success: true });
});

app.post('/api/admin/banners', authenticateToken, requireAdmin, async (req, res) => {
  const { target_type, target_id, message, due_title, due_at } = req.body;
  await pool.query(
    "INSERT INTO banner_overrides (target_type, target_id, message, due_title, due_at) VALUES ($1, $2, $3, $4, $5)",
    [target_type || 'global', target_id || null, message, due_title || null, due_at || null]
  );
  res.json({ success: true });
});

// SERVE FRONTEND STATICS
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Class Hub server active on port ${PORT}`));
