const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

router.get('/', (req, res) => {
  const db = getDB();
  res.json(db.prepare('SELECT * FROM qa_items ORDER BY category, sort_order, id').all());
});

router.post('/', requireAdmin, (req, res) => {
  const { category, question, answer, sort_order } = req.body;
  if (!question || !answer) return res.status(400).json({ error: '質問と回答は必須です' });
  const db = getDB();
  const result = db.prepare('INSERT INTO qa_items (category, question, answer, sort_order) VALUES (?,?,?,?)')
    .run([category || '一般', question, answer, sort_order || 0]);
  res.json({ success: true, id: result.lastInsertRowid });
});

router.put('/:id', requireAdmin, (req, res) => {
  const { category, question, answer, sort_order } = req.body;
  if (!question || !answer) return res.status(400).json({ error: '質問と回答は必須です' });
  const db = getDB();
  db.prepare('UPDATE qa_items SET category=?, question=?, answer=?, sort_order=? WHERE id=?')
    .run([category || '一般', question, answer, sort_order || 0, req.params.id]);
  res.json({ success: true });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM qa_items WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
