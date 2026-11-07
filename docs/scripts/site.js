/*
 * site.js — the quikleaf GitHub Pages site, built with bitwrench.js.
 *
 * index.html is an SEO head plus an empty <div id="app">; everything visible
 * is a bitwrench TACO tree mounted from here, styled by two generated
 * palettes (bw.loadStyles → primary + alternate) and a handful of bw.css()
 * rules over CSS custom properties. No hand-written HTML or CSS.
 *
 * Layout: left-justified throughout. The hero is two columns, copy on the
 * left and a real screenshot of the app on the right, followed at once by
 * the install strip (npm command + per-platform download links) so the
 * whole "what is it / how do I get it" story sits above the fold.
 *
 * quikleaf dogfoods bitwrench in the app (src/ui/*) and on this page.
 */
(function () {
  'use strict';

  /* --- version (bumped by tools/feature.sh) ------------------------------- */
  var SITE_VERSION = '1.2.4';
  var REPO = 'https://github.com/deftio/quikleaf';

  /* --- theme ---------------------------------------------------------------- */
  var theme = bw.loadStyles({
    primary: '#6c47b8',
    secondary: '#6b7280',
    success: '#10b981',
    danger: '#ef4444',
    light: '#e5e7eb',
    dark: '#1f2937',
    background: '#f5f5f8',
    surface: '#ffffff',
    surfaceAlt: '#ecebf3',
    spacing: 'normal',
    radius: 'md',
    elevation: 'sm'
  });
  var lp = theme.palette;
  var dp = theme.alternatePalette;

  function tokens(p, extra) {
    return {
      '--site-bg': p.background,
      '--site-surface': p.surface,
      '--site-surface-alt': p.surfaceAlt,
      '--site-text': p.dark.base,
      '--site-muted': p.secondary.base,
      '--site-border': p.light.base,
      '--site-accent': p.primary.base,
      '--site-accent-hover': p.primary.hover,
      '--site-code-bg': extra.codeBg,
      '--site-code-text': extra.codeText,
      '--site-shadow': extra.shadow
    };
  }

  var MONO = 'ui-monospace, "SF Mono", Monaco, "Cascadia Code", Consolas, monospace';
  var SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  bw.injectCSS(bw.css([
    { ':root': tokens(lp, { codeBg: '#1f2937', codeText: '#e5e7eb', shadow: '0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06)' }) },
    { ':root.bw_theme_alt': tokens(dp, { codeBg: '#0f1419', codeText: '#e2e8f0', shadow: '0 1px 3px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.3)' }) },
    {
      'html': { 'scroll-behavior': 'smooth', 'scroll-padding-top': '72px' },
      'body': { margin: 0, 'font-family': SANS, background: 'var(--site-bg)', color: 'var(--site-text)', 'line-height': 1.55 },
      'img': { 'max-width': '100%', height: 'auto' },
      'a': { color: 'var(--site-accent)', 'text-decoration': 'none' },
      'a:hover': { color: 'var(--site-accent-hover)' },
      'code, kbd': { 'font-family': MONO, 'font-size': '0.9em', background: 'var(--site-surface-alt)', padding: '0.1em 0.4em', 'border-radius': '4px' },
      'kbd': { border: '1px solid var(--site-border)', 'box-shadow': '0 1px 0 var(--site-border)' },
      'pre': { 'font-family': MONO, 'font-size': '0.85rem', 'line-height': 1.55, background: 'var(--site-code-bg)', color: 'var(--site-code-text)', padding: '1rem 1.25rem', 'border-radius': '10px', overflow: 'auto', margin: 0 },
      'pre code': { background: 'none', padding: 0, color: 'inherit', 'font-size': 'inherit' },

      /* nav */
      '.site-nav': { position: 'sticky', top: 0, 'z-index': 100, 'backdrop-filter': 'blur(10px)', 'border-bottom': '1px solid var(--site-border)' },
      '.site-nav .bw_bccl_navbar_brand': { display: 'inline-flex', 'align-items': 'center', gap: '0.5rem', 'font-weight': 700 },
      '.site-nav .bw_bccl_navbar_brand img': { width: '28px', height: '28px', 'border-radius': '6px' },
      '.site-nav .bw_bccl_navbar_nav': { 'align-items': 'center', gap: '0.25rem' },
      '.site-version': { 'font-weight': 500, opacity: 0.85 },

      /* hero: two columns, copy left, screenshot right */
      '.site-hero': { background: 'linear-gradient(135deg, #6c47b8 0%, #9550bb 55%, #c45db6 100%)', color: '#fff', 'padding-top': '2.5rem !important', 'padding-bottom': '2.5rem !important' },
      '.site-hero .bw_row': { 'align-items': 'center' },
      '.site-hero .bw_bccl_hero_title': { 'font-size': 'clamp(2rem, 3.6vw, 2.9rem)', 'letter-spacing': '-0.02em', 'line-height': 1.1, margin: '0 0 0.9rem' },
      '.site-hero .bw_bccl_hero_subtitle': { 'font-size': '1.1rem', 'font-weight': 400, margin: '0 0 1.25rem', opacity: 0.95, 'max-width': '34rem' },
      '.site-hero .bw_bccl_hero_subtitle a': { color: '#fff', 'text-decoration': 'underline' },
      '.site-eyebrow': { display: 'inline-flex', 'align-items': 'center', gap: '0.5rem', 'font-size': '0.78rem', 'letter-spacing': '0.08em', 'text-transform': 'uppercase', opacity: 0.9, 'margin-bottom': '0.9rem' },
      '.site-eyebrow img': { width: '22px', height: '22px', 'border-radius': '6px' },
      '.site-hero .bw_bccl_hero_actions': { display: 'flex', gap: '0.6rem', 'justify-content': 'flex-start', 'flex-wrap': 'wrap', margin: '0 0 1rem' },
      '.site-hero .bw_bccl_hero_title, .site-hero .bw_bccl_hero_subtitle, .site-hero .site-eyebrow': { color: '#fff' },
      '.site-hero .bw_bccl_hero_actions a:first-child': { background: '#fff', color: '#6c47b8', border: '1px solid #fff', 'font-weight': 600 },
      '.site-hero .bw_bccl_hero_actions a:first-child:hover': { background: '#f3effa', color: '#4a2d8f' },
      '.site-hero .bw_bccl_hero_actions a:last-child': { background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.7)' },
      '.site-hero .bw_bccl_hero_actions a:last-child:hover': { background: 'rgba(255,255,255,0.22)', color: '#fff' },
      '.site-hero-points': { 'list-style': 'none', padding: 0, margin: 0, 'font-size': '0.95rem', opacity: 0.95 },
      '.site-hero-points li': { margin: '0.2rem 0', 'padding-left': '1.1rem', position: 'relative' },
      '.site-hero-points li:before': { content: '"·"', position: 'absolute', left: '0.2rem', 'font-weight': 700 },

      /* screenshot in a window frame */
      '.site-shot': { background: '#111827', 'border-radius': '12px', 'box-shadow': '0 16px 48px rgba(0,0,0,.35)', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.18)' },
      '.site-shot-bar': { display: 'flex', 'align-items': 'center', gap: '6px', padding: '8px 10px', background: '#1f2937' },
      '.site-shot-bar span': { width: '10px', height: '10px', 'border-radius': '50%', display: 'inline-block' },
      '.site-shot-bar span:nth-child(1)': { background: '#ff5f57' },
      '.site-shot-bar span:nth-child(2)': { background: '#febc2e' },
      '.site-shot-bar span:nth-child(3)': { background: '#28c840' },
      '.site-shot-bar em': { 'font-style': 'normal', 'font-size': '0.72rem', color: '#9ca3af', 'margin-left': '0.5rem', 'font-family': MONO },
      '.site-shot img': { display: 'block', width: '100%' },
      '.site-shot-caption': { 'font-size': '0.85rem', opacity: 0.85, margin: '0.6rem 0 0' },

      /* sections: left-aligned, compact */
      '.site-section': { padding: '2.5rem 0' },
      '.site-section-alt': { background: 'var(--site-surface-alt)' },
      '.site-section .bw_section_header': { 'text-align': 'left', 'margin-bottom': '1.5rem' },
      '.site-section .bw_section_title': { 'font-size': 'clamp(1.4rem, 2.4vw, 1.9rem)', 'letter-spacing': '-0.01em', 'font-weight': 600, 'margin-bottom': '0.35rem' },
      '.site-section .bw_section_subtitle': { 'max-width': '46rem', margin: 0 },
      '.site-h3': { 'font-size': '1.15rem', margin: '0 0 0.4rem', 'font-weight': 600 },
      '.site-sub': { color: 'var(--site-muted)', margin: '0 0 1rem', 'max-width': '46rem' },
      '.site-mt': { 'margin-top': '2rem' },
      '.bw_feature': { background: 'var(--site-surface)', border: '1px solid var(--site-border)', 'border-radius': '12px', padding: '1.1rem 1.1rem', height: '100%' },
      '.bw_feature_icon': { 'font-family': MONO, 'font-weight': 700, 'margin-bottom': '0.5rem !important' },
      '.bw_feature_title': { 'font-size': '1rem', 'font-weight': 600 },
      '.bw_feature_description': { 'font-size': '0.93rem', margin: 0 },
      '.bw_feature_grid .bw_row > div': { 'margin-bottom': '1rem' },

      /* install strip */
      '.site-install-row': { display: 'flex', 'align-items': 'center', gap: '1rem', 'flex-wrap': 'wrap', 'margin-bottom': '0.75rem' },
      '.site-install': { display: 'inline-flex', 'align-items': 'center', gap: '0.75rem', background: 'var(--site-code-bg)', color: 'var(--site-code-text)', 'border-radius': '10px', padding: '0.5rem 0.5rem 0.5rem 1rem' },
      '.site-install code': { background: 'none', color: 'inherit', 'font-size': '1rem', padding: 0, 'white-space': 'nowrap' },
      '.site-install-alt': { color: 'var(--site-muted)', margin: 0 },
      '.site-dl': { display: 'grid', 'grid-template-columns': 'repeat(4, minmax(0, 1fr))', gap: '0.75rem', margin: '0.25rem 0 0' },
      '.site-dl a': { display: 'block', background: 'var(--site-surface)', border: '1px solid var(--site-border)', 'border-radius': '10px', padding: '0.7rem 0.9rem', color: 'var(--site-text)', 'line-height': 1.35 },
      '.site-dl a:hover': { 'border-color': 'var(--site-accent)', color: 'var(--site-text)' },
      '.site-dl strong': { display: 'block', 'font-size': '0.95rem' },
      '.site-dl small': { display: 'block', color: 'var(--site-muted)', 'font-size': '0.82rem', 'font-family': MONO },
      '.site-dl-more': { 'font-size': '0.9rem', color: 'var(--site-muted)', margin: '0.6rem 0 0' },
      '.site-card-grid .bw_bccl_card': { height: '100%', background: 'var(--site-surface)', border: '1px solid var(--site-border)' },
      '.site-card-grid .bw_bccl_card_title': { 'font-size': '0.95rem', 'margin-bottom': '0.4rem' },
      '.site-card-grid .bw_bccl_card_body': { padding: '0.9rem 1rem' },
      '.site-docs .bw_row > div': { 'margin-bottom': '1rem' },
      '.site-docs .site-doc-link': { display: 'block', padding: '0 1rem 0.9rem', 'font-size': '0.8rem', 'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace', 'word-break': 'break-all' },
      '.site-card-grid .bw_bccl_card p': { margin: 0, 'font-size': '0.93rem' },
      '.site-card-grid .bw_row > div': { 'margin-bottom': '1rem' },
      '.site-card-grid pre': { padding: '0.6rem 0.8rem', 'font-size': '0.8rem' },

      /* tables */
      '.site-table-wrap h3': { 'font-size': '1.15rem', margin: '0 0 0.75rem', 'font-weight': 600 },
      '.site-table-wrap .bw_bccl_table': { background: 'var(--site-surface)', border: '1px solid var(--site-border)', 'border-radius': '10px', overflow: 'hidden', width: '100%', 'font-size': '0.92rem' },

      /* cta */
      '.site-cta .bw_cta_content': { 'text-align': 'left' },
      '.site-cta .bw_cta_title': { 'font-size': '1.5rem', 'font-weight': 600 },
      '.site-cta .bw_cta_actions': { 'justify-content': 'flex-start', display: 'flex', gap: '0.6rem', 'flex-wrap': 'wrap' },

      /* footer */
      '.site-footer': { 'border-top': '1px solid var(--site-border)', padding: '2.5rem 0 1.5rem', 'font-size': '0.92rem' },
      '.site-footer h5': { 'font-size': '0.95rem', margin: '0 0 0.6rem' },
      '.site-footer ul': { 'list-style': 'none', padding: 0, margin: 0 },
      '.site-footer li': { margin: '0.25rem 0' },
      '.site-footer p': { color: 'var(--site-muted)', margin: 0 },
      '.site-footer-bottom': { display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', gap: '1rem', 'flex-wrap': 'wrap', 'margin-top': '1.5rem', 'padding-top': '1rem', 'border-top': '1px solid var(--site-border)', color: 'var(--site-muted)' },
      '.site-footer-brand': { display: 'inline-flex', 'align-items': 'center', gap: '0.5rem', 'font-weight': 700, color: 'var(--site-text)' },
      '.site-footer-brand img': { width: '24px', height: '24px', 'border-radius': '6px' },

      /* goatcounter counter widget */
      '.gcvc': { display: 'block', margin: '0 auto 1rem', 'text-align': 'center' },

      '@media (max-width: 991px)': {
        '.site-hero .bw_row > div + div': { 'margin-top': '1.5rem' },
        '.site-dl': { 'grid-template-columns': 'repeat(2, minmax(0, 1fr))' }
      },
      '@media (max-width: 576px)': {
        '.site-nav': { position: 'static' },
        '.site-nav .bw_bccl_navbar_nav': { gap: 0 },
        '.site-nav .bw_nav_link': { 'font-size': '0.9rem', padding: '0.35rem 0.5rem' },
        '.site-nav .site-nav-secondary': { display: 'none' },
        '.site-section': { padding: '2rem 0' },
        '.site-install': { display: 'flex', width: '100%', 'justify-content': 'space-between' },
        '.site-dl': { 'grid-template-columns': '1fr' }
      }
    }
  ]));

  /* --- theme mode: light → dark → auto ------------------------------------ */
  var MODES = ['light', 'dark', 'auto'];
  var ICONS = { light: '☀️', dark: '🌙', auto: '🖥️' };
  var STORAGE_KEY = 'quikleaf-site-theme';
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function currentMode() {
    var stored = localStorage.getItem(STORAGE_KEY);
    return MODES.indexOf(stored) !== -1 ? stored : 'auto';
  }
  function applyMode(mode) {
    var dark = mode === 'dark' || (mode === 'auto' && media && media.matches);
    bw.setThemeMode(dark ? 'alternate' : 'primary');
    bw.patch('theme-icon', ICONS[mode]);
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.setAttribute('aria-label', 'Theme: ' + mode + ' (click to change)');
  }
  function cycleMode() {
    var next = MODES[(MODES.indexOf(currentMode()) + 1) % MODES.length];
    localStorage.setItem(STORAGE_KEY, next);
    applyMode(next);
  }
  if (media && media.addEventListener) media.addEventListener('change', function () { if (currentMode() === 'auto') applyMode('auto'); });

  /* --- helpers -------------------------------------------------------------- */
  function ext(text, href) {
    return { t: 'a', a: { href: href, target: '_blank', rel: 'noopener' }, c: text };
  }
  function linkButton(text, href, variant, size, external) {
    var a = { href: href, class: 'bw_bccl_btn bw_' + variant + (size ? ' bw_bccl_btn_' + size : '') };
    if (external) { a.target = '_blank'; a.rel = 'noopener'; }
    return { t: 'a', a: a, c: text };
  }
  function pre(code) {
    return { t: 'pre', c: { t: 'code', c: code } };
  }
  function row(children, colClass) {
    return {
      t: 'div', a: { class: 'bw_row bw_g_4' },
      c: children.map(function (ch) { return { t: 'div', a: { class: colClass }, c: ch }; })
    };
  }
  function section(opts) {
    var s = bw.makeSection({ title: opts.title, subtitle: opts.subtitle, content: opts.content, spacing: 'md' });
    s.a = s.a || {};
    s.a.class = (s.a.class || '') + ' site-section' + (opts.alt ? ' site-section-alt' : '');
    if (opts.id) s.a.id = opts.id;
    return s;
  }
  function copyButton(text) {
    return bw.makeButton({
      text: 'Copy', variant: 'light', size: 'sm',
      onclick: function (e) {
        var btn = e.currentTarget;
        navigator.clipboard.writeText(text).then(function () {
          bw.patch(btn, 'Copied!');
          setTimeout(function () { bw.patch(btn, 'Copy'); }, 1500);
        }).catch(function () {});
      }
    });
  }
  /* find the first TACO node in a tree whose class contains `cls` */
  function findByClass(taco, cls) {
    if (!taco || typeof taco !== 'object') return null;
    if (taco.a && typeof taco.a.class === 'string' && taco.a.class.indexOf(cls) !== -1) return taco;
    var kids = Array.isArray(taco.c) ? taco.c : (taco.c ? [taco.c] : []);
    for (var i = 0; i < kids.length; i++) { var f = findByClass(kids[i], cls); if (f) return f; }
    return null;
  }

  /* --- release assets --------------------------------------------------------
   * Installer file names follow tauri's bundler and release.yml; the launcher
   * archives are named by release.yml. Everything is keyed by version so the
   * links work before (and without) the GitHub API answering. */
  function assetUrl(version, name) {
    return REPO + '/releases/download/v' + version + '/' + name;
  }
  var DOWNLOADS = [
    { id: 'dl-mac-arm', title: 'macOS (Apple Silicon)', file: function (v) { return 'quikleaf_' + v + '_aarch64.dmg'; }, note: '.dmg' },
    { id: 'dl-mac-x64', title: 'macOS (Intel)', file: function (v) { return 'quikleaf_' + v + '_x64.dmg'; }, note: '.dmg' },
    { id: 'dl-win', title: 'Windows (x64)', file: function (v) { return 'quikleaf_' + v + '_x64-setup.exe'; }, note: '.exe installer' },
    { id: 'dl-linux', title: 'Linux (x64)', file: function (v) { return 'quikleaf_' + v + '_amd64.deb'; }, note: '.deb' }
  ];
  var MORE_DOWNLOADS = [
    { id: 'dl-win-msi', text: 'Windows .msi', file: function (v) { return 'quikleaf_' + v + '_x64_en-US.msi'; } },
    { id: 'dl-linux-rpm', text: 'Linux .rpm', file: function (v) { return 'quikleaf-' + v + '-1.x86_64.rpm'; } },
    { id: 'dl-linux-appimage', text: 'Linux AppImage', file: function (v) { return 'quikleaf_' + v + '_amd64.AppImage'; } }
  ];
  function downloadTiles(version) {
    return {
      t: 'div', a: { class: 'site-dl' },
      c: DOWNLOADS.map(function (d) {
        return { t: 'a', a: { id: d.id, href: assetUrl(version, d.file(version)), 'data-file': 'tile' }, c: [{ t: 'strong', c: d.title }, { t: 'small', c: d.note + ' · v' + version }] };
      })
    };
  }
  function moreDownloads(version) {
    var items = [];
    MORE_DOWNLOADS.forEach(function (d, i) {
      if (i) items.push(' · ');
      items.push({ t: 'a', a: { id: d.id, href: assetUrl(version, d.file(version)) }, c: d.text });
    });
    items.push(' · ', ext('all releases', REPO + '/releases'));
    return { t: 'p', a: { class: 'site-dl-more' }, c: ['Also: '].concat(items) };
  }
  /* Point every download link at `version` (after the GitHub API tells us the latest tag). */
  function retargetDownloads(version) {
    DOWNLOADS.concat(MORE_DOWNLOADS).forEach(function (d) {
      var a = document.getElementById(d.id);
      if (!a) return;
      a.setAttribute('href', assetUrl(version, d.file(version)));
      var small = a.querySelector('small');
      if (small) bw.patch(small, (d.note || '') + ' · v' + version);
    });
  }

  /* --- nav ------------------------------------------------------------------ */
  var nav = bw.makeNavbar({
    brand: 'quikleaf',
    brandHref: './',
    items: [
      { text: 'Install', href: '#install' },
      { text: 'Features', href: '#features' },
      { text: 'Architecture', href: '#architecture' },
      { text: 'Docs', href: '#docs' },
      { text: 'GitHub', href: REPO },
      { text: 'quikdown', href: 'https://github.com/deftio/quikdown' }
    ]
  });
  nav.a.class += ' site-nav';
  var brand = findByClass(nav, 'bw_bccl_navbar_brand');
  if (brand) brand.c = [{ t: 'img', a: { src: 'assets/icon.png', alt: '' } }, 'quikleaf', bw.makeBadge({ text: 'v' + SITE_VERSION, variant: 'light', pill: true, className: 'site-version' })];
  var navLinks = findByClass(nav, 'bw_bccl_navbar_nav');
  if (navLinks) {
    navLinks.c.forEach(function (l) {
      if (!l.a) return;
      if (/^https?:/.test(l.a.href)) { l.a.target = '_blank'; l.a.rel = 'noopener'; }
      if (l.a.href === '#architecture' || /quikdown/.test(l.a.href)) l.a.class += ' site-nav-secondary';
    });
    navLinks.c.push(bw.makeButton({
      text: { t: 'span', a: { id: 'theme-icon' }, c: ICONS.auto },
      variant: 'outline-light', size: 'sm', onclick: cycleMode,
      className: 'site-theme-btn'
    }));
  }
  var themeBtn = findByClass(nav, 'site-theme-btn');
  if (themeBtn) themeBtn.a.id = 'theme-toggle';

  /* --- hero ----------------------------------------------------------------- */
  var hero = bw.makeHero({
    title: 'Write markdown. Render everything. A chat that stays in its lane.',
    subtitle: {
      t: 'span', c: [
        'A native desktop editor powered by ', ext('quikdown', 'https://github.com/deftio/quikdown'),
        ': Mermaid, LaTeX, GeoJSON, CSV and Vega render locally, and every tab carries its own LLM chat that reads and edits only that document, with diffs you approve.'
      ]
    },
    size: 'md', centered: false,
    actions: [
      linkButton('Install ↓', '#install', 'light', 'lg'),
      linkButton('View on GitHub →', REPO, 'outline-light', 'lg', true)
    ]
  });
  hero.a.class += ' site-hero';
  var heroContent = findByClass(hero, 'bw_bccl_hero_content');
  if (heroContent) {
    var copy = [{ t: 'span', a: { class: 'site-eyebrow' }, c: [{ t: 'img', a: { src: 'assets/icon.png', alt: '' } }, 'Desktop app · macOS · Windows · Linux · BSD-2'] }]
      .concat(heroContent.c)
      .concat([{ t: 'ul', a: { class: 'site-hero-points' }, c: [
        { t: 'li', c: 'Local models auto-detected: Ollama, LM Studio, Docker Model Runner. Or Anthropic and any OpenAI-compatible API.' },
        { t: 'li', c: 'One sealed chat per document, one explicit project chat. Nothing leaks between projects.' },
        { t: 'li', c: 'Your files and keys stay on your machine.' }
      ] }]);
    var shot = [
      { t: 'div', a: { class: 'site-shot' }, c: [
        { t: 'div', a: { class: 'site-shot-bar' }, c: [{ t: 'span' }, { t: 'span' }, { t: 'span' }, { t: 'em', c: 'quikleaf — launch-plan.md' }] },
        { t: 'img', a: { src: 'assets/quikleaf-app.png', width: '1440', height: '900', alt: 'quikleaf with a document chat on the left that proposed a Risks table as a reviewable diff, the markdown source in the middle, and the rendered preview with tables, a Mermaid diagram and a math block on the right' } }
      ] },
      { t: 'p', a: { class: 'site-shot-caption' }, c: 'A document chat on a local model proposes a new section as a diff, you accept it, the source and the rendered preview update. Timings under every reply.' }
    ];
    heroContent.c = row([copy, shot], 'bw_col_lg_6');
    heroContent.c.c[0].a.class = 'bw_col_lg_5';
    heroContent.c.c[1].a.class = 'bw_col_lg_7';
  }

  /* --- install -------------------------------------------------------------- */
  var install = section({
    id: 'install', alt: true,
    title: 'Install',
    subtitle: 'One npm command, or a desktop installer for your platform. The npm package is a small launcher that fetches the release build on first run.',
    content: [
      { t: 'div', a: { class: 'site-install-row' }, c: [
        { t: 'div', a: { class: 'site-install' }, c: [{ t: 'code', c: 'npm install -g quikleaf' }, copyButton('npm install -g quikleaf')] },
        { t: 'p', a: { class: 'site-install-alt' }, c: ['or without installing: ', { t: 'code', c: 'npx quikleaf document.md' }] }
      ] },
      downloadTiles(SITE_VERSION),
      moreDownloads(SITE_VERSION),
      { t: 'div', a: { class: 'site-card-grid site-mt' }, c: row([
        bw.makeCard({ title: 'Open an empty editor', content: pre('quikleaf') }),
        bw.makeCard({ title: 'Open a file', content: pre('quikleaf document.md') }),
        bw.makeCard({ title: 'Project mode', content: pre('quikleaf --project ./mydir') })
      ], 'bw_col_md_4') },
      { t: 'p', a: { class: 'site-sub' }, c: [
        'Installed the macOS app by dragging it to Applications? Use ', { t: 'strong', c: 'Help → Install Command Line Tool' },
        ' once, then ', { t: 'code', c: 'quikleaf notes.md' }, ' or ', { t: 'code', c: 'quikleaf --project ./docs' }, ' works from any terminal.'
      ] }
    ]
  });

  /* --- features ------------------------------------------------------------- */
  var features = section({
    id: 'features',
    title: 'What it does',
    subtitle: 'An editor first, with the chat built around the document rather than the other way round.',
    content: bw.makeFeatureGrid({
      columns: 3, centered: false,
      features: [
        { icon: 'Q', title: 'Rich Markdown Rendering', description: 'quikdown standalone with syntax highlighting, Mermaid, LaTeX math, GeoJSON maps, 3D STL, CSV tables, Vega charts, ABC music notation and SVG, all rendered locally.' },
        { icon: 'AI', title: 'A Chat Per Tab', description: 'Every document tab has its own QD chat, sealed to that document: it sees and edits only that file, and the header says so. Each chat can run a different model. OpenAI-compatible APIs and Anthropic.' },
        { icon: '⊕', title: 'Project Mode', description: 'Open a folder for a file tree, project-scoped file tools and search, a scratchpad and key-value store, and a project file (in .quikleaf/ by default) that remembers open tabs and each file\u2019s chat.' },
        { icon: '↔', title: 'Local LLM Auto-Detect', description: 'Finds Ollama, LM Studio or Docker Model Runner running locally. No configuration, works fully offline.' },
        { icon: '</>', title: 'Project Chat', description: 'Cross-file work lives in one explicit project chat that reads, writes and searches files under the project root by path. Files from other projects never leak between chats.' },
        { icon: '±', title: 'Edits You Can Review', description: 'Edits show up as diff cards. Review everything, only project file writes, or nothing. Reject and it asks instead of retrying.' },
        { icon: '▤', title: 'Tabs With Panes', description: 'Each tab shows [chat | quikdown view | info] and remembers its layout and editor mode. The info pane has document stats, chat stats and the model picker.' },
        { icon: '¶', title: 'Writing Tools', description: 'Outline, find & replace with regex, word count and reading time, focus mode, four preview styles plus your own CSS, Export HTML and Print / PDF. Paste an image and it is saved beside the document; drop files to open them.' },
        { icon: '◆', title: 'Native Desktop App', description: 'Fast startup, low memory, native file dialogs, keyboard shortcuts, light and dark themes with a toggle, resizable panels. Watch a tab\u2019s file and it reloads when something else writes it. Built with Tauri v2.' },
        { icon: '⌚', title: 'Timing You Can See', description: 'Timestamps under every message, time-to-first-token and tokens/s under every reply, tool durations, and an optional JSON-lines performance log with a live log tab in the app.' },
        { icon: '{ }', title: 'UI as Data', description: { t: 'span', c: ['The whole interface, and this page, is built from ', ext('bitwrench.js', 'https://github.com/deftio/bitwrench'), ' TACO objects with themes generated from seed palettes. No hand-written HTML or CSS.'] } },
        { icon: 'BSD', title: 'Free and Open Source', description: 'BSD-2-Clause licensed. Your documents and API keys never leave your machine except to the LLM host you configure.' }
      ]
    })
  });

  /* --- rendering ------------------------------------------------------------ */
  var rendering = section({
    alt: true,
    title: 'Every fence type, rendered locally',
    subtitle: 'quikdown’s standalone bundle includes all renderers. No external services, no network requests.',
    content: bw.makeFeatureGrid({
      columns: 4, centered: false,
      features: [
        { icon: '{ }', title: 'Code', description: 'Syntax highlighting via highlight.js for 180+ languages.' },
        { icon: '⬡', title: 'Mermaid', description: 'Flowcharts, sequence diagrams, Gantt charts, state diagrams and more.' },
        { icon: '∑', title: 'Math / LaTeX', description: 'Inline and display math via MathJax. Full LaTeX equation support.' },
        { icon: '⌖', title: 'GeoJSON Maps', description: 'Interactive Leaflet maps from GeoJSON. Points, polygons and lines.' },
        { icon: '▧', title: '3D STL Viewer', description: 'STL models with orbit controls. Powered by Three.js.' },
        { icon: '☷', title: 'CSV / TSV / PSV', description: 'Tabular data rendered as clean HTML tables automatically.' },
        { icon: '▁▃▅', title: 'Vega / Vega-Lite', description: 'Declarative charts and visualizations from JSON specs.' },
        { icon: '♫', title: 'SVG & ABC Music', description: 'Inline SVG rendering and ABC music notation with sheet music output.' }
      ]
    })
  });

  /* --- providers ------------------------------------------------------------ */
  function providerCard(title, body) { return bw.makeCard({ title: title, content: { t: 'p', c: body } }); }
  var providers = section({
    title: 'Works with any LLM provider',
    subtitle: 'Pick a preset in Settings: Ollama, LM Studio, Docker Model Runner, OpenRouter or Anthropic, or any OpenAI-compatible endpoint.',
    content: { t: 'div', a: { class: 'site-card-grid' }, c: row([
      providerCard('Ollama (local)', ['Auto-detected on ', { t: 'code', c: 'localhost:11434' }, '. Run ', { t: 'code', c: 'ollama serve' }, ' and quikleaf finds it. Fully offline.']),
      providerCard('Docker Model Runner', ['Run ', { t: 'code', c: 'docker desktop enable model-runner --tcp 12434' }, ' once; quikleaf finds it at ', { t: 'code', c: 'localhost:12434/engines/v1' }, ' and lists your pulled ', { t: 'code', c: 'ai/' }, ' models.']),
      providerCard('Anthropic', 'Connect to Claude models with your API key in Settings. Streaming responses with tool calling.'),
      providerCard('OpenRouter and more', 'Any OpenAI-compatible API works: OpenRouter, LM Studio, Groq, Together, or your own endpoint.')
    ], 'bw_col_md_6') }
  });

  /* --- shortcuts + slash commands ------------------------------------------- */
  var shortcuts = [
    ['Cmd/Ctrl + N', 'New document'], ['Cmd/Ctrl + O', 'Open file'], ['Cmd/Ctrl + S', 'Save file'],
    ['Cmd/Ctrl + W', 'Close tab'], ['Ctrl + Tab / Ctrl + Shift + Tab', 'Next / previous tab'], ['Cmd/Ctrl + F', 'Find'], ['Cmd/Ctrl + H', 'Find and replace'],
    ['Cmd/Ctrl + Shift + C', 'Chat pane (this tab)'], ['Cmd/Ctrl + Shift + I', 'Info pane (this tab)'],
    ['Cmd/Ctrl + Shift + O', 'Outline panel'], ['Cmd/Ctrl + Shift + D', 'Focus mode'], ['Cmd/Ctrl + P', 'Print / PDF'],
    ['Enter', 'Send chat message'], ['Shift + Enter', 'New line in chat']
  ].map(function (r) { return { Shortcut: r[0], Action: r[1] }; });
  var slash = [
    ['/help', 'Show available commands'], ['/clear', 'Clear this chat'], ['/model', 'Show this chat\'s model'], ['/model <name>', 'Use a model for this chat only'],
    ['/memory', 'Show the project scratchpad'], ['/tools', 'List the tools this chat has'], ['/log', 'Performance log path and recent timings']
  ].map(function (r) { return { Command: r[0], Description: r[1] }; });

  var reference = section({
    alt: true,
    content: row([
      { t: 'div', a: { class: 'site-table-wrap' }, c: [{ t: 'h3', c: 'Keyboard shortcuts' }, bw.makeTable({ data: shortcuts, sortable: false })] },
      { t: 'div', a: { class: 'site-table-wrap' }, c: [{ t: 'h3', c: 'Chat slash commands' }, bw.makeTable({ data: slash, sortable: false })] }
    ], 'bw_col_md_6')
  });

  /* --- documentation ---------------------------------------------------------
   * One card per document, linking to the rendered file on GitHub. Keep in
   * step with the Docs list in llms.txt. */
  var DOCS = [
    ['README', 'README.md', 'Install, use, settings, keyboard, build from source.'],
    ['Chat internals', 'docs/quikleaf-chat-internals.md', 'How a chat turn runs: the full system prompt, tool schemas and counts, the dispatcher\u2019s scope gates, edit review, provider wire formats, the streaming proxy.'],
    ['LLM integration', 'docs/llm-integration.md', 'Providers and presets, settings, the tool list per scope, edit review, slash commands, the performance log.'],
    ['Architecture', 'docs/architecture.md', 'Module by module: the Rust commands, the TypeScript modules, UI rules, the tool-calling loop.'],
    ['Project mode', 'docs/project-mode.md', 'The file tree, the project chat, scratchpad and key-value store, the project file format.'],
    ['Agents and external tools', 'agents.md', 'Tool definitions and results, the project file as a channel, watching files an agent writes, the log format.'],
    ['Publishing', 'docs/publishing.md', 'CI, tags, GitHub releases and npm trusted publishing: the trust path from a merge to npm.'],
    ['Contributing', 'CONTRIBUTING.md', 'Reporting bugs, conventions, tests, pull requests.'],
    ['Security', 'SECURITY.md', 'Reporting a vulnerability, what the app does with your data, boundaries enforced in code, known gaps.'],
    ['Privacy', 'PRIVACY.md', 'What leaves the machine and when, what is stored where, what this website records.'],
    ['Changelog', 'CHANGELOG.md', 'Every release, with its AI-assistance line.'],
    ['llms.txt', 'llms.txt', 'The short form for language models.']
  ];
  function docCard(d) {
    var card = bw.makeCard({ title: d[0], content: { t: 'p', c: d[2] } });
    var link = { t: 'a', a: { href: REPO + '/blob/main/' + d[1], target: '_blank', rel: 'noopener', class: 'site-doc-link' }, c: d[1] };
    card.c = Array.isArray(card.c) ? card.c.concat([link]) : [card.c, link];
    return card;
  }
  var docs = section({
    id: 'docs',
    title: 'Documentation',
    subtitle: 'Each page is a markdown file in the repository, rendered on GitHub.',
    content: { t: 'div', a: { class: 'site-card-grid site-docs' }, c: row(DOCS.map(docCard), 'bw_col_md_6 bw_col_lg_4') }
  });

  /* --- build from source ---------------------------------------------------- */
  var build = section({
    id: 'build',
    title: 'For contributors',
    subtitle: 'Requires Node.js 18+ and a current stable Rust toolchain.',
    content: [
      row([
        [{ t: 'h3', a: { class: 'site-h3' }, c: 'Development' }, pre('# Install frontend dependencies\nnpm install\n\n# Full dev mode: Vite + Rust + native window\nnpx tauri dev\n\n# Type check, unit tests, e2e tests, coverage\nnpx tsc --noEmit\nnpm test\nnpm run test:e2e\nnpm run test:coverage\n\n# Rust\ncd src-tauri && cargo check && cargo test')],
        [{ t: 'h3', a: { class: 'site-h3' }, c: 'Production build' }, pre('# Build platform installers\nnpx tauri build\n\n# Output locations:\n#   macOS:   src-tauri/target/release/bundle/dmg/\n#   Windows: src-tauri/target/release/bundle/nsis/\n#   Linux:   src-tauri/target/release/bundle/deb/\n\n# Release (maintainer): feature branch, then\nnpm run feature -- "name" [patch|minor|major]\nnpm run release:dry\nnpm run release')]
      ], 'bw_col_md_6'),
      { t: 'div', a: { class: 'site-mt' }, c: row([
        [{ t: 'h3', a: { class: 'site-h3' }, c: 'macOS' }, pre('xcode-select --install')],
        [{ t: 'h3', a: { class: 'site-h3' }, c: 'Linux (Debian/Ubuntu)' }, pre('sudo apt install -y libwebkit2gtk-4.1-dev \\\n  build-essential curl wget file libxdo-dev \\\n  libssl-dev libayatana-appindicator3-dev \\\n  librsvg2-dev')],
        [{ t: 'h3', a: { class: 'site-h3' }, c: 'Windows' }, { t: 'p', a: { class: 'site-sub' }, c: 'Visual Studio 2022 with the "Desktop development with C++" workload.' }]
      ], 'bw_col_md_4') }
    ]
  });

  /* --- architecture --------------------------------------------------------- */
  var tree =
'src-tauri/                  Rust backend (Tauri v2)\n' +
'  src/commands/\n' +
'    fs.rs                   File I/O commands\n' +
'    llm.rs                  LLM API proxy with streaming\n' +
'    project.rs              Project state, memory, KV, file tools, search\n' +
'    diag.rs                 Performance log, CLI shim installer, build info\n' +
'    cli.rs                  --help / --version, unknown-flag warning\n' +
'    watch.rs                File watcher behind the Watch toggle and --watch\n' +
'  src/main.rs               CLI parsing, app setup, asset:// image handler\n' +
'\n' +
'src/                        TypeScript frontend (Vite + bitwrench)\n' +
'  ui/theme.ts               Light + dark themes, app CSS via bw.css()\n' +
'  ui/shell.ts               Title bar, menus, toggle buttons, status bar\n' +
'  ui/editor-toolbar.ts      The tab\u2019s control row over the headless editor\n' +
'  ui/appearance.ts          Theme, font sizes, preview styles, user CSS\n' +
'  ui/about.ts               About / How it works / Diagnostics tabs\n' +
'  ui/tabbar.ts, findbar.ts, outline.ts, focus.ts\n' +
'  editor/editor.ts          quikdown editor wrapper (headless)\n' +
'  editor/tabs.ts, documents.ts   Tab model and session controller\n' +
'  editor/images.ts, dropzone.ts, watch.ts   Images, dropped files, Watch\n' +
'  chat/chat-ui.ts           Chat pane, scoped tool dispatch, slash commands\n' +
'  chat/session.ts           One sealed chat session per tab\n' +
'  ui/panes.ts, ui/infopane.ts  Per-tab panes [chat | view | info]\n' +
'  chat/chat-utils.ts        Tool schemas + system prompt\n' +
'  chat/providers.ts         LLM provider adapters (OpenAI, Anthropic)\n' +
'  chat/review.ts, plan.ts   Edit review cards, plan card\n' +
'  diag/perf.ts, log-pane.ts Timing math, performance-log client, the log tab\n' +
'  settings/settings.ts      LLM config UI, auto-detect\n' +
'  project/file-tree.ts      Project mode file tree sidebar\n' +
'  main.ts                   App init, shortcuts, project mode\n' +
'\n' +
'index.html                  Empty #app, mounted by bitwrench';

  var architecture = section({
    id: 'architecture', alt: true,
    title: 'How it’s built',
    subtitle: 'Tauri v2 backend in Rust, a bitwrench.js UI in a webview, quikdown for rendering.',
    content: row([
      pre(tree),
      { t: 'div', a: { class: 'site-card-grid' }, c: [
        bw.makeCard({ title: 'Markdown only', content: { t: 'p', c: 'The LLM operates on raw markdown. It never sees or produces HTML. You see the rendered preview via quikdown.' } }),
        { t: 'div', a: { style: 'height: 1rem' } },
        bw.makeCard({ title: 'Backend proxy', content: { t: 'p', c: 'LLM API calls go through the Rust backend to avoid CORS and keep API keys out of the webview.' } }),
        { t: 'div', a: { style: 'height: 1rem' } },
        bw.makeCard({ title: 'Offline rendering', content: { t: 'p', c: 'quikdown’s standalone bundle includes every fence renderer (~8 MB) for complete offline use. No CDN dependencies in the app.' } })
      ] }
    ], 'bw_col_lg_6')
  });

  /* --- CTA ------------------------------------------------------------------ */
  var cta = bw.makeCTA({
    title: 'Get started',
    description: 'Install from npm, grab an installer, or read the source.',
    variant: 'light', centered: false,
    actions: [
      linkButton('Install', '#install', 'primary'),
      linkButton('Releases', REPO + '/releases', 'outline-primary', null, true),
      linkButton('Source code', REPO, 'outline-primary', null, true),
      linkButton('Issues', REPO + '/issues', 'outline-primary', null, true)
    ]
  });
  cta.a.class += ' site-section site-cta';

  /* --- footer --------------------------------------------------------------- */
  function col(title, items) {
    return [{ t: 'h5', c: title }, { t: 'ul', c: items.map(function (i) { return { t: 'li', c: i }; }) }];
  }
  var footer = {
    t: 'footer', a: { class: 'site-footer' },
    c: { t: 'div', a: { class: 'bw_container' }, c: [
      row([
        [{ t: 'h5', c: 'quikleaf' }, { t: 'p', c: 'A standalone, cross-platform markdown editor with rich rendering and LLM chat. Built with Tauri v2, a bitwrench.js UI and quikdown rendering.' }],
        col('Product', [{ t: 'a', a: { href: '#features' }, c: 'Features' }, { t: 'a', a: { href: '#install' }, c: 'Install' }, { t: 'a', a: { href: '#build' }, c: 'Build from source' }, { t: 'a', a: { href: '#architecture' }, c: 'Architecture' }, { t: 'a', a: { href: '#docs' }, c: 'Documentation' }]),
        col('Resources', [ext('GitHub', REPO), ext('Issues', REPO + '/issues'), ext('Releases', REPO + '/releases'), ext('npm', 'https://www.npmjs.com/package/quikleaf'), ext('Chat internals', REPO + '/blob/main/docs/quikleaf-chat-internals.md'), ext('Privacy', REPO + '/blob/main/PRIVACY.md'), ext('License (BSD-2)', REPO + '/blob/main/LICENSE')]),
        col('Related', [ext('quikdown', 'https://github.com/deftio/quikdown'), ext('bitwrench', 'https://github.com/deftio/bitwrench'), ext('quikdown site', 'https://deftio.github.io/quikdown/pages/'), ext('quikdown editor', 'https://deftio.github.io/quikdown/pages/edit/'), ext('deftio', 'https://github.com/deftio')])
      ], 'bw_col_md_3'),
      { t: 'div', a: { class: 'site-footer-bottom' }, c: [
        { t: 'a', a: { class: 'site-footer-brand', href: './' }, c: [{ t: 'img', a: { src: 'assets/icon.png', alt: '' } }, 'quikleaf'] },
        { t: 'span', c: '© 2026 deftio. BSD-2-Clause License. Site built with bitwrench.js.' }
      ] }
    ] }
  };

  /* --- mount ---------------------------------------------------------------- */
  bw.mount('#app', { t: 'div', c: [nav, { t: 'main', c: [hero, install, features, rendering, providers, reference, docs, build, architecture, cta] }, footer] });
  applyMode(currentMode());

  /* Show the latest released version in the nav badge and point the download
   * links at it, if GitHub answers. Until then everything targets SITE_VERSION. */
  if (window.fetch) {
    fetch('https://api.github.com/repos/deftio/quikleaf/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rel) {
        if (!rel || !rel.tag_name) return;
        bw.patch(document.querySelector('.site-version'), rel.tag_name);
        var v = rel.tag_name.replace(/^v/, '');
        if (v !== SITE_VERSION) retargetDownloads(v);
      })
      .catch(function () {});
  }
})();
