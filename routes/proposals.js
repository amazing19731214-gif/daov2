const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requireLogin, requireApproved } = require('../middleware/auth');
const { addPoints } = require('./points');

// 議題一覧
router.get('/', (req, res) => {
  const db = getDB();
  const proposals = db.prepare(`
    SELECT p.*, u.name as user_name,
      (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'agree') as agree_count,
      (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'disagree') as disagree_count,
      (SELECT COUNT(*) FROM proposal_comments WHERE proposal_id = p.id) as comment_count
    FROM proposals p
    LEFT JOIN users u ON p.user_id = u.id
    ORDER BY p.created_at DESC
  `).all();
  res.json(proposals);
});

// 議題詳細（閲覧でポイント付与）
router.get('/:id', (req, res) => {
  const db = getDB();
  const proposal = db.prepare(`
    SELECT p.*, u.name as user_name,
      (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'agree') as agree_count,
      (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'disagree') as disagree_count
    FROM proposals p
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!proposal) return res.status(404).json({ error: '議題が見つかりません' });

  const comments = db.prepare(`
    SELECT pc.*, u.name as user_name
    FROM proposal_comments pc
    LEFT JOIN users u ON pc.user_id = u.id
    WHERE pc.proposal_id = ?
    ORDER BY pc.created_at ASC
  `).all(req.params.id);

  // カスタム選択肢
  const options = db.prepare(`
    SELECT po.*, COUNT(pov.id) as vote_count
    FROM proposal_options po
    LEFT JOIN proposal_option_votes pov ON pov.option_id = po.id
    WHERE po.proposal_id = ?
    GROUP BY po.id
    ORDER BY po.sort_order ASC
  `).all(req.params.id);

  // ログイン中ユーザー：閲覧ポイント付与（初回のみ +1pt）
  let myVote = null;
  let myOptionVote = null;
  if (req.session.userId) {
    const read = db.prepare(
      'SELECT id FROM proposal_reads WHERE proposal_id = ? AND user_id = ?'
    ).get([req.params.id, req.session.userId]);

    if (!read) {
      db.prepare(`
        INSERT INTO proposal_reads (proposal_id, user_id, points_given) VALUES (?, ?, 1)
      `).run([req.params.id, req.session.userId]);
      addPoints(req.session.userId, 1, '議題閲覧', 'proposal', req.params.id);
    }

    const v = db.prepare(
      'SELECT vote_type FROM votes WHERE proposal_id = ? AND user_id = ?'
    ).get([req.params.id, req.session.userId]);
    myVote = v ? v.vote_type : null;

    const ov = db.prepare(
      'SELECT option_id FROM proposal_option_votes WHERE proposal_id = ? AND user_id = ?'
    ).get([req.params.id, req.session.userId]);
    myOptionVote = ov ? ov.option_id : null;
  }

  // 公開投票理由（is_anonymous=0 または本人のもの）
  const voteReasons = db.prepare(`
    SELECT v.vote_type, v.reason, v.is_anonymous,
      CASE WHEN v.is_anonymous = 1 THEN '匿名' ELSE u.name END as voter_name
    FROM votes v
    LEFT JOIN users u ON v.user_id = u.id
    WHERE v.proposal_id = ? AND v.reason IS NOT NULL AND v.reason != ''
    ORDER BY v.created_at DESC
  `).all(req.params.id);

  res.json({ ...proposal, comments, options, myVote, myOptionVote, voteReasons });
});

// 議題作成（承認済み以上）
router.post('/', requireApproved, (req, res) => {
  const { title, content, vote_start, vote_end, options } = req.body;
  if (!title) return res.status(400).json({ error: 'タイトルは必須です' });

  const db = getDB();
  const result = db.prepare(`
    INSERT INTO proposals (user_id, title, content, vote_start, vote_end)
    VALUES (?, ?, ?, ?, ?)
  `).run([req.session.userId, title, content, vote_start || null, vote_end || null]);

  const proposalId = result.lastInsertRowid;

  // カスタム選択肢があれば登録
  if (options && Array.isArray(options)) {
    options.forEach((label, i) => {
      if (label && label.trim()) {
        db.prepare('INSERT INTO proposal_options (proposal_id, label, sort_order) VALUES (?, ?, ?)')
          .run([proposalId, label.trim(), i]);
      }
    });
  }

  res.json({ success: true, id: proposalId });
});

// 議題編集（投稿者 or 管理者）
router.put('/:id', requireLogin, (req, res) => {
  const { title, content, vote_start, vote_end } = req.body;
  if (!title) return res.status(400).json({ error: 'タイトルは必須です' });

  const db = getDB();
  const proposal = db.prepare('SELECT user_id FROM proposals WHERE id = ?').get(req.params.id);
  if (!proposal) return res.status(404).json({ error: '議題が見つかりません' });

  const isOwner = proposal.user_id === req.session.userId;
  const isAdmin = ['officer', 'admin'].includes(req.session.userStatus);
  if (!isOwner && !isAdmin) return res.status(403).json({ error: '権限がありません' });

  db.prepare('UPDATE proposals SET title=?, content=?, vote_start=?, vote_end=? WHERE id=?')
    .run([title, content || '', vote_start || null, vote_end || null, req.params.id]);
  res.json({ success: true });
});

// カスタム選択肢投票（承認済み・1人1票）
router.post('/:id/option-vote', requireApproved, (req, res) => {
  const { option_id } = req.body;
  if (!option_id) return res.status(400).json({ error: '選択肢が必要です' });

  const db = getDB();
  const option = db.prepare('SELECT id FROM proposal_options WHERE id = ? AND proposal_id = ?')
    .get([option_id, req.params.id]);
  if (!option) return res.status(404).json({ error: '選択肢が見つかりません' });

  const existing = db.prepare(
    'SELECT id, option_id FROM proposal_option_votes WHERE proposal_id = ? AND user_id = ?'
  ).get([req.params.id, req.session.userId]);

  if (existing) {
    if (existing.option_id === option_id) {
      db.prepare('DELETE FROM proposal_option_votes WHERE proposal_id = ? AND user_id = ?')
        .run([req.params.id, req.session.userId]);
    } else {
      db.prepare('UPDATE proposal_option_votes SET option_id = ? WHERE proposal_id = ? AND user_id = ?')
        .run([option_id, req.params.id, req.session.userId]);
    }
  } else {
    db.prepare('INSERT INTO proposal_option_votes (proposal_id, option_id, user_id) VALUES (?, ?, ?)')
      .run([req.params.id, option_id, req.session.userId]);
    addPoints(req.session.userId, 1, '選択肢投票', 'proposal_option_vote', req.params.id);
  }

  const options = db.prepare(`
    SELECT po.id, po.label, COUNT(pov.id) as vote_count
    FROM proposal_options po
    LEFT JOIN proposal_option_votes pov ON pov.option_id = po.id
    WHERE po.proposal_id = ?
    GROUP BY po.id ORDER BY po.sort_order ASC
  `).all(req.params.id);

  const myOptionVote = db.prepare(
    'SELECT option_id FROM proposal_option_votes WHERE proposal_id = ? AND user_id = ?'
  ).get([req.params.id, req.session.userId]);

  res.json({ success: true, options, myOptionVote: myOptionVote ? myOptionVote.option_id : null });
});

// コメント投稿（+2pt）
router.post('/:id/comments', requireLogin, (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'コメント内容が必要です' });

  const db = getDB();
  const proposal = db.prepare('SELECT id FROM proposals WHERE id = ?').get(req.params.id);
  if (!proposal) return res.status(404).json({ error: '議題が見つかりません' });

  db.prepare(`
    INSERT INTO proposal_comments (proposal_id, user_id, content) VALUES (?, ?, ?)
  `).run([req.params.id, req.session.userId, content]);

  addPoints(req.session.userId, 2, '議題コメント', 'proposal_comment', req.params.id);
  res.json({ success: true });
});

// 投票（承認済み・1人1票・期間内のみ）
router.post('/:id/vote', requireApproved, (req, res) => {
  const { vote_type, reason, is_anonymous } = req.body;
  if (!['agree', 'disagree'].includes(vote_type)) {
    return res.status(400).json({ error: '投票タイプが不正です' });
  }

  const db = getDB();
  const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
  if (!proposal) return res.status(404).json({ error: '議題が見つかりません' });

  const now = new Date();
  if (proposal.vote_start && new Date(proposal.vote_start) > now) {
    return res.status(400).json({ error: '投票期間はまだ始まっていません' });
  }
  if (proposal.vote_end && new Date(proposal.vote_end) < now) {
    return res.status(400).json({ error: '投票期間が終了しました' });
  }

  const existing = db.prepare(
    'SELECT id FROM votes WHERE proposal_id = ? AND user_id = ?'
  ).get([req.params.id, req.session.userId]);

  const reasonVal = reason ? reason.trim() : null;
  const anonVal = is_anonymous ? 1 : 0;

  if (existing) {
    db.prepare('UPDATE votes SET vote_type=?, reason=?, is_anonymous=? WHERE proposal_id=? AND user_id=?')
      .run([vote_type, reasonVal, anonVal, req.params.id, req.session.userId]);
  } else {
    db.prepare('INSERT INTO votes (proposal_id, user_id, vote_type, reason, is_anonymous) VALUES (?, ?, ?, ?, ?)')
      .run([req.params.id, req.session.userId, vote_type, reasonVal, anonVal]);
    addPoints(req.session.userId, 2, '議題投票', 'vote', req.params.id);
  }

  const agree = db.prepare("SELECT COUNT(*) as c FROM votes WHERE proposal_id = ? AND vote_type = 'agree'").get(req.params.id).c;
  const disagree = db.prepare("SELECT COUNT(*) as c FROM votes WHERE proposal_id = ? AND vote_type = 'disagree'").get(req.params.id).c;

  const voteReasons = db.prepare(`
    SELECT v.vote_type, v.reason, v.is_anonymous,
      CASE WHEN v.is_anonymous = 1 THEN '匿名' ELSE u.name END as voter_name
    FROM votes v
    LEFT JOIN users u ON v.user_id = u.id
    WHERE v.proposal_id = ? AND v.reason IS NOT NULL AND v.reason != ''
    ORDER BY v.created_at DESC
  `).all(req.params.id);

  res.json({ success: true, agree, disagree, voteReasons });
});

module.exports = router;
