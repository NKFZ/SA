import Database from 'better-sqlite3';
import path from 'path';

export function dbApiPlugin() {
  const dbPath = path.resolve(process.cwd(), 'DB', 'supertrash.db');
  let db;

  try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Create waste_history table if not exists (for recording waste recycling stats)
    db.exec(`
      CREATE TABLE IF NOT EXISTS waste_history (
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
      );

      CREATE TABLE IF NOT EXISTS admins (
        admin_id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_name TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );

      CREATE TABLE IF NOT EXISTS waste_rates (
        category_key TEXT PRIMARY KEY,
        category_name TEXT NOT NULL,
        points_per_unit REAL NOT NULL,
        unit_name TEXT NOT NULL
      );
    `);

    // Ensure default waste_rates if empty
    const ratesCount = db.prepare("SELECT COUNT(*) as count FROM waste_rates").get().count;
    if (ratesCount === 0) {
      const defaultRates = [
        ['recycle', 'Recycle Waste', 50, 'kg'],
        ['organic', 'Organic Waste', 30, 'kg'],
        ['general', 'General Waste', 20, 'ถุง'],
        ['hazardous', 'Hazardous Waste', 80, 'ชิ้น']
      ];
      const insertRate = db.prepare("INSERT INTO waste_rates (category_key, category_name, points_per_unit, unit_name) VALUES (?, ?, ?, ?)");
      for (const r of defaultRates) {
        insertRate.run(...r);
      }
    }

    // Ensure sample admin if empty
    const adminCount = db.prepare("SELECT COUNT(*) as count FROM admins").get().count;
    if (adminCount === 0) {
      db.prepare("INSERT INTO admins (admin_name) VALUES (?)").run('Admin (ผู้ดูแลระบบ)');
    }

    // Ensure initial rewards if empty
    const rewardCount = db.prepare("SELECT COUNT(*) as count FROM rewards").get().count;
    if (rewardCount === 0) {
      const initRewards = [
        [1, 'Tote Bag (กระเป๋าผ้า)', 550, 20, '🛍️'],
        [2, 'Plastic Bottle (ขวดน้ำ)', 750, 15, '🍾'],
        [3, 'Voucher 100฿', 1150, 30, '🎟️'],
        [4, 'Air-Purifying Plant', 3350, 10, '🪴'],
        [5, 'Stainless Steel Bottle', 5000, 8, '🥤']
      ];
      const insert = db.prepare("INSERT INTO rewards (reward_id, reward_name, point_required, stock, image) VALUES (?, ?, ?, ?, ?)");
      for (const r of initRewards) {
        insert.run(...r);
      }
    }

    // Ensure sample staff if empty
    const staffCount = db.prepare("SELECT COUNT(*) as count FROM staffs").get().count;
    if (staffCount === 0) {
      db.prepare("INSERT INTO staffs (staff_name, phone) VALUES (?, ?)").run('สมชาย เก็บขยะ (EMP-8821)', '081-999-8888');
    }

    // Ensure sample location if empty
    const locCount = db.prepare("SELECT COUNT(*) as count FROM locations").get().count;
    if (locCount === 0) {
      db.prepare("INSERT INTO locations (location_name) VALUES (?)").run('กรุงเทพฯ และปริมณฑล');
    }

    // Auto-migrate new columns
    try { db.prepare('ALTER TABLE user ADD COLUMN address TEXT').run(); } catch(e) {}
    try { db.prepare('ALTER TABLE user ADD COLUMN password TEXT').run(); } catch(e) {}
    try { db.prepare('ALTER TABLE staffs ADD COLUMN password TEXT').run(); } catch(e) {}
    try { db.prepare('ALTER TABLE staffs ADD COLUMN username TEXT').run(); } catch(e) {}
    try { db.prepare('ALTER TABLE staffs ADD COLUMN email TEXT').run(); } catch(e) {}
    try { db.prepare('ALTER TABLE staffs ADD COLUMN address TEXT').run(); } catch(e) {}
    try { db.prepare('ALTER TABLE garbage_reports ADD COLUMN staff_id INTEGER').run(); } catch(e) {}
    try { db.prepare('ALTER TABLE garbage_reports ADD COLUMN created_at TEXT').run(); } catch(e) {}
    try { db.prepare('ALTER TABLE garbage_reports ADD COLUMN seller_decision TEXT').run(); } catch(e) {}
    try { db.prepare('ALTER TABLE waste_history ADD COLUMN staff_id INTEGER').run(); } catch(e) {}
    try { db.prepare('ALTER TABLE waste_history ADD COLUMN location_name TEXT').run(); } catch(e) {}
    try { db.prepare('ALTER TABLE waste_history ADD COLUMN waste_details TEXT').run(); } catch(e) {}

    console.log(`[DB Plugin] Connected to SQLite database at: ${dbPath}`);
  } catch (err) {
    console.error('[DB Plugin] Database connection error:', err);
  }

  // Helper: สุ่มยัดงานให้พนักงานโดยยึดคนที่มี queue น้อยที่สุด (ข้อ 19)
  function assignStaffWithLeastQueues() {
    const allStaffs = db.prepare("SELECT * FROM staffs").all();
    if (!allStaffs || allStaffs.length === 0) return null;

    const queueCounts = db.prepare(`
      SELECT staff_id, COUNT(*) as count 
      FROM garbage_reports 
      WHERE status = 'Waiting' AND staff_id IS NOT NULL
      GROUP BY staff_id
    `).all();

    const countMap = {};
    for (const s of allStaffs) {
      countMap[s.staff_id] = 0;
    }
    for (const row of queueCounts) {
      if (countMap[row.staff_id] !== undefined) {
        countMap[row.staff_id] = Number(row.count);
      }
    }

    let minCount = Infinity;
    for (const s of allStaffs) {
      if (countMap[s.staff_id] < minCount) {
        minCount = countMap[s.staff_id];
      }
    }

    const candidateStaffs = allStaffs.filter(s => countMap[s.staff_id] === minCount);
    return candidateStaffs[Math.floor(Math.random() * candidateStaffs.length)];
  }

  // Helper: ดึง staff_id และ location_id ที่มีอยู่จริงเพื่อป้องกัน Foreign Key Constraint Error
  function getValidStaffAndLocation(preferredStaffId = null, preferredLocId = null) {
    let staffId = preferredStaffId;
    let locId = preferredLocId;

    if (staffId) {
      const s = db.prepare('SELECT staff_id FROM staffs WHERE staff_id = ?').get(staffId);
      if (!s) staffId = null;
    }
    if (!staffId) {
      const s = db.prepare('SELECT staff_id FROM staffs ORDER BY staff_id ASC LIMIT 1').get();
      staffId = s ? s.staff_id : null;
    }

    if (locId) {
      const l = db.prepare('SELECT location_id FROM locations WHERE location_id = ?').get(locId);
      if (!l) locId = null;
    }
    if (!locId) {
      const l = db.prepare('SELECT location_id FROM locations ORDER BY location_id ASC LIMIT 1').get();
      locId = l ? l.location_id : null;
    }

    return { staffId, locId };
  }

  function safeLogHistory(actionText, preferredStaffId = null, preferredLocId = null) {
    try {
      const { staffId, locId } = getValidStaffAndLocation(preferredStaffId, preferredLocId);
      if (staffId && locId) {
        db.prepare(
          "INSERT INTO history_logs (staff_id, location_id, action, action_date) VALUES (?, ?, ?, datetime('now', 'localtime'))"
        ).run(staffId, locId, actionText);
      }
    } catch (err) {
      console.warn('[SafeLogHistory Warning]:', err.message);
    }
  }

  return {
    name: 'db-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) {
          return next();
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;
        const method = req.method;

        // Helper to parse JSON body
        const parseBody = () => {
          return new Promise((resolve) => {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                resolve(body ? JSON.parse(body) : {});
              } catch (e) {
                resolve({});
              }
            });
          });
        };

        const sendJson = (data, status = 200) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(data));
        };

        try {
          // 0.1 REGISTER (Seller or Staff)
          if (pathname === '/api/register' && method === 'POST') {
            const { email, username, phone, address, password, role } = await parseBody();
            const cleanUser = (username || '').trim();
            const cleanEmail = (email || '').trim();
            const cleanPhone = (phone || '').replace(/\D/g, '').slice(0, 10);
            const cleanAddress = (address || '').trim();
            const cleanPass = (password || '').trim();
            const cleanRole = (role || '').trim().toLowerCase();

            if (!cleanUser || !cleanPass || !cleanEmail || !cleanRole) {
              return sendJson({ error: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (ชื่อผู้ใช้, รหัสผ่าน, อีเมล, บทบาท)' }, 400);
            }

            if (cleanRole === 'seller' && !cleanAddress) {
              return sendJson({ error: 'สำหรับคนขายขยะ (Seller) กรุณากรอกที่อยู่ด้วย' }, 400);
            }

            if (cleanRole === 'admin' || cleanUser.toLowerCase() === 'admin') {
              return sendJson({ error: 'ไม่อนุญาตให้ลงทะเบียนเป็นผู้ดูแลระบบ (Admin)' }, 403);
            }

            if (cleanRole !== 'seller' && cleanRole !== 'staff') {
              return sendJson({ error: 'บทบาทไม่ถูกต้อง ต้องเลือกเป็น Seller หรือ Staff' }, 400);
            }

            const userExist = db.prepare('SELECT * FROM user WHERE LOWER(username) = LOWER(?)').get(cleanUser);
            const staffExist = db.prepare('SELECT * FROM staffs WHERE LOWER(username) = LOWER(?) OR LOWER(staff_name) = LOWER(?)').get(cleanUser, cleanUser);
            const adminExist = db.prepare('SELECT * FROM admins WHERE LOWER(admin_name) = LOWER(?)').get(cleanUser);
            if (userExist || staffExist || adminExist) {
              return sendJson({ error: `ชื่อผู้ใช้งาน "${cleanUser}" ถูกใช้งานแล้ว กรุณาเลือกชื่ออื่น` }, 409);
            }

            if (cleanRole === 'seller') {
              const resInsert = db.prepare(
                'INSERT INTO user (username, name, email, phone, address, password, points) VALUES (?, ?, ?, ?, ?, ?, ?)'
              ).run(cleanUser, cleanUser, cleanEmail, cleanPhone, cleanAddress, cleanPass, 0);
              const newUser = db.prepare('SELECT * FROM user WHERE user_id = ?').get(resInsert.lastInsertRowid);
              return sendJson({ success: true, role: 'seller', user: newUser });
            } else if (cleanRole === 'staff') {
              const staffPhone = cleanPhone || '0123456789';
              const resInsert = db.prepare(
                'INSERT INTO staffs (staff_name, username, email, phone, address, password) VALUES (?, ?, ?, ?, ?, ?)'
              ).run(cleanUser, cleanUser, cleanEmail, staffPhone, cleanAddress, cleanPass);
              const newStaff = db.prepare('SELECT * FROM staffs WHERE staff_id = ?').get(resInsert.lastInsertRowid);
              return sendJson({ success: true, role: 'staff', staff: newStaff });
            }
          }

          // 0.2 UNIFIED LOGIN (Admin, Seller, Staff)
          if (pathname === '/api/login' && method === 'POST') {
            const { username, password } = await parseBody();
            const cleanUser = (username || '').trim();
            const cleanPass = (password || '').trim();

            if (!cleanUser || !cleanPass) {
              return sendJson({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' }, 400);
            }

            if (cleanUser.toLowerCase() === 'admin' && cleanPass === 'admin01') {
              let admin = db.prepare('SELECT * FROM admins WHERE LOWER(admin_name) = ?').get('admin');
              if (!admin) {
                const resInsert = db.prepare('INSERT INTO admins (admin_name) VALUES (?)').run('admin');
                admin = db.prepare('SELECT * FROM admins WHERE admin_id = ?').get(resInsert.lastInsertRowid);
              }
              return sendJson({ success: true, role: 'admin', admin });
            }

            const user = db.prepare('SELECT * FROM user WHERE LOWER(username) = LOWER(?) OR LOWER(name) = LOWER(?)').get(cleanUser, cleanUser);
            if (user) {
              if (user.password && user.password !== cleanPass) {
                return sendJson({ error: 'รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' }, 401);
              }
              if (!user.password) {
                db.prepare('UPDATE user SET password = ? WHERE user_id = ?').run(cleanPass, user.user_id);
                user.password = cleanPass;
              }
              return sendJson({ success: true, role: 'seller', user });
            }

            const staff = db.prepare('SELECT * FROM staffs WHERE LOWER(username) = LOWER(?) OR LOWER(staff_name) = LOWER(?)').get(cleanUser, cleanUser);
            if (staff) {
              if (staff.password && staff.password !== cleanPass) {
                return sendJson({ error: 'รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' }, 401);
              }
              if (!staff.password) {
                db.prepare('UPDATE staffs SET password = ? WHERE staff_id = ?').run(cleanPass, staff.staff_id);
                staff.password = cleanPass;
              }
              return sendJson({ success: true, role: 'staff', staff });
            }

            return sendJson({ error: 'ไม่พบบัญชีผู้ใช้งานนี้ในระบบ กรุณาสมัครสมาชิกก่อนเข้าสู่ระบบ' }, 404);
          }

          // 1. LOGIN / USER (Seller) - 1 บทบาทต่อ 1 ชื่อ
          if (pathname === '/api/login/seller' && method === 'POST') {
            const { name } = await parseBody();
            const trimmed = (name || '').trim();
            if (!trimmed) {
              return sendJson({ error: 'กรุณากรอกชื่อ' }, 400);
            }

            // Check if name is already staff or admin
            const existingStaff = db.prepare("SELECT * FROM staffs WHERE LOWER(staff_name) = LOWER(?)").get(trimmed);
            if (existingStaff) {
              return sendJson({ 
                error: `ชื่อ "${trimmed}" ได้รับการลงทะเบียนเป็น "พนักงาน (Staff)" แล้ว ไม่สามารถเข้าใช้งานเป็นคนขายขยะได้` 
              }, 403);
            }

            const existingAdmin = db.prepare("SELECT * FROM admins WHERE LOWER(admin_name) = LOWER(?)").get(trimmed);
            if (existingAdmin) {
              return sendJson({ 
                error: `ชื่อ "${trimmed}" ได้รับการลงทะเบียนเป็น "ผู้ดูแลระบบ (Admin)" แล้ว ไม่สามารถเข้าใช้งานเป็นคนขายขยะได้` 
              }, 403);
            }

            // Find or create user
            let user = db.prepare("SELECT * FROM user WHERE username = ? OR name = ?").get(trimmed, trimmed);
            if (!user) {
              const resInsert = db.prepare(
                "INSERT INTO user (username, name, email, phone, points) VALUES (?, ?, ?, ?, ?)"
              ).run(trimmed, trimmed, `${trimmed.toLowerCase()}@eco.com`, '', 670);
              user = db.prepare("SELECT * FROM user WHERE user_id = ?").get(resInsert.lastInsertRowid);
            }

            return sendJson({ user });
          }

          // 2. LOGIN / STAFF (Employee) - 1 บทบาทต่อ 1 ชื่อ
          if (pathname === '/api/login/staff' && method === 'POST') {
            const { name } = await parseBody();
            const trimmed = (name || '').trim();
            if (!trimmed) {
              return sendJson({ error: 'กรุณากรอกชื่อ' }, 400);
            }

            // Check if name is already seller or admin
            const existingUser = db.prepare("SELECT * FROM user WHERE LOWER(username) = LOWER(?) OR LOWER(name) = LOWER(?)").get(trimmed, trimmed);
            if (existingUser) {
              return sendJson({ 
                error: `ชื่อ "${trimmed}" ได้รับการลงทะเบียนเป็น "คนขายขยะ (Seller)" แล้ว ไม่สามารถเข้าใช้งานเป็นพนักงานได้` 
              }, 403);
            }

            const existingAdmin = db.prepare("SELECT * FROM admins WHERE LOWER(admin_name) = LOWER(?)").get(trimmed);
            if (existingAdmin) {
              return sendJson({ 
                error: `ชื่อ "${trimmed}" ได้รับการลงทะเบียนเป็น "ผู้ดูแลระบบ (Admin)" แล้ว ไม่สามารถเข้าใช้งานเป็นพนักงานได้` 
              }, 403);
            }

            let staff = db.prepare("SELECT * FROM staffs WHERE LOWER(staff_name) = LOWER(?)").get(trimmed);
            if (!staff) {
              const resInsert = db.prepare("INSERT INTO staffs (staff_name, phone) VALUES (?, ?)").run(trimmed, '0123456789');
              staff = db.prepare("SELECT * FROM staffs WHERE staff_id = ?").get(resInsert.lastInsertRowid);
            } else if (!staff.phone) {
              db.prepare("UPDATE staffs SET phone = '0123456789' WHERE staff_id = ?").run(staff.staff_id);
              staff.phone = '0123456789';
            }

            return sendJson({ staff });
          }

          // 2.05 UPDATE STAFF PHONE (ข้อ 24)
          if (pathname === '/api/staff/phone' && method === 'POST') {
            const { staffId, phone } = await parseBody();
            if (!staffId) {
              return sendJson({ error: 'Missing staffId' }, 400);
            }
            const phoneVal = (phone || '').replace(/\D/g, '').slice(0, 10) || '0123456789';
            db.prepare('UPDATE staffs SET phone = ? WHERE staff_id = ?').run(phoneVal, staffId);
            const staff = db.prepare('SELECT * FROM staffs WHERE staff_id = ?').get(staffId);
            return sendJson({ success: true, staff });
          }

          // 2.1 LOGIN / ADMIN (ล็อคadmin ต้องชื่อ admin เเละใส่รหัส admin01 เท่านั้น)
          if (pathname === '/api/login/admin' && method === 'POST') {
            const { name, password } = await parseBody();
            const trimmed = (name || '').trim();
            const trimmedPass = (password || '').trim();

            if (!trimmed) {
              return sendJson({ error: 'กรุณากรอกชื่อผู้ดูแลระบบ' }, 400);
            }

            if (trimmed.toLowerCase() !== 'admin' || trimmedPass !== 'admin01') {
              return sendJson({ 
                error: 'สิทธิ์การเข้าถึงถูกปฏิเสธ: ชื่อผู้ใช้หรือรหัสผ่านผู้ดูแลระบบไม่ถูกต้อง' 
              }, 401);
            }

            let admin = db.prepare("SELECT * FROM admins WHERE LOWER(admin_name) = ?").get('admin');
            if (!admin) {
              const resInsert = db.prepare("INSERT INTO admins (admin_name) VALUES (?)").run('admin');
              admin = db.prepare("SELECT * FROM admins WHERE admin_id = ?").get(resInsert.lastInsertRowid);
            }

            return sendJson({ admin });
          }

          // 3. GET USER INFO
          if (pathname.startsWith('/api/user/') && method === 'GET') {
            const userId = pathname.replace('/api/user/', '');
            const user = db.prepare("SELECT * FROM user WHERE user_id = ?").get(userId);
            if (!user) return sendJson({ error: 'User not found' }, 404);
            return sendJson({ user });
          }

          // 3.1 UPDATE PROFILE IMAGE (เฉพาะฝั่งคนขาย)
          if (pathname === '/api/user/profile-image' && method === 'POST') {
            const { userId, imageBase64 } = await parseBody();
            if (!userId || !imageBase64) {
              return sendJson({ error: 'Missing userId or image' }, 400);
            }

            db.prepare("UPDATE user SET profile_image = ? WHERE user_id = ?").run(imageBase64, userId);
            const updatedUser = db.prepare("SELECT * FROM user WHERE user_id = ?").get(userId);
            return sendJson({ success: true, user: updatedUser });
          }

          // 3.2 GET USER WASTE STATS
          if (pathname.startsWith('/api/user-stats/') && method === 'GET') {
            const userId = pathname.replace('/api/user-stats/', '');
            
            const stats = db.prepare(`
              SELECT 
                COALESCE(SUM(recycle_kg), 0) as recycle_kg,
                COALESCE(SUM(organic_kg), 0) as organic_kg,
                COALESCE(SUM(general_kg), 0) as general_kg,
                COALESCE(SUM(hazardous_kg), 0) as hazardous_kg,
                COALESCE(SUM(total_kg), 0) as total_kg,
                COUNT(*) as total_times
              FROM waste_history
              WHERE user_id = ?
            `).get(userId);

            const recentHistory = db.prepare(`
              SELECT * FROM waste_history 
              WHERE user_id = ? 
              ORDER BY history_id DESC 
              LIMIT 10
            `).all(userId);

            return sendJson({ stats, recentHistory });
          }

          // 4. GET REWARDS (from rewards table)
          if (pathname === '/api/rewards' && method === 'GET') {
            const rewards = db.prepare("SELECT * FROM rewards ORDER BY point_required ASC").all();
            return sendJson({ rewards });
          }

          // 4.1 ADMIN: UPDATE REWARD (Stock & Points Required)
          if (pathname === '/api/admin/rewards/update' && method === 'POST') {
            const { rewardId, stock, pointRequired } = await parseBody();
            if (!rewardId) {
              return sendJson({ error: 'Missing rewardId' }, 400);
            }

            const current = db.prepare("SELECT * FROM rewards WHERE reward_id = ?").get(rewardId);
            if (!current) return sendJson({ error: 'Reward not found' }, 404);

            const newStock = stock !== undefined ? parseInt(stock) : current.stock;
            const newPoints = pointRequired !== undefined ? parseInt(pointRequired) : current.point_required;

            db.prepare("UPDATE rewards SET stock = ?, point_required = ? WHERE reward_id = ?").run(newStock, newPoints, rewardId);
            const updated = db.prepare("SELECT * FROM rewards WHERE reward_id = ?").get(rewardId);

            return sendJson({ success: true, reward: updated, message: `อัปเดต "${updated.reward_name}" เรียบร้อยแล้ว (สต็อก: ${newStock})` });
          }

          // 4.2 ADMIN: ADD NEW REWARD (ข้อ 8: เพิ่มของรางวัลใหม่)
          if (pathname === '/api/admin/rewards/add' && method === 'POST') {
            const { name, stock, pointRequired, image } = await parseBody();
            const trimmedName = (name || '').trim();
            const trimmedImage = (image || '').trim();
            const numStock = parseInt(stock);
            const numPoints = parseInt(pointRequired);

            if (!trimmedName) {
              return sendJson({ error: 'กรุณาระบุชื่อของรางวัล' }, 400);
            }
            if (isNaN(numStock) || numStock < 0) {
              return sendJson({ error: 'กรุณาระบุจำนวนสต็อกให้ถูกต้อง (ตัวเลข >= 0)' }, 400);
            }
            if (isNaN(numPoints) || numPoints <= 0) {
              return sendJson({ error: 'กรุณาระบุคะแนนที่ต้องใช้แลก (ตัวเลข > 0)' }, 400);
            }
            if (!trimmedImage) {
              return sendJson({ error: 'กรุณาระบุรูปภาพหรือ Emoji ของของรางวัล' }, 400);
            }

            const insertStmt = db.prepare(
              "INSERT INTO rewards (reward_name, point_required, stock, image) VALUES (?, ?, ?, ?)"
            );
            const resInsert = insertStmt.run(trimmedName, numPoints, numStock, trimmedImage);
            const newReward = db.prepare("SELECT * FROM rewards WHERE reward_id = ?").get(resInsert.lastInsertRowid);

            // Log action
            safeLogHistory(`แอดมินเพิ่มของรางวัลใหม่: "${trimmedName}" (${numStock} ชิ้น, ใช้ ${numPoints} แต้ม)`);

            return sendJson({ 
              success: true, 
              reward: newReward, 
              message: `เพิ่มของรางวัล "${trimmedName}" เข้าสู่ระบบสำเร็จ!` 
            });
          }

          // 4.3 ADMIN: DELETE REWARD (แก้ foreign key constraint error)
          if (pathname === '/api/admin/rewards/delete' && method === 'POST') {
            const { rewardId } = await parseBody();
            if (!rewardId) return sendJson({ error: 'Missing rewardId' }, 400);

            const target = db.prepare("SELECT * FROM rewards WHERE reward_id = ?").get(rewardId);
            if (!target) return sendJson({ error: 'Reward not found' }, 404);

            db.transaction(() => {
              db.prepare("DELETE FROM redemptions WHERE reward_id = ?").run(rewardId);
              db.prepare("DELETE FROM rewards WHERE reward_id = ?").run(rewardId);
            })();

            return sendJson({ success: true, message: `ลบของรางวัล "${target.reward_name}" เรียบร้อยแล้ว` });
          }

          // 5. REDEEM REWARD
          if (pathname === '/api/redeem' && method === 'POST') {
            const { userId, rewardId, quantity = 1 } = await parseBody();
            if (!userId || !rewardId) {
              return sendJson({ error: 'Missing userId or rewardId' }, 400);
            }

            const user = db.prepare("SELECT * FROM user WHERE user_id = ?").get(userId);
            const reward = db.prepare("SELECT * FROM rewards WHERE reward_id = ?").get(rewardId);

            if (!user) return sendJson({ error: 'User not found' }, 404);
            if (!reward) return sendJson({ error: 'Reward not found' }, 404);

            const totalPointsNeeded = reward.point_required * quantity;
            if (user.points < totalPointsNeeded) {
              return sendJson({ error: 'คะแนนไม่เพียงพอสำหรับการแลกของรางวัลนี้' }, 400);
            }

            if (reward.stock < quantity) {
              return sendJson({ error: 'สินค้าในคลังหมดแล้ว' }, 400);
            }

            // Transaction
            const performRedeem = db.transaction(() => {
              db.prepare("UPDATE user SET points = points - ? WHERE user_id = ?").run(totalPointsNeeded, userId);
              db.prepare("UPDATE rewards SET stock = stock - ? WHERE reward_id = ?").run(quantity, rewardId);
              const insertRedeem = db.prepare(
                "INSERT INTO redemptions (user_id, reward_id, points_used, quantity, status, redeemed_at) VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))"
              ).run(userId, rewardId, totalPointsNeeded, quantity, 'สำเร็จ');

              return insertRedeem.lastInsertRowid;
            });

            const redemptionId = performRedeem();
            const updatedUser = db.prepare("SELECT * FROM user WHERE user_id = ?").get(userId);
            const updatedReward = db.prepare("SELECT * FROM rewards WHERE reward_id = ?").get(rewardId);

            return sendJson({
              success: true,
              redemptionId,
              user: updatedUser,
              reward: updatedReward,
              message: `แลกรับ "${reward.reward_name}" สำเร็จ!`
            });
          }

          // 6. GET USER REDEMPTIONS
          if (pathname.startsWith('/api/redemptions/') && method === 'GET') {
            const userId = pathname.replace('/api/redemptions/', '');
            const history = db.prepare(`
              SELECT r.redemption_id, r.user_id, r.reward_id, r.points_used, r.quantity, r.status, r.redeemed_at,
                     w.reward_name, w.image
              FROM redemptions r
              JOIN rewards w ON r.reward_id = w.reward_id
              WHERE r.user_id = ?
              ORDER BY r.redemption_id DESC
            `).all(userId);

            return sendJson({ history });
          }

          // 6.5. SAVE USER DEFAULT ADDRESS & PHONE (ข้อ 14)
          if (pathname === '/api/user/address' && method === 'POST') {
            const { userId, address, phone } = await parseBody();
            if (!userId) {
              return sendJson({ error: 'Missing userId' }, 400);
            }
            if (address !== undefined) {
              db.prepare('UPDATE user SET address = ? WHERE user_id = ?').run(address.trim(), userId);
            }
            if (phone !== undefined) {
              const cleanP = (phone || '').replace(/\D/g, '').slice(0, 10);
              db.prepare('UPDATE user SET phone = ? WHERE user_id = ?').run(cleanP, userId);
            }
            const user = db.prepare('SELECT * FROM user WHERE user_id = ?').get(userId);
            return sendJson({ success: true, user });
          }

          // 7. GARBAGE REPORTS / PICKUP REQUESTS
          if (pathname === '/api/pickup' && method === 'GET') {
            const reports = db.prepare(`
              SELECT g.*, 
                     u.name as user_name, u.phone as user_phone, 
                     l.location_name,
                     s.staff_name, s.phone as staff_phone
              FROM garbage_reports g
              LEFT JOIN user u ON g.user_id = u.user_id
              LEFT JOIN locations l ON g.location_id = l.location_id
              LEFT JOIN staffs s ON g.staff_id = s.staff_id
              ORDER BY g.report_id DESC
            `).all();
            return sendJson({ reports });
          }

          // ดูสถานะคิวปัจจุบันของผู้ใช้คนขาย (ข้อ 11, ข้อ 22)
          if (pathname.startsWith('/api/pickup/user/') && method === 'GET') {
            const userId = pathname.replace('/api/pickup/user/', '');
            const activeReport = db.prepare(`
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
            `).get(userId);
            return sendJson({ report: activeReport || null });
          }

          // ดูสถานะคิวตาม reportId แบบ real-time สำหรับพนักงาน (ข้อ 22)
          if (pathname.startsWith('/api/pickup/status/') && method === 'GET') {
            const reportId = pathname.replace('/api/pickup/status/', '');
            const report = db.prepare(`
              SELECT g.*, 
                     u.name as user_name, u.phone as user_phone, 
                     l.location_name,
                     s.staff_name, s.phone as staff_phone
              FROM garbage_reports g
              LEFT JOIN user u ON g.user_id = u.user_id
              LEFT JOIN locations l ON g.location_id = l.location_id
              LEFT JOIN staffs s ON g.staff_id = s.staff_id
              WHERE g.report_id = ?
            `).get(reportId);
            return sendJson({ report: report || null });
          }

          // ปฏิเสธแต้ม / การรับซื้อ (ข้อ 22: Seller Reject)
          if (pathname === '/api/pickup/reject' && method === 'POST') {
            const { reportId, userId } = await parseBody();
            if (reportId) {
              db.prepare("UPDATE garbage_reports SET seller_decision = 'rejected', status = 'Seller Rejected' WHERE report_id = ?").run(reportId);
            } else if (userId) {
              db.prepare("UPDATE garbage_reports SET seller_decision = 'rejected', status = 'Seller Rejected' WHERE user_id = ? AND status = 'Waiting'").run(userId);
            }
            return sendJson({ success: true, message: 'บันทึกการปฏิเสธแต้มเรียบร้อยแล้ว' });
          }

          // ยืนยันคิวเสร็จสิ้น (Confirm Queue - ข้อ 20, ข้อ 22: ต้องรอ seller ตัดสินใจก่อน)
          if (pathname === '/api/pickup/confirm' && method === 'POST') {
            const { reportId, staffId } = await parseBody();
            if (!reportId) {
              return sendJson({ error: 'Missing reportId' }, 400);
            }

            const currentRep = db.prepare("SELECT * FROM garbage_reports WHERE report_id = ?").get(reportId);
            if (!currentRep) {
              return sendJson({ error: 'ไม่พบคิวนี้ในระบบ' }, 404);
            }

            if (!currentRep.seller_decision) {
              return sendJson({ 
                error: 'ไม่สามารถกดยืนยันคิวได้: รอลูกค้าสแกน QR Code และกดยืนยันรับหรือปฏิเสธแต้มก่อน' 
              }, 400);
            }

            db.prepare("UPDATE garbage_reports SET status = 'Completed' WHERE report_id = ?").run(reportId);
            const report = db.prepare(`
              SELECT g.*, 
                     u.name as user_name, u.phone as user_phone, 
                     l.location_name,
                     s.staff_name, s.phone as staff_phone
              FROM garbage_reports g
              LEFT JOIN user u ON g.user_id = u.user_id
              LEFT JOIN locations l ON g.location_id = l.location_id
              LEFT JOIN staffs s ON g.staff_id = s.staff_id
              WHERE g.report_id = ?
            `).get(reportId);

            if (staffId) {
              safeLogHistory(`พนักงานยืนยันเสร็จสิ้นคิว #${reportId} ของลูกค้า ${report ? report.user_name : ''} (ผลการตัดสินใจของลูกค้า: ${currentRep.seller_decision})`, staffId, report ? report.location_id : 1);
            }
            return sendJson({ success: true, report });
          }

          if (pathname === '/api/pickup' && method === 'POST') {
            const { userId, title, description, locationName = 'กรุงเทพฯ', phone } = await parseBody();
            const uid = userId || 1;

            // ข้อ 21: seller 1 คนสามารถกดเรียกพนักงานได้ครั้งเดียว ไม่สามารถกดซ้ำได้จนกว่าพนักงานจะ confirm queue
            const existing = db.prepare(
              "SELECT * FROM garbage_reports WHERE user_id = ? AND status = 'Waiting' LIMIT 1"
            ).get(uid);
            if (existing) {
              return sendJson({ 
                error: `คุณมีคิวที่กำลังรอรับบริการอยู่แล้ว (คำขอ #${existing.report_id}) ไม่สามารถเรียกรถซ้ำได้ จนกว่าพนักงานจะยืนยันเสร็จสิ้น` 
              }, 400);
            }

            // ข้อ 14: บันทึกที่อยู่เริ่มต้นและเบอร์โทรของผู้ใช้
            if (locationName && locationName.trim()) {
              db.prepare('UPDATE user SET address = ? WHERE user_id = ?').run(locationName.trim(), uid);
            }
            if (phone && phone.trim()) {
              const cleanP = phone.replace(/\D/g, '').slice(0, 10);
              db.prepare('UPDATE user SET phone = ? WHERE user_id = ?').run(cleanP, uid);
            }

            let loc = db.prepare("SELECT * FROM locations WHERE location_name = ?").get(locationName);
            if (!loc) {
              const resLoc = db.prepare("INSERT INTO locations (location_name) VALUES (?)").run(locationName);
              loc = { location_id: resLoc.lastInsertRowid };
            }

            // ข้อ 19: สุ่มยัดงานให้พนักงานโดยยึดคนที่มี queue น้อยที่สุด
            const assignedStaff = assignStaffWithLeastQueues();
            const staffId = assignedStaff ? assignedStaff.staff_id : null;

            const insertReport = db.prepare(
              "INSERT INTO garbage_reports (user_id, staff_id, location_id, title, descriiption, reward_point, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))"
            ).run(uid, staffId, loc.location_id, title || 'เรียกรถรับซื้อขยะ', description || '', 0, 'Waiting');

            const newReport = db.prepare(`
              SELECT g.*, 
                     u.name as user_name, u.phone as user_phone, 
                     l.location_name,
                     s.staff_name, s.phone as staff_phone
              FROM garbage_reports g
              LEFT JOIN user u ON g.user_id = u.user_id
              LEFT JOIN locations l ON g.location_id = l.location_id
              LEFT JOIN staffs s ON g.staff_id = s.staff_id
              WHERE g.report_id = ?
            `).get(insertReport.lastInsertRowid);

            return sendJson({ success: true, report: newReport, assignedStaff });
          }

          // 8. ADD REWARD POINTS & RECORD WASTE STATS
          if (pathname === '/api/points/add' && method === 'POST') {
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
            } = await parseBody();

            if (!userId || !points) {
              return sendJson({ error: 'Missing userId or points' }, 400);
            }

            // ข้อ 12: ตรวจสอบถ้าไม่ได้สแกนของตัวเอง จะไม่ได้คะแนน
            if (targetUserId && Number(targetUserId) !== Number(userId)) {
              return sendJson({ error: 'ไม่สามารถรับคะแนนได้: QR Code นี้ไม่ได้สร้างสำหรับบัญชีของคุณ' }, 403);
            }

            const totalKg = totalWeight > 0 ? totalWeight : (recycleKg + organicKg + generalKg + hazardousKg);

            let finalLocation = locationName;
            let finalStaffId = staffId;
            if (reportId) {
              const rep = db.prepare(`
                SELECT l.location_name, g.staff_id 
                FROM garbage_reports g 
                LEFT JOIN locations l ON g.location_id = l.location_id 
                WHERE g.report_id = ?
              `).get(reportId);
              if (rep) {
                if (rep.location_name && !finalLocation) finalLocation = rep.location_name;
                if (rep.staff_id) finalStaffId = rep.staff_id;
              }
            }
            if (!finalLocation) {
              const uRow = db.prepare('SELECT address FROM user WHERE user_id = ?').get(userId);
              finalLocation = (uRow && uRow.address) ? uRow.address : 'จุดบริการรับซื้อขยะเคลื่อนที่ (กรุงเทพฯ)';
            }

            const wasteDetails = summary || `ขยะรีไซเคิล ${recycleKg} kg, ขยะเปียก ${organicKg} kg, ขยะทั่วไป ${generalKg} ถุง, ขยะอันตราย ${hazardousKg} ชิ้น`;

            db.prepare("UPDATE user SET points = points + ? WHERE user_id = ?").run(points, userId);

            db.prepare(`
              INSERT INTO waste_history 
              (user_id, staff_id, location_name, waste_details, recycle_kg, organic_kg, general_kg, hazardous_kg, total_kg, points_earned)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(userId, finalStaffId, finalLocation, wasteDetails, recycleKg, organicKg, generalKg, hazardousKg, totalKg, points);

            safeLogHistory(`โอนแต้มให้ผู้ใช้ #${userId} จำนวน +${points} แต้ม (ขยะรวม ${totalKg} kg: ${summary || ''})`, finalStaffId, 1);

            // ข้อ 22: เมื่อผู้ใช้กดรับแต้ม ปรับสถานะเป็น Seller Accepted พร้อมบันทึก seller_decision = 'accepted'
            if (reportId) {
              db.prepare("UPDATE garbage_reports SET status = 'Seller Accepted', seller_decision = 'accepted' WHERE report_id = ?").run(reportId);
            } else {
              db.prepare("UPDATE garbage_reports SET status = 'Seller Accepted', seller_decision = 'accepted' WHERE user_id = ? AND status = 'Waiting'").run(userId);
            }

            const updatedUser = db.prepare("SELECT * FROM user WHERE user_id = ?").get(userId);
            return sendJson({ success: true, user: updatedUser });
          }

          // 8.1 GET USER WASTE SALES HISTORY
          if (pathname.startsWith('/api/user/sales-history/') && method === 'GET') {
            const uid = pathname.split('/').pop();
            const history = db.prepare(`
              SELECT w.*, s.staff_name, s.phone as staff_phone
              FROM waste_history w
              LEFT JOIN staffs s ON w.staff_id = s.staff_id
              WHERE w.user_id = ?
              ORDER BY w.history_id DESC
            `).all(uid);
            return sendJson({ history });
          }

          // 8.2 GET STAFF WASTE PURCHASE HISTORY
          if (pathname.startsWith('/api/staff/sales-history/') && method === 'GET') {
            const sid = pathname.split('/').pop();
            const history = db.prepare(`
              SELECT w.*, u.name as user_name, u.username, u.phone as user_phone
              FROM waste_history w
              LEFT JOIN user u ON w.user_id = u.user_id
              WHERE w.staff_id = ? OR (w.staff_id IS NULL AND ? = 1)
              ORDER BY w.history_id DESC
            `).all(sid, sid);
            return sendJson({ history });
          }

          // 9. GET ALL STAFFS
          if (pathname === '/api/staffs' && method === 'GET') {
            const staffs = db.prepare("SELECT * FROM staffs").all();
            return sendJson({ staffs });
          }

          // =========================================================================
          // ADMIN FEATURES (บล็อก 1: ของรางวัล, บล็อก 2: ตัวคูณขยะ, บล็อก 3: ปรับแต้ม User)
          // =========================================================================

          // 10. GET & UPDATE WASTE RATES (บล็อกที่ 2: ปรับตัวคูณของขยะ 4 ประเภท)
          if (pathname === '/api/rates' && method === 'GET') {
            const rates = db.prepare("SELECT * FROM waste_rates").all();
            return sendJson({ rates });
          }

          if (pathname === '/api/admin/rates/update' && method === 'POST') {
            const { rates } = await parseBody(); // Array of { category_key, points_per_unit }
            if (!Array.isArray(rates)) {
              return sendJson({ error: 'rates must be an array' }, 400);
            }

            const updateStmt = db.prepare("UPDATE waste_rates SET points_per_unit = ? WHERE category_key = ?");
            const updateTx = db.transaction(() => {
              for (const r of rates) {
                if (r.category_key && r.points_per_unit !== undefined) {
                  updateStmt.run(parseFloat(r.points_per_unit), r.category_key);
                }
              }
            });
            updateTx();

            const updatedRates = db.prepare("SELECT * FROM waste_rates").all();
            return sendJson({ 
              success: true, 
              rates: updatedRates, 
              message: 'อัปเดตอัตราตัวคูณขยะ 4 ประเภทลงฐานข้อมูลสำเร็จ!' 
            });
          }

          // 11. ADMIN: GET ALL USERS (บล็อกที่ 3: ดูและค้นหารายชื่อ User)
          if (pathname === '/api/admin/users' && method === 'GET') {
            const users = db.prepare("SELECT user_id, username, name, email, phone, points, profile_image FROM user ORDER BY user_id DESC").all();
            return sendJson({ users });
          }

          // 12. ADMIN: ADJUST USER POINTS (บล็อกที่ 3: ปรับคะแนนของแต่ละ User)
          if (pathname === '/api/admin/user/adjust-points' && method === 'POST') {
            const { usernameOrId, points, mode = 'set' } = await parseBody();
            if (!usernameOrId || points === undefined) {
              return sendJson({ error: 'กรุณาระบุชื่อ/รหัสผู้ใช้ และคะแนน' }, 400);
            }

            const numPoints = parseInt(points);
            if (isNaN(numPoints)) {
              return sendJson({ error: 'คะแนนต้องเป็นตัวเลข' }, 400);
            }

            // Find user by ID or Username or Name
            let targetUser = db.prepare("SELECT * FROM user WHERE user_id = ? OR LOWER(username) = LOWER(?) OR LOWER(name) = LOWER(?)").get(
              usernameOrId, usernameOrId, usernameOrId
            );

            if (!targetUser) {
              return sendJson({ error: `ไม่พบผู้ใช้งาน "${usernameOrId}" ในระบบ` }, 404);
            }

            let newPoints = numPoints;
            if (mode === 'add') {
              newPoints = targetUser.points + numPoints;
            }

            if (newPoints < 0) newPoints = 0;

            db.prepare("UPDATE user SET points = ? WHERE user_id = ?").run(newPoints, targetUser.user_id);
            const updatedUser = db.prepare("SELECT * FROM user WHERE user_id = ?").get(targetUser.user_id);

            // Log action
            safeLogHistory(`แอดมินปรับคะแนนผู้ใช้ "${updatedUser.username}" จาก ${targetUser.points} เป็น ${newPoints} แต้ม`);

            return sendJson({ 
              success: true, 
              user: updatedUser, 
              message: `ปรับคะแนนผู้ใช้ "${updatedUser.username}" เป็น ${newPoints.toLocaleString()} แต้ม สำเร็จ!` 
            });
          }

          // 13. ADMIN: DELETE USER
          if (pathname === '/api/admin/user/delete' && method === 'POST') {
            const { userId } = await parseBody();
            if (!userId) return sendJson({ error: 'Missing userId' }, 400);

            const targetUser = db.prepare("SELECT * FROM user WHERE user_id = ?").get(userId);
            if (!targetUser) return sendJson({ error: 'ไม่พบผู้ใช้งานนี้ในระบบ' }, 404);

            db.transaction(() => {
              db.prepare("DELETE FROM redemptions WHERE user_id = ?").run(userId);
              db.prepare("DELETE FROM waste_history WHERE user_id = ?").run(userId);
              db.prepare("DELETE FROM garbage_reports WHERE user_id = ?").run(userId);
              db.prepare("DELETE FROM user WHERE user_id = ?").run(userId);
              safeLogHistory(`แอดมินลบผู้ใช้ "${targetUser.username}" (ID: ${userId}) ออกจากระบบ`);
            })();

            return sendJson({ success: true, message: `ลบผู้ใช้งาน "${targetUser.username}" ออกจากระบบสำเร็จ!` });
          }

          // 14. ADMIN: DELETE STAFF
          if (pathname === '/api/admin/staff/delete' && method === 'POST') {
            const { staffId } = await parseBody();
            if (!staffId) return sendJson({ error: 'Missing staffId' }, 400);

            const targetStaff = db.prepare("SELECT * FROM staffs WHERE staff_id = ?").get(staffId);
            if (!targetStaff) return sendJson({ error: 'ไม่พบพนักงานนี้ในระบบ' }, 404);

            db.transaction(() => {
              db.prepare("DELETE FROM history_logs WHERE staff_id = ?").run(staffId);
              db.prepare("DELETE FROM staffs WHERE staff_id = ?").run(staffId);
            })();

            return sendJson({ success: true, message: `ลบพนักงาน "${targetStaff.staff_name}" (ID: ${staffId}) ออกจากระบบสำเร็จ!` });
          }

          // 15. ADMIN: CLEAR ALL QUEUES (ข้อ 25 & ข้อ 26: ล้างคิวทั้งหมดของพนักงานทิ้งได้เลย)
          if (pathname === '/api/admin/queues/clear' && method === 'POST') {
            db.transaction(() => {
              db.prepare("DELETE FROM garbage_reports").run();
              safeLogHistory('แอดมินล้างคิวงานทั้งหมดของพนักงาน');
            })();
            return sendJson({ success: true, message: 'ล้างคิวงานทั้งหมดของพนักงานเรียบร้อยแล้ว' });
          }

          // If no matching API
          return sendJson({ error: 'API route not found' }, 404);

        } catch (err) {
          console.error('[DB Plugin API Error]:', err);
          return sendJson({ error: err.message }, 500);
        }
      });
    }
  };
}
