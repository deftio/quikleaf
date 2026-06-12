/*
 * site.js — client-side script for the qdedit GitHub Pages site.
 *
 * Handles:
 *   - Theme cycling (light → dark → auto)
 *   - Copy-to-clipboard buttons
 *   - Hamburger nav toggle
 *   - Smooth scroll for anchor links
 *
 * No frameworks. Pure vanilla. ~120 lines.
 */

(function () {
    'use strict';

    // ----- Theme cycling -----
    var THEMES = ['qd-theme-light', 'qd-theme-dark', 'qd-theme-auto'];
    var ICONS  = { 'qd-theme-light': '\u2600\uFE0F', 'qd-theme-dark': '\uD83C\uDF19', 'qd-theme-auto': '\uD83D\uDDA5\uFE0F' };
    var STORAGE_KEY = 'qdedit-site-theme';
    var DEFAULT_THEME = 'qd-theme-light';

    function applyTheme(theme) {
        document.body.classList.remove.apply(document.body.classList, THEMES);
        document.body.classList.add(theme);
        var icon = document.getElementById('qd-theme-icon');
        if (icon) icon.textContent = ICONS[theme] || '\u2600\uFE0F';
    }

    function initTheme() {
        var stored = localStorage.getItem(STORAGE_KEY);
        var theme = THEMES.indexOf(stored) !== -1 ? stored : DEFAULT_THEME;
        applyTheme(theme);

        var btn = document.getElementById('qd-theme-toggle');
        if (!btn) return;
        btn.addEventListener('click', function () {
            var current = DEFAULT_THEME;
            for (var i = 0; i < THEMES.length; i++) {
                if (document.body.classList.contains(THEMES[i])) { current = THEMES[i]; break; }
            }
            var next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
            localStorage.setItem(STORAGE_KEY, next);
            applyTheme(next);
        });
    }

    // ----- Copy to clipboard -----
    function initCopyButtons() {
        document.querySelectorAll('[data-copy]').forEach(function (el) {
            el.addEventListener('click', function (ev) {
                ev.preventDefault();
                var text = el.dataset.copy;
                navigator.clipboard.writeText(text).then(function () {
                    el.classList.add('copied');
                    var original = el.textContent;
                    if (el.dataset.copiedLabel) el.textContent = el.dataset.copiedLabel;
                    setTimeout(function () {
                        el.classList.remove('copied');
                        if (el.dataset.copiedLabel) el.textContent = original;
                    }, 1500);
                }).catch(function () {});
            });
        });
    }

    // ----- Hamburger nav toggle -----
    function initNavToggle() {
        var toggle = document.getElementById('qd-nav-toggle');
        var nav = toggle && toggle.closest('.qd-nav');
        if (!toggle || !nav) return;
        toggle.addEventListener('click', function () {
            var open = nav.classList.toggle('open');
            toggle.setAttribute('aria-expanded', String(open));
        });
        nav.addEventListener('click', function (e) {
            if (e.target.closest('.qd-nav-link')) {
                nav.classList.remove('open');
                toggle.setAttribute('aria-expanded', 'false');
            }
        });
    }

    // ----- Smooth scroll for anchor links -----
    function initSmoothScroll() {
        document.querySelectorAll('a[href^="#"]').forEach(function (link) {
            link.addEventListener('click', function (e) {
                var target = document.querySelector(link.getAttribute('href'));
                if (target) {
                    e.preventDefault();
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
    }

    // ----- Init -----
    function init() {
        initTheme();
        initCopyButtons();
        initNavToggle();
        initSmoothScroll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
