const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { requireLogin } = require('../middleware/auth');

// お知らせ一覧
router.get('/', async (req, res) => {
  try {
    const userId = req.session.userId || null;
    const { rows } = await pool.query(`
      SELECT n.*,
        (SELECT COUNT(*)::int FROM notice_reads WHERE notice_id = n.id) as read_count,
        u.name as author_name,
        CASE WHEN $1::int IS NOT NULL AND EXISTS(
          SELECT 1 FROM notice_reads WHERE notice_id = n.id AND user_id = $1::int
        ) THEN true ELSE false END as my_read
      FROM notices n
      LEFT JOIN users u ON n.author_id = u.id
      ORDER BY
        CASE WHEN n.priority IN ('emergency','urgent') THEN 0 ELSE 1 END ASC,
        n.created_at DESC
    `, [userId]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// お知らせ詳細
router.get('/:id', async (req, res) => {
  try {
    const userId = req.session.userId || null;
    const { rows } = await pool.query(`
      SELECT n.*,
        (SELECT COUNT(*)::int FROM notice_reads WHERE notice_id = n.id) as read_count,
        u.name as author_name,
        CASE WHEN $2::int IS NOT NULL AND EXISTS(
          SELECT 1 FROM notice_reads WHERE notice_id = n.id AND user_id = $2::int
        ) THEN true ELSE false END as my_read
      FROM notices n
      LEFT JOIN users u ON n.author_id = u.id
      WHERE n.id = $1
    `, [req.params.id, userId]);

    if (rows.length === 0) return res.status(404).json({ error: 'お知らせが見つかりません' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 既読登録
router.post('/:id/read', requireLogin, async (req, res) => {
  try {
    const noticeRes = await pool.query('SELECT id FROM notices WHERE id=$1', [req.params.id]);
    if (noticeRes.rows.length === 0) return res.status(404).json({ error: 'お知らせが見つかりません' });

    await pool.query(
      'INSERT INTO notice_reads (notice_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, req.session.userId]
    );

    const readRes = await pool.query(
      'SELECT COUNT(*)::int as c FROM notice_reads WHERE notice_id=$1',
      [req.params.id]
    );
    res.json({ success: true, readCount: readRes.rows[0].c });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// お知らせ作成
router.post('/', requireLogin, async (req, res) => {
  try {
    const status = req.session.userStatus;
    if (!['admin','officer'].includes(status)) return res.status(403).json({ error: '権限がありません' });

    const { title, content, category, priority, total_count } = req.body;
    if (!title) return res.status(400).json({ error: 'タイトルは必須です' });

    const result = await pool.query(`
      INSERT INTO notices (title, content, category, priority, author_id, total_count)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [title, content || '', category || '一般', priority || 'normal', req.session.userId, total_count || 0]);

    res.json({ success: true, id: result.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// お知らせ更新
router.put('/:id', requireLogin, async (req, res) => {
  try {
    const status = req.session.userStatus;
    if (!['admin','officer'].includes(status)) return res.status(403).json({ error: '権限がありません' });

    const { title, content, category, priority, total_count } = req.body;
    if (!title) return res.status(400).json({ error: 'タイトルは必須です' });

    await pool.query(
      'UPDATE notices SET title=$1, content=$2, category=$3, priority=$4, total_count=$5 WHERE id=$6',
      [title, content || '', category || '一般', priority || 'normal', total_count || 0, req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// お知らせ削除
router.delete('/:id', requireLogin, async (req, res) => {
  try {
    const status = req.session.userStatus;
    if (!['admin','officer'].includes(status)) return res.status(403).json({ error: '権限がありません' });

    await pool.query('DELETE FROM notice_reads WHERE notice_id=$1', [req.params.id]);
    await pool.query('DELETE FROM notices WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
