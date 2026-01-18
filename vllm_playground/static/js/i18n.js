/**
 * i18n - Internationalization Module
 * Lightweight i18n solution for vLLM Playground
 * 
 * Design: 
 * - English (default): Keep original HTML text, minimal language pack for dynamic content
 * - Other languages: Full translation with data-i18n attributes
 */

class I18n {
    constructor() {
        this.currentLocale = null;
        this.translations = {};
        this.defaultLocale = 'en';
        this.fallbackLocale = 'en';
        this.originalTexts = new Map(); // Store original English texts
        
        // Available languages configuration
        this.availableLocales = {
            'en': {
                name: 'English',
                nativeName: 'English'
            },
            'zh-CN': {
                name: 'Chinese (Simplified)',
                nativeName: '简体中文'
            }
        };
    }

    /**
     * Initialize i18n system
     */
    init() {
        // Store original texts before any translation
        this.storeOriginalTexts();
        
        // Load saved language preference (no auto-detection, default to English)
        const savedLocale = localStorage.getItem('vllm-locale');
        
        // Priority: saved > default (English)
        // Note: We intentionally don't auto-detect browser language
        // First visit always shows English, user can manually switch
        let locale = savedLocale || this.defaultLocale;
        
        // Ensure locale is available
        if (!this.availableLocales[locale]) {
            locale = this.defaultLocale;
        }
        
        this.setLocale(locale);
        
        console.log(`[i18n] Initialized with locale: ${locale}`);
    }

    /**
     * Store original English texts from HTML
     */
    storeOriginalTexts() {
        // Store text content
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            if (key && !this.originalTexts.has(`text:${key}`)) {
                this.originalTexts.set(`text:${key}`, element.textContent);
            }
        });
        
        // Store HTML content
        document.querySelectorAll('[data-i18n-html]').forEach(element => {
            const key = element.getAttribute('data-i18n-html');
            if (key && !this.originalTexts.has(`html:${key}`)) {
                this.originalTexts.set(`html:${key}`, element.innerHTML);
            }
        });
        
        // Store placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            if (key && !this.originalTexts.has(`placeholder:${key}`)) {
                this.originalTexts.set(`placeholder:${key}`, element.placeholder);
            }
        });
        
        // Store titles
        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            if (key && !this.originalTexts.has(`title:${key}`)) {
                this.originalTexts.set(`title:${key}`, element.title);
            }
        });
    }

    /**
     * Register a language pack
     * @param {string} locale - Language code (e.g., 'en', 'zh-CN')
     * @param {object} translations - Translation object
     */
    register(locale, translations) {
        this.translations[locale] = translations;
        console.log(`[i18n] Registered locale: ${locale}`);
    }

    /**
     * Set current locale
     * @param {string} locale - Language code
     */
    setLocale(locale) {
        if (!this.translations[locale] && locale !== this.defaultLocale) {
            console.warn(`[i18n] Locale '${locale}' not found, falling back to '${this.fallbackLocale}'`);
            locale = this.fallbackLocale;
        }
        
        this.currentLocale = locale;
        localStorage.setItem('vllm-locale', locale);
        
        // Update all translatable elements
        this.updateDOM();
        
        // Dispatch locale change event
        window.dispatchEvent(new CustomEvent('localeChanged', { detail: { locale } }));
        
        console.log(`[i18n] Locale changed to: ${locale}`);
    }

    /**
     * Get current locale
     */
    getLocale() {
        return this.currentLocale;
    }

    /**
     * Get available locales
     */
    getAvailableLocales() {
        return this.availableLocales;
    }

    /**
     * Detect browser locale
     */
    detectBrowserLocale() {
        const browserLang = navigator.language || navigator.userLanguage;
        
        // Try exact match first
        if (this.availableLocales[browserLang]) {
            return browserLang;
        }
        
        // Try language code only (e.g., 'zh' from 'zh-TW')
        const langCode = browserLang.split('-')[0];
        
        // Find first matching language
        for (const locale in this.availableLocales) {
            if (locale.startsWith(langCode)) {
                return locale;
            }
        }
        
        return null;
    }

    /**
     * Translate a key
     * @param {string} key - Translation key (supports nested keys with dot notation)
     * @param {object} params - Optional parameters for template replacement
     * @returns {string} Translated text
     */
    t(key, params = {}) {
        // For English, try to get from translations first, then use key as-is
        if (this.currentLocale === this.defaultLocale) {
            const translation = this.getTranslation(key, this.currentLocale);
            if (translation !== key) {
                return this.replaceParams(translation, params);
            }
            return key; // Return key directly for English
        }
        
        // For other languages, get translation
        let translation = this.getTranslation(key, this.currentLocale);
        
        // Fallback to English if not found
        if (translation === key && this.currentLocale !== this.fallbackLocale) {
            translation = this.getTranslation(key, this.fallbackLocale);
        }
        
        return this.replaceParams(translation, params);
    }

    /**
     * Replace parameters in template
     */
    replaceParams(text, params) {
        if (params && typeof text === 'string') {
            Object.keys(params).forEach(param => {
                const regex = new RegExp(`{{\\s*${param}\\s*}}`, 'g');
                text = text.replace(regex, params[param]);
            });
        }
        return text;
    }

    /**
     * Get translation from nested object
     * @param {string} key - Dot notation key (e.g., 'server.config.model')
     * @param {string} locale - Locale code
     * @returns {string} Translation or key if not found
     */
    getTranslation(key, locale) {
        const translations = this.translations[locale];
        if (!translations) return key;
        
        const keys = key.split('.');
        let result = translations;
        
        for (const k of keys) {
            if (result && typeof result === 'object' && k in result) {
                result = result[k];
            } else {
                return key; // Return key if path not found
            }
        }
        
        return result;
    }

    /**
     * Update all DOM elements with translation attributes
     */
    updateDOM() {
        // Update elements with data-i18n attribute (text content)
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            if (key) {
                if (this.currentLocale === this.defaultLocale) {
                    // Restore original English text
                    const original = this.originalTexts.get(`text:${key}`);
                    if (original) {
                        element.textContent = original;
                    }
                } else {
                    element.textContent = this.t(key);
                }
            }
        });
        
        // Update elements with data-i18n-html attribute (HTML content)
        document.querySelectorAll('[data-i18n-html]').forEach(element => {
            const key = element.getAttribute('data-i18n-html');
            if (key) {
                if (this.currentLocale === this.defaultLocale) {
                    const original = this.originalTexts.get(`html:${key}`);
                    if (original) {
                        element.innerHTML = original;
                    }
                } else {
                    element.innerHTML = this.t(key);
                }
            }
        });
        
        // Update placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            if (key) {
                if (this.currentLocale === this.defaultLocale) {
                    const original = this.originalTexts.get(`placeholder:${key}`);
                    if (original) {
                        element.placeholder = original;
                    }
                } else {
                    element.placeholder = this.t(key);
                }
            }
        });
        
        // Update titles/tooltips
        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            if (key) {
                if (this.currentLocale === this.defaultLocale) {
                    const original = this.originalTexts.get(`title:${key}`);
                    if (original) {
                        element.title = original;
                    }
                } else {
                    element.title = this.t(key);
                }
            }
        });
        
        // Update aria-labels
        document.querySelectorAll('[data-i18n-aria]').forEach(element => {
            const key = element.getAttribute('data-i18n-aria');
            if (key) {
                element.setAttribute('aria-label', this.t(key));
            }
        });
    }

    /**
     * Create language selector dropdown
     * @param {HTMLElement} container - Container element to append the selector
     */
    createLanguageSelector(container) {
        const selector = document.createElement('div');
        selector.className = 'language-selector';
        
        const button = document.createElement('button');
        button.className = 'language-selector-btn';
        button.id = 'language-selector-btn';
        button.title = 'Switch Language / 切换语言';
        
        const currentLocale = this.availableLocales[this.currentLocale];
        button.innerHTML = `
            <span class="language-icon">🌐</span>
            <span class="language-label">${currentLocale.nativeName}</span>
            <span class="language-dropdown-icon">▼</span>
        `;
        
        const dropdown = document.createElement('div');
        dropdown.className = 'language-dropdown';
        dropdown.id = 'language-dropdown';
        
        // Create dropdown items
        Object.keys(this.availableLocales).forEach(locale => {
            const localeInfo = this.availableLocales[locale];
            const item = document.createElement('div');
            item.className = 'language-dropdown-item';
            if (locale === this.currentLocale) {
                item.classList.add('active');
            }
            item.setAttribute('data-locale', locale);
            item.innerHTML = `
                <span class="language-name">${localeInfo.nativeName}</span>
                ${locale === this.currentLocale ? '<span class="language-check">✓</span>' : ''}
            `;
            
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setLocale(locale);
                this.updateLanguageSelector();
                dropdown.classList.remove('show');
            });
            
            dropdown.appendChild(item);
        });
        
        // Toggle dropdown
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('show');
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            dropdown.classList.remove('show');
        });
        
        selector.appendChild(button);
        selector.appendChild(dropdown);
        container.appendChild(selector);
        
        return selector;
    }

    /**
     * Update language selector UI
     */
    updateLanguageSelector() {
        const button = document.getElementById('language-selector-btn');
        const dropdown = document.getElementById('language-dropdown');
        
        if (button && dropdown) {
            const currentLocale = this.availableLocales[this.currentLocale];
            button.innerHTML = `
                <span class="language-icon">🌐</span>
                <span class="language-label">${currentLocale.nativeName}</span>
                <span class="language-dropdown-icon">▼</span>
            `;
            
            // Update active state and checkmark
            dropdown.querySelectorAll('.language-dropdown-item').forEach(item => {
                const locale = item.getAttribute('data-locale');
                const localeInfo = this.availableLocales[locale];
                if (locale === this.currentLocale) {
                    item.classList.add('active');
                    item.innerHTML = `
                        <span class="language-name">${localeInfo.nativeName}</span>
                        <span class="language-check">✓</span>
                    `;
                } else {
                    item.classList.remove('active');
                    item.innerHTML = `
                        <span class="language-name">${localeInfo.nativeName}</span>
                    `;
                }
            });
        }
    }
}

// Create global i18n instance
window.i18n = new I18n();

