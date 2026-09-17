import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@libsql/client';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Turso LibSQL Database Client
const dbUrl = process.env.TURSO_DATABASE_URL || 'file:DB/supertrash.db';
const authToken = process.env.TURSO_AUTH_TOKEN;

console.log('[Server] Connecting to database:', dbUrl.startsWith('libsql://') ? 'Turso Cloud' : dbUrl);

const db = createClient({
  url: dbUrl,
  authToken: authToken
});

// Helper functions for LibSQL queries
async function queryOne(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows[0] || null;
}

async function queryAll(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows;
}

async function execute(sql, args = []) {
  return await db.execute({ sql, args });
}

// -------------------------------------------------------------
// Initialize missing tables / seed default rows if needed
// -------------------------------------------------------------
async function initDatabase() {
  try {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS waste_history (
        history_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        recycle_kg REAL DEFAULT 0,
        organic_kg REAL DEFAULT 0,
        general_kg REAL DEFAULT 0,
        hazardous_kg REAL DEFAULT 0,
        total_kg REAL DEFAULT 0,
        points_earned INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY(user_id) REFERENCES user(user_id)
      )`,
      `CREATE TABLE IF NOT EXISTS admins (
        admin_id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_name TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      )`,
      `CREATE TABLE IF NOT EXISTS waste_rates (
        category_key TEXT PRIMARY KEY,
        category_name TEXT NOT NULL,
        points_per_unit REAL NOT NULL,
        unit_name TEXT NOT NULL
      )`
    ]);

    // Check waste_rates
    const ratesCountRes = await queryOne('SELECT COUNT(*) as count FROM waste_rates');
    if (!ratesCountRes || ratesCountRes.count === 0) {
      await db.batch([
        { sql: "INSERT INTO waste_rates (category_key, category_name, points_per_unit, unit_name) VALUES (?, ?, ?, ?)", args: ['recycle', 'Recycle Waste', 50, 'kg'] },
        { sql: "INSERT INTO waste_rates (category_key, category_name, points_per_unit, unit_name) VALUES (?, ?, ?, ?)", args: ['organic', 'Organic Waste', 30, 'kg'] },
        { sql: "INSERT INTO waste_rates (category_key, category_name, points_per_unit, unit_name) VALUES (?, ?, ?, ?)", args: ['general', 'General Waste', 20, 'ถุง'] },
        { sql: "INSERT INTO waste_rates (category_key, category_name, points_per_unit, unit_name) VALUES (?, ?, ?, ?)", args: ['hazardous', 'Hazardous Waste', 80, 'ชิ้น'] }
      ]);
    }

    // Check sample admin
    const adminCountRes = await queryOne('SELECT COUNT(*) as count FROM admins');
    if (!adminCountRes || adminCountRes.count === 0) {
      await execute("INSERT INTO admins (admin_name) VALUES (?)", ['Admin (ผู้ดูแลระบบ)']);
    }

    try { await execute('ALTER TABLE user ADD COLUMN address TEXT'); } catch(e) {}
    try { await execute('ALTER TABLE user ADD COLUMN password TEXT'); } catch(e) {}
    try { await execute('ALTER TABLE staffs ADD COLUMN password TEXT'); } catch(e) {}
    try { await execute('ALTER TABLE staffs ADD COLUMN username TEXT'); } catch(e) {}
    try { await execute('ALTER TABLE staffs ADD COLUMN email TEXT'); } catch(e) {}
    try { await execute('ALTER TABLE staffs ADD COLUMN address TEXT'); } catch(e) {}
    try { await execute('ALTER TABLE garbage_reports ADD COLUMN staff_id INTEGER'); } catch(e) {}
    try { await execute('ALTER TABLE garbage_reports ADD COLUMN created_at TEXT'); } catch(e) {}
    try { await execute('ALTER TABLE garbage_reports ADD COLUMN seller_decision TEXT'); } catch(e) {}
    try { await execute('ALTER TABLE waste_history ADD COLUMN staff_id INTEGER'); } catch(e) {}
    try { await execute('ALTER TABLE waste_history ADD COLUMN location_name TEXT'); } catch(e) {}
    try { await execute('ALTER TABLE waste_history ADD COLUMN waste_details TEXT'); } catch(e) {}

    console.log('[Server] Database initialized successfully.');
  } catch (err) {
    console.error('[Server] Database initialization warning:', err.message);
  }
}

// Helper: สุ่มยัดงานให้พนักงานโดยยึดคนที่มี queue น้อยที่สุด (ข้อ 19)
async function assignStaffWithLeastQueues() {
  const allStaffs = await queryAll('SELECT * FROM staffs');
  if (!allStaffs || allStaffs.length === 0) {
    return null;
  }

  // นับจำนวนคิวที่ยังค้างอยู่ (status = 'Waiting') ของพนักงานแต่ละคน
  const queueCounts = await queryAll(`
    SELECT staff_id, COUNT(*) as count 
    FROM garbage_reports 
    WHERE status = 'Waiting' AND staff_id IS NOT NULL
    GROUP BY staff_id
  `);

  const countMap = {};
  for (const s of allStaffs) {
    countMap[s.staff_id] = 0;
  }
  for (const row of queueCounts) {
    if (countMap[row.staff_id] !== undefined) {
      countMap[row.staff_id] = Number(row.count);
    }
  }

  // หาจำนวนคิวต่ำสุด
  let minCount = Infinity;
  for (const s of allStaffs) {
    if (countMap[s.staff_id] < minCount) {
      minCount = countMap[s.staff_id];
    }
  }

  // กรองพนักงานทุกคนที่มีคิวน้อยที่สุดเท่ากัน
  const candidateStaffs = allStaffs.filter(s => countMap[s.staff_id] === minCount);

  // สุ่มเลือก 1 คนจากกลุ่มนี้
  const picked = candidateStaffs[Math.floor(Math.random() * candidateStaffs.length)];
  return picked;
}

// Helper: ดึง staff_id และ location_id ที่มีอยู่จริงเพื่อป้องกัน Foreign Key Constraint Error
async function getValidStaffAndLocation(preferredStaffId = null, preferredLocId = null) {
  let staffId = preferredStaffId;
  let locId = preferredLocId;

  if (staffId) {
    const s = await queryOne('SELECT staff_id FROM staffs WHERE staff_id = ?', [staffId]);
    if (!s) staffId = null;
  }
  if (!staffId) {
    const s = await queryOne('SELECT staff_id FROM staffs ORDER BY staff_id ASC LIMIT 1');
    staffId = s ? s.staff_id : null;
  }

  if (locId) {
    const l = await queryOne('SELECT location_id FROM locations WHERE location_id = ?', [locId]);
    if (!l) locId = null;
  }
  if (!locId) {
    const l = await queryOne('SELECT location_id FROM locations ORDER BY location_id ASC LIMIT 1');
    locId = l ? l.location_id : null;
  }

  return { staffId, locId };
}

async function safeLogHistory(actionText, preferredStaffId = null, preferredLocId = null) {
  try {
    const { staffId, locId } = await getValidStaffAndLocation(preferredStaffId, preferredLocId);
    if (staffId && locId) {
      await execute(
        "INSERT INTO history_logs (staff_id, location_id, action, action_date) VALUES (?, ?, ?, datetime('now', 'localtime'))",
        [staffId, locId, actionText]
      );
    }
  } catch (err) {
    console.warn('[SafeLogHistory Warning]:', err.message);
  }
}

// -------------------------------------------------------------
// API ENDPOINTS
// -------------------------------------------------------------

// 0.1 REGISTER (Seller or Staff)
app.post('/api/register', async (req, res) => {
  try {
    const { email, username, phone, address, password, role } = req.body;
    const cleanUser = (username || '').trim();
    const cleanEmail = (email || '').trim();
    const cleanPhone = (phone || '').trim();
    const cleanAddress = (address || '').trim();
    const cleanPass = (password || '').trim();
    const cleanRole = (role || '').trim().toLowerCase();

    if (!cleanUser || !cleanPass || !cleanEmail || !cleanRole) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (ชื่อผู้ใช้, รหัสผ่าน, อีเมล, บทบาท)' });
    }

    if (cleanRole === 'admin' || cleanUser.toLowerCase() === 'admin') {
      return res.status(403).json({ error: 'ไม่อนุญาตให้ลงทะเบียนเป็นผู้ดูแลระบบ (Admin)' });
    }

    if (cleanRole !== 'seller' && cleanRole !== 'staff') {
      return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง ต้องเลือกเป็น Seller หรือ Staff' });
    }

    // ตรวจสอบชื่อผู้ใช้ซ้ำ
    const userExist = await queryOne('SELECT * FROM user WHERE LOWER(username) = LOWER(?)', [cleanUser]);
    const staffExist = await queryOne('SELECT * FROM staffs WHERE LOWER(username) = LOWER(?) OR LOWER(staff_name) = LOWER(?)', [cleanUser, cleanUser]);
    const adminExist = await queryOne('SELECT * FROM admins WHERE LOWER(admin_name) = LOWER(?)', [cleanUser]);
    if (userExist || staffExist || adminExist) {
      return res.status(409).json({ error: `ชื่อผู้ใช้งาน "${cleanUser}" ถูกใช้งานแล้ว กรุณาเลือกชื่ออื่น` });
    }

    if (cleanRole === 'seller') {
      const insertRes = await execute(
        'INSERT INTO user (username, name, email, phone, address, password, points) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [cleanUser, cleanUser, cleanEmail, cleanPhone, cleanAddress, cleanPass, 0]
      );
      const newUser = await queryOne('SELECT * FROM user WHERE user_id = ?', [Number(insertRes.lastInsertRowid)]);
      return res.json({ success: true, role: 'seller', user: newUser });
    } else if (cleanRole === 'staff') {
      const staffPhone = cleanPhone || '0123456789';
      const insertRes = await execute(
        'INSERT INTO staffs (staff_name, username, email, phone, address, password) VALUES (?, ?, ?, ?, ?, ?)',
        [cleanUser, cleanUser, cleanEmail, staffPhone, cleanAddress, cleanPass]
      );
      const newStaff = await queryOne('SELECT * FROM staffs WHERE staff_id = ?', [Number(insertRes.lastInsertRowid)]);
      return res.json({ success: true, role: 'staff', staff: newStaff });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 0.2 UNIFIED LOGIN (Admin, Seller, Staff)
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const cleanUser = (username || '').trim();
    const cleanPass = (password || '').trim();

    if (!cleanUser || !cleanPass) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }

    // 1. ตรวจสอบ Admin (ถ้า username = admin และ password = admin01)
    if (cleanUser.toLowerCase() === 'admin' && cleanPass === 'admin01') {
      let admin = await queryOne('SELECT * FROM admins WHERE LOWER(admin_name) = ?', ['admin']);
      if (!admin) {
        const insertRes = await execute('INSERT INTO admins (admin_name) VALUES (?)', ['admin']);
        admin = await queryOne('SELECT * FROM admins WHERE admin_id = ?', [Number(insertRes.lastInsertRowid)]);
      }
      return res.json({ success: true, role: 'admin', admin });
    }

    // 2. ตรวจสอบ Seller (ตาราง user)
    const user = await queryOne('SELECT * FROM user WHERE LOWER(username) = LOWER(?) OR LOWER(name) = LOWER(?)', [cleanUser, cleanUser]);
    if (user) {
      if (user.password && user.password !== cleanPass) {
        return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' });
      }
      if (!user.password) {
        await execute('UPDATE user SET password = ? WHERE user_id = ?', [cleanPass, user.user_id]);
        user.password = cleanPass;
      }
      return res.json({ success: true, role: 'seller', user });
    }

    // 3. ตรวจสอบ Staff (ตาราง staffs)
    const staff = await queryOne('SELECT * FROM staffs WHERE LOWER(username) = LOWER(?) OR LOWER(staff_name) = LOWER(?)', [cleanUser, cleanUser]);
    if (staff) {
      if (staff.password && staff.password !== cleanPass) {
        return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' });
      }
      if (!staff.password) {
        await execute('UPDATE staffs SET password = ? WHERE staff_id = ?', [cleanPass, staff.staff_id]);
        staff.password = cleanPass;
      }
      return res.json({ success: true, role: 'staff', staff });
    }

    // ไม่พบบัญชีใดๆ
    return res.status(404).json({ error: 'ไม่พบบัญชีผู้ใช้งานนี้ในระบบ กรุณาสมัครสมาชิกก่อนเข้าสู่ระบบ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1. LOGIN / USER (Seller)
app.post('/api/login/seller', async (req, res) => {
  try {
    const { name } = req.body;
    const trimmed = (name || '').trim();
    if (!trimmed) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อ' });
    }

    const existingStaff = await queryOne('SELECT * FROM staffs WHERE LOWER(staff_name) = LOWER(?)', [trimmed]);
    if (existingStaff) {
      return res.status(403).json({ 
        error: `ชื่อ "${trimmed}" ได้รับการลงทะเบียนเป็น "พนักงาน (Staff)" แล้ว ไม่สามารถเข้าใช้งานเป็นคนขายขยะได้` 
      });
    }

    const existingAdmin = await queryOne('SELECT * FROM admins WHERE LOWER(admin_name) = LOWER(?)', [trimmed]);
    if (existingAdmin) {
      return res.status(403).json({ 
        error: `ชื่อ "${trimmed}" ได้รับการลงทะเบียนเป็น "ผู้ดูแลระบบ (Admin)" แล้ว ไม่สามารถเข้าใช้งานเป็นคนขายขยะได้` 
      });
    }

    let user = await queryOne('SELECT * FROM user WHERE username = ? OR name = ?', [trimmed, trimmed]);
    if (!user) {
      const insertRes = await execute(
        'INSERT INTO user (username, name, email, phone, points) VALUES (?, ?, ?, ?, ?)',
        [trimmed, trimmed, `${trimmed.toLowerCase()}@eco.com`, '', 670]
      );
      user = await queryOne('SELECT * FROM user WHERE user_id = ?', [Number(insertRes.lastInsertRowid)]);
    }

    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. LOGIN / STAFF (Employee)
app.post('/api/login/staff', async (req, res) => {
  try {
    const { name } = req.body;
    const trimmed = (name || '').trim();
    if (!trimmed) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อ' });
    }

    const existingUser = await queryOne('SELECT * FROM user WHERE LOWER(username) = LOWER(?) OR LOWER(name) = LOWER(?)', [trimmed, trimmed]);
    if (existingUser) {
      return res.status(403).json({ 
        error: `ชื่อ "${trimmed}" ได้รับการลงทะเบียนเป็น "คนขายขยะ (Seller)" แล้ว ไม่สามารถเข้าใช้งานเป็นพนักงานได้` 
      });
    }

    const existingAdmin = await queryOne('SELECT * FROM admins WHERE LOWER(admin_name) = LOWER(?)', [trimmed]);
    if (existingAdmin) {
      return res.status(403).json({ 
        error: `ชื่อ "${trimmed}" ได้รับการลงทะเบียนเป็น "ผู้ดูแลระบบ (Admin)" แล้ว ไม่สามารถเข้าใช้งานเป็นพนักงานได้` 
      });
    }

    let staff = await queryOne('SELECT * FROM staffs WHERE LOWER(staff_name) = LOWER(?)', [trimmed]);
    if (!staff) {
      const insertRes = await execute('INSERT INTO staffs (staff_name, phone) VALUES (?, ?)', [trimmed, '0123456789']);
      staff = await queryOne('SELECT * FROM staffs WHERE staff_id = ?', [Number(insertRes.lastInsertRowid)]);
    } else if (!staff.phone) {
      // Ensure initial default phone is 0123456789 (ข้อ 24)
      await execute("UPDATE staffs SET phone = '0123456789' WHERE staff_id = ?", [staff.staff_id]);
      staff.phone = '0123456789';
    }

    res.json({ staff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2.05 UPDATE STAFF PHONE (ข้อ 24)
app.post('/api/staff/phone', async (req, res) => {
  try {
    const { staffId, phone } = req.body;
    if (!staffId) {
      return res.status(400).json({ error: 'Missing staffId' });
    }
    const phoneVal = (phone || '').trim() || '0123456789';
    await execute('UPDATE staffs SET phone = ? WHERE staff_id = ?', [phoneVal, staffId]);
    const staff = await queryOne('SELECT * FROM staffs WHERE staff_id = ?', [staffId]);
    res.json({ success: true, staff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2.1 LOGIN / ADMIN (ล็อคadmin ต้องชื่อ admin เเละใส่รหัส admin01 เท่านั้น)
app.post('/api/login/admin', async (req, res) => {
  try {
    const { name, password } = req.body;
    const trimmed = (name || '').trim();
    const trimmedPass = (password || '').trim();

    if (!trimmed) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ดูแลระบบ' });
    }

    if (trimmed.toLowerCase() !== 'admin' || trimmedPass !== 'admin01') {
      return res.status(401).json({ 
        error: 'สิทธิ์การเข้าถึงถูกปฏิเสธ: ชื่อผู้ใช้หรือรหัสผ่านผู้ดูแลระบบไม่ถูกต้อง' 
      });
    }

    let admin = await queryOne('SELECT * FROM admins WHERE LOWER(admin_name) = ?', ['admin']);
    if (!admin) {
      const insertRes = await execute('INSERT INTO admins (admin_name) VALUES (?)', ['admin']);
      admin = await queryOne('SELECT * FROM admins WHERE admin_id = ?', [Number(insertRes.lastInsertRowid)]);
    }

    res.json({ admin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GET USER INFO
app.get('/api/user/:id', async (req, res) => {
  try {
    const user = await queryOne('SELECT * FROM user WHERE user_id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3.1 UPDATE PROFILE IMAGE
app.post('/api/user/profile-image', async (req, res) => {
  try {
    const { userId, imageBase64 } = req.body;
    if (!userId || !imageBase64) {
      return res.status(400).json({ error: 'Missing userId or image' });
    }

    await execute('UPDATE user SET profile_image = ? WHERE user_id = ?', [imageBase64, userId]);
    const updatedUser = await queryOne('SELECT * FROM user WHERE user_id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3.2 GET USER WASTE STATS
app.get('/api/user-stats/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const stats = await queryOne(`
      SELECT 
        COALESCE(SUM(recycle_kg), 0) as recycle_kg,
        COALESCE(SUM(organic_kg), 0) as organic_kg,
        COALESCE(SUM(general_kg), 0) as general_kg,
        COALESCE(SUM(hazardous_kg), 0) as hazardous_kg,
        COALESCE(SUM(total_kg), 0) as total_kg,
        COUNT(*) as total_times
      FROM waste_history
      WHERE user_id = ?
    `, [userId]);

    const recentHistory = await queryAll(`
      SELECT * FROM waste_history 
      WHERE user_id = ? 
      ORDER BY history_id DESC 
      LIMIT 10
    `, [userId]);

    res.json({ stats, recentHistory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. GET REWARDS
app.get('/api/rewards', async (req, res) => {
  try {
    const rewards = await queryAll('SELECT * FROM rewards ORDER BY point_required ASC');
    res.json({ rewards });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.1 ADMIN: UPDATE REWARD
app.post('/api/admin/rewards/update', async (req, res) => {
  try {
    const { rewardId, stock, pointRequired } = req.body;
    if (!rewardId) {
      return res.status(400).json({ error: 'Missing rewardId' });
    }

    const current = await queryOne('SELECT * FROM rewards WHERE reward_id = ?', [rewardId]);
    if (!current) return res.status(404).json({ error: 'Reward not found' });

    const newStock = stock !== undefined ? parseInt(stock) : current.stock;
    const newPoints = pointRequired !== undefined ? parseInt(pointRequired) : current.point_required;

    await execute('UPDATE rewards SET stock = ?, point_required = ? WHERE reward_id = ?', [newStock, newPoints, rewardId]);
    const updated = await queryOne('SELECT * FROM rewards WHERE reward_id = ?', [rewardId]);

    res.json({ 
      success: true, 
      reward: updated, 
      message: `อัปเดต "${updated.reward_name}" เรียบร้อยแล้ว (สต็อก: ${newStock})` 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.2 ADMIN: ADD NEW REWARD
app.post('/api/admin/rewards/add', async (req, res) => {
  try {
    const { name, stock, pointRequired, image } = req.body;
    const trimmedName = (name || '').trim();
    const trimmedImage = (image || '').trim();
    const numStock = parseInt(stock);
    const numPoints = parseInt(pointRequired);

    if (!trimmedName) {
      return res.status(400).json({ error: 'กรุณาระบุชื่อของรางวัล' });
    }
    if (isNaN(numStock) || numStock < 0) {
      return res.status(400).json({ error: 'กรุณาระบุจำนวนสต็อกให้ถูกต้อง (ตัวเลข >= 0)' });
    }
    if (isNaN(numPoints) || numPoints <= 0) {
      return res.status(400).json({ error: 'กรุณาระบุคะแนนที่ต้องใช้แลก (ตัวเลข > 0)' });
    }
    if (!trimmedImage) {
      return res.status(400).json({ error: 'กรุณาระบุรูปภาพหรือ Emoji ของของรางวัล' });
    }

    const insertRes = await execute(
      'INSERT INTO rewards (reward_name, point_required, stock, image) VALUES (?, ?, ?, ?)',
      [trimmedName, numPoints, numStock, trimmedImage]
    );
    const newReward = await queryOne('SELECT * FROM rewards WHERE reward_id = ?', [Number(insertRes.lastInsertRowid)]);
    await safeLogHistory(`แอดมินเพิ่มของรางวัลใหม่: "${trimmedName}" (${numStock} ชิ้น, ใช้ ${numPoints} แต้ม)`);

    res.json({ 
      success: true, 
      reward: newReward, 
      message: `เพิ่มของรางวัล "${trimmedName}" เข้าสู่ระบบสำเร็จ!` 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.3 ADMIN: DELETE REWARD (แก้ foreign key constraint error)
app.post('/api/admin/rewards/delete', async (req, res) => {
  try {
    const { rewardId } = req.body;
    if (!rewardId) return res.status(400).json({ error: 'Missing rewardId' });

    const target = await queryOne('SELECT * FROM rewards WHERE reward_id = ?', [rewardId]);
    if (!target) return res.status(404).json({ error: 'Reward not found' });

    // Delete redemptions associated with this reward first to prevent Foreign Key constraint error
    await db.batch([
      { sql: 'DELETE FROM redemptions WHERE reward_id = ?', args: [rewardId] },
      { sql: 'DELETE FROM rewards WHERE reward_id = ?', args: [rewardId] }
    ]);

    res.json({ success: true, message: `ลบของรางวัล "${target.reward_name}" เรียบร้อยแล้ว` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. REDEEM REWARD
app.post('/api/redeem', async (req, res) => {
  try {
    const { userId, rewardId, quantity = 1 } = req.body;
    if (!userId || !rewardId) {
      return res.status(400).json({ error: 'Missing userId or rewardId' });
    }

    const user = await queryOne('SELECT * FROM user WHERE user_id = ?', [userId]);
    const reward = await queryOne('SELECT * FROM rewards WHERE reward_id = ?', [rewardId]);

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!reward) return res.status(404).json({ error: 'Reward not found' });

    const totalPointsNeeded = reward.point_required * quantity;
    if (user.points < totalPointsNeeded) {
      return res.status(400).json({ error: 'คะแนนไม่เพียงพอสำหรับการแลกของรางวัลนี้' });
    }

    if (reward.stock < quantity) {
      return res.status(400).json({ error: 'สินค้าในคลังหมดแล้ว' });
    }

    // LibSQL atomic batch
    await db.batch([
      { sql: 'UPDATE user SET points = points - ? WHERE user_id = ?', args: [totalPointsNeeded, userId] },
      { sql: 'UPDATE rewards SET stock = stock - ? WHERE reward_id = ?', args: [quantity, rewardId] },
      { 
        sql: "INSERT INTO redemptions (user_id, reward_id, points_used, quantity, status, redeemed_at) VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))", 
        args: [userId, rewardId, totalPointsNeeded, quantity, 'สำเร็จ'] 
      }
    ]);

    const updatedUser = await queryOne('SELECT * FROM user WHERE user_id = ?', [userId]);
    const updatedReward = await queryOne('SELECT * FROM rewards WHERE reward_id = ?', [rewardId]);

    res.json({
      success: true,
      user: updatedUser,
      reward: updatedReward,
      message: `แลกรับ "${reward.reward_name}" สำเร็จ!`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. GET USER REDEMPTIONS
app.get('/api/redemptions/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const history = await queryAll(`
      SELECT r.redemption_id, r.user_id, r.reward_id, r.points_used, r.quantity, r.status, r.redeemed_at,
             w.reward_name, w.image
      FROM redemptions r
      JOIN rewards w ON r.reward_id = w.reward_id
      WHERE r.user_id = ?
      ORDER BY r.redemption_id DESC
    `, [userId]);

    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6.5. SAVE USER DEFAULT ADDRESS & PHONE (ข้อ 14)
app.post('/api/user/address', async (req, res) => {
  try {
    const { userId, address, phone } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }
    if (address !== undefined) {
      await execute('UPDATE user SET address = ? WHERE user_id = ?', [address.trim(), userId]);
    }
    if (phone !== undefined) {
      await execute('UPDATE user SET phone = ? WHERE user_id = ?', [phone.trim(), userId]);
    }
    const user = await queryOne('SELECT * FROM user WHERE user_id = ?', [userId]);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. GARBAGE REPORTS / PICKUP REQUESTS
app.get('/api/pickup', async (req, res) => {
  try {
    const reports = await queryAll(`
      SELECT g.*, 
             u.name as user_name, u.phone as user_phone, 
             l.location_name,
             s.staff_name, s.phone as staff_phone
      FROM garbage_reports g
      LEFT JOIN user u ON g.user_id = u.user_id
      LEFT JOIN locations l ON g.location_id = l.location_id
      LEFT JOIN staffs s ON g.staff_id = s.staff_id
      ORDER BY g.report_id DESC
    `);
    res.json({ reports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ดูสถานะคิวปัจจุบันของผู้ใช้คนขาย (ข้อ 11)
app.get('/api/pickup/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const activeReport = await queryOne(`
      SELECT g.*, 
             u.name as user_name, u.phone as user_phone, 
             l.location_name,
             s.staff_name, s.phone as staff_phone
      FROM garbage_reports g
      LEFT JOIN user u ON g.user_id = u.user_id
      LEFT JOIN locations l ON g.location_id = l.location_id
      LEFT JOIN staffs s ON g.staff_id = s.staff_id
      WHERE g.user_id = ? AND g.status IN ('Waiting', 'Seller Accepted', 'Seller Rejected')
      ORDER BY g.report_id DESC
      LIMIT 1
    `, [userId]);

    res.json({ report: activeReport || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ตรวจสอบสถานะการตัดสินใจของ Seller สำหรับคิวที่พนักงานกำลังทำรายการ (ข้อ 22)
app.get('/api/pickup/status/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const report = await queryOne(`
      SELECT g.*, 
             u.name as user_name, u.phone as user_phone, 
             l.location_name,
             s.staff_name, s.phone as staff_phone
      FROM garbage_reports g
      LEFT JOIN user u ON g.user_id = u.user_id
      LEFT JOIN locations l ON g.location_id = l.location_id
      LEFT JOIN staffs s ON g.staff_id = s.staff_id
      WHERE g.report_id = ?
    `, [reportId]);

    if (!report) {
      return res.status(404).json({ error: 'ไม่พบรายการคิวนี้ในระบบ' });
    }
    res.json({ report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ลูกค้ากดปฏิเสธแต้มจากการสแกน QR Code (ข้อ 22)
app.post('/api/pickup/reject', async (req, res) => {
  try {
    const { reportId, userId, reason } = req.body;
    if (!reportId) {
      return res.status(400).json({ error: 'Missing reportId' });
    }

    await execute(
      "UPDATE garbage_reports SET status = 'Seller Rejected', seller_decision = 'rejected' WHERE report_id = ?",
      [reportId]
    );

    const report = await queryOne('SELECT * FROM garbage_reports WHERE report_id = ?', [reportId]);
    if (report && report.staff_id) {
      await safeLogHistory(
        `ลูกค้า #${userId || report.user_id} ปฏิเสธแต้มในคิว #${reportId} (${reason || 'ปฏิเสธแต้ม'})`,
        report.staff_id,
        report.location_id || 1
      );
    }

    res.json({ success: true, message: 'บันทึกการปฏิเสธแต้มเรียบร้อยแล้ว' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ยืนยันคิวเสร็จสิ้น (Confirm Queue - ข้อ 20 & ข้อ 22)
// พนักงานจะกด Confirm ได้ก็ต่อเมื่อ seller สแกน qr code และกดยืนยันรับหรือปฏิเสธ point แล้วเท่านั้น
app.post('/api/pickup/confirm', async (req, res) => {
  try {
    const { reportId, staffId } = req.body;
    if (!reportId) {
      return res.status(400).json({ error: 'Missing reportId' });
    }

    const currentRep = await queryOne('SELECT * FROM garbage_reports WHERE report_id = ?', [reportId]);
    if (!currentRep) {
      return res.status(404).json({ error: 'ไม่พบรายการคิวนี้ในระบบ' });
    }

    // ข้อ 22: ตรวจสอบการตัดสินใจของ seller
    if (!currentRep.seller_decision) {
      return res.status(400).json({ 
        error: 'ยังไม่สามารถยืนยันคิวได้: ต้องรอให้ลูกค้าสแกน QR Code และกดยืนยันรับหรือปฏิเสธแต้มก่อน' 
      });
    }

    await execute("UPDATE garbage_reports SET status = 'Completed' WHERE report_id = ?", [reportId]);
    const report = await queryOne(`
      SELECT g.*, 
             u.name as user_name, u.phone as user_phone, 
             l.location_name,
             s.staff_name, s.phone as staff_phone
      FROM garbage_reports g
      LEFT JOIN user u ON g.user_id = u.user_id
      LEFT JOIN locations l ON g.location_id = l.location_id
      LEFT JOIN staffs s ON g.staff_id = s.staff_id
      WHERE g.report_id = ?
    `, [reportId]);

    if (staffId) {
      await safeLogHistory(
        `พนักงานยืนยันเสร็จสิ้นคิว #${reportId} ของลูกค้า ${report ? report.user_name : ''} (ผลการตัดสินใจลูกค้า: ${currentRep.seller_decision})`,
        staffId,
        report ? report.location_id : 1
      );
    }

    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pickup', async (req, res) => {
  try {
    const { userId, title, description, locationName = 'กรุงเทพฯ', phone } = req.body;
    const uid = userId || 1;

    // ข้อ 21: seller 1 คนสามารถกดเรียกพนักงานได้ครั้งเดียว ไม่สามารถกดซ้ำได้จนกว่าพนักงานจะ confirm queue
    const existing = await queryOne(
      "SELECT * FROM garbage_reports WHERE user_id = ? AND status = 'Waiting' LIMIT 1",
      [uid]
    );
    if (existing) {
      return res.status(400).json({ 
        error: `คุณมีคิวที่กำลังรอรับบริการอยู่แล้ว (คำขอ #${existing.report_id}) ไม่สามารถเรียกรถซ้ำได้ จนกว่าพนักงานจะยืนยันเสร็จสิ้น` 
      });
    }

    // ข้อ 14: บันทึกที่อยู่เริ่มต้นและเบอร์โทรของผู้ใช้
    if (locationName && locationName.trim()) {
      await execute('UPDATE user SET address = ? WHERE user_id = ?', [locationName.trim(), uid]);
    }
    if (phone && phone.trim()) {
      await execute('UPDATE user SET phone = ? WHERE user_id = ?', [phone.trim(), uid]);
    }

    let loc = await queryOne('SELECT * FROM locations WHERE location_name = ?', [locationName]);
    if (!loc) {
      const resLoc = await execute('INSERT INTO locations (location_name) VALUES (?)', [locationName]);
      loc = { location_id: Number(resLoc.lastInsertRowid) };
    }

    // ข้อ 19: สุ่มยัดงานให้พนักงานโดยยึดคนที่มี queue น้อยที่สุด
    const assignedStaff = await assignStaffWithLeastQueues();
    const staffId = assignedStaff ? assignedStaff.staff_id : null;

    const insertReport = await execute(
      'INSERT INTO garbage_reports (user_id, staff_id, location_id, title, descriiption, reward_point, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\', \'localtime\'))',
      [uid, staffId, loc.location_id, title || 'เรียกรถรับซื้อขยะ', description || '', 0, 'Waiting']
    );

    const newReport = await queryOne(`
      SELECT g.*, 
             u.name as user_name, u.phone as user_phone, 
             l.location_name,
             s.staff_name, s.phone as staff_phone
      FROM garbage_reports g
      LEFT JOIN user u ON g.user_id = u.user_id
      LEFT JOIN locations l ON g.location_id = l.location_id
      LEFT JOIN staffs s ON g.staff_id = s.staff_id
      WHERE g.report_id = ?
    `, [Number(insertReport.lastInsertRowid)]);

    res.json({ success: true, report: newReport, assignedStaff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. ADD REWARD POINTS & RECORD WASTE STATS
app.post('/api/points/add', async (req, res) => {
  try {
    const { 
      userId, 
      points, 
      summary, 
      staffId = 1,
      recycleKg = 0,
      organicKg = 0,
      generalKg = 0,
      hazardousKg = 0,
      totalWeight = 0,
      targetUserId = null,
      reportId = null,
      locationName = null
    } = req.body;

    if (!userId || !points) {
      return res.status(400).json({ error: 'Missing userId or points' });
    }

    // ข้อ 12: ตรวจสอบถ้าไม่ได้สแกนของตัวเอง จะไม่ได้คะแนน
    if (targetUserId && Number(targetUserId) !== Number(userId)) {
      return res.status(403).json({ error: 'ไม่สามารถรับคะแนนได้: QR Code นี้ไม่ได้สร้างสำหรับบัญชีของคุณ' });
    }

    const totalKg = totalWeight > 0 ? totalWeight : (recycleKg + organicKg + generalKg + hazardousKg);

    let finalLocation = locationName;
    let finalStaffId = staffId;
    if (reportId) {
      const rep = await queryOne(`
        SELECT l.location_name, g.staff_id 
        FROM garbage_reports g 
        LEFT JOIN locations l ON g.location_id = l.location_id 
        WHERE g.report_id = ?
      `, [reportId]);
      if (rep) {
        if (rep.location_name && !finalLocation) finalLocation = rep.location_name;
        if (rep.staff_id) finalStaffId = rep.staff_id;
      }
    }
    if (!finalLocation) {
      const uRow = await queryOne('SELECT address FROM user WHERE user_id = ?', [userId]);
      finalLocation = (uRow && uRow.address) ? uRow.address : 'จุดบริการรับซื้อขยะเคลื่อนที่ (กรุงเทพฯ)';
    }

    const wasteDetails = summary || `ขยะรีไซเคิล ${recycleKg} kg, ขยะเปียก ${organicKg} kg, ขยะทั่วไป ${generalKg} ถุง, ขยะอันตราย ${hazardousKg} ชิ้น`;

    const batchOps = [
      { sql: 'UPDATE user SET points = points + ? WHERE user_id = ?', args: [points, userId] },
      { 
        sql: `INSERT INTO waste_history 
              (user_id, staff_id, location_name, waste_details, recycle_kg, organic_kg, general_kg, hazardous_kg, total_kg, points_earned) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        args: [userId, finalStaffId, finalLocation, wasteDetails, recycleKg, organicKg, generalKg, hazardousKg, totalKg, points] 
      }
    ];

    // ปรับสถานะคิวเป็น Seller Accepted เมื่อรับแต้มเสร็จสิ้น (ข้อ 22)
    if (reportId) {
      batchOps.push({
        sql: "UPDATE garbage_reports SET status = 'Seller Accepted', seller_decision = 'accepted' WHERE report_id = ?",
        args: [reportId]
      });
    } else {
      batchOps.push({
        sql: "UPDATE garbage_reports SET status = 'Seller Accepted', seller_decision = 'accepted' WHERE user_id = ? AND status = 'Waiting'",
        args: [userId]
      });
    }

    await db.batch(batchOps);

    await safeLogHistory(`โอนแต้มให้ผู้ใช้ #${userId} จำนวน +${points} แต้ม (ขยะรวม ${totalKg} kg: ${summary || ''})`, finalStaffId, 1);

    const updatedUser = await queryOne('SELECT * FROM user WHERE user_id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8.1 GET USER WASTE SALES HISTORY (ประวัติการขายขยะของ user)
app.get('/api/user/sales-history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const history = await queryAll(`
      SELECT w.*, s.staff_name, s.phone as staff_phone
      FROM waste_history w
      LEFT JOIN staffs s ON w.staff_id = s.staff_id
      WHERE w.user_id = ?
      ORDER BY w.history_id DESC
    `, [userId]);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8.2 GET STAFF WASTE PURCHASE HISTORY (ประวัติการรับซื้อขยะของ staff)
app.get('/api/staff/sales-history/:staffId', async (req, res) => {
  try {
    const { staffId } = req.params;
    const history = await queryAll(`
      SELECT w.*, u.name as user_name, u.username, u.phone as user_phone
      FROM waste_history w
      LEFT JOIN user u ON w.user_id = u.user_id
      WHERE w.staff_id = ? OR (w.staff_id IS NULL AND ? = 1)
      ORDER BY w.history_id DESC
    `, [staffId, staffId]);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. GET ALL STAFFS
app.get('/api/staffs', async (req, res) => {
  try {
    const staffs = await queryAll('SELECT * FROM staffs');
    res.json({ staffs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. GET & UPDATE WASTE RATES
app.get('/api/rates', async (req, res) => {
  try {
    const rates = await queryAll('SELECT * FROM waste_rates');
    res.json({ rates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/rates/update', async (req, res) => {
  try {
    const { rates } = req.body;
    if (!Array.isArray(rates)) {
      return res.status(400).json({ error: 'rates must be an array' });
    }

    const statements = rates
      .filter(r => r.category_key && r.points_per_unit !== undefined)
      .map(r => ({
        sql: 'UPDATE waste_rates SET points_per_unit = ? WHERE category_key = ?',
        args: [parseFloat(r.points_per_unit), r.category_key]
      }));

    if (statements.length > 0) {
      await db.batch(statements);
    }

    const updatedRates = await queryAll('SELECT * FROM waste_rates');
    res.json({ 
      success: true, 
      rates: updatedRates, 
      message: 'อัปเดตอัตราตัวคูณขยะ 4 ประเภทลงฐานข้อมูลสำเร็จ!' 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. ADMIN: GET ALL USERS
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await queryAll('SELECT user_id, username, name, email, phone, points, profile_image FROM user ORDER BY user_id DESC');
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. ADMIN: ADJUST USER POINTS
app.post('/api/admin/user/adjust-points', async (req, res) => {
  try {
    const { usernameOrId, points, mode = 'set' } = req.body;
    if (!usernameOrId || points === undefined) {
      return res.status(400).json({ error: 'กรุณาระบุชื่อ/รหัสผู้ใช้ และคะแนน' });
    }

    const numPoints = parseInt(points);
    if (isNaN(numPoints)) {
      return res.status(400).json({ error: 'คะแนนต้องเป็นตัวเลข' });
    }

    const targetUser = await queryOne(
      'SELECT * FROM user WHERE user_id = ? OR LOWER(username) = LOWER(?) OR LOWER(name) = LOWER(?)',
      [usernameOrId, usernameOrId, usernameOrId]
    );

    if (!targetUser) {
      return res.status(404).json({ error: `ไม่พบผู้ใช้งาน "${usernameOrId}" ในระบบ` });
    }

    let newPoints = numPoints;
    if (mode === 'add') {
      newPoints = targetUser.points + numPoints;
    }
    if (newPoints < 0) newPoints = 0;

    await execute('UPDATE user SET points = ? WHERE user_id = ?', [newPoints, targetUser.user_id]);
    await safeLogHistory(`แอดมินปรับคะแนนผู้ใช้ "${targetUser.username}" จาก ${targetUser.points} เป็น ${newPoints} แต้ม`);

    const updatedUser = await queryOne('SELECT * FROM user WHERE user_id = ?', [targetUser.user_id]);
    res.json({ 
      success: true, 
      user: updatedUser, 
      message: `ปรับคะแนนผู้ใช้ "${updatedUser.username}" เป็น ${newPoints.toLocaleString()} แต้ม สำเร็จ!` 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. ADMIN: DELETE USER (ลบ user พร้อมข้อมูลที่เชื่อมโยง)
app.post('/api/admin/user/delete', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const targetUser = await queryOne('SELECT * FROM user WHERE user_id = ?', [userId]);
    if (!targetUser) return res.status(404).json({ error: 'ไม่พบผู้ใช้งานนี้ในระบบ' });

    await db.batch([
      { sql: 'DELETE FROM redemptions WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM waste_history WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM garbage_reports WHERE user_id = ?', args: [userId] },
      { sql: 'DELETE FROM user WHERE user_id = ?', args: [userId] }
    ]);

    await safeLogHistory(`แอดมินลบผู้ใช้ "${targetUser.username}" (ID: ${userId}) ออกจากระบบ`);

    res.json({ success: true, message: `ลบผู้ใช้งาน "${targetUser.username}" ออกจากระบบสำเร็จ!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. ADMIN: DELETE STAFF (ลบ staff พร้อมข้อมูลที่เชื่อมโยง)
app.post('/api/admin/staff/delete', async (req, res) => {
  try {
    const { staffId } = req.body;
    if (!staffId) return res.status(400).json({ error: 'Missing staffId' });

    const targetStaff = await queryOne('SELECT * FROM staffs WHERE staff_id = ?', [staffId]);
    if (!targetStaff) return res.status(404).json({ error: 'ไม่พบพนักงานนี้ในระบบ' });

    await db.batch([
      { sql: 'DELETE FROM history_logs WHERE staff_id = ?', args: [staffId] },
      { sql: 'DELETE FROM staffs WHERE staff_id = ?', args: [staffId] }
    ]);

    res.json({ success: true, message: `ลบพนักงาน "${targetStaff.staff_name}" (ID: ${staffId}) ออกจากระบบสำเร็จ!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. ADMIN: CLEAR ALL QUEUES (ล้างคิวทั้งหมดของพนักงานทิ้ง - ข้อ 25 & ข้อ 26)
app.post('/api/admin/queues/clear', async (req, res) => {
  try {
    const queueCountRes = await queryOne('SELECT COUNT(*) as count FROM garbage_reports');
    const totalDeleted = queueCountRes ? queueCountRes.count : 0;

    await execute('DELETE FROM garbage_reports');

    await safeLogHistory(`แอดมินล้างคิวคำขอรับซื้อขยะของพนักงานทั้งหมด (${totalDeleted} รายการ)`);

    res.json({ success: true, message: `ล้างคิวของพนักงานทั้งหมดสำเร็จแล้ว (${totalDeleted} รายการ)` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// STATIC FILES & SPA FALLBACK (Production)
// -------------------------------------------------------------
const distPath = path.resolve(process.cwd(), 'dist');
app.use(express.static(distPath));

app.use((req, res) => {
  if (req.url.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.resolve(distPath, 'index.html'));
});

// Start Server
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
    console.log(`📦 Serving static frontend from: ${distPath}`);
  });
});
