// ─────────────────────────────────────────────────────────────────────────────
//  routes/files.js — File upload + organiser API
//
//  POST   /api/files/upload         upload one or more files (multipart)
//  GET    /api/files                list own files (with filters)
//  GET    /api/files/stats          storage + category breakdown
//  GET    /api/files/:id            get single file metadata
//  DELETE /api/files/:id            soft-delete a file
//  DELETE /api/files                bulk delete (body: { ids: [...] })
//  GET    /api/files/download/:id   download a file
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');

// ── UPLOAD DIRECTORY ──────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── FREE PLAN LIMITS ──────────────────────────────────────────────────────────
const FREE_MAX_FILES   = 50;
const FREE_MAX_BYTES   = 100 * 1024 * 1024; // 100 MB
const PRO_MAX_BYTES    = 10  * 1024 * 1024 * 1024; // 10 GB

// ── ALLOWED MIME TYPES (grouped into categories) ──────────────────────────────
const CATEGORY_MAP = {
  image:    ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml','image/bmp','image/tiff'],
  video:    ['video/mp4','video/mpeg','video/quicktime','video/x-msvideo','video/x-matroska','video/webm'],
  audio:    ['audio/mpeg','audio/wav','audio/ogg','audio/flac','audio/aac','audio/mp4','audio/webm'],
  document: ['application/pdf','application/msword',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'application/vnd.ms-excel',
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             'application/vnd.ms-powerpoint',
             'application/vnd.openxmlformats-officedocument.presentationml.presentation',
             'text/plain','text/csv','text/markdown'],
  archive:  ['application/zip','application/x-rar-compressed','application/x-7z-compressed',
             'application/x-tar','application/gzip'],
  code:     ['application/javascript','application/typescript','application/json',
             'text/html','text/css','text/xml','application/xml'],
};

const ALL_ALLOWED = Object.values(CATEGORY_MAP).flat();

function getCategory(mime) {
  for (const [cat, types] of Object.entries(CATEGORY_MAP)) {
    if (types.includes(mime)) return cat;
  }
  return 'other';
}

// ── MULTER STORAGE ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const uid  = crypto.randomBytes(16).toString('hex');
    const ext  = path.extname(file.originalname) || '';
    cb(null, uid + ext);
  },
});

function fileFilter(_req, file, cb) {
  if (ALL_ALLOWED.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(Object.assign(new Error(`File type not allowed: ${file.mimetype}`), { code: 'INVALID_TYPE' }));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB per file hard cap
});

// ── UPLOAD ────────────────────────────────────────────────────────────────────
router.post('/upload', authMiddleware, (req, res, next) => {
  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE')   return res.status(413).json({ error: 'File too large (max 500 MB per file)' });
      if (err.code === 'INVALID_TYPE')      return res.status(415).json({ error: err.message });
      if (err.code === 'LIMIT_FILE_COUNT')  return res.status(400).json({ error: 'Max 20 files per upload' });
      return next(err);
    }

    const user = req.user;
    const isPro = user.plan === 'pro';

    // ── Plan limits check ──────────────────────────────────────────────────
    if (!isPro) {
      const countRow = db.prepare('SELECT COUNT(*) AS c FROM files WHERE user_id=? AND deleted=0').get(user.id);
      if (countRow.c + (req.files?.length || 0) > FREE_MAX_FILES)
        return res.status(403).json({ error: `Free plan limit: ${FREE_MAX_FILES} files. Upgrade to Pro for unlimited.` });

      const sizeRow = db.prepare('SELECT SUM(size) AS s FROM files WHERE user_id=? AND deleted=0').get(user.id);
      const used = sizeRow.s || 0;
      const adding = (req.files || []).reduce((a, f) => a + f.size, 0);
      if (used + adding > FREE_MAX_BYTES)
        return res.status(403).json({ error: 'Free plan storage limit (100 MB) reached. Upgrade to Pro.' });
    }

    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: 'No files uploaded' });

    const saved = [];
    const insertFile = db.prepare(`
      INSERT INTO files (id, user_id, original_name, stored_name, mime_type, size, category, path, team_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const f of req.files) {
        const fileId   = 'file_' + crypto.randomBytes(12).toString('hex');
        const category = getCategory(f.mimetype);
        insertFile.run(fileId, user.id, f.originalname, f.filename, f.mimetype, f.size, category, f.path, user.team_id || null);
        saved.push({
          id: fileId, originalName: f.originalname, size: f.size,
          mimeType: f.mimetype, category, uploadedAt: new Date().toISOString(),
        });
      }
    })();

    console.log(`[FILES] ${user.email} uploaded ${saved.length} file(s)`);
    res.status(201).json({ message: `${saved.length} file(s) uploaded`, files: saved });
  });
});

// ── LIST FILES ────────────────────────────────────────────────────────────────
router.get('/', authMiddleware, (req, res) => {
  const { category, search, limit = 50, offset = 0 } = req.query;

  let sql    = 'SELECT * FROM files WHERE user_id=? AND deleted=0';
  const args = [req.user.id];

  if (category) { sql += ' AND category=?'; args.push(category); }
  if (search)   { sql += ' AND original_name LIKE ?'; args.push(`%${search}%`); }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  args.push(Number(limit), Number(offset));

  const files = db.prepare(sql).all(...args);
  const total = db.prepare('SELECT COUNT(*) AS c FROM files WHERE user_id=? AND deleted=0').get(req.user.id).c;

  res.json({ total, files: files.map(formatFile) });
});

// ── STORAGE STATS ─────────────────────────────────────────────────────────────
router.get('/stats', authMiddleware, (req, res) => {
  const user  = req.user;
  const isPro = user.plan === 'pro';

  const totals = db.prepare(`
    SELECT category, COUNT(*) AS count, SUM(size) AS bytes
    FROM files WHERE user_id=? AND deleted=0
    GROUP BY category
  `).all(user.id);

  const overall = db.prepare(`
    SELECT COUNT(*) AS total_files, SUM(size) AS total_bytes
    FROM files WHERE user_id=? AND deleted=0
  `).get(user.id);

  const maxBytes = isPro ? PRO_MAX_BYTES : FREE_MAX_BYTES;
  const usedBytes = overall.total_bytes || 0;

  res.json({
    plan:        user.plan,
    totalFiles:  overall.total_files || 0,
    usedBytes,
    usedMB:      +(usedBytes / 1024 / 1024).toFixed(2),
    maxBytes,
    maxMB:       +(maxBytes  / 1024 / 1024).toFixed(2),
    usedPct:     +((usedBytes / maxBytes) * 100).toFixed(1),
    byCategory:  totals.reduce((acc, r) => {
      acc[r.category] = { count: r.count, bytes: r.bytes || 0 };
      return acc;
    }, {}),
  });
});

// ── SINGLE FILE ───────────────────────────────────────────────────────────────
router.get('/:id', authMiddleware, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id=? AND user_id=? AND deleted=0').get(req.params.id, req.user.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  res.json({ file: formatFile(file) });
});

// ── DOWNLOAD ──────────────────────────────────────────────────────────────────
router.get('/download/:id', authMiddleware, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id=? AND user_id=? AND deleted=0').get(req.params.id, req.user.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  if (!fs.existsSync(file.path)) return res.status(404).json({ error: 'File not on disk' });

  res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
  res.setHeader('Content-Type', file.mime_type);
  res.sendFile(path.resolve(file.path));
});

// ── DELETE (soft) ─────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id=? AND user_id=? AND deleted=0').get(req.params.id, req.user.id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  db.prepare(`UPDATE files SET deleted=1 WHERE id=?`).run(file.id);

  // Also remove from disk
  try { fs.unlinkSync(file.path); } catch (_) { /* already gone */ }

  console.log(`[FILES] Deleted ${file.original_name} for ${req.user.email}`);
  res.json({ message: 'File deleted', id: file.id });
});

// ── BULK DELETE ───────────────────────────────────────────────────────────────
router.delete('/', authMiddleware, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: 'ids array required' });

  const placeholders = ids.map(() => '?').join(',');
  const files = db.prepare(
    `SELECT * FROM files WHERE id IN (${placeholders}) AND user_id=? AND deleted=0`
  ).all(...ids, req.user.id);

  db.transaction(() => {
    for (const f of files) {
      db.prepare('UPDATE files SET deleted=1 WHERE id=?').run(f.id);
      try { fs.unlinkSync(f.path); } catch (_) { /* gone */ }
    }
  })();

  res.json({ message: `${files.length} file(s) deleted`, deleted: files.map(f => f.id) });
});

function formatFile(f) {
  return {
    id: f.id, originalName: f.original_name, storedName: f.stored_name,
    mimeType: f.mime_type, size: f.size, category: f.category,
    teamId: f.team_id, uploadedAt: f.created_at,
  };
}

module.exports = router;
