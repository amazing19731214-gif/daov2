const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM qa_items ORDER BY category, sort_order, id');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { category, question, answer, sort_order } = req.body;
    if (!question || !answer) return res.status(400).json({ error: '質問と回答は必須です' });

    const result = await pool.query(
      'INSERT INTO qa_items (category, question, answer, sort_order) VALUES ($1, $2, $3, $4) RETURNING id',
      [category || '一般', question, answer, sort_order || 0]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { category, question, answer, sort_order } = req.body;
    if (!question || !answer) return res.status(400).json({ error: '質問と回答は必須です' });

    await pool.query(
      'UPDATE qa_items SET category=$1, question=$2, answer=$3, sort_order=$4 WHERE id=$5',
      [category || '一般', question, answer, sort_order || 0, req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM qa_items WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
