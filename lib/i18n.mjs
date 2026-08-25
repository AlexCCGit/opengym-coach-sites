export const LANGUAGES = [
  ["en", "English"], ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"],
  ["it", "Italiano"], ["pt", "Português"], ["hi", "हिन्दी"], ["pl", "Polski"],
  ["tr", "Türkçe"], ["ru", "Русский"], ["ko", "한국어"], ["zh", "中文"],
];

const DICTIONARIES = {
  en: { intent: "Train with intent.", today: "Today", coach: "Coach", library: "Library", routines: "Routines", history: "History", progress: "Progress", settings: "Settings" },
  es: {
    intent: "Entrena con intención.", today: "Hoy", coach: "Coach", library: "Biblioteca", routines: "Rutinas", history: "Historial", progress: "Progreso", settings: "Ajustes",
    Beginner: "Principiante", Intermediate: "Intermedio", Advanced: "Avanzado",
    "Dumbbell weight is per hand": "El peso de la mancuerna es por mano",
    "Source code": "Código fuente",
  },
  fr: { intent: "Entraînez-vous avec intention.", today: "Aujourd’hui", coach: "Coach", library: "Bibliothèque", routines: "Programmes", history: "Historique", progress: "Progrès", settings: "Réglages" },
  de: { intent: "Trainiere mit Absicht.", today: "Heute", coach: "Coach", library: "Bibliothek", routines: "Pläne", history: "Verlauf", progress: "Fortschritt", settings: "Einstellungen" },
  it: { intent: "Allenati con intenzione.", today: "Oggi", coach: "Coach", library: "Libreria", routines: "Routine", history: "Cronologia", progress: "Progressi", settings: "Impostazioni" },
  pt: { intent: "Treine com intenção.", today: "Hoje", coach: "Coach", library: "Biblioteca", routines: "Rotinas", history: "Histórico", progress: "Progresso", settings: "Definições" },
  hi: { intent: "उद्देश्य के साथ प्रशिक्षण लें।", today: "आज", coach: "कोच", library: "लाइब्रेरी", routines: "रूटीन", history: "इतिहास", progress: "प्रगति", settings: "सेटिंग्स" },
  pl: { intent: "Trenuj świadomie.", today: "Dzisiaj", coach: "Trener", library: "Biblioteka", routines: "Plany", history: "Historia", progress: "Postęp", settings: "Ustawienia" },
  tr: { intent: "Bilinçli antrenman yap.", today: "Bugün", coach: "Koç", library: "Kütüphane", routines: "Programlar", history: "Geçmiş", progress: "İlerleme", settings: "Ayarlar" },
  ru: { intent: "Тренируйтесь осознанно.", today: "Сегодня", coach: "Тренер", library: "Библиотека", routines: "Программы", history: "История", progress: "Прогресс", settings: "Настройки" },
  ko: { intent: "목표를 가지고 훈련하세요.", today: "오늘", coach: "코치", library: "라이브러리", routines: "루틴", history: "기록", progress: "진행", settings: "설정" },
  zh: { intent: "有目标地训练。", today: "今天", coach: "教练", library: "动作库", routines: "计划", history: "历史", progress: "进度", settings: "设置" },
};

export function translate(locale, key, dictionary = {}, ...args) {
  let value = dictionary?.[key] ?? DICTIONARIES[locale]?.[key] ?? DICTIONARIES.en[key] ?? key;
  args.forEach((argument, index) => { value = value.replaceAll(`{${index}}`, String(argument)); });
  return value;
}

const UI_COMMIT = "678bf5bf10446e8997a77d43e89c9b2721d8d0fc";
const uiCache = new Map();

export async function loadUiLocale(locale) {
  if (locale === "en") return {};
  if (!LANGUAGES.some(([code]) => code === locale)) return {};
  if (!uiCache.has(locale)) {
    const url = `https://cdn.jsdelivr.net/gh/alexpcosta/opengym@${UI_COMMIT}/frontend/src/locales/${locale}.js`;
    uiCache.set(locale, import(/* @vite-ignore */ url).then((module) => module.default).catch(() => ({})));
  }
  return uiCache.get(locale);
}
