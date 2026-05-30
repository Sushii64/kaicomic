// Pure, side-effect-free helpers shared by the browser app (js/app.js) and the
// deploy script (deploy.js). Keeping them here makes them unit-testable with
// `node --test` without a DOM or a bundler. Nothing in this file may touch
// `document`, `location`, `fetch`, `fs`, or `process`, as those
// will have to stay in the callers.

export const SITE_TITLE = 'Null and Void';

// Build the document.title for a story page: "<page title> - <site>", falling
// back to the bare site name when the page has no title (or its title already
// is the site name, to avoid "Null and Void - Null and Void").
export function formatPageTitle(pageTitle) {
  const trimmed = (pageTitle || '').trim();
  if (!trimmed || trimmed === SITE_TITLE) return SITE_TITLE;
  return `${trimmed} - ${SITE_TITLE}`;
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
