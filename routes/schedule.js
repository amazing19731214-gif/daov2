const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

// 一覧取得（全員）
router.get('/', (req, res) => {
  const db = getDB();
  const events = db.prepare(
    'SELECT * FROM schedule_events ORDER BY month, sort_order, id'
  ).all();
  res.json(events);
});

// 追加（管理者のみ）
router.post('/', requireAdmin, (req, res) => {
  const { month, date_label, dow, time_label, title, who, note, category, sort_order } = req.body;
  if (!month || !title || !date_label) return res.status(400).json({ error: '月・日付・タイトルは必須です' });
  const db = getDB();
  const result = db.prepare(`
    INSERT INTO schedule_events (month, date_label, dow, time_label, title, who, note, category, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run([month, date_label, dow||'', time_label||'', title, who||'', note||'', category||'その他', sort_order||0]);
  res.json({ success: true, id: result.lastInsertRowid });
});

// 更新（管理者のみ）
router.put('/:id', requireAdmin, (req, res) => {
  const { month, date_label, dow, time_label, title, who, note, category, sort_order } = req.body;
  if (!month || !title || !date_label) return res.status(400).json({ error: '月・日付・タイトルは必須です' });
  const db = getDB();
  db.prepare(`
    UPDATE schedule_events SET month=?, date_label=?, dow=?, time_label=?, title=?, who=?, note=?, category=?, sort_order=?
    WHERE id=?
  `).run([month, date_label, dow||'', time_label||'', title, who||'', note||'', category||'その他', sort_order||0, req.params.id]);
  res.json({ success: true });
});

// 削除（管理者のみ）
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM schedule_events WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
