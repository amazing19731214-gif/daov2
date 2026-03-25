const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

// 一覧取得
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM schedule_events ORDER BY month, sort_order, id'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 追加（管理者のみ）
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { month, date_label, dow, time_label, title, who, note, category, sort_order } = req.body;
    if (!month || !title || !date_label) return res.status(400).json({ error: '月・日付・タイトルは必須です' });

    const result = await pool.query(`
      INSERT INTO schedule_events (month, date_label, dow, time_label, title, who, note, category, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `, [month, date_label, dow||'', time_label||'', title, who||'', note||'', category||'その他', sort_order||0]);

    res.json({ success: true, id: result.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新（管理者のみ）
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { month, date_label, dow, time_label, title, who, note, category, sort_order } = req.body;
    if (!month || !title || !date_label) return res.status(400).json({ error: '月・日付・タイトルは必須です' });

    await pool.query(`
      UPDATE schedule_events
      SET month=$1, date_label=$2, dow=$3, time_label=$4, title=$5, who=$6, note=$7, category=$8, sort_order=$9
      WHERE id=$10
    `, [month, date_label, dow||'', time_label||'', title, who||'', note||'', category||'その他', sort_order||0, req.params.id]);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 削除（管理者のみ）
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM schedule_events WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
