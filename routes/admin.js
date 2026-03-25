const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

// 承認待ちユーザー一覧
router.get('/pending', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.address, u.phone, u.created_at, rr.submitted_at
      FROM users u
      LEFT JOIN registration_requests rr ON u.id = rr.user_id
      WHERE u.status = 'pending_review'
      ORDER BY rr.submitted_at ASC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ユーザー承認
router.post('/approve/:userId', requireAdmin, async (req, res) => {
  try {
    const { note } = req.body;
    const { rows } = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND status = 'pending_review'",
      [req.params.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'ユーザーが見つかりません' });

    await pool.query("UPDATE users SET status = 'approved' WHERE id = $1", [req.params.userId]);
    await pool.query(
      'UPDATE registration_requests SET reviewed_at = NOW(), reviewer_id = $1 WHERE user_id = $2',
      [req.session.userId, req.params.userId]
    );
    await pool.query(
      "INSERT INTO approval_logs (user_id, admin_id, action, note) VALUES ($1, $2, 'approved', $3)",
      [req.params.userId, req.session.userId, note || null]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ユーザー拒否
router.post('/reject/:userId', requireAdmin, async (req, res) => {
  try {
    const { note } = req.body;
    const { rows } = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND status = 'pending_review'",
      [req.params.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'ユーザーが見つかりません' });

    await pool.query("UPDATE users SET status = 'provisional' WHERE id = $1", [req.params.userId]);
    await pool.query(
      "INSERT INTO approval_logs (user_id, admin_id, action, note) VALUES ($1, $2, 'rejected', $3)",
      [req.params.userId, req.session.userId, note || null]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 全ユーザー一覧
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, address, phone, status, points, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ユーザー削除
router.delete('/users/:userId', requireAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    if (String(userId) === String(req.session.userId)) {
      return res.status(400).json({ error: '自分自身は削除できません' });
    }
    const { rows } = await pool.query('SELECT id, status FROM users WHERE id = $1', [userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'ユーザーが見つかりません' });
    if (rows[0].status === 'admin') return res.status(400).json({ error: '管理者は削除できません' });

    await pool.query('DELETE FROM registration_requests WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM point_logs WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM approval_logs WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 地図投稿一覧（管理用）
router.get('/posts', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT mp.id, mp.title, mp.category, mp.status, mp.created_at, u.name as user_name
      FROM map_posts mp LEFT JOIN users u ON mp.user_id = u.id
      ORDER BY mp.created_at DESC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 地図投稿削除
router.delete('/posts/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM map_option_votes WHERE post_id = $1', [req.params.id]);
    await pool.query('DELETE FROM map_post_options WHERE post_id = $1', [req.params.id]);
    await pool.query('DELETE FROM map_votes WHERE post_id = $1', [req.params.id]);
    await pool.query('DELETE FROM map_comments WHERE post_id = $1', [req.params.id]);
    await pool.query('DELETE FROM map_assignments WHERE post_id = $1', [req.params.id]);
    await pool.query('DELETE FROM map_views WHERE post_id = $1', [req.params.id]);
    await pool.query('DELETE FROM map_posts WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 議題一覧（管理用）
router.get('/proposals', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.title, p.status, p.created_at, u.name as user_name
      FROM proposals p LEFT JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 議題削除
router.delete('/proposals/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM proposal_option_votes WHERE proposal_id = $1', [req.params.id]);
    await pool.query('DELETE FROM proposal_options WHERE proposal_id = $1', [req.params.id]);
    await pool.query('DELETE FROM votes WHERE proposal_id = $1', [req.params.id]);
    await pool.query('DELETE FROM proposal_comments WHERE proposal_id = $1', [req.params.id]);
    await pool.query('DELETE FROM proposal_reads WHERE proposal_id = $1', [req.params.id]);
    await pool.query('DELETE FROM proposals WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ステータス変更
router.patch('/users/:userId/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['provisional', 'pending_review', 'approved', 'officer', 'admin'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'ステータスが不正です' });

    await pool.query('UPDATE users SET status = $1 WHERE id = $2', [status, req.params.userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
