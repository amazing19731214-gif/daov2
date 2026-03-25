const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const crypto = require('crypto');

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password + salt).digest('hex');
}

// ニックネームでログイン
router.post('/login', async (req, res) => {
  try {
    const { nickname, password } = req.body;
    if (!nickname || !nickname.trim()) return res.status(400).json({ error: 'ニックネームを入力してください' });
    const name = nickname.trim();

    let { rows } = await pool.query('SELECT * FROM users WHERE nickname = $1', [name]);
    let user = rows[0];

    if (!user) {
      // 新規仮登録
      const ins = await pool.query(
        "INSERT INTO users (nickname, name, status) VALUES ($1, $2, 'provisional') RETURNING *",
        [name, name]
      );
      user = ins.rows[0];
    } else if (user.password_hash) {
      // パスワードあり → 照合必須
      if (!password) return res.json({ requiresPassword: true });
      const hash = hashPassword(password, user.password_salt);
      if (hash !== user.password_hash) return res.status(401).json({ error: 'パスワードが違います' });
    }

    req.session.userId = user.id;
    req.session.userStatus = user.status;
    req.session.userName = user.name;
    res.json({ success: true, user: { id: user.id, name: user.name, status: user.status } });
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 本登録申請
router.post('/register', async (req, res) => {
  try {
    console.log('[register] userId:', req.session.userId);
    if (!req.session.userId) return res.status(401).json({ error: 'ログインが必要です' });

    const { name, password, address, phone } = req.body;
    if (!name || !password || !address || !phone) {
      return res.status(400).json({ error: '氏名・パスワード・住所・電話番号は必須です' });
    }

    // 申請済みチェック
    const existing = await pool.query(
      'SELECT id FROM registration_requests WHERE user_id = $1',
      [req.session.userId]
    );
    if (existing.rows.length > 0) return res.status(400).json({ error: '既に申請済みです' });

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);

    await pool.query(
      "UPDATE users SET name=$1, address=$2, phone=$3, password_hash=$4, password_salt=$5, status='pending_review' WHERE id=$6",
      [name, address, phone, hash, salt, req.session.userId]
    );

    // ニックネームが未設定なら名前で設定
    const userRes = await pool.query('SELECT nickname FROM users WHERE id = $1', [req.session.userId]);
    if (!userRes.rows[0]?.nickname) {
      await pool.query('UPDATE users SET nickname=$1 WHERE id=$2', [name, req.session.userId]);
    }

    await pool.query(
      'INSERT INTO registration_requests (user_id, name, address, phone) VALUES ($1, $2, $3, $4)',
      [req.session.userId, name, address, phone]
    );

    req.session.userStatus = 'pending_review';
    req.session.userName = name;

    res.json({ success: true, message: '申請を受け付けました。管理者の承認をお待ちください。' });
  } catch (e) {
    console.error('register error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ログアウト
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// 現在のユーザー情報取得
router.get('/me', async (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });

  try {
    const { rows } = await pool.query(
      'SELECT id, name, status, points FROM users WHERE id = $1',
      [req.session.userId]
    );
    const user = rows[0];

    if (!user) {
      req.session.destroy(() => {});
      return res.json({ loggedIn: false });
    }

    req.session.userStatus = user.status;
    res.json({ loggedIn: true, user: { id: user.id, name: user.name, status: user.status, points: user.points } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
