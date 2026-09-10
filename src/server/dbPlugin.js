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

    console.log(`[DB Plugin] Connected to SQLite database at: ${dbPath}`);
  } catch (err) {
    console.error('[DB Plugin] Database connection error:', err);
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
              ).run(trimmed, trimmed, `${trimmed.toLowerCase()}@eco.com`, '089-765-4321', 670);
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
              const resInsert = db.prepare("INSERT INTO staffs (staff_name, phone) VALUES (?, ?)").run(trimmed, '081-999-8888');
              staff = db.prepare("SELECT * FROM staffs WHERE staff_id = ?").get(resInsert.lastInsertRowid);
            }

            return sendJson({ staff });
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
                error: 'สิทธิ์การเข้าถึงถูกปฏิเสธ: ต้องระบุชื่อเป็น "admin" และรหัสผ่าน "admin01" เท่านั้น' 
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
            db.prepare(
              "INSERT INTO history_logs (staff_id, location_id, action, action_date) VALUES (?, ?, ?, datetime('now', 'localtime'))"
            ).run(1, 1, `แอดมินเพิ่มของรางวัลใหม่: "${trimmedName}" (${numStock} ชิ้น, ใช้ ${numPoints} แต้ม)`);

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

          // 7. GARBAGE REPORTS / PICKUP REQUESTS
          if (pathname === '/api/pickup' && method === 'GET') {
            const reports = db.prepare(`
              SELECT g.*, u.name as user_name, u.phone as user_phone, l.location_name
              FROM garbage_reports g
              LEFT JOIN user u ON g.user_id = u.user_id
              LEFT JOIN locations l ON g.location_id = l.location_id
              ORDER BY g.report_id DESC
            `).all();
            return sendJson({ reports });
          }

          if (pathname === '/api/pickup' && method === 'POST') {
            const { userId, title, description, locationName = 'กรุงเทพฯ' } = await parseBody();

            let loc = db.prepare("SELECT * FROM locations WHERE location_name = ?").get(locationName);
            if (!loc) {
              const resLoc = db.prepare("INSERT INTO locations (location_name) VALUES (?)").run(locationName);
              loc = { location_id: resLoc.lastInsertRowid };
            }

            const insertReport = db.prepare(
              "INSERT INTO garbage_reports (user_id, location_id, title, descriiption, reward_point, status) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(userId || 1, loc.location_id, title || 'เรียกรถรับซื้อขยะ', description || '', 0, 'Waiting');

            const newReport = db.prepare("SELECT * FROM garbage_reports WHERE report_id = ?").get(insertReport.lastInsertRowid);
            return sendJson({ success: true, report: newReport });
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
              totalWeight = 0
            } = await parseBody();

            if (!userId || !points) {
              return sendJson({ error: 'Missing userId or points' }, 400);
            }

            const totalKg = totalWeight > 0 ? totalWeight : (recycleKg + organicKg + generalKg + hazardousKg);

            db.prepare("UPDATE user SET points = points + ? WHERE user_id = ?").run(points, userId);

            db.prepare(`
              INSERT INTO waste_history (user_id, recycle_kg, organic_kg, general_kg, hazardous_kg, total_kg, points_earned)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(userId, recycleKg, organicKg, generalKg, hazardousKg, totalKg, points);

            db.prepare(
              "INSERT INTO history_logs (staff_id, location_id, action, action_date) VALUES (?, ?, ?, datetime('now', 'localtime'))"
            ).run(staffId, 1, `โอนแต้มให้ผู้ใช้ #${userId} จำนวน +${points} แต้ม (ขยะรวม ${totalKg} kg: ${summary || ''})`);

            const updatedUser = db.prepare("SELECT * FROM user WHERE user_id = ?").get(userId);
            return sendJson({ success: true, user: updatedUser });
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
            db.prepare(
              "INSERT INTO history_logs (staff_id, location_id, action, action_date) VALUES (?, ?, ?, datetime('now', 'localtime'))"
            ).run(1, 1, `แอดมินปรับคะแนนผู้ใช้ "${updatedUser.username}" จาก ${targetUser.points} เป็น ${newPoints} แต้ม`);

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
              db.prepare(
                "INSERT INTO history_logs (staff_id, location_id, action, action_date) VALUES (?, ?, ?, datetime('now', 'localtime'))"
              ).run(1, 1, `แอดมินลบผู้ใช้ "${targetUser.username}" (ID: ${userId}) ออกจากระบบ`);
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
