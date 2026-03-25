const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { requireLogin } = require('../middleware/auth');

// ポイント付与（他のルートから呼び出す共通関数）
async function addPoints(userId, points, reason, refType, refId) {
  try {
    await pool.query(
      'INSERT INTO point_logs (user_id, points, reason, ref_type, ref_id) VALUES ($1, $2, $3, $4, $5)',
      [userId, points, reason, refType || null, refId || null]
    );
    await pool.query(
      'UPDATE users SET points = points + $1 WHERE id = $2',
      [points, userId]
    );
  } catch (e) {
    console.error('addPoints error:', e);
  }
}

// 自分のポイント履歴（最新50件）
router.get('/logs', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM point_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.session.userId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ポイントランキング（承認済み以上）
router.get('/ranking', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, points FROM users WHERE status IN ('approved','officer','admin') ORDER BY points DESC LIMIT 20"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.addPoints = addPoints;
