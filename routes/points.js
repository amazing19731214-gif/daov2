const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requireLogin } = require('../middleware/auth');

// ポイント付与（他のルートから呼び出す共通関数）
function addPoints(userId, points, reason, refType, refId) {
  const db = getDB();
  db.prepare(`
    INSERT INTO point_logs (user_id, points, reason, ref_type, ref_id)
    VALUES (?, ?, ?, ?, ?)
  `).run([userId, points, reason, refType || null, refId || null]);

  // ユーザーのポイント合計を更新
  db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run([points, userId]);
}

// 自分のポイント履歴（最新50件）
router.get('/logs', requireLogin, (req, res) => {
  const db = getDB();
  const logs = db.prepare(`
    SELECT * FROM point_logs
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(req.session.userId);
  res.json(logs);
});

// ポイントランキング（承認済み以上）
router.get('/ranking', (req, res) => {
  const db = getDB();
  const ranking = db.prepare(`
    SELECT id, name, points
    FROM users
    WHERE status IN ('approved', 'officer', 'admin')
    ORDER BY points DESC
    LIMIT 20
  `).all();
  res.json(ranking);
});

module.exports = router;
module.exports.addPoints = addPoints; // 他ルートからimport可能に
