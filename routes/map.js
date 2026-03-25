const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db/database');
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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('画像ファイルのみアップロード可能です'));
  }
});

// ピン一覧
router.get('/posts', async (req, res) => {
  try {
    const { category, status } = req.query;
    let query = `
      SELECT mp.*, u.name as user_name,
        (SELECT COUNT(*)::int FROM map_votes WHERE post_id = mp.id AND vote_type = 'agree') as agree_count,
        (SELECT COUNT(*)::int FROM map_votes WHERE post_id = mp.id AND vote_type = 'disagree') as disagree_count,
        (SELECT COUNT(*)::int FROM map_comments WHERE post_id = mp.id) as comment_count
      FROM map_posts mp
      LEFT JOIN users u ON mp.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (category && category !== 'all') { query += ` AND mp.category = $${idx++}`; params.push(category); }
    if (status) { query += ` AND mp.status = $${idx++}`; params.push(status); }
    query += ' ORDER BY mp.created_at DESC';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ピン詳細
router.get('/posts/:id', async (req, res) => {
  try {
    const postRes = await pool.query(`
      SELECT mp.*, u.name as user_name,
        (SELECT COUNT(*)::int FROM map_votes WHERE post_id = mp.id AND vote_type = 'agree') as agree_count,
        (SELECT COUNT(*)::int FROM map_votes WHERE post_id = mp.id AND vote_type = 'disagree') as disagree_count
      FROM map_posts mp
      LEFT JOIN users u ON mp.user_id = u.id
      WHERE mp.id = $1
    `, [req.params.id]);

    const post = postRes.rows[0];
    if (!post) return res.status(404).json({ error: '投稿が見つかりません' });

    const commentsRes = await pool.query(`
      SELECT mc.*, u.name as user_name
      FROM map_comments mc
      LEFT JOIN users u ON mc.user_id = u.id
      WHERE mc.post_id = $1
      ORDER BY mc.created_at ASC
    `, [req.params.id]);

    const viewRes = await pool.query(
      'SELECT COUNT(*)::int as c FROM map_views WHERE post_id = $1',
      [req.params.id]
    );
    const viewCount = viewRes.rows[0].c;

    let myView = false;
    if (req.session.userId) {
      const v = await pool.query(
        'SELECT id FROM map_views WHERE post_id = $1 AND user_id = $2',
        [req.params.id, req.session.userId]
      );
      myView = v.rows.length > 0;
    }

    const optionsRes = await pool.query(`
      SELECT mpo.*, COUNT(mov.id)::int as vote_count
      FROM map_post_options mpo
      LEFT JOIN map_option_votes mov ON mov.option_id = mpo.id
      WHERE mpo.post_id = $1
      GROUP BY mpo.id
      ORDER BY mpo.sort_order ASC
    `, [req.params.id]);

    let myVote = null;
    let myOptionVote = null;
    if (req.session.userId) {
      const v = await pool.query(
        'SELECT vote_type FROM map_votes WHERE post_id = $1 AND user_id = $2',
        [req.params.id, req.session.userId]
      );
      myVote = v.rows[0]?.vote_type || null;

      const ov = await pool.query(
        'SELECT option_id FROM map_option_votes WHERE post_id = $1 AND user_id = $2',
        [req.params.id, req.session.userId]
      );
      myOptionVote = ov.rows[0]?.option_id || null;
    }

    res.json({ ...post, comments: commentsRes.rows, options: optionsRes.rows, myVote, myOptionVote, viewCount, myView });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ピン投稿
router.post('/posts', requireApproved, upload.single('photo'), async (req, res) => {
  try {
    const { title, content, category, lat, lng, priority } = req.body;
    if (!title || !lat || !lng) {
      return res.status(400).json({ error: 'タイトル・位置情報は必須です' });
    }

    const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const result = await pool.query(`
      INSERT INTO map_posts (user_id, title, content, category, lat, lng, photo_url, priority)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [req.session.userId, title, content, category || 'other', lat, lng, photoUrl, priority || '様子見']);

    const postId = result.rows[0].id;

    const options = req.body.options;
    if (options) {
      const optList = Array.isArray(options) ? options : [options];
      for (let i = 0; i < optList.length; i++) {
        if (optList[i]?.trim()) {
          await pool.query(
            'INSERT INTO map_post_options (post_id, label, sort_order) VALUES ($1, $2, $3)',
            [postId, optList[i].trim(), i]
          );
        }
      }
    }

    await addPoints(req.session.userId, 3, '地図投稿', 'map_post', postId);
    res.json({ success: true, id: postId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// コメント投稿
router.post('/posts/:id/comments', requireApproved, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'コメント内容が必要です' });

    const postRes = await pool.query('SELECT id FROM map_posts WHERE id = $1', [req.params.id]);
    if (postRes.rows.length === 0) return res.status(404).json({ error: '投稿が見つかりません' });

    await pool.query(
      'INSERT INTO map_comments (post_id, user_id, content) VALUES ($1, $2, $3)',
      [req.params.id, req.session.userId, content]
    );

    await addPoints(req.session.userId, 2, '地図コメント', 'map_comment', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 投票
router.post('/posts/:id/vote', requireApproved, async (req, res) => {
  try {
    const { vote_type } = req.body;
    if (!['agree', 'disagree'].includes(vote_type)) {
      return res.status(400).json({ error: '投票タイプが不正です' });
    }

    const postRes = await pool.query('SELECT id FROM map_posts WHERE id = $1', [req.params.id]);
    if (postRes.rows.length === 0) return res.status(404).json({ error: '投稿が見つかりません' });

    const existing = await pool.query(
      'SELECT id FROM map_votes WHERE post_id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        'UPDATE map_votes SET vote_type = $1 WHERE post_id = $2 AND user_id = $3',
        [vote_type, req.params.id, req.session.userId]
      );
    } else {
      await pool.query(
        'INSERT INTO map_votes (post_id, user_id, vote_type) VALUES ($1, $2, $3)',
        [req.params.id, req.session.userId, vote_type]
      );
      await addPoints(req.session.userId, 1, '地図投票', 'map_vote', req.params.id);
    }

    const agreeRes = await pool.query(
      "SELECT COUNT(*)::int as c FROM map_votes WHERE post_id = $1 AND vote_type = 'agree'",
      [req.params.id]
    );
    const disagreeRes = await pool.query(
      "SELECT COUNT(*)::int as c FROM map_votes WHERE post_id = $1 AND vote_type = 'disagree'",
      [req.params.id]
    );

    res.json({ success: true, agree: agreeRes.rows[0].c, disagree: disagreeRes.rows[0].c });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 閲覧記録
router.post('/posts/:id/view', requireLogin, async (req, res) => {
  try {
    const postRes = await pool.query('SELECT id FROM map_posts WHERE id = $1', [req.params.id]);
    if (postRes.rows.length === 0) return res.status(404).json({ error: '投稿が見つかりません' });

    const existing = await pool.query(
      'SELECT id FROM map_views WHERE post_id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );

    if (existing.rows.length === 0) {
      await pool.query(
        'INSERT INTO map_views (post_id, user_id) VALUES ($1, $2)',
        [req.params.id, req.session.userId]
      );
      await addPoints(req.session.userId, 1, '地図投稿閲覧', 'map_view', req.params.id);
    }

    const viewRes = await pool.query(
      'SELECT COUNT(*)::int as c FROM map_views WHERE post_id = $1',
      [req.params.id]
    );
    res.json({ success: true, viewCount: viewRes.rows[0].c, myView: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// カスタム選択肢投票
router.post('/posts/:id/option-vote', requireApproved, async (req, res) => {
  try {
    const { option_id } = req.body;
    if (!option_id) return res.status(400).json({ error: '選択肢が必要です' });

    const optionRes = await pool.query(
      'SELECT id FROM map_post_options WHERE id = $1 AND post_id = $2',
      [option_id, req.params.id]
    );
    if (optionRes.rows.length === 0) return res.status(404).json({ error: '選択肢が見つかりません' });

    const existing = await pool.query(
      'SELECT id, option_id FROM map_option_votes WHERE post_id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );

    if (existing.rows.length > 0) {
      if (existing.rows[0].option_id === parseInt(option_id)) {
        await pool.query(
          'DELETE FROM map_option_votes WHERE post_id = $1 AND user_id = $2',
          [req.params.id, req.session.userId]
        );
      } else {
        await pool.query(
          'UPDATE map_option_votes SET option_id = $1 WHERE post_id = $2 AND user_id = $3',
          [option_id, req.params.id, req.session.userId]
        );
      }
    } else {
      await pool.query(
        'INSERT INTO map_option_votes (post_id, option_id, user_id) VALUES ($1, $2, $3)',
        [req.params.id, option_id, req.session.userId]
      );
      await addPoints(req.session.userId, 1, '選択肢投票', 'map_option_vote', req.params.id);
    }

    const optionsRes = await pool.query(`
      SELECT mpo.id, mpo.label, COUNT(mov.id)::int as vote_count
      FROM map_post_options mpo
      LEFT JOIN map_option_votes mov ON mov.option_id = mpo.id
      WHERE mpo.post_id = $1
      GROUP BY mpo.id ORDER BY mpo.sort_order ASC
    `, [req.params.id]);

    const myOptRes = await pool.query(
      'SELECT option_id FROM map_option_votes WHERE post_id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );

    res.json({ success: true, options: optionsRes.rows, myOptionVote: myOptRes.rows[0]?.option_id || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 投稿編集
router.put('/posts/:id', requireLogin, upload.single('photo'), async (req, res) => {
  try {
    const { title, content, category, priority, remove_photo } = req.body;
    if (!title) return res.status(400).json({ error: 'タイトルは必須です' });

    const postRes = await pool.query(
      'SELECT user_id, photo_url FROM map_posts WHERE id = $1',
      [req.params.id]
    );
    const post = postRes.rows[0];
    if (!post) return res.status(404).json({ error: '投稿が見つかりません' });

    const isOwner = post.user_id === req.session.userId;
    const isAdmin = ['officer', 'admin'].includes(req.session.userStatus);
    if (!isOwner && !isAdmin) return res.status(403).json({ error: '権限がありません' });

    let photoUrl = post.photo_url;
    if (req.file) {
      photoUrl = `/uploads/${req.file.filename}`;
    } else if (remove_photo === '1') {
      if (post.photo_url) {
        const oldPath = path.join(__dirname, '..', 'public', post.photo_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      photoUrl = null;
    }

    await pool.query(
      'UPDATE map_posts SET title=$1, content=$2, category=$3, priority=$4, photo_url=$5 WHERE id=$6',
      [title, content || '', category || 'other', priority || '様子見', photoUrl, req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 状態更新
router.patch('/posts/:id/status', requireLogin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['open', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({ error: '状態が不正です' });
    }

    const postRes = await pool.query('SELECT user_id FROM map_posts WHERE id = $1', [req.params.id]);
    const post = postRes.rows[0];
    if (!post) return res.status(404).json({ error: '投稿が見つかりません' });

    const isOwner = post.user_id === req.session.userId;
    const isOfficer = ['officer', 'admin'].includes(req.session.userStatus);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: '権限がありません' });

    await pool.query('UPDATE map_posts SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
