/**
 * サークル内掲示板 - GASバックエンド
 * ------------------------------------------------
 * シート構成:
 *   Users : UserID | Name | Email | PasswordHash | Salt | CreatedAt
 *   Posts : PostID | AuthorName | Email | Content | CreatedAt
 *
 * 通信方式:
 *   フロントエンドから text/plain で POST することで
 *   ブラウザのCORSプリフライト(OPTIONS)を回避しています。
 *   (GASはOPTIONSリクエストをうまく扱えないため)
 */

const SS = SpreadsheetApp.getActiveSpreadsheet();
const USERS_SHEET = 'Users';
const POSTS_SHEET = 'Posts';
const SESSION_HOURS = 6; // セッション有効時間

/* ============ エントリーポイント ============ */

function doGet(e) {
  // 動作確認用（ブラウザで直接GAS URLを開いたときに表示）
  return ContentService.createTextOutput(
    JSON.stringify({ status: 'ok', message: 'サークル掲示板API is running.' })
  ).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let result;
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    switch (action) {
      case 'login':
        result = handleLogin(body.email, body.password);
        break;
      case 'logout':
        result = handleLogout(body.token);
        break;
      case 'getPosts':
        result = handleGetPosts(body.token);
        break;
      case 'addPost':
        result = handleAddPost(body.token, body.content);
        break;
      default:
        result = { success: false, message: '不正なactionです。' };
    }
  } catch (err) {
    result = { success: false, message: 'サーバーエラー: ' + err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============ 認証関連 ============ */

function handleLogin(email, password) {
  if (!email || !password) {
    return { success: false, message: 'メールアドレスとパスワードを入力してください。' };
  }
  email = email.trim().toLowerCase();

  const sheet = SS.getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const col = colIndexMap(header);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[col.Email]).trim().toLowerCase() === email) {
      const salt = row[col.Salt];
      const hash = hashPassword(password, salt);
      if (hash === row[col.PasswordHash]) {
        const token = createSession(email, row[col.Name]);
        return {
          success: true,
          token: token,
          name: row[col.Name],
          email: email
        };
      } else {
        return { success: false, message: 'パスワードが違います。' };
      }
    }
  }
  return { success: false, message: '登録されていないメールアドレスです。' };
}

function handleLogout(token) {
  if (token) {
    CacheService.getScriptCache().remove('session_' + token);
  }
  return { success: true };
}

/* セッション作成: CacheServiceにtoken -> {email, name} を保存 */
function createSession(email, name) {
  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  const payload = JSON.stringify({ email: email, name: name });
  cache.put('session_' + token, payload, SESSION_HOURS * 60 * 60); // 秒指定
  return token;
}

/* トークン検証。有効なら {email, name} を返す。無効ならnull */
function verifySession(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const raw = cache.get('session_' + token);
  if (!raw) return null;
  return JSON.parse(raw);
}

/* パスワードのハッシュ化 (SHA-256 + ソルト) */
function hashPassword(password, salt) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + password,
    Utilities.Charset.UTF_8
  );
  return digest.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

/* 新規会員をUsersシートに追加するための補助関数（GASエディタから手動実行用） */
function addUserManually() {
  const name = 'サンプル太郎';
  const email = 'sample@example.com';
  const password = 'changeme123'; // 実際に発行する初期パスワード

  const salt = Utilities.getUuid();
  const hash = hashPassword(password, salt);

  const sheet = SS.getSheetByName(USERS_SHEET);
  sheet.appendRow([
    Utilities.getUuid(),
    name,
    email,
    hash,
    salt,
    new Date()
  ]);
  Logger.log('追加しました: ' + email + ' / 初期パスワード: ' + password);
}

/* ============ 掲示板関連 ============ */

function handleGetPosts(token) {
  const session = verifySession(token);
  if (!session) {
    return { success: false, message: 'セッションが切れています。再ログインしてください。' };
  }

  const sheet = SS.getSheetByName(POSTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const col = colIndexMap(header);

  const posts = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[col.PostID]) continue;
    posts.push({
      postId: row[col.PostID],
      authorName: row[col.AuthorName],
      content: row[col.Content],
      createdAt: row[col.CreatedAt] instanceof Date
        ? row[col.CreatedAt].toISOString()
        : row[col.CreatedAt]
    });
  }
  // 新しい投稿が上に来るように並べ替え
  posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return { success: true, posts: posts };
}

function handleAddPost(token, content) {
  const session = verifySession(token);
  if (!session) {
    return { success: false, message: 'セッションが切れています。再ログインしてください。' };
  }
  if (!content || !content.trim()) {
    return { success: false, message: '本文を入力してください。' };
  }
  if (content.length > 1000) {
    return { success: false, message: '投稿は1000文字以内にしてください。' };
  }

  const sheet = SS.getSheetByName(POSTS_SHEET);
  const postId = Utilities.getUuid();
  const now = new Date();
  sheet.appendRow([postId, session.name, session.email, content.trim(), now]);

  return {
    success: true,
    post: {
      postId: postId,
      authorName: session.name,
      content: content.trim(),
      createdAt: now.toISOString()
    }
  };
}

/* ============ 共通ユーティリティ ============ */

function colIndexMap(header) {
  const map = {};
  header.forEach((name, idx) => { map[name] = idx; });
  return map;
}
