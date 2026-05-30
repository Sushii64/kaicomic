// Unit tests for the pure helpers in js/lib.mjs.
// Run with: npm test   (which runs `node --test`)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_COLORS,
  parseTxtFile,
  parseTxtMeta,
  buildRosterLookup,
  colorsFor,
  parseChatlog,
  parseInlineHandles,
  formatDate,
  parseDate,
  parsePageNumber,
  boolFromEnv,
  formatPageTitle,
  SITE_TITLE,
  findPageEntry,
  nextPageEntry,
  toPosixPath,
  computeModifiedFiles,
} from '../js/lib.mjs';

// ─── formatPageTitle ─────────────────────────────────────────────────────────

test('formatPageTitle: prefixes the page title before the site name', () => {
  assert.equal(formatPageTitle('Lab Partner: Remember who you are.'),
    'Lab Partner: Remember who you are. - ' + SITE_TITLE);
});

test('formatPageTitle: blank/missing page title falls back to the site name alone', () => {
  assert.equal(formatPageTitle(''), SITE_TITLE);
  assert.equal(formatPageTitle('   '), SITE_TITLE);
  assert.equal(formatPageTitle(null), SITE_TITLE);
  assert.equal(formatPageTitle(undefined), SITE_TITLE);
});

test('formatPageTitle: trims surrounding whitespace on the page title', () => {
  assert.equal(formatPageTitle('  ACT 2  '), 'ACT 2 - ' + SITE_TITLE);
});

test('formatPageTitle: does not double up when the title already is the site name', () => {
  // Page 1's title in txt/1.txt is literally "Null and Void" (the site name);
  // showing "Null and Void - Null and Void" would be silly.
  assert.equal(formatPageTitle(SITE_TITLE), SITE_TITLE);
});

// ─── findPageEntry / nextPageEntry ───────────────────────────────────────────

const INDEX = [
  { num: 1, title: 'Null and Void', date: '11-10-2025' },
  { num: 2, title: 'A new day', date: '11-11-2025' },
  { num: 3, title: 'ACT 2', date: '04-05-2026' },
];

test('findPageEntry: returns the entry whose num matches', () => {
  assert.deepEqual(findPageEntry(INDEX, 2), { num: 2, title: 'A new day', date: '11-11-2025' });
});

test('findPageEntry: returns null when the number is absent', () => {
  assert.equal(findPageEntry(INDEX, 99), null);
});

test('findPageEntry: tolerates null/empty index', () => {
  assert.equal(findPageEntry(null, 1), null);
  assert.equal(findPageEntry([], 1), null);
});

test('nextPageEntry: returns the entry for n+1', () => {
  assert.deepEqual(nextPageEntry(INDEX, 1), { num: 2, title: 'A new day', date: '11-11-2025' });
});

test('nextPageEntry: returns null when n is the last page', () => {
  assert.equal(nextPageEntry(INDEX, 3), null);
});

test('nextPageEntry: returns null for a gap in numbering', () => {
  // index missing num 2 → page 1 has no immediate next
  const gapped = [{ num: 1, title: 'a' }, { num: 3, title: 'c' }];
  assert.equal(nextPageEntry(gapped, 1), null);
});

// ─── toPosixPath ─────────────────────────────────────────────────────────────

test('toPosixPath: converts backslashes to forward slashes; posix unchanged', () => {
  assert.equal(toPosixPath('css/style.css'), 'css/style.css');
  assert.equal(toPosixPath('img\\act1\\1.png'), 'img/act1/1.png');
  assert.equal(toPosixPath(''), '');
});

// ─── computeModifiedFiles ─────────────────────────────────────────────────────

test('computeModifiedFiles: classifies new, modified (size), and unchanged by relative path', () => {
  const local = [
    { path: 'index.html', size: 100 },
    { path: 'css/style.css', size: 250 }, // size differs from remote → modified
    { path: 'js/app.js', size: 500 },     // not on remote → new
  ];
  const remote = new Map([
    ['index.html', 100],
    ['css/style.css', 240],
  ]);

  const { modifiedFiles, summary } = computeModifiedFiles(local, remote);
  assert.deepEqual(modifiedFiles.sort(), ['css/style.css', 'js/app.js']);
  assert.deepEqual(summary, { newCount: 1, modifiedCount: 1, unchangedCount: 1 });
});

test('computeModifiedFiles: keys by full relative path, not basename (collision regression)', () => {
  // Two different files share a basename. The remote has only css/style.css at a
  // matching size. Keying by basename would wrongly treat js/style.css as
  // unchanged; keying by full path correctly flags it as new.
  const local = [
    { path: 'css/style.css', size: 300 },
    { path: 'js/style.css', size: 999 },
  ];
  const remote = new Map([['css/style.css', 300]]);

  const { modifiedFiles } = computeModifiedFiles(local, remote);
  assert.deepEqual(modifiedFiles, ['js/style.css']);
});

test('computeModifiedFiles: nested file matched by its full path is unchanged', () => {
  // Demonstrates the recursive-listing contract: the remote map is keyed by
  // relative path including subdirectories, so img/1.png matches img/1.png.
  const local = [{ path: 'img/1.png', size: 42 }];
  const remote = new Map([['img/1.png', 42]]);
  const { modifiedFiles, summary } = computeModifiedFiles(local, remote);
  assert.deepEqual(modifiedFiles, []);
  assert.equal(summary.unchangedCount, 1);
});

test('computeModifiedFiles: empty remote map means everything is new', () => {
  const local = [{ path: 'a', size: 1 }, { path: 'b', size: 2 }];
  const { modifiedFiles, summary } = computeModifiedFiles(local, new Map());
  assert.deepEqual(modifiedFiles, ['a', 'b']);
  assert.equal(summary.newCount, 2);
});

// ─── parseTxtFile ──────────────────────────────────────────────────────────

test('parseTxtFile: title, date, and content from a standard page', () => {
  const txt = 'Null and Void\n11-10-2025\n------\nAlone in his room.\nA new day.';
  assert.deepEqual(parseTxtFile(txt), {
    title: 'Null and Void',
    date: '11-10-2025',
    content: 'Alone in his room.\nA new day.',
  });
});

test('parseTxtFile: no date line leaves date null and keeps content after separator', () => {
  const txt = 'Some Title\n------\nBody line';
  assert.deepEqual(parseTxtFile(txt), {
    title: 'Some Title',
    date: null,
    content: 'Body line',
  });
});

test('parseTxtFile: normalizes CRLF line endings', () => {
  const txt = 'Title\r\n01-02-2026\r\n------\r\nLine one\r\nLine two';
  const { title, date, content } = parseTxtFile(txt);
  assert.equal(title, 'Title');
  assert.equal(date, '01-02-2026');
  assert.equal(content, 'Line one\nLine two');
});

test('parseTxtFile: trims surrounding whitespace on title and content', () => {
  const txt = '  Spaced Title  \n------\n\n  padded body  \n';
  const { title, content } = parseTxtFile(txt);
  assert.equal(title, 'Spaced Title');
  assert.equal(content, 'padded body');
});

test('parseTxtFile: a line-2 string that is not a date is treated as content, not a date', () => {
  const txt = 'Title\nnot a date\n------\nbody';
  const { date, content } = parseTxtFile(txt);
  assert.equal(date, null);
  assert.equal(content, 'body');
});

// ─── parseTxtMeta ──────────────────────────────────────────────────────────

test('parseTxtMeta: returns just title and date', () => {
  const txt = 'My Title\n12-25-2025\n------\nbody we ignore';
  assert.deepEqual(parseTxtMeta(txt), { title: 'My Title', date: '12-25-2025' });
});

test('parseTxtMeta: date null when line 2 is not a date', () => {
  assert.deepEqual(parseTxtMeta('Title\n------\nbody'), { title: 'Title', date: null });
});

// ─── buildRosterLookup ───────────────────────────────────────────────────────

test('buildRosterLookup: keys by upper-cased name, abbr, and handle', () => {
  const lookup = buildRosterLookup({
    Kai: { handle: 'cyanusViator', abbr: 'CV', dark: '#00d5f0', light: '#007a8a' },
  });
  const expected = { dark: '#00d5f0', light: '#007a8a' };
  assert.deepEqual(lookup['KAI'], expected);
  assert.deepEqual(lookup['CV'], expected);
  assert.deepEqual(lookup['CYANUSVIATOR'], expected);
});

test('buildRosterLookup: light falls back to dark, dark falls back to default', () => {
  const lookup = buildRosterLookup({
    Mono: { dark: '#abcdef' },          // no light → light = dark
    Ghost: { light: '#123456' },        // no dark → dark = default, light kept
  });
  assert.deepEqual(lookup['MONO'], { dark: '#abcdef', light: '#abcdef' });
  assert.deepEqual(lookup['GHOST'], { dark: DEFAULT_COLORS.dark, light: '#123456' });
});

test('buildRosterLookup: tolerates null/empty input', () => {
  assert.deepEqual(buildRosterLookup(null), {});
  assert.deepEqual(buildRosterLookup({}), {});
});

// ─── colorsFor ────────────────────────────────────────────────────────────

test('colorsFor: case-insensitive lookup, default when missing or null', () => {
  const roster = { KAI: { dark: '#111', light: '#222' } };
  assert.deepEqual(colorsFor(roster, 'kai'), { dark: '#111', light: '#222' });
  assert.deepEqual(colorsFor(roster, 'NOBODY'), DEFAULT_COLORS);
  assert.deepEqual(colorsFor(roster, null), DEFAULT_COLORS);
});

// ─── parseChatlog ─────────────────────────────────────────────────────────

test('parseChatlog: classifies blank, header, dialogue, and plain text lines', () => {
  const roster = { CV: { dark: '#00d5f0', light: '#007a8a' } };
  const log = [
    '-- cyanusViator [CV] began pestering --',
    '',
    'CV: hello there',
    'just some narration',
  ].join('\n');

  const els = parseChatlog(log, roster);
  assert.equal(els[0].type, 'header');
  assert.equal(els[0].text, '-- cyanusViator [CV] began pestering --');
  assert.equal(els[1].type, 'blank');
  assert.equal(els[2].type, 'dialogue');
  assert.equal(els[2].handle, 'CV');
  assert.equal(els[2].text, 'hello there');
  assert.deepEqual(els[2].colors, { dark: '#00d5f0', light: '#007a8a' });
  assert.equal(els[3].type, 'text');
  assert.equal(els[3].text, 'just some narration');
});

test('parseChatlog: unknown handle gets default colors', () => {
  const [line] = parseChatlog('XX: who am i', {});
  assert.equal(line.type, 'dialogue');
  assert.deepEqual(line.colors, DEFAULT_COLORS);
});

// ─── parseInlineHandles ─────────────────────────────────────────────────────

test('parseInlineHandles: extracts a handle tag with surrounding text', () => {
  const roster = { CV: { dark: '#00d5f0', light: '#007a8a' } };
  const segs = parseInlineHandles('I am [handle=CV]cyanusViator[/handle] online', roster);
  assert.deepEqual(segs, [
    { type: 'text', text: 'I am ' },
    { type: 'handle', id: 'CV', text: 'cyanusViator', colors: { dark: '#00d5f0', light: '#007a8a' } },
    { type: 'text', text: ' online' },
  ]);
});

test('parseInlineHandles: plain text comes back as one text segment', () => {
  assert.deepEqual(parseInlineHandles('nothing to see here', {}),
    [{ type: 'text', text: 'nothing to see here' }]);
});

test('parseInlineHandles: case-insensitive tag and id, unknown id gets default colors', () => {
  const segs = parseInlineHandles('[HANDLE=xx]ghost[/HANDLE]', {});
  assert.equal(segs.length, 1);
  assert.equal(segs[0].type, 'handle');
  assert.equal(segs[0].id, 'xx');
  assert.equal(segs[0].text, 'ghost');
  assert.deepEqual(segs[0].colors, DEFAULT_COLORS);
});

test('parseInlineHandles: handles multiple tags on one line', () => {
  const roster = { CV: { dark: '#1', light: '#2' }, AF: { dark: '#3', light: '#4' } };
  const segs = parseInlineHandles('[handle=CV]kai[/handle] and [handle=AF]scott[/handle]', roster);
  assert.equal(segs.length, 3);
  assert.equal(segs[0].text, 'kai');
  assert.equal(segs[1].text, ' and ');
  assert.equal(segs[2].text, 'scott');
});

// ─── formatDate ───────────────────────────────────────────────────────────

test('formatDate: reorders MM-DD-YYYY into each supported display format', () => {
  assert.equal(formatDate('11-10-2025', 'MM-DD-YYYY'), '11/10/2025');
  assert.equal(formatDate('11-10-2025', 'DD-MM-YYYY'), '10/11/2025');
  assert.equal(formatDate('11-10-2025', 'YYYY-MM-DD'), '2025/11/10');
});

test('formatDate: empty input yields empty string; unknown format falls back to MM/DD/YYYY', () => {
  assert.equal(formatDate('', 'MM-DD-YYYY'), '');
  assert.equal(formatDate(null, 'MM-DD-YYYY'), '');
  assert.equal(formatDate('11-10-2025', 'bogus'), '11/10/2025');
});

// ─── parseDate ────────────────────────────────────────────────────────────

test('parseDate: builds a Date with month zero-indexed', () => {
  const d = parseDate('11-10-2025');
  assert.equal(d.getFullYear(), 2025);
  assert.equal(d.getMonth(), 10); // November
  assert.equal(d.getDate(), 10);
});

// ─── parsePageNumber ──────────────────────────────────────────────────────

test('parsePageNumber: reads the trailing numeric path segment', () => {
  assert.equal(parsePageNumber('/story/1', ''), 1);
  assert.equal(parsePageNumber('/42', ''), 42);
  assert.equal(parsePageNumber('/story/7/', ''), 7); // trailing slash tolerated
});

test('parsePageNumber: non-numeric or rootless paths yield null', () => {
  assert.equal(parsePageNumber('/', ''), null);
  assert.equal(parsePageNumber('/log', ''), null);
  assert.equal(parsePageNumber('/map', ''), null);
});

test('parsePageNumber: falls back to #/ hash routes', () => {
  assert.equal(parsePageNumber('/', '#/story/5'), 5);
  assert.equal(parsePageNumber('/', '#/3'), 3);
  assert.equal(parsePageNumber('/', '#/log'), null);
});

test('parsePageNumber: pathname number takes precedence over hash', () => {
  assert.equal(parsePageNumber('/story/2', '#/story/9'), 2);
});

// ─── boolFromEnv ──────────────────────────────────────────────────────────

test('boolFromEnv: recognizes common truthy strings, case/space-insensitively', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' on ']) {
    assert.equal(boolFromEnv(v), true, `expected ${JSON.stringify(v)} to be true`);
  }
});

test('boolFromEnv: everything else is false', () => {
  for (const v of ['0', 'false', 'no', 'off', '', 'maybe']) {
    assert.equal(boolFromEnv(v), false, `expected ${JSON.stringify(v)} to be false`);
  }
});

test('boolFromEnv: null/undefined returns the provided default', () => {
  assert.equal(boolFromEnv(undefined), false);
  assert.equal(boolFromEnv(null), false);
  assert.equal(boolFromEnv(undefined, true), true);
});
