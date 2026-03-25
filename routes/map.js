const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDB } = require('../db/database');
const { requireLogin, requireApproved } = require('../middleware/auth');
const { addPoints } = require('./points');

// アップロード先ディレクトリ
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `map_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    // 画像ファイルのみ許可
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('画像ファイルのみアップロード可能です'));
  }
});

// ピン一覧（地図表示用）
router.get('/posts', (req, res) => {
  const { category, status } = req.query;
  const db = getDB();

  let query = `
    SELECT mp.*, u.name as user_name,
      (SELECT COUNT(*) FROM map_votes WHERE post_id = mp.id AND vote_type = 'agree') as agree_count,
      (SELECT COUNT(*) FROM map_votes WHERE post_id = mp.id AND vote_type = 'disagree') as disagree_count,
      (SELECT COUNT(*) FROM map_comments WHERE post_id = mp.id) as comment_count
    FROM map_posts mp
    LEFT JOIN users u ON mp.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (category && category !== 'all') { query += ' AND mp.category = ?'; params.push(category); }
  if (status) { query += ' AND mp.status = ?'; params.push(status); }
  query += ' ORDER BY mp.created_at DESC';

  res.json(db.prepare(query).all(params));
});

// ピン詳細
router.get('/posts/:id', (req, res) => {
  const db = getDB();
  const post = db.prepare(`
    SELECT mp.*, u.name as user_name,
      (SELECT COUNT(*) FROM map_votes WHERE post_id = mp.id AND vote_type = 'agree') as agree_count,
      (SELECT COUNT(*) FROM map_votes WHERE post_id = mp.id AND vote_type = 'disagree') as disagree_count
    FROM map_posts mp
    LEFT JOIN users u ON mp.user_id = u.id
    WHERE mp.id = ?
  `).get(req.params.id);

  if (!post) return res.status(404).json({ error: '投稿が見つかりません' });

  const comments = db.prepare(`
    SELECT mc.*, u.name as user_name
    FROM map_comments mc
    LEFT JOIN users u ON mc.user_id = u.id
    WHERE mc.post_id = ?
    ORDER BY mc.created_at ASC
  `).all(req.params.id);

  // 閲覧数・自分の閲覧状態
  const viewCount = db.prepare('SELECT COUNT(*) as c FROM map_views WHERE post_id = ?').get(req.params.id).c;
  let myView = false;
  if (req.session.userId) {
    const v = db.prepare('SELECT id FROM map_views WHERE post_id = ? AND user_id = ?').get([req.params.id, req.session.userId]);
    myView = !!v;
  }

  // カスタム選択肢
  const options = db.prepare(`
    SELECT mpo.*, COUNT(mov.id) as vote_count
    FROM map_post_options mpo
    LEFT JOIN map_option_votes mov ON mov.option_id = mpo.id
    WHERE mpo.post_id = ?
    GROUP BY mpo.id
    ORDER BY mpo.sort_order ASC
  `).all(req.params.id);

  // ログイン中ユーザーの投票状態
  let myVote = null;
  let myOptionVote = null;
  if (req.session.userId) {
    const v = db.prepare(
      'SELECT vote_type FROM map_votes WHERE post_id = ? AND user_id = ?'
    ).get([req.params.id, req.session.userId]);
    myVote = v ? v.vote_type : null;

    const ov = db.prepare(
      'SELECT option_id FROM map_option_votes WHERE post_id = ? AND user_id = ?'
    ).get([req.params.id, req.session.userId]);
    myOptionVote = ov ? ov.option_id : null;
  }

  res.json({ ...post, comments, options, myVote, myOptionVote, viewCount, myView });
});

// ピン投稿
router.post('/posts', requireLogin, upload.single('photo'), (req, res) => {
  const { title, content, category, lat, lng } = req.body;
  if (!title || !lat || !lng) {
    return res.status(400).json({ error: 'タイトル・位置情報は必須です' });
  }

  const db = getDB();
  const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;

  const { priority } = req.body;
  const result = db.prepare(`
    INSERT INTO map_posts (user_id, title, content, category, lat, lng, photo_url, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run([req.session.userId, title, content, category || 'other', lat, lng, photoUrl, priority || '様子見']);

  const postId = result.lastInsertRowid;

  // カスタム選択肢があれば登録
  const options = req.body.options;
  if (options) {
    const optList = Array.isArray(options) ? options : [options];
    optList.forEach((label, i) => {
      if (label && label.trim()) {
        db.prepare('INSERT INTO map_post_options (post_id, label, sort_order) VALUES (?, ?, ?)')
          .run([postId, label.trim(), i]);
      }
    });
  }

  // 投稿ポイント付与（+3pt）
  addPoints(req.session.userId, 3, '地図投稿', 'map_post', postId);

  res.json({ success: true, id: postId });
});

// コメント投稿
router.post('/posts/:id/comments', requireLogin, (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'コメント内容が必要です' });

  const db = getDB();
  const post = db.prepare('SELECT id FROM map_posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '投稿が見つかりません' });

  db.prepare(`
    INSERT INTO map_comments (post_id, user_id, content) VALUES (?, ?, ?)
  `).run([req.params.id, req.session.userId, content]);

  // コメントポイント付与（+2pt）
  addPoints(req.session.userId, 2, '地図コメント', 'map_comment', req.params.id);

  res.json({ success: true });
});

// 投票（承認済みのみ・1人1票）
router.post('/posts/:id/vote', requireApproved, (req, res) => {
  const { vote_type } = req.body;
  if (!['agree', 'disagree'].includes(vote_type)) {
    return res.status(400).json({ error: '投票タイプが不正です' });
  }

  const db = getDB();
  const post = db.prepare('SELECT id FROM map_posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '投稿が見つかりません' });

  const existing = db.prepare(
    'SELECT id FROM map_votes WHERE post_id = ? AND user_id = ?'
  ).get([req.params.id, req.session.userId]);

  if (existing) {
    // 投票変更
    db.prepare('UPDATE map_votes SET vote_type = ? WHERE post_id = ? AND user_id = ?')
      .run([vote_type, req.params.id, req.session.userId]);
  } else {
    // 新規投票（+1pt）
    db.prepare('INSERT INTO map_votes (post_id, user_id, vote_type) VALUES (?, ?, ?)')
      .run([req.params.id, req.session.userId, vote_type]);
    addPoints(req.session.userId, 1, '地図投票', 'map_vote', req.params.id);
  }

  const agree = db.prepare("SELECT COUNT(*) as c FROM map_votes WHERE post_id = ? AND vote_type = 'agree'").get(req.params.id).c;
  const disagree = db.prepare("SELECT COUNT(*) as c FROM map_votes WHERE post_id = ? AND vote_type = 'disagree'").get(req.params.id).c;

  res.json({ success: true, agree, disagree });
});

// 閲覧しました（ログイン必須）
router.post('/posts/:id/view', requireLogin, (req, res) => {
  const db = getDB();
  const post = db.prepare('SELECT id FROM map_posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '投稿が見つかりません' });

  const existing = db.prepare('SELECT id FROM map_views WHERE post_id = ? AND user_id = ?')
    .get([req.params.id, req.session.userId]);

  if (!existing) {
    db.prepare('INSERT INTO map_views (post_id, user_id) VALUES (?, ?)').run([req.params.id, req.session.userId]);
    addPoints(req.session.userId, 1, '地図投稿閲覧', 'map_view', req.params.id);
  }

  const viewCount = db.prepare('SELECT COUNT(*) as c FROM map_views WHERE post_id = ?').get(req.params.id).c;
  res.json({ success: true, viewCount, myView: true });
});

// カスタム選択肢投票（承認済みのみ・1人1票）
router.post('/posts/:id/option-vote', requireApproved, (req, res) => {
  const { option_id } = req.body;
  if (!option_id) return res.status(400).json({ error: '選択肢が必要です' });

  const db = getDB();
  const option = db.prepare('SELECT id FROM map_post_options WHERE id = ? AND post_id = ?')
    .get([option_id, req.params.id]);
  if (!option) return res.status(404).json({ error: '選択肢が見つかりません' });

  const existing = db.prepare(
    'SELECT id, option_id FROM map_option_votes WHERE post_id = ? AND user_id = ?'
  ).get([req.params.id, req.session.userId]);

  if (existing) {
    if (existing.option_id === option_id) {
      // 同じ選択肢 → 取り消し
      db.prepare('DELETE FROM map_option_votes WHERE post_id = ? AND user_id = ?')
        .run([req.params.id, req.session.userId]);
    } else {
      // 別の選択肢に変更
      db.prepare('UPDATE map_option_votes SET option_id = ? WHERE post_id = ? AND user_id = ?')
        .run([option_id, req.params.id, req.session.userId]);
    }
  } else {
    db.prepare('INSERT INTO map_option_votes (post_id, option_id, user_id) VALUES (?, ?, ?)')
      .run([req.params.id, option_id, req.session.userId]);
    addPoints(req.session.userId, 1, '選択肢投票', 'map_option_vote', req.params.id);
  }

  const options = db.prepare(`
    SELECT mpo.id, mpo.label, COUNT(mov.id) as vote_count
    FROM map_post_options mpo
    LEFT JOIN map_option_votes mov ON mov.option_id = mpo.id
    WHERE mpo.post_id = ?
    GROUP BY mpo.id ORDER BY mpo.sort_order ASC
  `).all(req.params.id);

  const myOptionVote = db.prepare(
    'SELECT option_id FROM map_option_votes WHERE post_id = ? AND user_id = ?'
  ).get([req.params.id, req.session.userId]);

  res.json({ success: true, options, myOptionVote: myOptionVote ? myOptionVote.option_id : null });
});

// 投稿編集（投稿者 or 管理者）
router.put('/posts/:id', requireLogin, upload.single('photo'), (req, res) => {
  const { title, content, category, priority, remove_photo } = req.body;
  if (!title) return res.status(400).json({ error: 'タイトルは必須です' });

  const db = getDB();
  const post = db.prepare('SELECT user_id, photo_url FROM map_posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '投稿が見つかりません' });

  const isOwner = post.user_id === req.session.userId;
  const isAdmin = ['officer', 'admin'].includes(req.session.userStatus);
  if (!isOwner && !isAdmin) return res.status(403).json({ error: '権限がありません' });

  let photoUrl = post.photo_url;
  if (req.file) {
    // 新しい写真をアップロード
    photoUrl = `/uploads/${req.file.filename}`;
  } else if (remove_photo === '1') {
    // 写真を削除
    if (post.photo_url) {
      const oldPath = path.join(__dirname, '..', 'public', post.photo_url);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    photoUrl = null;
  }

  db.prepare('UPDATE map_posts SET title=?, content=?, category=?, priority=?, photo_url=? WHERE id=?')
    .run([title, content || '', category || 'other', priority || '様子見', photoUrl, req.params.id]);
  res.json({ success: true });
});

// 状態更新（投稿者 or 役員・管理者）
router.patch('/posts/:id/status', requireLogin, (req, res) => {
  const { status } = req.body;
  if (!['open', 'in_progress', 'resolved'].includes(status)) {
    return res.status(400).json({ error: '状態が不正です' });
  }

  const db = getDB();
  const post = db.prepare('SELECT user_id FROM map_posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '投稿が見つかりません' });

  const isOwner = post.user_id === req.session.userId;
  const isOfficer = ['officer', 'admin'].includes(req.session.userStatus);
  if (!isOwner && !isOfficer) return res.status(403).json({ error: '権限がありません' });

  db.prepare('UPDATE map_posts SET status = ? WHERE id = ?').run([status, req.params.id]);
  res.json({ success: true });
});

module.exports = router;
