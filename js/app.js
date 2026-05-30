import {
  parseTxtFile,
  buildRosterLookup,
  colorsFor,
  parseChatlog,
  formatDate,
  parsePageNumber,
  formatPageTitle,
  nextPageEntry,
} from './lib.mjs';

(function () {
  const app = document.getElementById('app');

  let currentRenderToken = 0;

  // LocalStorage utilities
  const STORAGE_KEYS = {
    DATE_FORMAT: 'nav-date-format',
    LIGHT_MODE: 'nav-light-mode',
    SAVED_POSITION: 'nav-saved-position'
  };

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

  function applyLightMode() {
    const isLight = getFromStorage(STORAGE_KEYS.LIGHT_MODE, 'false') === 'true';
    if (isLight) {
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
    }
  }

  function applyChatlogColors() {
    const isLight = document.body.classList.contains('light-mode');

    // Apply colors to all chatlog elements
    document.querySelectorAll('.chatlog-handle, .chatlog-text, .chatlog-handle-tag').forEach(el => {
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
  function renderChrome(panelClass = 'panel') {
    const header = h('header', { class: 'site-header' },
      h('div', { class: 'container' },
        h('h1', { class: 'site-title' }, 'Null and Void')
      )
    );

    const underHeader = h('div', { class: 'under-header container' },
      h('a', {
        href: '/',
        onClick: (e) => { if (!navigateTo('/', e)) e.preventDefault(); }
      }, 'Home'),
      ' | ',
      h('a', {
        href: '/log',
        onClick: (e) => { if (!navigateTo('/log', e)) e.preventDefault(); }
      }, 'Log'),
      ' | ',
      h('a', {
        href: '/map',
        onClick: (e) => { if (!navigateTo('/map', e)) e.preventDefault(); }
      }, 'Map')
    );

    const lightModeLink = h('a', {
      href: '#',
      onClick: (e) => {
        e.preventDefault();
        toggleLightMode(lightModeLink);
      }
    }, document.body.classList.contains('light-mode') ? 'Dark Mode' : 'Light Mode');

    const discordLink = h('a', {
      href: 'https://discord.gg/pp3NrFrZKh',
      target: '_blank',
      rel: 'noopener'
    }, 'Discord');

    const lightModeToggle = h('div', { class: 'light-mode-toggle container' }, lightModeLink, ' | ', discordLink);

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

  // Index accessor that never throws: returns null when the index is
  // unavailable so callers can fall back to probing pages directly.
  async function getIndexSafe() {
    try {
      return await fetchIndex();
    } catch {
      return null;
    }
  }

  async function renderContentAsHtml(text) {
    // Match any [TAG START] ... [TAG END] block. The tag is arbitrary: CHATLOG uses the chatlog formatting, anything else falls back to the dialog method. The tag also drives the collapse button label.
    const blockRegex = /\[([A-Z]+) START\]([\s\S]*?)\[\1 END\]/g;
    const frag = document.createDocumentFragment();

    // Both chatlog and dialog blocks pull colors from the same roster file.
    const hasBlocks = /\[[A-Z]+ START\]/.test(text);
    const roster = hasBlocks ? await fetchRoster() : {};

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
            frag.appendChild(h('p', {}, line));
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
          // Parse header text and color [HANDLE] tags
          const headerLine = h('div', { class: 'chatlog-header' });
          const headerText = elem.text;
          const handleRegex = /\[([A-Z]+)\]/g;
          let lastIndex = 0;
          let handleMatch;

          while ((handleMatch = handleRegex.exec(headerText)) !== null) {
            // Add text before the handle
            if (handleMatch.index > lastIndex) {
              headerLine.appendChild(document.createTextNode(headerText.slice(lastIndex, handleMatch.index)));
            }

            // Add colored handle with brackets
            const handle = handleMatch[1];
            const colors = colorsFor(elem.roster, handle);
            const handleSpan = h('span', {
              class: 'chatlog-handle-tag',
              'data-dark-color': colors.dark,
              'data-light-color': colors.light
            }, `[${handle}]`);
            headerLine.appendChild(handleSpan);

            lastIndex = handleMatch.index + handleMatch[0].length;
          }

          // Add remaining text
          if (lastIndex < headerText.length) {
            headerLine.appendChild(document.createTextNode(headerText.slice(lastIndex)));
          }

          contentDiv.appendChild(headerLine);
        } else if (elem.type === 'dialogue') {
          const line = h('div', { class: 'chatlog-line' },
            h('span', {
              class: 'chatlog-handle',
              'data-dark-color': elem.colors.dark,
              'data-light-color': elem.colors.light
            }, `${elem.handle}: `),
            h('span', {
              class: 'chatlog-text',
              'data-dark-color': elem.colors.dark,
              'data-light-color': elem.colors.light
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
        frag.appendChild(h('p', {}, line));
      }
    } else {
      // Add remaining text after last chatlog
      const afterText = text.slice(lastIndex);
      if (afterText.trim()) {
        const afterLines = afterText.split('\n');
        for (const line of afterLines) {
          if (line.trim()) {
            frag.appendChild(h('p', {}, line));
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

    const unmuteOverlay = h(
        'div',
        { class: 'media-overlay', 'data-kind': 'unmute', style: { display: 'none' } },
        h('div', {},
            h('div', { style: { marginBottom: '12px' } }, 'Click to unmute'),
            h('button', { type: 'button' }, 'Start')
        )
    );
    frame.appendChild(unmuteOverlay);

    const ruffle = window.RufflePlayer && window.RufflePlayer.newest ? window.RufflePlayer.newest() : null;
    if (!ruffle) {
      loadingOverlay.textContent = 'Flash player failed to load.';
      return frame;
    }

    const player = ruffle.createPlayer();
    frame.appendChild(player);

    player.config = {
      preloader: false,
      unmuteOverlay: "visible",
      autoplay: "on"
    };

    // const startBtn = unmuteOverlay.querySelector('button');
    // startBtn.addEventListener('click', async () => {
    //   unmuteOverlay.style.display = 'none';
    //   try {
    //     if ('muted' in player) player.muted = false;
    //     if ('volume' in player) player.volume = 1;
    //     if (typeof player.play === 'function') await player.play();
    //   } catch { /* ignore */ }
    // });
    //
    // unmuteOverlay.addEventListener('click', (e) => {
    //   if (e.target === unmuteOverlay) startBtn.click();
    // });

    // Return the frame immediately so the caller can append it to the DOM,
    // THEN kick off the load. This ensures the player is connected before
    // Ruffle tries to initialize the WebGL/audio context.
    requestAnimationFrame(async () => {
      try {
        await player.load({ url: swfUrl });
        if (!frame.isConnected) return;
        loadingOverlay.style.display = 'none';
        unmuteOverlay.style.display = 'grid';
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

      // Apply chatlog colors after rendering
      setTimeout(() => applyChatlogColors(), 0);

      // Command link (big) placed right under the text. Use the pre-built
      // index to learn the next page's title and existence; only probe the
      // page directly (legacy behavior) if the index can't be loaded.
      let nextTitle = null;
      const index = await getIndexSafe();
      if (index) {
        const entry = nextPageEntry(index, n);
        if (entry) nextTitle = entry.title || `Page ${n + 1}`;
      } else {
        try {
          const next = await fetchTxt(n + 1);
          nextTitle = next.title || `Page ${n + 1}`;
        } catch (_) {
          // No next page
        }
      }
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
      const positionControls = h('p', { class: 'position-controls', style: { margin: '0', textAlign: n > 1 ? 'right' : 'left' } },
        h('a', {
          href: '#',
          onClick: (e) => {
            e.preventDefault();
            setToStorage(STORAGE_KEYS.SAVED_POSITION, String(n));
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

    const { header, underHeader, lightModeToggle, main, panel } = renderChrome('panel');
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
    const path = location.pathname.replace(/\/+$/, '');
    const hash = location.hash;

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

  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', route);

  // Add keydown event listener for arrow navigation
  window.addEventListener('keydown', (event) => {
    const currentPage = getRequestedPageNumber();
    if (!currentPage) return;

    if (event.key === 'ArrowRight') {
      // Consult the (cached) index for the next page instead of fetching it.
      getIndexSafe().then((index) => {
        if (index) {
          if (nextPageEntry(index, currentPage)) navigateTo(`/story/${currentPage + 1}`);
        } else {
          // No index, so fall back to probing the page directly.
          fetchTxt(currentPage + 1)
            .then(() => navigateTo(`/story/${currentPage + 1}`))
            .catch(() => {});
        }
      });
    } else if (event.key === 'ArrowLeft' && currentPage > 1) {
      navigateTo(`/story/${currentPage - 1}`);
    }
  });

  // Enhance Save Position button with a tooltip
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
    setTimeout(() => element.removeChild(tooltip), 1500);
  }

  document.addEventListener('click', (event) => {
    if (event.target.textContent === 'Save Position') {
      showTooltip(event.target, 'Saved!');
    }
  });
})();
