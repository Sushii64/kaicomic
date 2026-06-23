// Pure, side-effect-free helpers shared by the browser app (js/app.js) and the
// deploy script (deploy.js). Keeping them here makes them unit-testable with
// `node --test` without a DOM or a bundler. Nothing in this file may touch
// `document`, `location`, `fetch`, `fs`, or `process`, as those
// will have to stay in the callers.

export const SITE_TITLE = 'Null and Void';

// Tagline used in og:/twitter: descriptions. The site root keeps the bare
// tagline (see index.html); story pages prefix the site name so a shared link
// reads "Null and Void - A Legends of Willow webcomic" under the page title.
export const SITE_TAGLINE = 'A Legends of Willow webcomic';

// Canonical public origin (no trailing slash). Used to build absolute og:url /
// og:image URLs, which crawlers like Discord require. deploy.js may override
// this from the SITE_URL env var.
export const SITE_URL = 'https://null.pixspla.net';

// Build the document.title for a story page: "<page title> - <site>", falling
// back to the bare site name when the page has no title (or its title already
// is the site name, to avoid "Null and Void - Null and Void").
export function formatPageTitle(pageTitle) {
  const trimmed = (pageTitle || '').trim();
  if (!trimmed || trimmed === SITE_TITLE) return SITE_TITLE;
  return `${trimmed} - ${SITE_TITLE}`;
}

// The og:/twitter: description for a story page: "Null and Void - A Legends of
// Willow webcomic".
export function storyOgDescription() {
  return `${SITE_TITLE} - ${SITE_TAGLINE}`;
}

// Escape a string for safe interpolation into an HTML attribute value.
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Produce a per-page copy of the base index.html with Open Graph / Twitter
// meta tags filled in for one story page, so link unfurlers (Discord, etc.)
// that don't run JS still see the page's real title and image. The returned
// HTML still boots the SPA normally for real browsers.
//
//   templateHtml  contents of the built index.html
//   page          { num, title } for the story page
//   opts.siteUrl  public origin override (defaults to SITE_URL)
//   opts.hasImage whether /img/<num>.png exists; gates the image tags
//
// Replaces everything from the "<!-- Open Graph -->" marker up to the
// stylesheet <link>, plus the <title>. Throws if the marker is absent so a
// template change can't silently produce pages with stale/default tags.
export function injectStoryMeta(templateHtml, page, opts = {}) {
  const siteUrl = (opts.siteUrl || SITE_URL).replace(/\/+$/, '');
  const num = page.num;
  const title = escapeHtml((page.title || '').trim() || SITE_TITLE);
  const desc = escapeHtml(storyOgDescription());
  const pageUrl = escapeHtml(`${siteUrl}/story/${num}`);
  const imageUrl = escapeHtml(`${siteUrl}/img/${num}.png`);

  const imageTags = opts.hasImage
    ? `  <meta property="og:image" content="${imageUrl}">\n`
    : '';
  const twitterImage = opts.hasImage
    ? `  <meta name="twitter:image" content="${imageUrl}">\n`
    : '';
  const twitterCard = opts.hasImage ? 'summary_large_image' : 'summary';

  const block =
    `<!-- Open Graph -->\n` +
    `  <meta property="og:title" content="${title}">\n` +
    `  <meta property="og:description" content="${desc}">\n` +
    `  <meta property="og:type" content="article">\n` +
    `  <meta property="og:url" content="${pageUrl}">\n` +
    imageTags +
    `\n` +
    `  <!-- Twitter Card -->\n` +
    `  <meta name="twitter:card" content="${twitterCard}">\n` +
    `  <meta name="twitter:title" content="${title}">\n` +
    `  <meta name="twitter:description" content="${desc}">\n` +
    twitterImage +
    `\n  `;

  const re = /<!-- Open Graph -->[\s\S]*?(?=<link rel="stylesheet")/;
  if (!re.test(templateHtml)) {
    throw new Error('injectStoryMeta: could not find the Open Graph meta block in the template');
  }
  let html = templateHtml.replace(re, block);
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(formatPageTitle(page.title))}</title>`);
  return html;
}

// Default colors used when a speaker isn't found in the roster.
export const DEFAULT_COLORS = { dark: '#d0d0d0', light: '#2a2a2a' };

// Parse a comic page .txt file into { title, date, content }.
//   Line 1:            title
//   Line 2 (optional): date as MM-DD-YYYY, before the ------ separator
//   ------             separator
//   ...                content
export function parseTxtFile(text) {
  const norm = text.replace(/\r\n/g, '\n');
  const lines = norm.split('\n');
  const sepIndex = lines.findIndex(l => l.trim() === '------');
  const title = (lines[0] || '').trim();

  // Check if second line is a date (MM-DD-YYYY format)
  let date = null;
  let contentStartLine = 1;
  if (sepIndex > 1) {
    const secondLine = lines[1].trim();
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(secondLine)) {
      date = secondLine;
      contentStartLine = 2;
    }
  }

  const content = sepIndex >= 0
    ? lines.slice(sepIndex + 1).join('\n').trim()
    : lines.slice(contentStartLine).join('\n').trim();
  return { title, date, content };
}

// Lighter-weight metadata parse used by the deploy-time index generator:
// returns just { title, date } and does not require the ------ separator.
export function parseTxtMeta(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const title = (lines[0] || '').trim();
  let date = null;
  if (lines.length > 1) {
    const second = lines[1].trim();
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(second)) date = second;
  }
  return { title, date };
}

// Build a color lookup keyed by every identifier a speaker might be referenced
// by (character name, chat abbreviation, full handle), all upper-cased.
export function buildRosterLookup(data) {
  const lookup = {};
  for (const [name, info] of Object.entries(data || {})) {
    const colors = { dark: info.dark || DEFAULT_COLORS.dark, light: info.light || info.dark || DEFAULT_COLORS.light };
    for (const id of [name, info.abbr, info.handle]) {
      if (id) lookup[id.toUpperCase()] = colors;
    }
  }
  return lookup;
}

export function colorsFor(roster, id) {
  return (id && roster[id.toUpperCase()]) || DEFAULT_COLORS;
}

// Parse a pesterlog/dialog block into a flat list of typed elements.
export function parseChatlog(chatlogText, roster) {
  const lines = chatlogText.split('\n');
  const elements = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Empty lines are preserved as blank lines.
    if (!trimmed) {
      elements.push({ type: 'blank' });
      continue;
    }

    // Header/footer lines (-- text --).
    if (trimmed.startsWith('--') && trimmed.endsWith('--')) {
      elements.push({ type: 'header', text: trimmed, roster: roster });
      continue;
    }

    // Dialogue line: HANDLE: text
    const dialogueMatch = trimmed.match(/^([A-Z]+):\s*(.*)$/);
    if (dialogueMatch) {
      const [, handle, text] = dialogueMatch;
      elements.push({ type: 'dialogue', handle: handle, text: text, colors: colorsFor(roster, handle) });
      continue;
    }

    // Plain text line.
    elements.push({ type: 'text', text: trimmed });
  }

  return elements;
}

// Split a line of prose into inline segments, pulling out [handle=ID]label[/handle]
// spans. ID is matched against the roster (case-insensitive, by name/abbr/handle)
// for its color; label is the text shown, rendered colored + monospace. Returns a
// flat list of { type: 'text', text } and { type: 'handle', id, text, colors }.
// Lines without any handle tag come back as a single 'text' segment.
const INLINE_HANDLE_RE = /\[handle=([^\]]+)\]([\s\S]*?)\[\/handle\]/gi;
export function parseInlineHandles(text, roster = {}) {
  const segments = [];
  let last = 0;
  let m;
  INLINE_HANDLE_RE.lastIndex = 0;
  while ((m = INLINE_HANDLE_RE.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'text', text: text.slice(last, m.index) });
    const id = m[1].trim();
    segments.push({ type: 'handle', id, text: m[2], colors: colorsFor(roster, id) });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  return segments;
}

// Split a chatlog header line (e.g. "-- cyanusViator [CV] began pestering --")
// into colored handle tokens and plain text, like Homestuck pesterlogs
const HEADER_HANDLE_RE = /(?:(\S+)\s+)?\[([A-Z]+)\]/g;
export function parseHeaderHandles(text, roster = {}) {
  const segments = [];
  let last = 0;
  let m;
  HEADER_HANDLE_RE.lastIndex = 0;
  while ((m = HEADER_HANDLE_RE.exec(text)) !== null) {
    const precedingWord = m[1];
    const abbr = m[2];
    const matchStart = m.index;
    const matchEnd = m.index + m[0].length;
    const abbrColors = colorsFor(roster, abbr);
    const wordColors = precedingWord ? colorsFor(roster, precedingWord) : null;
    const absorb = !!wordColors
      && wordColors.dark === abbrColors.dark && wordColors.light === abbrColors.light;

    if (matchStart > last) segments.push({ type: 'text', text: text.slice(last, matchStart) });

    if (absorb) {
      // Color the whole "handle [ABBR]" token.
      segments.push({ type: 'handle', text: text.slice(matchStart, matchEnd), colors: abbrColors });
    } else {
      // Leave any preceding word as plain text; color only the bracket.
      const bracketStart = matchEnd - `[${abbr}]`.length;
      if (bracketStart > matchStart) {
        segments.push({ type: 'text', text: text.slice(matchStart, bracketStart) });
      }
      segments.push({ type: 'handle', text: `[${abbr}]`, colors: abbrColors });
    }
    last = matchEnd;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  return segments;
}

// Reformat a stored MM-DD-YYYY date string into the user's chosen display format.
export function formatDate(dateStr, format) {
  if (!dateStr) return '';
  const [month, day, year] = dateStr.split('-');
  switch (format) {
    case 'MM-DD-YYYY': return `${month}/${day}/${year}`;
    case 'DD-MM-YYYY': return `${day}/${month}/${year}`;
    case 'YYYY-MM-DD': return `${year}/${month}/${day}`;
    default: return `${month}/${day}/${year}`;
  }
}

// Parse a stored MM-DD-YYYY date string into a Date.
export function parseDate(dateStr) {
  const [month, day, year] = dateStr.split('-').map(s => parseInt(s, 10));
  return new Date(year, month - 1, day);
}

// Resolve the requested page number from a URL. Prefers the pathname
// (/story/1 or legacy /1); falls back to a #/... hash route. The page number
// is the last numeric path segment. Returns null when none is present.
export function parsePageNumber(pathname, hash) {
  const fromPath = (pathname || '').split('/').filter(Boolean).pop();
  if (fromPath && /^\d+$/.test(fromPath)) return parseInt(fromPath, 10);

  if (hash && hash.startsWith('#/')) {
    const fromHash = hash.slice(2).split('/').filter(Boolean).pop();
    if (fromHash && /^\d+$/.test(fromHash)) return parseInt(fromHash, 10);
  }
  return null;
}

// Look up a page index entry ([{ num, title, date }, ...]) by page number.
// Returns the matching entry or null. Lets callers use the pre-built
// txt/index.json instead of re-fetching a page's .txt just to learn its
// title or whether it exists.
export function findPageEntry(index, n) {
  if (!index) return null;
  return index.find(e => e.num === n) || null;
}

// The entry for the page after n, or null when n is the last page (or n+1 is
// missing from the index).
export function nextPageEntry(index, n) {
  return findPageEntry(index, n + 1);
}

// Normalize a path to forward slashes so local (possibly Windows) paths and
// remote (always posix) paths can be compared and used as map keys.
export function toPosixPath(p) {
  return p.replace(/\\/g, '/');
}

// Decide which local files need uploading by comparing against a remote
// snapshot. Both sides are keyed by *relative posix path* (never basename, so
// files that share a name in different folders don't collide).
//   localEntries:     [{ path, size }, ...]  (paths already posix-normalized)
//   remoteSizeByPath: Map<relativePosixPath, size>
// Returns { modifiedFiles, summary: { newCount, modifiedCount, unchangedCount } }.
// Comparison is by size only: that's all FTP exposes cheaply, so a same-size
// edit won't be detected here — the manifest-based path (which hashes) covers
// that case once a manifest exists.
export function computeModifiedFiles(localEntries, remoteSizeByPath) {
  const modifiedFiles = [];
  let newCount = 0, modifiedCount = 0, unchangedCount = 0;

  for (const { path: relPath, size } of localEntries) {
    const remoteSize = remoteSizeByPath.get(relPath);
    if (remoteSize === undefined) {
      modifiedFiles.push(relPath);
      newCount++;
    } else if (remoteSize !== size) {
      modifiedFiles.push(relPath);
      modifiedCount++;
    } else {
      unchangedCount++;
    }
  }

  return { modifiedFiles, summary: { newCount, modifiedCount, unchangedCount } };
}

// Interpret an environment-variable-style truthy string.
export function boolFromEnv(value, def = false) {
  if (value == null) return def;
  const v = String(value).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
