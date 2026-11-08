// Thin wrapper around chrome.i18n. Strings live in _locales/<lang>/messages.json:
// English is the default locale, Swedish is used when the browser UI is Swedish.
//
// Message files can't hold markup, and we never set innerHTML anyway. Two bits
// of inline syntax cover what the UI needs instead:
//   `tabs`     -> <code>tabs</code>
//   [[Ctrl+I]] -> <kbd>Ctrl+I</kbd>

/** Looks up a message. Falls back to the key, so a missing string is visible. */
export function t(key, ...subs) {
  const msg = globalThis.chrome?.i18n?.getMessage(key, subs.map(String));
  return msg || key;
}

/** Plural lookup: picks `<key>_one` or `<key>_other` and passes n as $1. */
export function tn(key, n, ...subs) {
  return t(n === 1 ? `${key}_one` : `${key}_other`, String(n), ...subs);
}

/** UI language, e.g. "sv" or "en-US". */
export function uiLanguage() {
  return globalThis.chrome?.i18n?.getUILanguage?.() || 'en';
}

/** Fills an element with text, turning `code` and [[kbd]] into elements. */
export function setRichText(el, text) {
  el.textContent = '';
  const re = /`([^`]+)`|\[\[([^\]]+)\]\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
    const node = document.createElement(m[1] !== undefined ? 'code' : 'kbd');
    node.textContent = m[1] ?? m[2];
    el.appendChild(node);
    last = m.index + m[0].length;
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

/**
 * Translates a page. Elements opt in with attributes:
 *   data-i18n="key"               -> content (rich text)
 *   data-i18n-placeholder="key"   -> placeholder
 *   data-i18n-title="key"         -> title
 *   data-i18n-aria-label="key"    -> aria-label
 */
export function localizeDocument(root = document) {
  document.documentElement.lang = uiLanguage().split('-')[0];
  for (const el of root.querySelectorAll('[data-i18n]')) {
    setRichText(el, t(el.dataset.i18n));
  }
  for (const [attr, prop] of [
    ['placeholder', 'i18nPlaceholder'],
    ['title', 'i18nTitle'],
    ['aria-label', 'i18nAriaLabel'],
  ]) {
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) {
      el.setAttribute(attr, t(el.dataset[prop]));
    }
  }
}
