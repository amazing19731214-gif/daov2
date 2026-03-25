const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { requireLogin } = require('../middleware/auth');

// 一覧
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM documents ORDER BY category, sort_order, id'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 詳細
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '資料が見つかりません' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 作成（役員・管理者）
router.post('/', requireLogin, async (req, res) => {
  try {
    if (!['admin','officer'].includes(req.session.userStatus)) {
      return res.status(403).json({ error: '権限がありません' });
    }
    const { title, category, content, sort_order } = req.body;
    if (!title) return res.status(400).json({ error: 'タイトルは必須です' });

    const result = await pool.query(
      'INSERT INTO documents (title, category, content, sort_order) VALUES ($1,$2,$3,$4) RETURNING id',
      [title, category || '一般', content || '', sort_order || 0]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新（役員・管理者）
router.put('/:id', requireLogin, async (req, res) => {
  try {
    if (!['admin','officer'].includes(req.session.userStatus)) {
      return res.status(403).json({ error: '権限がありません' });
    }
    const { title, category, content, sort_order } = req.body;
    if (!title) return res.status(400).json({ error: 'タイトルは必須です' });

    await pool.query(
      'UPDATE documents SET title=$1, category=$2, content=$3, sort_order=$4, updated_at=NOW() WHERE id=$5',
      [title, category || '一般', content || '', sort_order || 0, req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 削除（管理者のみ）
router.delete('/:id', requireLogin, async (req, res) => {
  try {
    if (!['admin','officer'].includes(req.session.userStatus)) {
      return res.status(403).json({ error: '権限がありません' });
    }
    await pool.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
