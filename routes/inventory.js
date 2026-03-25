const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { requireLogin, requireAdmin } = require('../middleware/auth');

// 一覧
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT i.*, u.name as updated_by_name FROM inventory_items i LEFT JOIN users u ON i.updated_by = u.id ORDER BY i.category, i.id'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新（管理者・役員）
router.put('/:id', requireLogin, async (req, res) => {
  try {
    if (!['admin','officer'].includes(req.session.userStatus)) {
      return res.status(403).json({ error: '権限がありません' });
    }
    const { name, category, quantity, unit, location, notes } = req.body;
    if (!name) return res.status(400).json({ error: '品名は必須です' });

    await pool.query(
      'UPDATE inventory_items SET name=$1, category=$2, quantity=$3, unit=$4, location=$5, notes=$6, updated_at=NOW(), updated_by=$7 WHERE id=$8',
      [name, category || 'その他', quantity || 0, unit || '個', location || '', notes || '', req.session.userId, req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 追加（管理者・役員）
router.post('/', requireLogin, async (req, res) => {
  try {
    if (!['admin','officer'].includes(req.session.userStatus)) {
      return res.status(403).json({ error: '権限がありません' });
    }
    const { name, category, quantity, unit, location, notes } = req.body;
    if (!name) return res.status(400).json({ error: '品名は必須です' });

    const result = await pool.query(
      'INSERT INTO inventory_items (name, category, quantity, unit, location, notes, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [name, category || 'その他', quantity || 0, unit || '個', location || '', notes || '', req.session.userId]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 削除（管理者のみ）
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM inventory_items WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
