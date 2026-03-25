const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

// 承認待ちユーザー一覧
router.get('/pending', requireAdmin, (req, res) => {
  const db = getDB();
  const users = db.prepare(`
    SELECT u.id, u.name, u.address, u.phone, u.created_at, rr.submitted_at
    FROM users u
    LEFT JOIN registration_requests rr ON u.id = rr.user_id
    WHERE u.status = 'pending_review'
    ORDER BY rr.submitted_at ASC
  `).all();
  res.json(users);
});

// ユーザー承認
router.post('/approve/:userId', requireAdmin, (req, res) => {
  const { note } = req.body;
  const db = getDB();

  const user = db.prepare("SELECT id FROM users WHERE id = ? AND status = 'pending_review'")
    .get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' });

  db.prepare("UPDATE users SET status = 'approved' WHERE id = ?").run(req.params.userId);
  db.prepare(`
    UPDATE registration_requests SET reviewed_at = CURRENT_TIMESTAMP, reviewer_id = ?
    WHERE user_id = ?
  `).run([req.session.userId, req.params.userId]);
  db.prepare(`
    INSERT INTO approval_logs (user_id, admin_id, action, note) VALUES (?, ?, 'approved', ?)
  `).run([req.params.userId, req.session.userId, note || null]);

  res.json({ success: true });
});

// ユーザー拒否
router.post('/reject/:userId', requireAdmin, (req, res) => {
  const { note } = req.body;
  const db = getDB();

  const user = db.prepare("SELECT id FROM users WHERE id = ? AND status = 'pending_review'")
    .get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' });

  db.prepare("UPDATE users SET status = 'provisional' WHERE id = ?").run(req.params.userId);
  db.prepare(`
    INSERT INTO approval_logs (user_id, admin_id, action, note) VALUES (?, ?, 'rejected', ?)
  `).run([req.params.userId, req.session.userId, note || null]);

  res.json({ success: true });
});

// 全ユーザー一覧
router.get('/users', requireAdmin, (req, res) => {
  const db = getDB();
  const users = db.prepare(`
    SELECT id, name, address, phone, status, points, created_at FROM users ORDER BY created_at DESC
  `).all();
  res.json(users);
});

// ユーザー削除（自分自身と管理者は削除不可）
router.delete('/users/:userId', requireAdmin, (req, res) => {
  const userId = req.params.userId;
  if (String(userId) === String(req.session.userId)) {
    return res.status(400).json({ error: '自分自身は削除できません' });
  }
  const db = getDB();
  const user = db.prepare('SELECT id, status FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  if (user.status === 'admin') return res.status(400).json({ error: '管理者は削除できません' });

  db.prepare('DELETE FROM registration_requests WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM point_logs WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM approval_logs WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  res.json({ success: true });
});

// 地図投稿一覧（管理用）
router.get('/posts', requireAdmin, (req, res) => {
  const db = getDB();
  const posts = db.prepare(`
    SELECT mp.id, mp.title, mp.category, mp.status, mp.created_at, u.name as user_name
    FROM map_posts mp LEFT JOIN users u ON mp.user_id = u.id
    ORDER BY mp.created_at DESC
  `).all();
  res.json(posts);
});

// 地図投稿削除
router.delete('/posts/:id', requireAdmin, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM map_option_votes WHERE post_id = ?').run(req.params.id);
  db.prepare('DELETE FROM map_post_options WHERE post_id = ?').run(req.params.id);
  db.prepare('DELETE FROM map_votes WHERE post_id = ?').run(req.params.id);
  db.prepare('DELETE FROM map_comments WHERE post_id = ?').run(req.params.id);
  db.prepare('DELETE FROM map_assignments WHERE post_id = ?').run(req.params.id);
  db.prepare('DELETE FROM map_posts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 議題一覧（管理用）
router.get('/proposals', requireAdmin, (req, res) => {
  const db = getDB();
  const proposals = db.prepare(`
    SELECT p.id, p.title, p.status, p.created_at, u.name as user_name
    FROM proposals p LEFT JOIN users u ON p.user_id = u.id
    ORDER BY p.created_at DESC
  `).all();
  res.json(proposals);
});

// 議題削除
router.delete('/proposals/:id', requireAdmin, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM proposal_option_votes WHERE proposal_id = ?').run(req.params.id);
  db.prepare('DELETE FROM proposal_options WHERE proposal_id = ?').run(req.params.id);
  db.prepare('DELETE FROM votes WHERE proposal_id = ?').run(req.params.id);
  db.prepare('DELETE FROM proposal_comments WHERE proposal_id = ?').run(req.params.id);
  db.prepare('DELETE FROM proposal_reads WHERE proposal_id = ?').run(req.params.id);
  db.prepare('DELETE FROM proposals WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ステータス変更（役員昇格など）
router.patch('/users/:userId/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  const valid = ['provisional', 'pending_review', 'approved', 'officer', 'admin'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'ステータスが不正です' });

  const db = getDB();
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run([status, req.params.userId]);
  res.json({ success: true });
});

module.exports = router;
