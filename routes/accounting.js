const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { requireLogin, requireAdmin } = require('../middleware/auth');

// 年度一覧（全員）
router.get('/reports', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM accounting_reports ORDER BY fiscal_year DESC'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 年度詳細＋明細（全員）
router.get('/reports/:id', async (req, res) => {
  try {
    const repRes = await pool.query('SELECT * FROM accounting_reports WHERE id=$1', [req.params.id]);
    if (repRes.rows.length === 0) return res.status(404).json({ error: '報告書が見つかりません' });

    const itemsRes = await pool.query(
      'SELECT * FROM accounting_items WHERE report_id=$1 ORDER BY type, category, sort_order, id',
      [req.params.id]
    );
    res.json({ report: repRes.rows[0], items: itemsRes.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 年度作成（管理者・役員）
router.post('/reports', requireLogin, async (req, res) => {
  try {
    if (!['admin','officer'].includes(req.session.userStatus)) {
      return res.status(403).json({ error: '権限がありません' });
    }
    const { fiscal_year, title, description } = req.body;
    if (!fiscal_year || !title) return res.status(400).json({ error: '年度とタイトルは必須です' });

    const result = await pool.query(
      'INSERT INTO accounting_reports (fiscal_year, title, description) VALUES ($1,$2,$3) RETURNING id',
      [fiscal_year, title, description || '']
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 年度削除（管理者のみ）
router.delete('/reports/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM accounting_items WHERE report_id=$1', [req.params.id]);
    await pool.query('DELETE FROM accounting_reports WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 明細追加（管理者・役員）
router.post('/reports/:id/items', requireLogin, async (req, res) => {
  try {
    if (!['admin','officer'].includes(req.session.userStatus)) {
      return res.status(403).json({ error: '権限がありません' });
    }
    const { type, category, item_name, amount, notes, sort_order } = req.body;
    if (!type || !item_name) return res.status(400).json({ error: '種別と項目名は必須です' });

    const result = await pool.query(
      'INSERT INTO accounting_items (report_id, type, category, item_name, amount, notes, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [req.params.id, type, category || 'その他', item_name, amount || 0, notes || '', sort_order || 0]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 明細更新（管理者・役員）
router.put('/items/:id', requireLogin, async (req, res) => {
  try {
    if (!['admin','officer'].includes(req.session.userStatus)) {
      return res.status(403).json({ error: '権限がありません' });
    }
    const { type, category, item_name, amount, notes, sort_order } = req.body;
    if (!type || !item_name) return res.status(400).json({ error: '種別と項目名は必須です' });

    await pool.query(
      'UPDATE accounting_items SET type=$1, category=$2, item_name=$3, amount=$4, notes=$5, sort_order=$6 WHERE id=$7',
      [type, category || 'その他', item_name, amount || 0, notes || '', sort_order || 0, req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 明細削除（管理者・役員）
router.delete('/items/:id', requireLogin, async (req, res) => {
  try {
    if (!['admin','officer'].includes(req.session.userStatus)) {
      return res.status(403).json({ error: '権限がありません' });
    }
    await pool.query('DELETE FROM accounting_items WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
