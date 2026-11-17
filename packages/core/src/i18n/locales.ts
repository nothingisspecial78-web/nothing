export interface I18nDictionary {
  welcome: string;
  askAnything: string;
  placeholder: string;
  send: string;
  export: string;
  import: string;
  creditsRemaining: string;
  upgrade: string;
  confirmAction: string;
  cancel: string;
  confirm: string;
  close: string;
  open: string;
  clearHistory: string;
  downloadData: string;
  voiceInput: string;
  dropFilesHere: string;
  errorGeneric: string;
}

export const enLocale: I18nDictionary = {
  welcome: 'Hello! How can I help you today?',
  askAnything: 'Ask anything about your data, reports, or workflow...',
  placeholder: 'Type your question or request...',
  send: 'Send',
  export: 'Export Data',
  import: 'Import Data',
  creditsRemaining: 'Credits remaining',
  upgrade: 'Upgrade to Premium',
  confirmAction: 'Please confirm this action before proceeding',
  cancel: 'Cancel',
  confirm: 'Confirm & Execute',
  close: 'Close assistant',
  open: 'Open assistant',
  clearHistory: 'Clear conversation history',
  downloadData: 'Download report',
  voiceInput: 'Voice input',
  dropFilesHere: 'Drop spreadsheet or document here',
  errorGeneric: 'An unexpected error occurred. Please try again.',
};

export const mlLocale: I18nDictionary = {
  welcome: 'നമസ്കാരം! ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കണം?',
  askAnything: 'ഡാറ്റ, റിപ്പോർട്ടുകൾ, അല്ലെങ്കിൽ വർക്ക്ഫ്ലോ എന്നിവയെക്കുറിച്ച് ചോദിക്കുക...',
  placeholder: 'നിങ്ങളുടെ ചോദ്യം ഇവിടെ ടൈപ്പ് ചെയ്യുക...',
  send: 'അയക്കുക',
  export: 'ഡാറ്റ എക്സ്പോർട്ട് ചെയ്യുക',
  import: 'ഡാറ്റ ഇംപോർട്ട് ചെയ്യുക',
  creditsRemaining: 'ബാക്കിയുള്ള ക്രെഡിറ്റുകൾ',
  upgrade: 'പ്രീമിയത്തിലേക്ക് അപ്‌ഗ്രേഡ് ചെയ്യുക',
  confirmAction: 'തുടരുന്നതിന് മുമ്പ് ദയവായി ഈ പ്രവർത്തനം സ്ഥിരീകരിക്കുക',
  cancel: 'റദ്ദാക്കുക',
  confirm: 'സ്ഥിരീകരിച്ചു നടപ്പിലാക്കുക',
  close: 'അസിസ്റ്റന്റ് അടയ്ക്കുക',
  open: 'അസിസ്റ്റന്റ് തുറക്കുക',
  clearHistory: 'സംഭാഷണ ചരിത്രം മായ്ക്കുക',
  downloadData: 'റിപ്പോർട്ട് ഡൗൺലോഡ് ചെയ്യുക',
  voiceInput: 'ശബ്ദ ഇൻപുട്ട്',
  dropFilesHere: 'ഫയലുകൾ ഇവിടെ ഇടുക',
  errorGeneric: 'ഒരു തകരാറുണ്ടായി. ദയവായി വീണ്ടും ശ്രമിക്കുക.',
};

export const arLocale: I18nDictionary = {
  welcome: 'مرحبًا! كيف يمكنني مساعدتك اليوم؟',
  askAnything: 'اسأل عن بياناتك أو تقاريرك أو سير عملك...',
  placeholder: 'اكتب سؤالك أو طلبك هنا...',
  send: 'إرسال',
  export: 'تصدير البيانات',
  import: 'استيراد البيانات',
  creditsRemaining: 'الرصيد المتبقي',
  upgrade: 'الترقية إلى بريميوم',
  confirmAction: 'يرجى تأكيد هذا الإجراء قبل المتابعة',
  cancel: 'إلغاء',
  confirm: 'تأكيد وتنفيذ',
  close: 'إغلاق المساعد',
  open: 'فتح المساعد',
  clearHistory: 'مسح سجل المحادثة',
  downloadData: 'تنزيل التقرير',
  voiceInput: 'الإدخال الصوتي',
  dropFilesHere: 'أسقط الملفات هنا',
  errorGeneric: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.',
};

export const LOCALES: Record<string, I18nDictionary> = {
  en: enLocale,
  ml: mlLocale,
  ar: arLocale,
};

export function isRtlLocale(locale: string): boolean {
  const code = (locale || '').toLowerCase().split('-')[0];
  return code === 'ar' || code === 'fa' || code === 'ur' || code === 'he';
}

export function getFontFamilyForLocale(locale: string): string {
  const code = (locale || '').toLowerCase().split('-')[0];
  if (code === 'ar') {
    return "'Noto Sans Arabic', 'Amiri', 'Segoe UI', Tahoma, sans-serif";
  }
  if (code === 'ml') {
    return "'Noto Sans Malayalam', 'Manjari', 'Gayathri', sans-serif";
  }
  return "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
}

export function translate(key: keyof I18nDictionary, locale: string = 'en'): string {
  const code = (locale || 'en').toLowerCase().split('-')[0];
  const dict = LOCALES[code] || LOCALES.en;
  return dict[key] || LOCALES.en[key] || String(key);
}
