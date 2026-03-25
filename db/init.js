const { getDB } = require('./database');

function initDB() {
  const db = getDB();

  // ユーザーテーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_id TEXT UNIQUE,
      name TEXT DEFAULT 'ゲスト',
      address TEXT,
      phone TEXT,
      status TEXT DEFAULT 'provisional',
      points INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 本登録申請テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS registration_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      phone TEXT NOT NULL,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      reviewer_id INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 地図投稿テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS map_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      category TEXT DEFAULT 'other',
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      photo_url TEXT,
      status TEXT DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 地図コメントテーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS map_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES map_posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 地図投票テーブル（1人1票）
  db.exec(`
    CREATE TABLE IF NOT EXISTS map_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      vote_type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES map_posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 担当割り当てテーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS map_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      assigned_to INTEGER NOT NULL,
      assigned_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES map_posts(id)
    )
  `);

  // 議題テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      status TEXT DEFAULT 'open',
      vote_start DATETIME,
      vote_end DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 議題コメントテーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS proposal_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (proposal_id) REFERENCES proposals(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 議題投票テーブル（1人1票）
  db.exec(`
    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      vote_type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(proposal_id, user_id),
      FOREIGN KEY (proposal_id) REFERENCES proposals(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 地図投稿カスタム選択肢テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS map_post_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (post_id) REFERENCES map_posts(id)
    )
  `);

  // カスタム選択肢投票テーブル（1人1票）
  db.exec(`
    CREATE TABLE IF NOT EXISTS map_option_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      option_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES map_posts(id),
      FOREIGN KEY (option_id) REFERENCES map_post_options(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 承認ログテーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      admin_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ポイントログテーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      points INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_type TEXT,
      ref_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 議題閲覧ログテーブル（重複付与防止）
  db.exec(`
    CREATE TABLE IF NOT EXISTS proposal_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      points_given INTEGER DEFAULT 0,
      UNIQUE(proposal_id, user_id),
      FOREIGN KEY (proposal_id) REFERENCES proposals(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // map_posts に priority カラム追加（既存DBへのマイグレーション）
  try {
    db.exec("ALTER TABLE map_posts ADD COLUMN priority TEXT DEFAULT '様子見'");
  } catch(e) { /* 既に存在する場合は無視 */ }

  // votes に reason / is_anonymous カラム追加
  try { db.exec("ALTER TABLE votes ADD COLUMN reason TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE votes ADD COLUMN is_anonymous INTEGER DEFAULT 0"); } catch(e) {}

  // 地図閲覧テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS map_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES map_posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Q&Aテーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS qa_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL DEFAULT '一般',
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Q&A初期データ
  const qaExists = db.prepare('SELECT id FROM qa_items LIMIT 1').get();
  if (!qaExists) {
    const ins = db.prepare('INSERT INTO qa_items (category, question, answer, sort_order) VALUES (?,?,?,?)');
    const items = [
      ['加入・退会','自治会に加入するにはどうすればいいですか？','班長または役員にお声がけいただくか、このアプリの「本登録申請」から申請してください。管理者が審査・承認後、正会員となります。',1],
      ['加入・退会','自治会を退会したい場合はどうすればいいですか？','班長または役員まで退会の旨をお伝えください。年度途中での退会の場合、会費の返還はできませんのでご了承ください。',2],
      ['加入・退会','賃貸に住んでいますが加入できますか？','はい、賃貸にお住まいの方も加入できます。地域の一員として、ぜひご参加ください。',3],
      ['会費','会費はいくらですか？','年間〇〇円（詳細は班長にご確認ください）です。毎年〇月頃に班長が集金に伺います。',4],
      ['会費','会費は何に使われていますか？','地域の行事・イベント費用、公園・集会所の維持管理費、防災用品の購入、回覧板・広報誌の印刷費などに使用されます。年度末の総会で収支報告を行います。',5],
      ['会費','会費の支払いが遅れてしまった場合は？','班長または会計担当にご連絡ください。できる限りご対応します。',6],
      ['役員・運営','役員はどのように決まりますか？','毎年の定期総会で選出されます。班長からの推薦や立候補で決まります。任期は1年（再任可）です。',7],
      ['役員・運営','班長の仕事は何ですか？','回覧板の回覧、会費の集金、行事への参加・協力、住民からの要望・相談の取り次ぎなどを担当します。',8],
      ['役員・運営','役員を断ることはできますか？','原則として地域住民で輪番制を取っています。やむを得ない事情がある場合は役員会にご相談ください。',9],
      ['行事・イベント','どんな行事がありますか？','主な行事として、一斉清掃、運動会、お祭り、どんど焼き、防災訓練、定期総会などがあります。年間スケジュールはこのアプリの「予定」タブでご確認いただけます。',10],
      ['行事・イベント','行事への参加は必須ですか？','強制ではありませんが、地域のつながりのためにできる限りご参加をお願いしています。ご都合が悪い場合は班長にご連絡ください。',11],
      ['行事・イベント','子どもだけで参加できる行事はありますか？','運動会やお祭りはご家族でご参加いただけます。子ども向けのプログラムもご用意しています。',12],
      ['清掃・ゴミ','一斉清掃はいつですか？','年2回（夏・年末）実施しています。詳しい日程はアプリの「予定」タブ、または回覧板でお知らせします。',13],
      ['清掃・ゴミ','ゴミの分別・収集について教えてください。','市区町村のルールに従ってください。ゴミステーションの管理は各班が輪番で担当しています。不明点は班長または市区町村の窓口にお問い合わせください。',14],
      ['清掃・ゴミ','粗大ゴミはどうすればいいですか？','市区町村の粗大ゴミ収集サービスをご利用ください。自治会では粗大ゴミの収集は行っていません。',15],
      ['防災','自治会の防災活動について教えてください。','毎年防災訓練を実施しています。また、防災倉庫に非常用資機材を備蓄しています。避難場所は〇〇（詳細は班長にご確認ください）です。',16],
      ['防災','災害時の連絡方法は？','このアプリの地図機能で被害状況を共有できます。また、緊急の場合は班長・役員に直接ご連絡ください。',17],
      ['防災','一人暮らしの高齢者ですが、災害時に支援はありますか？','自治会では要配慮者支援の取り組みを行っています。役員または班長にご相談いただければ、支援体制について個別に対応します。',18],
      ['回覧板・連絡','回覧板が回ってきません。','班長にご連絡ください。引っ越し等で回覧順が変わっている可能性があります。',19],
      ['回覧板・連絡','アパート・マンションに住んでいますが回覧板はどうなりますか？','管理組合や各戸への配布など、建物の状況に応じて対応しています。班長にご確認ください。',20],
      ['このアプリ','このアプリはどのように使いますか？','LINEアカウントでログインし、本登録申請を行うと正会員として投票・コメントができます。地図で地域の問題を投稿・共有したり、議題に参加したりできます。',21],
      ['このアプリ','個人情報は安全ですか？','氏名・住所・電話番号は管理者のみが閲覧できます。他の会員には表示されません。',22],
      ['このアプリ','スマートフォンを持っていない場合はどうすればいいですか？','紙の回覧板や班長を通じて情報をお伝えします。アプリがなくても自治会活動に参加いただけます。',23],
    ];
    items.forEach(i => ins.run(i));
    console.log('✅ Q&A初期データ投入完了');
  }

  // スケジュールテーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month INTEGER NOT NULL,
      date_label TEXT NOT NULL,
      dow TEXT DEFAULT '',
      time_label TEXT DEFAULT '',
      title TEXT NOT NULL,
      who TEXT DEFAULT '',
      note TEXT DEFAULT '',
      category TEXT DEFAULT 'その他',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // スケジュール初期データ（未登録の場合のみ）
  const scheduleExists = db.prepare('SELECT id FROM schedule_events LIMIT 1').get();
  if (!scheduleExists) {
    const ins = db.prepare(`INSERT INTO schedule_events (month,date_label,dow,time_label,title,who,note,category,sort_order) VALUES (?,?,?,?,?,?,?,?,?)`);
    const events = [
      [5,"2026/05/09","土","18:00-19:00","役員会","役員","年間スケジュール展開、専門部活動紹介、専門部員配置決め、班長役割説明","役員会",1],
      [5,"2026/05/09","土","19:00-20:00","定例会","役員、班長","","定例会",2],
      [5,"2026/05/09","土","","案内送付","役員","各関連団体の会計監査→受け渡し案内送付","回覧・案内",3],
      [5,"2026/05/23","土","18:00-20:00","役員会","役員","会費徴収・一斉清掃・運動会・お祭り（11月）準備、課題対応検討","役員会",4],
      [5,"2026/05/30","土","","回覧","文化厚生部","ボランティア募集の回覧（お祭り/運動会）、一斉清掃案内など","回覧・案内",5],
      [6,"2026/06/06","土","10:00-11:00","補助金配布","三役、団体代表","関連団体補助金配布・受領","その他",1],
      [6,"2026/06/13","土","18:00-19:00","役員会","役員","","役員会",2],
      [6,"2026/06/13","土","19:00-20:00","定例会","役員、班長","会費・消防団後期会費、班員最新状況確認","定例会",3],
      [6,"2026/06/13","土","","会費徴収","会計、班長","（仮）","その他",4],
      [6,"6/14〜6/28","","8:00-8:15","夏季一斉清掃","","","清掃",5],
      [7,"2026/07/19","日","","ボランティア会合（1）","三役、専門部長、ボランティア","","行事",1],
      [7,"2026/07/25","土","18:00-20:00","役員会","役員","お祭り当日段取り（素案）・運動会準備","役員会",2],
      [8,"2026/08/08","土","","ボランティア会合（2）","三役、専門部長、ボランティア","防災訓練・運動会・お祭り準備の確認","行事",1],
      [8,"2026/08/22","土","18:00-19:00","役員会","役員","運動会準備状況説明、課題対応検討","役員会",2],
      [8,"2026/08/22","土","19:00-20:00","定例会","役員、班長","（参考）総合防災訓練の共有など","定例会",3],
      [9,"2026/09/26","土","18:00-19:00","役員会","役員","運動会・お祭り最終準備","役員会",1],
      [9,"2026/09/26","土","19:00-20:00","定例会","役員、班長","","定例会",2],
      [10,"2026/10/04","日","","荻野地区大運動会","体育部、ボランティア、他","※日曜日開催","行事",1],
      [10,"2026/10/10","土","10:00-11:00","会計監査","三役、会計部長","前期・運動会関連など","棚卸・監査",2],
      [10,"2026/10/24","土","18:00-20:00","役員会","役員","運動会結果報告、お祭り準備、課題対応検討","役員会",3],
      [11,"2026/11/14","土","","お祭り","文化厚生部、ボランティア、他","11月開催","行事",1],
      [11,"2026/11/28","土","18:00-19:00","役員会","役員","棚卸実施説明、次年度役員選出案内","役員会",2],
      [11,"2026/11/28","土","19:00-20:00","定例会","役員、班長","年末美化清掃の案内など","定例会",3],
      [12,"2026/12/06","日","","棚卸","","自治会館、山の手公園","棚卸・監査",1],
      [12,"2026/12/19","土","18:00-19:00","役員会","役員","棚卸結果報告、どんど焼き最終確認","役員会",2],
      [12,"2026/12/19","土","19:00-20:00","定例会","役員、班長","","定例会",3],
      [1,"2027/01/10","日","","どんど焼き","体育部、役員、他","山の手公園","行事",1],
      [1,"2027/01/23","土","18:00-19:00","役員会","役員","次年度役員選出状況確認、定期総会準備関連","役員会",2],
      [1,"2027/01/23","土","19:00-20:00","定例会","役員、班長","次年度役員決定、班長活動費配布案内","定例会",3],
      [2,"2027/02/06","土","","関連団体活動確認","三役、関連団体","活動状況確認、次年度補助金検討","その他",1],
      [3,"3/13〜3/14","","","年度末会計・会務点検","","決算・予算の確認、議事録点検","棚卸・監査",1],
      [3,"3/27〜3/28","","","総会資料配布（回覧）","","総会資料案の配布（会員へ）","回覧・案内",2],
      [3,"2027/03/27","土","18:00-19:00","役員会","役員","定期総会準備状況報告、次年度役員引継ぎ","役員会",3],
      [4,"2027/04/10","土","19:00-20:00","定例会","役員、班長","定期総会関連、次年度班長引継ぎ関連","定例会",1],
      [4,"2027/04/17","土","","定期総会","会員、役員、班長","事業・会計承認／新年度方針（第三土曜）","行事",2],
    ];
    events.forEach(e => ins.run(e));
    console.log('✅ スケジュール初期データ投入完了');
  }

  // 議題カスタム選択肢テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS proposal_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (proposal_id) REFERENCES proposals(id)
    )
  `);

  // 議題カスタム選択肢投票テーブル（1人1票）
  db.exec(`
    CREATE TABLE IF NOT EXISTS proposal_option_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER NOT NULL,
      option_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(proposal_id, user_id),
      FOREIGN KEY (proposal_id) REFERENCES proposals(id),
      FOREIGN KEY (option_id) REFERENCES proposal_options(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 初期管理者アカウント（存在しない場合のみ作成）
  const adminExists = db.prepare("SELECT id FROM users WHERE status = 'admin' LIMIT 1").get();
  if (!adminExists) {
    db.prepare(`
      INSERT INTO users (line_id, name, address, status)
      VALUES ('admin_line_id', '管理者', '自治会本部', 'admin')
    `).run();
    console.log('✅ 初期管理者作成: line_id = admin_line_id');
  }

  console.log('✅ DB初期化完了');
}

module.exports = { initDB };
