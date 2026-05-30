// deploy.js (ESM)
// 
// Builds the site with webpack, copies static assets, generates /txt/index.json,
// and deploys via FTP.
//
// Usage examples:
//   node deploy.js                           - Build and deploy
//   node deploy.js --clean                   - Clear remote directory before upload
//   node deploy.js --obfuscate               - Obfuscate the JS bundle after build
//   node deploy.js --skip-deploy             - Build only, don't deploy
//   node deploy.js --preserve-dist           - Keep dist/ folder after deployment
//   node deploy.js --modified-only           - Only upload modified/new files
//   node deploy.js --clean --obfuscate       - Combine multiple flags
//
// Arguments:
//   --clean          Clear all files in the remote directory before uploading
//   --obfuscate      Run javascript-obfuscator on dist/js/app.js after webpack build
//   --skip-deploy    Only build locally, skip FTP upload step
//   --preserve-dist  Don't delete dist/ folder after successful deployment
//   --modified-only  Only upload files that differ from the server or are new
//
// Config via .env or environment variables:
//   FTP_HOST, FTP_PORT, FTP_USER, FTP_PASSWORD, FTP_SECURE, FTP_TLS_INSECURE
//   REMOTE_DIR, LOCAL_DIR

import 'dotenv/config';
import path from 'node:path';
import * as fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import { createHash } from 'node:crypto';
import { Client as FtpClient } from 'basic-ftp';
import webpack from 'webpack';
import { boolFromEnv, parseTxtMeta, toPosixPath, computeModifiedFiles } from './js/lib.mjs';

const MANIFEST_FILE = '.deploy-manifest.json';
const BATCH_SIZE = 10;

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    clean: args.has('--clean'),
    obfuscate: args.has('--obfuscate') || boolFromEnv(process.env.OBFUSCATE, false),
    skipDeploy: args.has('--skip-deploy'),
    preserveDist: args.has('--preserve-dist'),
    modifiedOnly: args.has('--modified-only'),
  };
}

async function pathExists(p) {
  try { await fsp.access(p); return true; }
  catch { return false; }
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fsp.copyFile(src, dest);
}

async function copyDir(src, dest) {
  if (!(await pathExists(src))) return;
  await ensureDir(dest);
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) await copyDir(s, d);
    else if (ent.isFile()) await copyFile(s, d);
  }
}

async function deleteDist(distPath) {
  if (!(await pathExists(distPath))) return;
  console.log(`Deleting ${distPath} ...`);
  await fsp.rm(distPath, { recursive: true, force: true });
  console.log('dist/ folder deleted.');
}

// ─── index.json generation ────────────────────────────────────────────────────
//
// Scans txt/ for sequentially-numbered files (1.txt, 2.txt, …) and reads
// the title and optional date from each one, then writes txt/index.json.
//
// txt file format (first few lines):
//   Title text
//   MM-DD-YYYY          ← optional date on line 2, before the ------ separator
//   ------
//   ...content...
//
// parseTxtMeta lives in js/lib.mjs (shared with the browser app).

async function generatePageIndex(txtDir, outPath) {
  console.log('Generating page index (txt/index.json)...');

  const entries = [];
  let n = 1;
  while (true) {
    const filePath = path.join(txtDir, `${n}.txt`);
    if (!(await pathExists(filePath))) break;
    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      const { title, date } = parseTxtMeta(raw);
      entries.push({ num: n, title, date });
      console.log(`  ${n}: "${title}"${date ? ` (${date})` : ''}`);
    } catch (err) {
      console.warn(`  Warning: could not read ${filePath}: ${err.message}`);
    }
    n++;
  }

  if (entries.length === 0) {
    console.warn('  No numbered txt files found — index.json not written.');
    return;
  }

  await ensureDir(path.dirname(outPath));
  await fsp.writeFile(outPath, JSON.stringify(entries, null, 2), 'utf8');
  console.log(`  Wrote ${entries.length} entries to ${outPath}`);
}

// ─── Build ────────────────────────────────────────────────────────────────────

async function buildSite() {
  const config = (await import('./webpack.common.js')).default || (await import('./webpack.common.js'));
  const finalConfig = { ...config, mode: 'production' };

  console.log('Building with webpack (production)...');
  await new Promise((resolve, reject) => {
    webpack(finalConfig, (err, stats) => {
      if (err) return reject(err);
      const info = stats.toJson();
      if (stats.hasErrors()) {
        return reject(new Error(info.errors.map(e => e.message || e).join('\n')));
      }
      if (stats.hasWarnings()) {
        console.warn('Build warnings:\n' + info.warnings.map(w => w.message || w).join('\n'));
      }
      resolve();
    });
  });

  const dist = path.resolve('dist');

  // Generate index.json from local txt/ before copying
  const localTxtDir = path.resolve('txt');
  const indexJsonOut = path.join(localTxtDir, 'index.json');
  if (await pathExists(localTxtDir)) {
    await generatePageIndex(localTxtDir, indexJsonOut);
  } else {
    console.warn('txt/ directory not found — skipping index.json generation.');
  }

  // Copy static assets
  const filesToCopy = [
    { src: 'index.html',          dest: path.join(dist, 'index.html') },
    { src: '404.html',            dest: path.join(dist, '404.html') },
    { src: '.htaccess',           dest: path.join(dist, '.htaccess') },
    { src: 'favicon.ico',         dest: path.join(dist, 'favicon.ico') },
    { src: 'favicon-32x32.png',   dest: path.join(dist, 'favicon-32x32.png') },
    { src: 'favicon-16x16.png',   dest: path.join(dist, 'favicon-16x16.png') },
    { src: 'apple-touch-icon.png',dest: path.join(dist, 'apple-touch-icon.png') },
  ];
  const dirsToCopy = ['css', 'img', 'txt']; // txt now includes the freshly-written index.json

  console.log('Copying static assets...');
  for (const f of filesToCopy) {
    if (await pathExists(f.src)) {
      await copyFile(f.src, f.dest);
      console.log(`  + ${f.src} -> ${f.dest}`);
    }
  }
  for (const d of dirsToCopy) {
    if (await pathExists(d)) {
      await copyDir(d, path.join(dist, d));
      console.log(`  + ${d}/ -> ${path.join(dist, d)}/`);
    }
  }
}

// ─── Obfuscation ──────────────────────────────────────────────────────────────

async function maybeObfuscate(distJsPath) {
  let JavaScriptObfuscator;
  try {
    ({ default: JavaScriptObfuscator } = await import('javascript-obfuscator'));
  } catch {
    console.error('javascript-obfuscator not installed. Install with: npm i -D javascript-obfuscator');
    process.exit(1);
  }
  if (!(await pathExists(distJsPath))) {
    console.warn(`Obfuscation skipped: file not found: ${distJsPath}`);
    return;
  }
  console.log('Obfuscating bundle...');
  const input = await fsp.readFile(distJsPath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(input, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    disableConsoleOutput: true,
    identifierNamesGenerator: 'hexadecimal',
    rotateStringArray: true,
    selfDefending: true,
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: true,
  });
  await fsp.writeFile(distJsPath, result.getObfuscatedCode(), 'utf8');
  console.log('Obfuscation complete.');
}

// ─── Deploy manifest helpers ──────────────────────────────────────────────────

async function computeFileHash(filePath) {
  const content = await fsp.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function getFileMetadata(filePath) {
  const stats = await fsp.stat(filePath);
  return { size: stats.size, mtime: stats.mtimeMs, hash: await computeFileHash(filePath) };
}

async function getAllLocalFiles(dir, baseDir = dir) {
  const files = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await getAllLocalFiles(fullPath, baseDir));
    else if (entry.isFile()) files.push(path.relative(baseDir, fullPath));
  }
  return files;
}

async function loadManifest() {
  try {
    if (await pathExists(MANIFEST_FILE)) {
      const content = await fsp.readFile(MANIFEST_FILE, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn(`Warning: Could not load manifest: ${err.message}`);
  }
  return {};
}

async function saveManifest(manifest) {
  await fsp.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8');
}

async function getModifiedFilesWithManifest(localDir) {
  console.log('Analyzing files for changes (using local manifest)...');
  const manifest = await loadManifest();
  const localFiles = await getAllLocalFiles(localDir);
  const modifiedFiles = [];
  const newManifest = {};
  let newCount = 0, modifiedCount = 0, unchangedCount = 0;

  for (const relativePath of localFiles) {
    const localPath = path.join(localDir, relativePath);
    const stats = await fsp.stat(localPath);
    const oldEntry = manifest[relativePath];

    if (oldEntry && oldEntry.size === stats.size && oldEntry.mtime === stats.mtimeMs) {
      newManifest[relativePath] = oldEntry;
      unchangedCount++;
      continue;
    }

    const hash = await computeFileHash(localPath);
    newManifest[relativePath] = { size: stats.size, mtime: stats.mtimeMs, hash };

    if (!oldEntry) {
      console.log(`  New: ${relativePath}`);
      modifiedFiles.push(relativePath);
      newCount++;
    } else if (oldEntry.hash !== hash) {
      console.log(`  Modified: ${relativePath}`);
      modifiedFiles.push(relativePath);
      modifiedCount++;
    } else {
      unchangedCount++;
    }
  }

  console.log(`Summary: ${newCount} new, ${modifiedCount} modified, ${unchangedCount} unchanged`);
  return { modifiedFiles, newManifest };
}

// Recursively list a remote tree into a Map keyed by relative posix path -> size.
// basic-ftp's client.list() is per-directory, so we walk subdirectories
// ourselves; without this, nested files would never match and would be
// re-uploaded every run.
async function listRemoteFilesRecursive(client, remoteDir, prefix = '') {
  const result = new Map();
  let entries;
  try {
    entries = await client.list(remoteDir);
  } catch {
    return result; // directory missing or not listable
  }
  for (const file of entries) {
    const relPath = prefix ? `${prefix}/${file.name}` : file.name;
    if (file.type === 2) { // directory
      const sub = await listRemoteFilesRecursive(client, path.posix.join(remoteDir, file.name), relPath);
      for (const [k, v] of sub) result.set(k, v);
    } else if (file.type === 1) { // file
      result.set(relPath, file.size);
    }
  }
  return result;
}

async function getModifiedFilesViaFTP(client, localDir, remoteDir) {
  console.log('Analyzing files for changes (comparing with remote)...');
  const localFiles = await getAllLocalFiles(localDir);
  const newManifest = {};

  // Remote snapshot keyed by relative posix path (recursive, so nested files
  // and same-named files in different folders compare correctly).
  let remoteSizeByPath = new Map();
  try {
    remoteSizeByPath = await listRemoteFilesRecursive(client, remoteDir);
  } catch {
    console.warn('Could not list remote directory, treating all files as new');
  }

  // Stat + hash every local file for the manifest, and build posix-keyed
  // { path, size } entries for the diff.
  const localEntries = [];
  for (let i = 0; i < localFiles.length; i += BATCH_SIZE) {
    const batch = localFiles.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (relativePath) => {
      const metadata = await getFileMetadata(path.join(localDir, relativePath));
      newManifest[relativePath] = metadata;
      localEntries.push({ path: toPosixPath(relativePath), size: metadata.size });
    }));
  }

  const { modifiedFiles, summary } = computeModifiedFiles(localEntries, remoteSizeByPath);
  for (const p of modifiedFiles) {
    console.log(remoteSizeByPath.has(p) ? `  Modified: ${p} (size changed)` : `  New: ${p}`);
  }
  console.log(`Summary: ${summary.newCount} new, ${summary.modifiedCount} modified, ${summary.unchangedCount} unchanged (by size only — FTP can't detect same-size edits)`);

  return { modifiedFiles, newManifest };
}

async function uploadModifiedFiles(client, localDir, remoteDir, modifiedFiles) {
  if (modifiedFiles.length === 0) { console.log('No files to upload.'); return; }
  console.log(`Uploading ${modifiedFiles.length} file(s)...`);

  const filesByDir = new Map();
  for (const relativePath of modifiedFiles) {
    const dir = path.posix.dirname(relativePath.replace(/\\/g, '/'));
    if (!filesByDir.has(dir)) filesByDir.set(dir, []);
    filesByDir.get(dir).push(relativePath);
  }

  for (const dir of [...filesByDir.keys()].sort()) {
    await client.ensureDir(path.posix.join(remoteDir, dir));
  }

  let uploaded = 0;
  for (const relativePath of modifiedFiles) {
    const localPath = path.join(localDir, relativePath);
    const remotePath = path.posix.join(remoteDir, relativePath.replace(/\\/g, '/'));
    await client.uploadFrom(localPath, remotePath);
    uploaded++;
    console.log(`  [${uploaded}/${modifiedFiles.length}] Uploaded: ${relativePath}`);
  }
}

// ─── Deploy ───────────────────────────────────────────────────────────────────

async function deploy() {
  const { FTP_HOST, FTP_PORT, FTP_USER, FTP_PASSWORD, FTP_SECURE, REMOTE_DIR, LOCAL_DIR } = process.env;

  if (!FTP_HOST || !FTP_USER || !FTP_PASSWORD) {
    throw new Error('Missing FTP credentials: set FTP_HOST, FTP_USER, FTP_PASSWORD (via .env or environment).');
  }

  const port = FTP_PORT ? Number(FTP_PORT) : 21;
  const secure = boolFromEnv(FTP_SECURE, false);
  const remoteDir = REMOTE_DIR || '/null.pixspla.net/public_html/';
  const localDir = LOCAL_DIR || 'dist';

  if (!fs.existsSync(localDir) || !fs.statSync(localDir).isDirectory()) {
    throw new Error(`Local directory not found: ${localDir}. Build step may have failed.`);
  }

  const { clean, modifiedOnly } = parseArgs();
  if (clean && modifiedOnly) console.warn('Warning: --clean and --modified-only are mutually exclusive. Using --clean.');

  const client = new FtpClient();
  client.ftp.verbose = true;

  try {
    const masked = (s) => (s ? '*'.repeat(Math.min(8, s.length)) : '(none)');
    console.log(`FTP target: ${FTP_HOST}:${port} secure=${secure} user=${FTP_USER} pass=${masked(FTP_PASSWORD)}`);
    console.log(`Connecting to ${FTP_HOST}:${port} (secure=${secure}) ...`);
    await client.access({ host: FTP_HOST, port, user: FTP_USER, password: FTP_PASSWORD, secure });

    console.log(`Ensuring remote directory: ${remoteDir}`);
    await client.ensureDir(remoteDir);
    await client.cd(remoteDir);

    let newManifest = {};

    if (clean) {
      console.log('Clearing remote directory (--clean)...');
      await client.clearWorkingDir();
      console.log(`Uploading ${path.resolve(localDir)} -> ${remoteDir}`);
      await client.uploadFromDir(localDir);
      const localFiles = await getAllLocalFiles(localDir);
      for (const relativePath of localFiles) {
        newManifest[relativePath] = await getFileMetadata(path.join(localDir, relativePath));
      }
    } else if (modifiedOnly) {
      const manifestExists = await pathExists(MANIFEST_FILE);
      let modifiedFiles;
      if (manifestExists) {
        ({ modifiedFiles, newManifest } = await getModifiedFilesWithManifest(localDir));
      } else {
        console.log('No manifest found, comparing with remote (slower)...');
        ({ modifiedFiles, newManifest } = await getModifiedFilesViaFTP(client, localDir, remoteDir));
      }
      if (modifiedFiles.length === 0) {
        console.log('No files modified. Nothing to upload.');
      } else {
        await uploadModifiedFiles(client, localDir, remoteDir, modifiedFiles);
      }
    } else {
      console.log(`Uploading ${path.resolve(localDir)} -> ${remoteDir}`);
      await client.uploadFromDir(localDir);
      const localFiles = await getAllLocalFiles(localDir);
      for (const relativePath of localFiles) {
        newManifest[relativePath] = await getFileMetadata(path.join(localDir, relativePath));
      }
    }

    if (Object.keys(newManifest).length > 0) {
      await saveManifest(newManifest);
      console.log(`Saved deployment manifest (${Object.keys(newManifest).length} files)`);
    }

    console.log('Deployment completed successfully.');
  } finally {
    client.close();
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

(async function main() {
  try {
    const { obfuscate, skipDeploy, preserveDist } = parseArgs();
    await buildSite();

    if (obfuscate) {
      await maybeObfuscate(path.resolve('dist/js/app.js'));
    }

    if (skipDeploy) {
      console.log('Skipping deploy (--skip-deploy). Done.');
      return;
    }

    await deploy();

    if (!preserveDist) {
      await deleteDist(path.resolve('dist'));
    } else {
      console.log('Preserving dist/ folder (--preserve-dist).');
    }
  } catch (err) {
    console.error('Failed:', err);
    process.exitCode = 1;
  }
})();