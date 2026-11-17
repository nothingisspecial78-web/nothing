export type SupportedLocale = 'en' | 'ml' | 'ar';

export interface LocaleStrings {
  locale: SupportedLocale;
  dir: 'ltr' | 'rtl';
  welcome: string;
  inputPlaceholder: string;
  send: string;
  cancel: string;
  confirm: string;
  undo: string;
  exportTitle: string;
  noDataFound: string;
  unauthorized: string;
  creditsExhausted: string;
  upgradePrompt: string;
  guideNext: string;
  guideBack: string;
  guideStop: string;
  thinking: string;
  askAiAction: string;
  inspectAction: string;
  voiceMute: string;
  voiceUnmute: string;
  languageSwitch: string;
}

export const LOCALES: Record<SupportedLocale, LocaleStrings> = {
  en: {
    locale: 'en',
    dir: 'ltr',
    welcome: 'Hello! How can I help you today?',
    inputPlaceholder: 'Ask a question or request an action...',
    send: 'Send',
    cancel: 'Cancel',
    confirm: 'Confirm',
    undo: 'Undo',
    exportTitle: 'Export Ready',
    noDataFound: 'No matching records found within your access scope.',
    unauthorized: 'Access denied: you do not have permission to view or modify this resource.',
    creditsExhausted: 'Monthly AI credits exhausted.',
    upgradePrompt: 'Upgrade to Premium for unlimited AI assistance.',
    guideNext: 'Next Step',
    guideBack: 'Back',
    guideStop: 'Stop Guide',
    thinking: 'Thinking...',
    askAiAction: 'Ask AI Assistant',
    inspectAction: 'Inspect with Cursor',
    voiceMute: 'Mute voice',
    voiceUnmute: 'Speak instructions',
    languageSwitch: 'Language',
  },
  ml: {
    locale: 'ml',
    dir: 'ltr',
    welcome: 'നമസ്കാരം! ഇന്ന് ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കാം?',
    inputPlaceholder: 'ഒരു ചോദ്യം ചോദിക്കുക അല്ലെങ്കിൽ ടാസ്ക് നൽകുക...',
    send: 'അയയ്ക്കുക',
    cancel: 'റദ്ദാക്കുക',
    confirm: 'സ്ഥിരീകരിക്കുക',
    undo: 'തിരിച്ചെടുക്കുക',
    exportTitle: 'ഫയൽ ഡൗൺലോഡിന് തയ്യാർ',
    noDataFound: 'നിങ്ങളുടെ പരിധിയിൽ യോജിക്കുന്ന വിവരങ്ങളൊന്നും കണ്ടെത്തിയില്ല.',
    unauthorized: 'അനുമതി നിഷേധിച്ചു: ഈ വിവരങ്ങൾ കാണാൻ നിങ്ങൾക്ക് അനുമതിയില്ല.',
    creditsExhausted: 'പ്രതിമാസ AI ക്രെഡിറ്റുകൾ തീർന്നിരിക്കുന്നു.',
    upgradePrompt: 'പരിധിയില്ലാത്ത AI സഹായത്തിനായി പ്രീമിയത്തിലേക്ക് അപ്‌ഗ്രേഡ് ചെയ്യുക.',
    guideNext: 'അടുത്ത ഘട്ടം',
    guideBack: 'പിന്നിലേക്ക്',
    guideStop: 'നിർത്തുക',
    thinking: 'ചിന്തിക്കുന്നു...',
    askAiAction: 'AI സഹായിയോട് ചോദിക്കുക',
    inspectAction: 'കഴ്സർ ഉപയോഗിച്ച് പരിശോധിക്കുക',
    voiceMute: 'ശബ്ദം മ്യൂട്ട് ചെയ്യുക',
    voiceUnmute: 'ശബ്ദം ഓണാക്കുക',
    languageSwitch: 'ഭാഷ',
  },
  ar: {
    locale: 'ar',
    dir: 'rtl',
    welcome: 'مرحبًا! كيف يمكنني مساعدتك اليوم؟',
    inputPlaceholder: 'اطرح سؤالاً أو اطلب إجراءً...',
    send: 'إرسال',
    cancel: 'إلغاء',
    confirm: 'تأكيد',
    undo: 'تراجع',
    exportTitle: 'الملف جاهز للتصدير',
    noDataFound: 'لم يتم العثور على سجلات مطابقة ضمن نطاق صلاحياتك.',
    unauthorized: 'تم رفض الوصول: ليس لديك صلاحية لعرض أو تعديل هذا المورد.',
    creditsExhausted: 'انتهت رصيد نقاط الذكاء الاصطناعي الشهرية.',
    upgradePrompt: 'قم بالترقية إلى الباقة المميزة للحصول على استخدام غير محدود.',
    guideNext: 'الخطوة التالية',
    guideBack: 'السابق',
    guideStop: 'إيقاف الدليل',
    thinking: 'جاري التفكير...',
    askAiAction: 'اسأل المساعد الذكي',
    inspectAction: 'فحص باستخدام المؤشر',
    voiceMute: 'كتم الصوت',
    voiceUnmute: 'تشغيل الصوت',
    languageSwitch: 'اللغة',
  },
};

export function getLocaleStrings(locale?: string): LocaleStrings {
  const norm = (locale || 'en').toLowerCase().slice(0, 2);
  if (norm === 'ml') return LOCALES.ml;
  if (norm === 'ar') return LOCALES.ar;
  return LOCALES.en;
}

export function isRtlLocale(locale?: string): boolean {
  return getLocaleStrings(locale).dir === 'rtl';
}

export function translate(key: keyof LocaleStrings, locale?: string): string {
  const dict = getLocaleStrings(locale);
  return dict[key] ?? LOCALES.en[key];
}

export function getFontFamilyForLocale(locale?: string): string {
  const norm = (locale || 'en').toLowerCase().slice(0, 2);
  if (norm === 'ar') {
    return '"Noto Naskh Arabic", "Noto Sans Arabic", "Amiri", system-ui, sans-serif';
  }
  if (norm === 'ml') {
    return '"Noto Sans Malayalam", "Manjari", system-ui, sans-serif';
  }
  return '"Inter", "Noto Sans", system-ui, -apple-system, sans-serif';
}
