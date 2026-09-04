// js/i18n.js — small, real i18n system: a translations table plus a
// data-i18n attribute pass. Only settings.html and profile.html are wired
// up to it in this build (see the session report for exactly what is/isn't
// translated) — this module itself is page-agnostic and can be applied to
// the rest of the app later without changes here.

export const translations = {
  en: {
    'settings.sound.title': 'Sound',
    'settings.sound.sub': 'Turn game sounds on/off',
    'settings.testButton': 'Test',
    'settings.timer.title': 'Timer',
    'settings.timer.sub': 'Default time control',
    'settings.timer.minutes': 'Minutes per side',
    'settings.timer.increment': 'Increment (seconds)',
    'settings.save': 'Save',
    'settings.defaults': 'Defaults',
    'settings.theme.title': 'Theme',
    'settings.theme.sub': 'Choose app appearance',
    'settings.theme.auto': 'Auto',
    'settings.theme.light': 'Light',
    'settings.theme.dark': 'Dark',
    'settings.hints.title': 'Move Hints',
    'settings.hints.sub': 'Show green dots for legal moves',
    'settings.ai.title': 'AI',
    'settings.ai.sub': 'Difficulty & engine debug',
    'settings.ai.level': 'AI Level',
    'settings.ai.debug.title': 'AI Debug Mode',
    'settings.ai.debug.sub': 'Show search stats panel on the Play screen',
    'settings.band.easy': 'Easy',
    'settings.band.medium': 'Medium',
    'settings.band.hard': 'Hard',
    'settings.band.expert': 'Expert',
    'settings.language.title': 'Language',
    'settings.language.sub': 'App display language',
    'settings.language.en': 'English',
    'settings.language.km': 'Khmer',
    'settings.pieceTheme.title': 'Piece Theme',
    'settings.pieceTheme.sub': 'Choose piece art set',
    'settings.boardTheme.title': 'Board Theme',
    'settings.boardTheme.sub': 'Choose board skin',
    'settings.theme.prev': '‹ Previous',
    'settings.theme.next': 'Next ›',
    'settings.theme.onlyOne': 'Only one option is available today — more are coming later.',
    'settings.instantMove.title': 'Instant Move',
    'settings.instantMove.sub': 'Apply moves immediately, without the slide/hop animation',
    'settings.about.title': 'About App',
    'settings.about.sub': 'Version & credits',
    'settings.about.version': 'Version:',
    'settings.about.released': 'Released Date:',
    'settings.about.developer': 'Developer:',
    'settings.about.email': 'Email:',
    'profile.title': 'Profile',
    'profile.tapToView': 'Tap to view profile',
    'profile.coins': 'Coins',
    'profile.aiLevel': 'AI Level',
    'profile.winRate': 'Win Rate',
    'profile.notRated': 'Not Rated',
    'profile.password.title': 'Password',
    'profile.password.sub': 'Requires an online account — not available yet',
    'profile.switchAccount.title': 'Switch Account',
    'profile.switchAccount.sub': 'Requires an online account — not available yet',
    'profile.history.title': 'History',
    'profile.history.sub': 'Your completed games',
    'profile.history.empty': 'No completed games yet.',
    'profile.history.win': 'Win',
    'profile.history.loss': 'Loss',
    'profile.history.draw': 'Draw',
    'profile.history.moves': 'moves',
    'profile.editName': 'Edit name',
    'profile.editAvatar': 'Change avatar',
    'profile.save': 'Save',
    'profile.cancel': 'Cancel',
    'profile.uploadPhoto': 'Upload photo…',
    'profile.namePlaceholder': 'Your name',
    'profile.back': 'Back',
  },
  km: {
    'settings.sound.title': 'សំឡេង',
    'settings.sound.sub': 'បើក/បិទសំឡេងក្នុងល្បែង',
    'settings.testButton': 'សាកល្បង',
    'settings.timer.title': 'ម៉ោង',
    'settings.timer.sub': 'ការកំណត់ម៉ោងលំនាំដើម',
    'settings.timer.minutes': 'នាទីក្នុងមួយខាង',
    'settings.timer.increment': 'បន្ថែម (វិនាទី)',
    'settings.save': 'រក្សាទុក',
    'settings.defaults': 'លំនាំដើម',
    'settings.theme.title': 'រូបរាង',
    'settings.theme.sub': 'ជ្រើសរើសរូបរាងកម្មវិធី',
    'settings.theme.auto': 'ស្វ័យប្រវត្តិ',
    'settings.theme.light': 'ភ្លឺ',
    'settings.theme.dark': 'ងងឹត',
    'settings.hints.title': 'ណែនាំចលនា',
    'settings.hints.sub': 'បង្ហាញចំណុចបៃតងសម្រាប់ចលនាត្រឹមត្រូវ',
    'settings.ai.title': 'AI',
    'settings.ai.sub': 'កម្រិតលំបាក និងឌីបាកម៉ូទ័រ',
    'settings.ai.level': 'កម្រិត AI',
    'settings.ai.debug.title': 'របៀបឌីបាក AI',
    'settings.ai.debug.sub': 'បង្ហាញផ្ទាំងស្ថិតិស្វែងរកលើទំព័រលេង',
    'settings.band.easy': 'ងាយ',
    'settings.band.medium': 'មធ្យម',
    'settings.band.hard': 'ពិបាក',
    'settings.band.expert': 'ជំនាញ',
    'settings.language.title': 'ភាសា',
    'settings.language.sub': 'ភាសាបង្ហាញកម្មវិធី',
    'settings.language.en': 'អង់គ្លេស',
    'settings.language.km': 'ខ្មែរ',
    'settings.pieceTheme.title': 'ស្តាយគ្រាប់',
    'settings.pieceTheme.sub': 'ជ្រើសរើសរូបភាពគ្រាប់',
    'settings.boardTheme.title': 'ស្តាយក្តារ',
    'settings.boardTheme.sub': 'ជ្រើសរើសរូបភាពក្តារ',
    'settings.theme.prev': '‹ មុន',
    'settings.theme.next': 'បន្ទាប់ ›',
    'settings.theme.onlyOne': 'មានតែជម្រើសមួយប៉ុណ្ណោះនាពេលនេះ — មានបន្ថែមនាពេលក្រោយ។',
    'settings.instantMove.title': 'ចលនាភ្លាមៗ',
    'settings.instantMove.sub': 'ធ្វើចលនាភ្លាមៗ ដោយគ្មានចលនាមានចលនា',
    'settings.about.title': 'អំពីកម្មវិធី',
    'settings.about.sub': 'កំណែ និងឥណទាន',
    'settings.about.version': 'កំណែ៖',
    'settings.about.released': 'កាលបរិច្ឆេទចេញផ្សាយ៖',
    'settings.about.developer': 'អ្នកអភិវឌ្ឍ៖',
    'settings.about.email': 'អ៊ីមែល៖',
    'profile.title': 'ប្រវត្តិរូប',
    'profile.tapToView': 'ចុចដើម្បីមើលប្រវត្តិរូប',
    'profile.coins': 'កាក់',
    'profile.aiLevel': 'កម្រិត AI',
    'profile.winRate': 'អត្រាឈ្នះ',
    'profile.notRated': 'មិនទាន់មានចំណាត់ថ្នាក់',
    'profile.password.title': 'ពាក្យសម្ងាត់',
    'profile.password.sub': 'ត្រូវការគណនីអនឡាញ — មិនទាន់មានទេឥឡូវនេះ',
    'profile.switchAccount.title': 'ប្តូរគណនី',
    'profile.switchAccount.sub': 'ត្រូវការគណនីអនឡាញ — មិនទាន់មានទេឥឡូវនេះ',
    'profile.history.title': 'ប្រវត្តិល្បែង',
    'profile.history.sub': 'ល្បែងដែលបានបញ្ចប់របស់អ្នក',
    'profile.history.empty': 'មិនទាន់មានល្បែងបញ្ចប់ទេ។',
    'profile.history.win': 'ឈ្នះ',
    'profile.history.loss': 'ចាញ់',
    'profile.history.draw': 'ស្មើ',
    'profile.history.moves': 'ចលនា',
    'profile.editName': 'កែឈ្មោះ',
    'profile.editAvatar': 'ប្តូររូបតំណាង',
    'profile.save': 'រក្សាទុក',
    'profile.cancel': 'បោះបង់',
    'profile.uploadPhoto': 'ផ្ទុករូបភាព…',
    'profile.namePlaceholder': 'ឈ្មោះរបស់អ្នក',
    'profile.back': 'ត្រឡប់ក្រោយ',
  },
};

let currentLang = 'en';

export function setLanguage(lang) {
  currentLang = translations[lang] ? lang : 'en';
  return currentLang;
}

export function getLanguage() {
  return currentLang;
}

export function t(key) {
  const dict = translations[currentLang] || translations.en;
  if (key in dict) return dict[key];
  if (key in translations.en) return translations.en[key];
  return key;
}

// Walks `root` for [data-i18n] (textContent) and [data-i18n-placeholder]
// (placeholder attribute) and fills them in from the current language.
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
}
