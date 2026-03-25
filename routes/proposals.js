const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { requireLogin, requireApproved, requireOfficer } = require('../middleware/auth');
const { addPoints } = require('./points');

// 議題一覧
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, u.name as user_name,
        (SELECT COUNT(*)::int FROM votes WHERE proposal_id = p.id AND vote_type = 'agree') as agree_count,
        (SELECT COUNT(*)::int FROM votes WHERE proposal_id = p.id AND vote_type = 'disagree') as disagree_count,
        (SELECT COUNT(*)::int FROM proposal_comments WHERE proposal_id = p.id) as comment_count
      FROM proposals p
      LEFT JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 議題詳細
router.get('/:id', async (req, res) => {
  try {
    const proposalRes = await pool.query(`
      SELECT p.*, u.name as user_name,
        (SELECT COUNT(*)::int FROM votes WHERE proposal_id = p.id AND vote_type = 'agree') as agree_count,
        (SELECT COUNT(*)::int FROM votes WHERE proposal_id = p.id AND vote_type = 'disagree') as disagree_count
      FROM proposals p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = $1
    `, [req.params.id]);

    const proposal = proposalRes.rows[0];
    if (!proposal) return res.status(404).json({ error: '議題が見つかりません' });

    const commentsRes = await pool.query(`
      SELECT pc.*, u.name as user_name
      FROM proposal_comments pc
      LEFT JOIN users u ON pc.user_id = u.id
      WHERE pc.proposal_id = $1
      ORDER BY pc.created_at ASC
    `, [req.params.id]);

    const optionsRes = await pool.query(`
      SELECT po.*, COUNT(pov.id)::int as vote_count
      FROM proposal_options po
      LEFT JOIN proposal_option_votes pov ON pov.option_id = po.id
      WHERE po.proposal_id = $1
      GROUP BY po.id
      ORDER BY po.sort_order ASC
    `, [req.params.id]);

    // 閲覧ポイント付与（初回のみ）
    let myVote = null;
    let myOptionVote = null;
    if (req.session.userId) {
      const readRes = await pool.query(
        'SELECT id FROM proposal_reads WHERE proposal_id = $1 AND user_id = $2',
        [req.params.id, req.session.userId]
      );
      if (readRes.rows.length === 0) {
        await pool.query(
          'INSERT INTO proposal_reads (proposal_id, user_id, points_given) VALUES ($1, $2, 1)',
          [req.params.id, req.session.userId]
        );
        await addPoints(req.session.userId, 1, '議題閲覧', 'proposal', req.params.id);
      }

      const vRes = await pool.query(
        'SELECT vote_type FROM votes WHERE proposal_id = $1 AND user_id = $2',
        [req.params.id, req.session.userId]
      );
      myVote = vRes.rows[0]?.vote_type || null;

      const ovRes = await pool.query(
        'SELECT option_id FROM proposal_option_votes WHERE proposal_id = $1 AND user_id = $2',
        [req.params.id, req.session.userId]
      );
      myOptionVote = ovRes.rows[0]?.option_id || null;
    }

    const voteReasonsRes = await pool.query(`
      SELECT v.vote_type, v.reason, v.is_anonymous,
        CASE WHEN v.is_anonymous = 1 THEN '匿名' ELSE u.name END as voter_name
      FROM votes v
      LEFT JOIN users u ON v.user_id = u.id
      WHERE v.proposal_id = $1 AND v.reason IS NOT NULL AND v.reason != ''
      ORDER BY v.created_at DESC
    `, [req.params.id]);

    res.json({
      ...proposal,
      comments: commentsRes.rows,
      options: optionsRes.rows,
      myVote,
      myOptionVote,
      voteReasons: voteReasonsRes.rows
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 議題作成（役員・管理者のみ）
router.post('/', requireOfficer, async (req, res) => {
  try {
    const { title, content, vote_start, vote_end, options } = req.body;
    if (!title) return res.status(400).json({ error: 'タイトルは必須です' });

    const result = await pool.query(`
      INSERT INTO proposals (user_id, title, content, vote_start, vote_end)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [req.session.userId, title, content, vote_start || null, vote_end || null]);

    const proposalId = result.rows[0].id;

    if (options && Array.isArray(options)) {
      for (let i = 0; i < options.length; i++) {
        if (options[i]?.trim()) {
          await pool.query(
            'INSERT INTO proposal_options (proposal_id, label, sort_order) VALUES ($1, $2, $3)',
            [proposalId, options[i].trim(), i]
          );
        }
      }
    }

    res.json({ success: true, id: proposalId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 議題編集
router.put('/:id', requireLogin, async (req, res) => {
  try {
    const { title, content, vote_start, vote_end } = req.body;
    if (!title) return res.status(400).json({ error: 'タイトルは必須です' });

    const propRes = await pool.query('SELECT user_id FROM proposals WHERE id = $1', [req.params.id]);
    const proposal = propRes.rows[0];
    if (!proposal) return res.status(404).json({ error: '議題が見つかりません' });

    const isOwner = proposal.user_id === req.session.userId;
    const isAdmin = ['officer', 'admin'].includes(req.session.userStatus);
    if (!isOwner && !isAdmin) return res.status(403).json({ error: '権限がありません' });

    await pool.query(
      'UPDATE proposals SET title=$1, content=$2, vote_start=$3, vote_end=$4 WHERE id=$5',
      [title, content || '', vote_start || null, vote_end || null, req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// カスタム選択肢投票
router.post('/:id/option-vote', requireApproved, async (req, res) => {
  try {
    const { option_id } = req.body;
    if (!option_id) return res.status(400).json({ error: '選択肢が必要です' });

    const optRes = await pool.query(
      'SELECT id FROM proposal_options WHERE id = $1 AND proposal_id = $2',
      [option_id, req.params.id]
    );
    if (optRes.rows.length === 0) return res.status(404).json({ error: '選択肢が見つかりません' });

    const existing = await pool.query(
      'SELECT id, option_id FROM proposal_option_votes WHERE proposal_id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );

    if (existing.rows.length > 0) {
      if (existing.rows[0].option_id === parseInt(option_id)) {
        await pool.query(
          'DELETE FROM proposal_option_votes WHERE proposal_id = $1 AND user_id = $2',
          [req.params.id, req.session.userId]
        );
      } else {
        await pool.query(
          'UPDATE proposal_option_votes SET option_id = $1 WHERE proposal_id = $2 AND user_id = $3',
          [option_id, req.params.id, req.session.userId]
        );
      }
    } else {
      await pool.query(
        'INSERT INTO proposal_option_votes (proposal_id, option_id, user_id) VALUES ($1, $2, $3)',
        [req.params.id, option_id, req.session.userId]
      );
      await addPoints(req.session.userId, 1, '選択肢投票', 'proposal_option_vote', req.params.id);
    }

    const optionsRes = await pool.query(`
      SELECT po.id, po.label, COUNT(pov.id)::int as vote_count
      FROM proposal_options po
      LEFT JOIN proposal_option_votes pov ON pov.option_id = po.id
      WHERE po.proposal_id = $1
      GROUP BY po.id ORDER BY po.sort_order ASC
    `, [req.params.id]);

    const myOptRes = await pool.query(
      'SELECT option_id FROM proposal_option_votes WHERE proposal_id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );

    res.json({ success: true, options: optionsRes.rows, myOptionVote: myOptRes.rows[0]?.option_id || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// コメント投稿
router.post('/:id/comments', requireLogin, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'コメント内容が必要です' });

    const propRes = await pool.query('SELECT id FROM proposals WHERE id = $1', [req.params.id]);
    if (propRes.rows.length === 0) return res.status(404).json({ error: '議題が見つかりません' });

    await pool.query(
      'INSERT INTO proposal_comments (proposal_id, user_id, content) VALUES ($1, $2, $3)',
      [req.params.id, req.session.userId, content]
    );

    await addPoints(req.session.userId, 2, '議題コメント', 'proposal_comment', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 投票
router.post('/:id/vote', requireApproved, async (req, res) => {
  try {
    const { vote_type, reason, is_anonymous } = req.body;
    if (!['agree', 'disagree'].includes(vote_type)) {
      return res.status(400).json({ error: '投票タイプが不正です' });
    }

    const propRes = await pool.query('SELECT * FROM proposals WHERE id = $1', [req.params.id]);
    const proposal = propRes.rows[0];
    if (!proposal) return res.status(404).json({ error: '議題が見つかりません' });

    const now = new Date();
    if (proposal.vote_start && new Date(proposal.vote_start) > now) {
      return res.status(400).json({ error: '投票期間はまだ始まっていません' });
    }
    if (proposal.vote_end && new Date(proposal.vote_end) < now) {
      return res.status(400).json({ error: '投票期間が終了しました' });
    }

    const existing = await pool.query(
      'SELECT id FROM votes WHERE proposal_id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );

    const reasonVal = reason ? reason.trim() : null;
    const anonVal = is_anonymous ? 1 : 0;

    if (existing.rows.length > 0) {
      await pool.query(
        'UPDATE votes SET vote_type=$1, reason=$2, is_anonymous=$3 WHERE proposal_id=$4 AND user_id=$5',
        [vote_type, reasonVal, anonVal, req.params.id, req.session.userId]
      );
    } else {
      await pool.query(
        'INSERT INTO votes (proposal_id, user_id, vote_type, reason, is_anonymous) VALUES ($1, $2, $3, $4, $5)',
        [req.params.id, req.session.userId, vote_type, reasonVal, anonVal]
      );
      await addPoints(req.session.userId, 2, '議題投票', 'vote', req.params.id);
    }

    const agreeRes = await pool.query(
      "SELECT COUNT(*)::int as c FROM votes WHERE proposal_id = $1 AND vote_type = 'agree'",
      [req.params.id]
    );
    const disagreeRes = await pool.query(
      "SELECT COUNT(*)::int as c FROM votes WHERE proposal_id = $1 AND vote_type = 'disagree'",
      [req.params.id]
    );

    const voteReasonsRes = await pool.query(`
      SELECT v.vote_type, v.reason, v.is_anonymous,
        CASE WHEN v.is_anonymous = 1 THEN '匿名' ELSE u.name END as voter_name
      FROM votes v
      LEFT JOIN users u ON v.user_id = u.id
      WHERE v.proposal_id = $1 AND v.reason IS NOT NULL AND v.reason != ''
      ORDER BY v.created_at DESC
    `, [req.params.id]);

    res.json({
      success: true,
      agree: agreeRes.rows[0].c,
      disagree: disagreeRes.rows[0].c,
      voteReasons: voteReasonsRes.rows
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
