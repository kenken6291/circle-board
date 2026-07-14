/**
 * サークル内掲示板 - GASバックエンド (v2: セルフ会員登録対応版)
 * ------------------------------------------------
 * シート構成:
 *   Users : UserID | Email | Nickname | PasswordHash | Salt |
 *           MustChangePassword | AgreedAt | CreatedAt | UpdatedAt
 *   Posts : PostID | AuthorName | Email | Content | CreatedAt
 *
 * 通信方式:
 *   フロントエンドから text/plain で POST することで
 *   ブラウザのCORSプリフライト(OPTIONS)を回避しています。
 */

const SS = SpreadsheetApp.getActiveSpreadsheet();
const USERS_SHEET = 'Users';
const POSTS_SHEET = 'Posts';
const SESSION_HOURS = 6;          // ログインセッションの有効時間
const MAX_LOGIN_FAILS = 5;        // ロックアウトまでの失敗回数
const LOCK_MINUTES = 15;          // ロックアウト時間（分）

// パスワードハッシュ用の「胡椒」。必ずご自身の文字列に変更してください。
const PEPPER = 'CHANGE_THIS_TO_YOUR_OWN_RANDOM_STRING_2026';

/* ============ エントリーポイント ============ */

function doGet(e) {
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
      case 'register':
        result = handleRegister(body.email, body.nickname, body.agreeTerms);
        break;
      case 'login':
        result = handleLogin(body.email, body.password);
        break;
      case 'forgotPassword':
        result = handleForgotPassword(body.email);
        break;
      case 'changePassword':
        result = handleChangePassword(body.token, body.currentPassword, body.newPassword);
        break;
      case 'updateProfile':
        result = handleUpdateProfile(body.token, body.nickname);
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

/* ============ 会員登録 ============ */

function handleRegister(email, nickname, agreeTerms) {
  if (!email || !nickname) {
    return { success: false, message: 'メールアドレスとニックネームを入力してください。' };
  }
  if (!agreeTerms) {
    return { success: false, message: '注意事項・免責事項への同意が必要です。' };
  }
  email = normalizeEmail(email);
  nickname = nickname.trim();
  if (nickname.length > 30) {
    return { success: false, message: 'ニックネームは30文字以内にしてください。' };
  }
  if (!isValidEmail(email)) {
    return { success: false, message: 'メールアドレスの形式が正しくありません。' };
  }

  const sheet = SS.getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const col = colIndexMap(header);

  // 既存メールかどうかチェック（列挙攻撃対策として、結果メッセージは登録成功時と同じにする）
  for (let i = 1; i < data.length; i++) {
    if (normalizeEmail(data[i][col.Email]) === email) {
      return {
        success: true,
        message: '登録手続きが完了しました。ご入力いただいたメールアドレス宛に確認メールをご確認ください。'
      };
    }
  }

  const tempPassword = generateTempPassword();
  const salt = Utilities.getUuid();
  const hash = hashPassword(tempPassword, salt);
  const now = new Date();

  sheet.appendRow([
    Utilities.getUuid(),
    email,
    nickname,
    hash,
    salt,
    true,   // MustChangePassword
    now,    // AgreedAt
    now,    // CreatedAt
    now     // UpdatedAt
  ]);

  sendMail(
    email,
    '【サークル内掲示板】仮パスワードのお知らせ',
    `${nickname} 様\n\n` +
    `サークル内掲示板へのご登録ありがとうございます。\n` +
    `以下の仮パスワードでログインし、初回ログイン時に必ずパスワードを変更してください。\n\n` +
    `メールアドレス: ${email}\n` +
    `仮パスワード: ${tempPassword}\n\n` +
    `このメールに心当たりがない場合は、破棄してください。`
  );

  return {
    success: true,
    message: '登録手続きが完了しました。ご入力いただいたメールアドレス宛に確認メールをご確認ください。'
  };
}

/* ============ 認証関連 ============ */

function handleLogin(email, password) {
  if (!email || !password) {
    return { success: false, message: 'メールアドレスとパスワードを入力してください。' };
  }
  email = normalizeEmail(email);

  const lock = checkLockout(email);
  if (lock.locked) {
    return { success: false, message: `試行回数が上限に達しました。${lock.remainingMinutes}分後に再度お試しください。` };
  }

  const sheet = SS.getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const col = colIndexMap(header);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (normalizeEmail(row[col.Email]) === email) {
      const salt = row[col.Salt];
      const hash = hashPassword(password, salt);
      if (hash === row[col.PasswordHash]) {
        clearLoginFails(email);
        const token = createSession(email, row[col.Nickname]);
        return {
          success: true,
          token: token,
          nickname: row[col.Nickname],
          email: email,
          mustChangePassword: !!row[col.MustChangePassword]
        };
      } else {
        registerLoginFail(email);
        return { success: false, message: 'メールアドレスまたはパスワードが違います。' };
      }
    }
  }
  registerLoginFail(email);
  return { success: false, message: 'メールアドレスまたはパスワードが違います。' };
}

function handleForgotPassword(email) {
  if (!email) {
    return { success: false, message: 'メールアドレスを入力してください。' };
  }
  email = normalizeEmail(email);

  const sheet = SS.getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const col = colIndexMap(header);

  const genericMessage = 'ご登録のメールアドレスの場合、仮パスワードを送信しました。メールをご確認ください。';

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (normalizeEmail(row[col.Email]) === email) {
      const tempPassword = generateTempPassword();
      const salt = Utilities.getUuid();
      const hash = hashPassword(tempPassword, salt);
      const rowIndex = i + 1;

      sheet.getRange(rowIndex, col.PasswordHash + 1).setValue(hash);
      sheet.getRange(rowIndex, col.Salt + 1).setValue(salt);
      sheet.getRange(rowIndex, col.MustChangePassword + 1).setValue(true);
      sheet.getRange(rowIndex, col.UpdatedAt + 1).setValue(new Date());

      sendMail(
        email,
        '【サークル内掲示板】仮パスワード再発行のお知らせ',
        `${row[col.Nickname]} 様\n\n` +
        `パスワード再発行のご依頼を受け付けました。\n` +
        `以下の仮パスワードでログインし、初回ログイン時に必ずパスワードを変更してください。\n\n` +
        `メールアドレス: ${email}\n` +
        `仮パスワード: ${tempPassword}\n\n` +
        `このメールに心当たりがない場合は、破棄してください。`
      );
      break;
    }
  }

  return { success: true, message: genericMessage };
}

function handleChangePassword(token, currentPassword, newPassword) {
  const session = verifySession(token);
  if (!session) {
    return { success: false, message: 'セッションが切れています。再ログインしてください。' };
  }
  if (!currentPassword || !newPassword) {
    return { success: false, message: '現在のパスワードと新しいパスワードを入力してください。' };
  }
  if (newPassword.length < 8) {
    return { success: false, message: '新しいパスワードは8文字以上にしてください。' };
  }

  const sheet = SS.getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const col = colIndexMap(header);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (normalizeEmail(row[col.Email]) === session.email) {
      const hash = hashPassword(currentPassword, row[col.Salt]);
      if (hash !== row[col.PasswordHash]) {
        return { success: false, message: '現在のパスワードが正しくありません。' };
      }
      const newSalt = Utilities.getUuid();
      const newHash = hashPassword(newPassword, newSalt);
      const rowIndex = i + 1;

      sheet.getRange(rowIndex, col.PasswordHash + 1).setValue(newHash);
      sheet.getRange(rowIndex, col.Salt + 1).setValue(newSalt);
      sheet.getRange(rowIndex, col.MustChangePassword + 1).setValue(false);
      sheet.getRange(rowIndex, col.UpdatedAt + 1).setValue(new Date());

      return { success: true, message: 'パスワードを変更しました。' };
    }
  }
  return { success: false, message: 'ユーザーが見つかりません。' };
}

function handleUpdateProfile(token, nickname) {
  const session = verifySession(token);
  if (!session) {
    return { success: false, message: 'セッションが切れています。再ログインしてください。' };
  }
  nickname = (nickname || '').trim();
  if (!nickname) {
    return { success: false, message: 'ニックネームを入力してください。' };
  }
  if (nickname.length > 30) {
    return { success: false, message: 'ニックネームは30文字以内にしてください。' };
  }

  const sheet = SS.getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const col = colIndexMap(header);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (normalizeEmail(row[col.Email]) === session.email) {
      const rowIndex = i + 1;
      sheet.getRange(rowIndex, col.Nickname + 1).setValue(nickname);
      sheet.getRange(rowIndex, col.UpdatedAt + 1).setValue(new Date());

      updateSessionNickname(token, session.email, nickname);

      return { success: true, nickname: nickname };
    }
  }
  return { success: false, message: 'ユーザーが見つかりません。' };
}

function handleLogout(token) {
  if (token) {
    CacheService.getScriptCache().remove('session_' + token);
  }
  return { success: true };
}

/* ============ セッション管理 ============ */

function createSession(email, nickname) {
  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  cache.put('session_' + token, JSON.stringify({ email, nickname }), SESSION_HOURS * 60 * 60);
  return token;
}

function verifySession(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get('session_' + token);
  return raw ? JSON.parse(raw) : null;
}

function updateSessionNickname(token, email, nickname) {
  const cache = CacheService.getScriptCache();
  cache.put('session_' + token, JSON.stringify({ email, nickname }), SESSION_HOURS * 60 * 60);
}

/* ============ ログイン失敗回数によるロックアウト ============ */

function registerLoginFail(email) {
  const cache = CacheService.getScriptCache();
  const key = 'fails_' + email;
  const current = Number(cache.get(key) || '0') + 1;
  cache.put(key, String(current), LOCK_MINUTES * 60);
  if (current >= MAX_LOGIN_FAILS) {
    cache.put('locked_' + email, '1', LOCK_MINUTES * 60);
  }
}

function clearLoginFails(email) {
  const cache = CacheService.getScriptCache();
  cache.remove('fails_' + email);
  cache.remove('locked_' + email);
}

function checkLockout(email) {
  const cache = CacheService.getScriptCache();
  const locked = cache.get('locked_' + email);
  if (locked) {
    return { locked: true, remainingMinutes: LOCK_MINUTES };
  }
  return { locked: false };
}

/* ============ パスワード関連ユーティリティ ============ */

function hashPassword(password, salt) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + password + PEPPER,
    Utilities.Charset.UTF_8
  );
  return digest.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 10; i++) {
    pw += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pw;
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sendMail(to, subject, body) {
  MailApp.sendEmail(to, subject, body);
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
  sheet.appendRow([postId, session.nickname, session.email, content.trim(), now]);

  return {
    success: true,
    post: {
      postId: postId,
      authorName: session.nickname,
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
