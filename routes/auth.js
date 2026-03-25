const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const crypto = require('crypto');

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password + salt).digest('hex');
}

// ニックネームでログイン（仮登録 or 本登録済み）
router.post('/login', (req, res) => {
  try {
    const { nickname, password } = req.body;
    if (!nickname || !nickname.trim()) return res.status(400).json({ error: 'ニックネームを入力してください' });
    const name = nickname.trim();
    const db = getDB();
    let user = db.prepare('SELECT * FROM users WHERE nickname = ?').get(name);

    if (!user) {
      // 新規仮登録
      db.prepare("INSERT INTO users (nickname, name, status) VALUES (?, ?, 'provisional')").run(name, name);
      user = db.prepare('SELECT * FROM users WHERE nickname = ?').get(name);
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

// 本登録申請（名前・パスワード・住所・電話番号）
router.post('/register', (req, res) => {
  console.log('[register] session:', JSON.stringify(req.session));
  if (!req.session.userId) return res.status(401).json({ error: 'ログインが必要です' });

  const { name, password, address, phone } = req.body;
  if (!name || !password || !address || !phone) {
    return res.status(400).json({ error: '氏名・パスワード・住所・電話番号は必須です' });
  }

  const db = getDB();

  // 申請済みチェック
  const existing = db.prepare('SELECT id FROM registration_requests WHERE user_id = ?').get(req.session.userId);
  if (existing) return res.status(400).json({ error: '既に申請済みです' });

  // パスワードハッシュ化
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);

  // ユーザー情報更新
  db.prepare(`
    UPDATE users SET name=?, address=?, phone=?, password_hash=?, password_salt=?, status='pending_review' WHERE id=?
  `).run(name, address, phone, hash, salt, req.session.userId);

  // ニックネームが未設定なら名前で設定
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user.nickname) {
    db.prepare('UPDATE users SET nickname=? WHERE id=?').run(name, req.session.userId);
  }

  db.prepare(`
    INSERT INTO registration_requests (user_id, name, address, phone) VALUES (?, ?, ?, ?)
  `).run(req.session.userId, name, address, phone);

  req.session.userStatus = 'pending_review';
  req.session.userName = name;

  res.json({ success: true, message: '申請を受け付けました。管理者の承認をお待ちください。' });
});

// ログアウト
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// 現在のユーザー情報取得
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });

  const db = getDB();
  const user = db.prepare('SELECT id, name, status, points FROM users WHERE id = ?')
    .get(req.session.userId);

  if (!user) {
    req.session.destroy();
    return res.json({ loggedIn: false });
  }

  req.session.userStatus = user.status;
  res.json({ loggedIn: true, user: { id: user.id, name: user.name, status: user.status, points: user.points } });
});

module.exports = router;
