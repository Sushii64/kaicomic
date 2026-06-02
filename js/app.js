import {
  parseTxtFile,
  buildRosterLookup,
  parseChatlog,
  parseInlineHandles,
  parseHeaderHandles,
  formatDate,
  parsePageNumber,
  formatPageTitle,
} from './lib.mjs';

(function () {
  const app = document.getElementById('app');

  let currentRenderToken = 0;

  // LocalStorage utilities
  const STORAGE_KEYS = {
    DATE_FORMAT: 'nav-date-format',
    LIGHT_MODE: 'nav-light-mode',
    SAVED_POSITION: 'nav-saved-position',
    FONT_SIZE: 'nav-font-size',
    LINE_SPACING: 'nav-line-spacing',
    IMAGE_SIZE: 'nav-image-size',
  };

  const DISPLAY_SETTINGS = [
    { key: STORAGE_KEYS.FONT_SIZE,    label: 'Font Size',    cssVar: '--reader-font-size',    default: 18,  min: 12,  max: 28,  step: 1,   decimals: 0, format: v => `${v}px`,  toCss: v => `${v}px`  },
    { key: STORAGE_KEYS.LINE_SPACING, label: 'Line Spacing', cssVar: '--reader-line-spacing', default: 1.5, min: 1.0, max: 2.5, step: 0.1, decimals: 1, format: v => v.toFixed(1), toCss: v => v.toFixed(1) },
    { key: STORAGE_KEYS.IMAGE_SIZE,   label: 'Image Size',   cssVar: '--reader-img-size',     default: 100, min: 30,  max: 200, step: 10,  decimals: 0, format: v => `${v}%`,   toCss: v => v <= 100 ? `${v}%` : '100%',
      extra: v => document.documentElement.style.setProperty('--reader-container-max', v > 100 ? `${Math.round(950 * v / 100)}px` : '950px') },
  ];

  function getFromStorage(key, defaultValue) {
    try {
      const value = localStorage.getItem(key);
      return value !== null ? value : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  function setToStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore storage errors
    }
  }

  function applyDisplaySettings() {
    for (const s of DISPLAY_SETTINGS) {
      const stored = parseFloat(getFromStorage(s.key, null));
      const val = isNaN(stored) ? s.default : Math.min(s.max, Math.max(s.min, stored));
      document.documentElement.style.setProperty(s.cssVar, s.toCss(val));
      s.extra?.(val);
    }
  }

  function applyLightMode() {
    const isLight = getFromStorage(STORAGE_KEYS.LIGHT_MODE, 'false') === 'true';
    if (isLight) {
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
    }
  }

  function colorForMode(colors) {
    return document.body.classList.contains('light-mode') ? colors.light : colors.dark;
  }

  function applyChatlogColors() {
    const isLight = document.body.classList.contains('light-mode');

    // Apply colors to all chatlog elements
    document.querySelectorAll('.chatlog-handle, .chatlog-text, .chatlog-handle-tag, .inline-handle').forEach(el => {
      const darkColor = el.getAttribute('data-dark-color');
      const lightColor = el.getAttribute('data-light-color');

      if (isLight && lightColor) {
        el.style.color = lightColor;
      } else if (!isLight && darkColor) {
        el.style.color = darkColor;
      }
    });
  }

  function toggleLightMode(linkElement) {
    // Add transition class for smooth toggle
    document.body.classList.add('transitioning');

    const isLight = document.body.classList.contains('light-mode');
    if (isLight) {
      document.body.classList.remove('light-mode');
      setToStorage(STORAGE_KEYS.LIGHT_MODE, 'false');
      if (linkElement) linkElement.textContent = 'Light Mode';
    } else {
      document.body.classList.add('light-mode');
      setToStorage(STORAGE_KEYS.LIGHT_MODE, 'true');
      if (linkElement) linkElement.textContent = 'Dark Mode';
    }

    // Apply chatlog colors after mode change
    applyChatlogColors();

    // Remove transition class after animation completes
    setTimeout(() => {
      document.body.classList.remove('transitioning');
    }, 300);
  }

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.substring(2).toLowerCase(), v);
      else el.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      if (Array.isArray(c)) el.append(...c);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    }
    return el;
  }

  // Turn a line of prose into DOM nodes, rendering any inline
  // [handle=ID]label[/handle] tags as colored, monospace spans. The common case
  // (no tags) returns the bare string so callers still get a single text node.
  function inlineNodes(text, roster) {
    const segments = parseInlineHandles(text, roster);
    if (segments.length === 1 && segments[0].type === 'text') return [segments[0].text];
    return segments.map(seg => {
      if (seg.type === 'text') return document.createTextNode(seg.text);
      return h('span', {
        class: 'inline-handle',
        'data-dark-color': seg.colors.dark,
        'data-light-color': seg.colors.light,
        style: { color: colorForMode(seg.colors) }
      }, seg.text);
    });
  }

  function navigateTo(path, e) {
    // Allow ctrl/cmd/middle click to open in new tab
    if (e && (e.ctrlKey || e.metaKey || e.button === 1)) {
      return true; // Allow default behavior
    }
    // Prefer clean URLs
    history.pushState({ path }, '', path);
    route();
    return false;
  }

  function getRequestedPageNumber() {
    return parsePageNumber(location.pathname, location.hash);
  }

  // Build the shared page chrome that every view wraps its content in: the site
  // header, the Home/Log/Map nav, the light-mode + Discord toggle, and an empty
  // main > article(panel) for the caller to fill. Returns the pieces so each
  // view can append content to `panel` and decide where to place `lightModeToggle`.
  // panelClass sets the <article> class (e.g. 'panel page', 'panel home').
  // A small inline image used to separate nav links, in the spirit of the MS
  // Paint Adventures "candy corn" separators. Placeholder art for now — swap
  // /img/ui/separator.svg for the real comic-specific icon.
  function navSep() {
    return h('img', { class: 'nav-sep', src: '/img/ui/separator.svg', alt: '', 'aria-hidden': 'true' });
  }

  function renderChrome(panelClass = 'panel') {
    // MSPA-style masthead: two corner mascots flanking the centered title.
    const header = h('header', { class: 'site-header' },
      h('div', { class: 'masthead container' },
        h('img', { class: 'masthead__mascot masthead__mascot--left', src: '/img/ui/mascot-left.png', alt: '', 'aria-hidden': 'true' }),
        h('div', { class: 'masthead__title-wrap' },
          h('h1', { class: 'site-title' }, 'Null and Void'),
          h('p', { class: 'site-tagline' }, 'a Legends of Willow webcomic')
        ),
        h('img', { class: 'masthead__mascot masthead__mascot--right', src: '/img/ui/mascot-right.png', alt: '', 'aria-hidden': 'true' })
      ),
      h('div', { class: 'masthead__rule' })
    );

    const underHeader = h('div', { class: 'under-header container' },
      h('a', {
        href: '/',
        onClick: (e) => { if (!navigateTo('/', e)) e.preventDefault(); }
      }, 'Home'),
      navSep(),
      h('a', {
        href: '/log',
        onClick: (e) => { if (!navigateTo('/log', e)) e.preventDefault(); }
      }, 'Log'),
      navSep(),
      h('a', {
        href: '/map',
        onClick: (e) => { if (!navigateTo('/map', e)) e.preventDefault(); }
      }, 'Map'),
      navSep(),
      h('a', {
        href: 'https://discord.gg/pp3NrFrZKh',
        target: '_blank',
        rel: 'noopener'
      }, 'Discord')
    );

    const lightModeToggle = h('div', { class: 'light-mode-toggle container' });

    const main = h('main', { class: 'container' });
    const panel = h('article', { class: panelClass });
    main.append(panel);

    return { header, underHeader, lightModeToggle, main, panel };
  }

  function renderHome() {
    app.innerHTML = '';
    applyLightMode();

    const { header, underHeader, lightModeToggle, main, panel } = renderChrome('panel home');

    panel.append(
      h('h2', { class: 'panel__title' }, 'Null and Void'),
      h('h3', { class: 'panel__subtitle' }, 'a Legends of Willow webcomic'),
      h('p', { class: 'disclaimer' },
        'This is a webcomic inspired by ',
        h('a', { href: 'https://www.homestuck.com', target: '_blank', rel: 'noopener' }, 'Homestuck'),
        ' by Andrew Hussie, even going as far as to borrow some concepts from it (though with different terminology), its writing style, and its structure. Other than structural things, I try my best to make my own story. Homestuck is an amazing work, and you all should go check it out if you haven\'t already.'
      ),
      h('p', { style: { textAlign: 'center', marginTop: '1rem' } },
        'Join the ',
        h('a', { href: 'https://discord.gg/pp3NrFrZKh', target: '_blank', rel: 'noopener' }, 'Discord'),
        ' for updates and interaction!'
      ),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-primary', onClick: (e) => navigateTo('/story/1', e) }, 'Read!'),
        h('p', { class: 'hash-fallback' },
          'No clean URLs? Use ',
          h('a', {
            href: '#/story/1',
            onClick: (e) => {
              if (e.ctrlKey || e.metaKey || e.button === 1) return;
              e.preventDefault();
              location.hash = '#/story/1';
              route();
            }
          }, '#/story/1')
        )
      )
    );

    app.append(header, underHeader, main, lightModeToggle);
    document.title = 'Null and Void';
  }

  async function fetchTxt(n) {
    const url = `/txt/${n}.txt`;
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Missing: ${url}`);
    const text = await res.text();
    return parseTxtFile(text);
  }

  // Resolve the next page's title by probing its .txt directly, returning null
  // when there's no next page. Probing — rather than consulting txt/index.json —
  // means a freshly-added page is picked up by the command link and arrow
  // navigation without having to regenerate the index first.
  async function fetchNextTitle(n) {
    try {
      const next = await fetchTxt(n + 1);
      return next.title || `Page ${n + 1}`;
    } catch {
      return null;
    }
  }

  let rosterCache = null;

  // Load the unified character roster (txt/roster.json) and build a lookup keyed by every identifier a speaker might be referenced by: the character name, their chat abbreviation, and their full handle (all upper-cased). This replaces the old chatterbox.txt + dialog.txt pair so chatlogs and dialog blocks pull their colors from the same file.
  async function fetchRoster() {
    if (rosterCache) return rosterCache;

    try {
      const res = await fetch('/txt/roster.json', { cache: 'no-cache' });
      if (!res.ok) {
        rosterCache = {};
        return rosterCache;
      }
      const data = await res.json();
      rosterCache = buildRosterLookup(data);
      return rosterCache;
    } catch {
      rosterCache = {};
      return {};
    }
  }

  let indexCache = null;

  // Load the page index
  async function fetchIndex() {
    if (indexCache) return indexCache;
    const res = await fetch('/txt/index.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Missing: /txt/index.json');
    const data = await res.json();
    indexCache = data.map(e => ({ num: e.num, title: e.title, date: e.date }));
    return indexCache;
  }

  async function renderContentAsHtml(text) {
    // Match any [TAG START] ... [TAG END] block. The tag is arbitrary: CHATLOG uses the chatlog formatting, anything else falls back to the dialog method. The tag also drives the collapse button label.
    const blockRegex = /\[([A-Z]+) START\]([\s\S]*?)\[\1 END\]/g;
    const frag = document.createDocumentFragment();

    // Both chatlog and dialog blocks pull colors from the same roster file.
    const hasBlocks = /\[[A-Z]+ START\]/.test(text);
    const hasHandles = /\[handle=/i.test(text);
    const roster = (hasBlocks || hasHandles) ? await fetchRoster() : {};

    let lastIndex = 0;
    let match;

    while ((match = blockRegex.exec(text)) !== null) {
      const blockTag = match[1];
      // Add text before block as regular paragraphs
      const beforeText = text.slice(lastIndex, match.index);
      if (beforeText.trim()) {
        const beforeLines = beforeText.split('\n');
        for (const line of beforeLines) {
          if (line.trim()) {
            frag.appendChild(h('p', {}, ...inlineNodes(line, roster)));
          }
        }
      }

      // Parse and render block (trim to remove leading/trailing empty lines)
      const logContent = match[2].trim();
      const elements = parseChatlog(logContent, roster);

      // CHATLOG gets the chatlog styling; any other tag uses the dialog method.
      const containerClass = blockTag === 'CHATLOG' ? 'chatlog' : 'dialog';
      const containerDiv = h('div', { class: containerClass });
      // Title-case the tag for the button label (CHATLOG -> Chatlog, POEM -> Poem).
      const tagLabel = blockTag.charAt(0) + blockTag.slice(1).toLowerCase();
      const hideLabel = `Hide ${tagLabel}`;
      const showLabel = `Show ${tagLabel}`;

      // Add collapse button at the top
      const collapseBtn = h('button', {
        class: `${containerClass}-collapse-btn`,
        onClick: (e) => {
          const content = e.target.nextElementSibling;
          const isCollapsed = content.style.display === 'none';
          content.style.display = isCollapsed ? 'block' : 'none';
          e.target.textContent = isCollapsed ? hideLabel : showLabel;
        }
      }, hideLabel);
      containerDiv.appendChild(collapseBtn);

      // Content wrapper
      const contentDiv = h('div', { class: `${containerClass}-content` });

      for (const elem of elements) {
        if (elem.type === 'blank') {
          // Add a blank line
          const blankLine = h('div', { class: 'chatlog-blank' }, '\u00A0');
          contentDiv.appendChild(blankLine);
        } else if (elem.type === 'header') {
          // Parse header text, coloring the whole "handle [ABBR]" token.
          const headerLine = h('div', { class: 'chatlog-header' });
          for (const seg of parseHeaderHandles(elem.text, elem.roster)) {
            if (seg.type === 'text') {
              headerLine.appendChild(document.createTextNode(seg.text));
            } else {
              headerLine.appendChild(h('span', {
                class: 'chatlog-handle-tag',
                'data-dark-color': seg.colors.dark,
                'data-light-color': seg.colors.light,
                style: { color: colorForMode(seg.colors) }
              }, seg.text));
            }
          }
          contentDiv.appendChild(headerLine);
        } else if (elem.type === 'dialogue') {
          const line = h('div', { class: 'chatlog-line' },
            h('span', {
              class: 'chatlog-handle',
              'data-dark-color': elem.colors.dark,
              'data-light-color': elem.colors.light,
              style: { color: colorForMode(elem.colors) }
            }, `${elem.handle}: `),
            h('span', {
              class: 'chatlog-text',
              'data-dark-color': elem.colors.dark,
              'data-light-color': elem.colors.light,
              style: { color: colorForMode(elem.colors) }
            }, elem.text)
          );
          contentDiv.appendChild(line);
        } else if (elem.type === 'text') {
          const textLine = h('div', { class: 'chatlog-header' }, elem.text);
          contentDiv.appendChild(textLine);
        }
      }

      containerDiv.appendChild(contentDiv);
      frag.appendChild(containerDiv);

      lastIndex = match.index + match[0].length;
    }

    // If no chatlog/dialog blocks found, render as simple paragraphs
    if (lastIndex === 0) {
      const parts = text.split('\n');
      for (const line of parts) {
        frag.appendChild(h('p', {}, ...inlineNodes(line, roster)));
      }
    } else {
      // Add remaining text after last chatlog
      const afterText = text.slice(lastIndex);
      if (afterText.trim()) {
        const afterLines = afterText.split('\n');
        for (const line of afterLines) {
          if (line.trim()) {
            frag.appendChild(h('p', {}, ...inlineNodes(line, roster)));
          }
        }
      }
    }

    return frag;
  }

  function imageElementFor(n) {
    const img = h('img', { alt: '', decoding: 'async', loading: 'eager' });
    const png = `/img/${n}.png`;
    const gif = `/img/${n}.gif`;
    img.src = png;
    img.onerror = function onErr() {
      if (img.src.endsWith('.png')) {
        img.onerror = null; // avoid loops
        img.src = gif;
      }
    };
    return img;
  }

  async function createRuffleSwfFrame(n) {
    const swfUrl = `/img/${n}.swf`;

    const frame = h('div', { class: 'media-frame media-frame--swf' });

    const loadingOverlay = h('div', { class: 'media-overlay', 'data-kind': 'loading' }, 'Loading...');
    frame.appendChild(loadingOverlay);

    const ruffle = window.RufflePlayer && window.RufflePlayer.newest ? window.RufflePlayer.newest() : null;
    if (!ruffle) {
      loadingOverlay.textContent = 'Flash player failed to load.';
      return frame;
    }

    const player = ruffle.createPlayer();
    frame.appendChild(player);

    // Ruffle's own "visible" unmute overlay handles the browser autoplay-with-
    // sound gesture requirement, so we don't render a custom one.
    player.config = {
      preloader: false,
      unmuteOverlay: "visible",
      autoplay: "on"
    };

    // Return the frame immediately so the caller can append it to the DOM,
    // THEN kick off the load. This ensures the player is connected before
    // Ruffle tries to initialize the WebGL/audio context.
    requestAnimationFrame(async () => {
      try {
        await player.load({ url: swfUrl });
        if (!frame.isConnected) return;
        loadingOverlay.style.display = 'none';
      } catch {
        if (frame.isConnected) loadingOverlay.textContent = 'SWF failed to load.';
      }
    });

    return frame;
  }

  async function swfExists(url) {
    // Prefer HEAD so we don't download the SWF twice (some hosts don't allow HEAD, so fallback to GET).
    try {
      const head = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
      if (head.ok) return true;
      if (head.status === 405 || head.status === 403) throw new Error('HEAD not allowed');
      return false;
    } catch {
      try {
        const get = await fetch(url, { method: 'GET', cache: 'no-cache' });
        return get.ok;
      } catch {
        return false;
      }
    }
  }

  async function mediaElementFor(n) {
    const png = `/img/${n}.png`;
    const gif = `/img/${n}.gif`;
    const swf = `/img/${n}.swf`;

    // Try PNG first
    try {
      const res = await fetch(png, { method: 'HEAD', cache: 'no-cache' });
      if (res.ok) {
        const img = h('img', { src: png, alt: '', decoding: 'async', loading: 'eager' });
        const host = h('div');
        host.appendChild(img);
        return host;
      }
    } catch { /* fall through */ }

    // Try GIF
    try {
      const res = await fetch(gif, { method: 'HEAD', cache: 'no-cache' });
      if (res.ok) {
        const img = h('img', { src: gif, alt: '', decoding: 'async', loading: 'eager' });
        const host = h('div');
        host.appendChild(img);
        return host;
      }
    } catch { /* fall through */ }

    // Try SWF — only NOW do we touch Ruffle
    try {
      const res = await fetch(swf, { method: 'HEAD', cache: 'no-cache' });
      if (res.ok) {
        return await createRuffleSwfFrame(n);
      }
    } catch { /* fall through */ }

    // Nothing found
    const host = h('div');
    host.appendChild(h('p', { class: 'loading' }, 'Missing image.'));
    return host;
  }

  async function renderPage(n) {
    const myToken = ++currentRenderToken;
    app.innerHTML = '';
    applyLightMode();

    const { header, underHeader, lightModeToggle, main, panel } = renderChrome('panel page');
    app.append(header, underHeader, main);

    // Loading state
    panel.append(h('p', { class: 'loading' }, 'Loading...'));

    try {
      const data = await fetchTxt(n);

      if (myToken !== currentRenderToken) return;

      panel.innerHTML = '';

      // Title
      const titleText = data.title || `Page ${n}`;
      panel.append(h('h2', { class: 'panel__title title' }, titleText));
      document.title = formatPageTitle(titleText);

      // Image (PNG/GIF) or SWF (Ruffle)
      const imgWrap = h('div', { class: 'image' });
      imgWrap.appendChild(await mediaElementFor(n));
      panel.append(imgWrap);

      // Text content
      const textWrap = h('div', { class: 'content' });
      const contentHtml = await renderContentAsHtml(data.content);
      textWrap.append(contentHtml);
      panel.append(textWrap);

      // Command link (big) placed right under the text. Probe the next page's
      // .txt directly to learn its title and existence, so a newly-added page
      // links up without first regenerating txt/index.json.
      const nextTitle = await fetchNextTitle(n);
      if (myToken === currentRenderToken && nextTitle != null) {
        const cmdLink = h('div', { class: 'command-link' },
          '> ',
          h('a', {
            href: `/story/${n + 1}`,
            onClick: (e) => { if (!navigateTo(`/story/${n + 1}`, e)) e.preventDefault(); }
          }, nextTitle)
        );
        panel.append(cmdLink);
      }

      // Navigation links and position controls
      const navContainer = h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' } });

      if (n > 1) {
        // Show Start Over and Go Back on the left
        const navLinks = h('p', { class: 'nav-links', style: { margin: '0', textAlign: 'left' } },
          h('a', {
            href: '/story/1',
            onClick: (e) => { if (!navigateTo('/story/1', e)) e.preventDefault(); }
          }, 'Start Over'),
          ' | ',
          h('a', {
            href: `/story/${n - 1}`,
            onClick: (e) => { if (!navigateTo(`/story/${n - 1}`, e)) e.preventDefault(); }
          }, 'Go Back')
        );
        navContainer.append(navLinks);
      } else {
        // Empty div for spacing when on page 1
        navContainer.append(h('div'));
      }

      // Position controls on the right (or left if page 1)
      const positionControls = h('p', { class: 'position-controls', style: { margin: '0', textAlign: n > 1 ? 'right' : 'left' } });

      // Gear / display-settings button
      let activeSettingsPanel = null;
      const settingsWrap = h('span', { class: 'settings-wrap' });
      const gearBtn = h('a', {
        href: '#',
        title: 'Display settings',
        class: 'settings-gear',
        onClick: (e) => {
          e.preventDefault();
          if (activeSettingsPanel) {
            activeSettingsPanel.remove();
            activeSettingsPanel = null;
          } else {
            const rect = gearBtn.getBoundingClientRect();
            activeSettingsPanel = buildSettingsPanel();
            Object.assign(activeSettingsPanel.style, {
              position: 'fixed',
              right:  `${document.documentElement.clientWidth - rect.right}px`,
              bottom: `${window.innerHeight - rect.top + 8}px`,
              top:    'auto',
              transform: 'none',
            });
            document.body.appendChild(activeSettingsPanel);
            const closeOnOutside = (ev) => {
              if (!gearBtn.contains(ev.target) && !activeSettingsPanel?.contains(ev.target)) {
                activeSettingsPanel?.remove();
                activeSettingsPanel = null;
                document.removeEventListener('click', closeOnOutside);
              }
            };
            setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
          }
        }
      }, '⚙️');
      settingsWrap.appendChild(gearBtn);

      positionControls.append(
        settingsWrap,
        ' | ',
        h('a', {
          href: '#',
          onClick: (e) => {
            e.preventDefault();
            setToStorage(STORAGE_KEYS.SAVED_POSITION, String(n));
            showTooltip(e.currentTarget, 'Saved!');
          }
        }, 'Save Position'),
        ' | ',
        h('a', {
          href: '#',
          onClick: (e) => {
            e.preventDefault();
            const saved = getFromStorage(STORAGE_KEYS.SAVED_POSITION, null);
            if (saved) {
              navigateTo(`/story/${saved}`, e);
            }
          }
        }, 'Load Position')
      );
      navContainer.append(positionControls);

      panel.append(navContainer);

    } catch (err) {
      if (myToken !== currentRenderToken) return;
      panel.innerHTML = '';
      document.title = 'Not found - Null and Void';
      panel.append(
        h('h2', { class: 'panel__title' }, 'Not found'),
        h('p', {}, `Could not load page ${n}.`),
        h('a', {
          class: 'btn',
          href: '/',
          onClick: (e) => { if (!navigateTo('/', e)) e.preventDefault(); }
        }, 'Back to home')
      );
    }

    if (myToken !== currentRenderToken) return;
    app.append(lightModeToggle);
  }

  // Discover all available pages
  async function discoverAllPages() {
    const pages = [];
    let n = 1;
    while (true) {
      try {
        const data = await fetchTxt(n);
        pages.push({ num: n, title: data.title, date: data.date });
        n++;
      } catch {
        break;
      }
    }
    return pages;
  }

  async function renderLog() {
    app.innerHTML = '';
    applyLightMode();

    const { header, underHeader, lightModeToggle, main, panel } = renderChrome('panel log');
    app.append(header, underHeader, main);

    panel.append(h('h2', { class: 'panel__title' }, 'Log'));
    panel.append(h('p', { class: 'loading' }, 'Loading pages...'));

    document.title = 'Log - Null and Void';

    try {
      // Prefer the pre-built index; fall back to probing pages one by one.
      let pages;
      try {
        pages = await fetchIndex();
      } catch {
        pages = await discoverAllPages();
      }
      panel.innerHTML = '';
      panel.append(h('h2', { class: 'panel__title' }, 'Log'));

      // State for sorting and date format
      let sortNewest = true;
      let dateFormat = getFromStorage(STORAGE_KEYS.DATE_FORMAT, 'MM-DD-YYYY');

      const controls = h('div', { style: { marginBottom: '20px', textAlign: 'center' } });
      const sortBtn = h('button', { class: 'btn', style: { marginRight: '10px' } }, 'Sort: Newest First');
      const formatSelect = h('select', { class: 'date-format-select' },
        h('option', { value: 'MM-DD-YYYY' }, 'MM/DD/YYYY'),
        h('option', { value: 'DD-MM-YYYY' }, 'DD/MM/YYYY'),
        h('option', { value: 'YYYY-MM-DD' }, 'YYYY/MM/DD')
      );
      formatSelect.value = dateFormat;

      controls.append(sortBtn, ' Date format: ', formatSelect);
      panel.append(controls);

      const logList = h('div', { class: 'log-list', style: { textAlign: 'left', maxWidth: '700px', margin: '0 auto' } });
      panel.append(logList);

      const renderList = () => {
        const sorted = [...pages].sort((a, b) => {
          return sortNewest ? b.num - a.num : a.num - b.num;
        });

        logList.innerHTML = '';
        for (const page of sorted) {
          const dateStr = page.date ? formatDate(page.date, dateFormat) : 'No date';
          const entry = h('p', { style: { margin: '8px 0' } },
            dateStr,
            ' - ',
            h('a', {
              href: `/story/${page.num}`,
              onClick: (e) => { if (!navigateTo(`/story/${page.num}`, e)) e.preventDefault(); }
            }, `"${page.title || `Page ${page.num}`}"`)
          );
          logList.append(entry);
        }
      };

      sortBtn.addEventListener('click', () => {
        sortNewest = !sortNewest;
        sortBtn.textContent = sortNewest ? 'Sort: Newest First' : 'Sort: Oldest First';
        renderList();
      });

      formatSelect.addEventListener('change', (e) => {
        dateFormat = e.target.value;
        setToStorage(STORAGE_KEYS.DATE_FORMAT, dateFormat);
        renderList();
      });

      renderList();

    } catch (err) {
      panel.innerHTML = '';
      panel.append(
        h('h2', { class: 'panel__title' }, 'Log'),
        h('p', {}, 'Failed to load pages.')
      );
    }

    app.append(lightModeToggle);
  }

  async function renderMap() {
    app.innerHTML = '';
    applyLightMode();

    const { header, underHeader, lightModeToggle, main, panel } = renderChrome('panel');
    app.append(header, underHeader, main);

    panel.append(
      h('h2', { class: 'panel__title' }, 'Map'),
      h('p', { style: { textAlign: 'center', fontSize: '24px', marginTop: '40px' } }, 'TBD')
      //   h('a', {href: '/1'}, h('img', {src: '/img/map/act1.png'}))
    );

    app.append(lightModeToggle);

    document.title = 'Map - Null and Void';
  }

  function route() {
    let path = location.pathname.replace(/\/+$/, '');
    const hash = location.hash;

    // Canonicalize the legacy bare /<number> (or #/<number>) URL to the clean
    // /story/<number> form in place, so there's a single canonical URL per page.
    // replaceState (not push) keeps the back button from bouncing between forms.
    const legacyNumber = path.match(/^\/(\d+)$/) || hash.match(/^#\/(\d+)$/);
    if (legacyNumber) {
      path = `/story/${legacyNumber[1]}`;
      history.replaceState({ path }, '', path);
    }

    // Check for hash-based routes as fallback
    if (path === '/log' || hash === '#/log') {
      renderLog();
    } else if (path === '/map' || hash === '#/map') {
      renderMap();
    } else {
      const n = getRequestedPageNumber();
      if (n == null) {
        renderHome();
      } else {
        renderPage(n);
      }
    }
  }

  applyDisplaySettings();

  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', route);

  // Add keydown event listener for arrow navigation
  window.addEventListener('keydown', (event) => {
    const currentPage = getRequestedPageNumber();
    if (!currentPage) {
      if (event.key === 'ArrowRight') navigateTo('/story/1');
      return;
    }

    if (event.key === 'ArrowRight') {
      // Probe the next page directly so newly-added pages are navigable without
      // regenerating the index.
      fetchNextTitle(currentPage).then((title) => {
        if (title != null) navigateTo(`/story/${currentPage + 1}`);
      });
    } else if (event.key === 'ArrowLeft') {
      if (currentPage > 1) navigateTo(`/story/${currentPage - 1}`);
      else navigateTo('/');
    }
  });

  function buildSettingsPanel() {
    const stepperUpdaters = [];

    const groups = DISPLAY_SETTINGS.map(s => {
      const stored = parseFloat(getFromStorage(s.key, null));
      let val = isNaN(stored) ? s.default : Math.min(s.max, Math.max(s.min, stored));

      const display  = h('span', { class: 'settings-stepper__val' }, s.format(val));
      const minusBtn = h('button', { class: 'settings-stepper__btn' }, '−');
      const plusBtn  = h('button', { class: 'settings-stepper__btn' }, '+');

      const update = (newVal) => {
        val = parseFloat(Math.min(s.max, Math.max(s.min, newVal)).toFixed(s.decimals));
        display.textContent = s.format(val);
        setToStorage(s.key, String(val));
        document.documentElement.style.setProperty(s.cssVar, s.toCss(val));
        s.extra?.(val);
        minusBtn.disabled = val <= s.min;
        plusBtn.disabled  = val >= s.max;
      };

      minusBtn.addEventListener('click', () => update(val - s.step));
      plusBtn.addEventListener('click',  () => update(val + s.step));
      minusBtn.disabled = val <= s.min;
      plusBtn.disabled  = val >= s.max;

      stepperUpdaters.push(() => update(s.default));

      return h('div', { class: 'settings-panel__group' },
        h('span', { class: 'settings-panel__label' }, s.label),
        h('div', { class: 'settings-stepper' }, minusBtn, display, plusBtn)
      );
    });

    const resetBtn = h('button', {
      class: 'settings-reset-btn',
      onClick: () => stepperUpdaters.forEach(fn => fn()),
    }, 'Reset');

    const modeLabel = () => document.body.classList.contains('light-mode') ? 'Dark Mode' : 'Light Mode';
    const modeBtn = h('button', {
      class: 'settings-mode-btn',
      onClick: () => {
        toggleLightMode(null);
        modeBtn.textContent = modeLabel();
      }
    }, modeLabel());

    return h('div', { class: 'settings-panel' }, ...groups,
      h('div', { class: 'settings-bottom-btns' }, modeBtn, resetBtn)
    );
  }

  // Show a transient tooltip above an element (used by the Save Position link
  // to confirm the save).
  function showTooltip(element, message) {
    const tooltip = h('div', {
      class: 'tooltip',
      style: {
        position: 'absolute',
        backgroundColor: '#000',
        color: '#fff',
        padding: '5px 10px',
        borderRadius: '5px',
        top: '-30px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        pointerEvents: 'none',
        opacity: 0,
        transition: 'opacity 0.3s ease'
      }
    }, message);

    element.style.position = 'relative';
    element.appendChild(tooltip);

    // Fade in and remove tooltip after a delay
    setTimeout(() => (tooltip.style.opacity = 1), 0);
    setTimeout(() => tooltip.remove(), 1500);
  }
})();
