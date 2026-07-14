/**
 * サークル内掲示板 - GASバックエンド (v3: 複数イベント・参加登録・投稿編集削除対応版)
 * ------------------------------------------------
 * シート構成:
 *   Users        : UserID | Email | Nickname | PasswordHash | Salt |
 *                  MustChangePassword | AgreedAt | CreatedAt | UpdatedAt
 *   Events       : EventID | Title | Description | StartDate | EndDate |
 *                  CreatedByEmail | CreatedByNickname | CreatedAt | UpdatedAt
 *   Posts        : PostID | EventID | AuthorEmail | AuthorName | Content |
 *                  CreatedAt | UpdatedAt
 *   Participants : EventID | Email | Nickname | Status | UpdatedAt
 *                  (Statusは '参加' か '不参加')
 *
 * 通信方式:
 *   フロントエンドから text/plain で POST することで
 *   ブラウザのCORSプリフライト(OPTIONS)を回避しています。
 */

const SS = SpreadsheetApp.getActiveSpreadsheet();
const USERS_SHEET = 'Users';
const EVENTS_SHEET = 'Events';
const POSTS_SHEET = 'Posts';
const PARTICIPANTS_SHEET = 'Participants';

const SESSION_HOURS = 6;
const MAX_LOGIN_FAILS = 5;
const LOCK_MINUTES = 15;

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
      case 'register': result = handleRegister(body.email, body.nickname, body.agreeTerms); break;
      case 'login': result = handleLogin(body.email, body.password); break;
      case 'forgotPassword': result = handleForgotPassword(body.email); break;
      case 'changePassword': result = handleChangePassword(body.token, body.currentPassword, body.newPassword); break;
      case 'updateProfile': result = handleUpdateProfile(body.token, body.nickname); break;
      case 'logout': result = handleLogout(body.token); break;

      case 'getEvents': result = handleGetEvents(body.token); break;
      case 'createEvent': result = handleCreateEvent(body.token, body.title, body.description, body.startDate, body.endDate); break;
      case 'updateEvent': result = handleUpdateEvent(body.token, body.eventId, body.title, body.description, body.startDate, body.endDate); break;
      case 'deleteEvent': result = handleDeleteEvent(body.token, body.eventId); break;

      case 'setParticipation': result = handleSetParticipation(body.token, body.eventId, body.status); break;
      case 'getParticipants': result = handleGetParticipants(body.token, body.eventId); break;

      case 'getPosts': result = handleGetPosts(body.token, body.eventId); break;
      case 'addPost': result = handleAddPost(body.token, body.eventId, body.content); break;
      case 'editPost': result = handleEditPost(body.token, body.postId, body.content); break;
      case 'deletePost': result = handleDeletePost(body.token, body.postId); break;

      default: result = { success: false, message: '不正なactionです。' };
    }
  } catch (err) {
    result = { success: false, message: 'サーバーエラー: ' + err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============ 会員登録・認証 ============ */

function handleRegister(email, nickname, agreeTerms) {
  if (!email || !nickname) return { success: false, message: 'メールアドレスとニックネームを入力してください。' };
  if (!agreeTerms) return { success: false, message: '注意事項・免責事項への同意が必要です。' };
  email = normalizeEmail(email);
  nickname = nickname.trim();
  if (nickname.length > 30) return { success: false, message: 'ニックネームは30文字以内にしてください。' };
  if (!isValidEmail(email)) return { success: false, message: 'メールアドレスの形式が正しくありません。' };

  const sheet = SS.getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  const col = colIndexMap(data[0]);
  const genericMsg = '登録手続きが完了しました。ご入力いただいたメールアドレス宛に確認メールをご確認ください。';

  for (let i = 1; i < data.length; i++) {
    if (normalizeEmail(data[i][col.Email]) === email) {
      return { success: true, message: genericMsg };
    }
  }

  const tempPassword = generateTempPassword();
  const salt = Utilities.getUuid();
  const hash = hashPassword(tempPassword, salt);
  const now = new Date();

  sheet.appendRow([Utilities.getUuid(), email, nickname, hash, salt, true, now, now, now]);

  sendMail(email, '【サークル内掲示板】仮パスワードのお知らせ',
    `${nickname} 様\n\nサークル内掲示板へのご登録ありがとうございます。\n` +
    `以下の仮パスワードでログインし、初回ログイン時に必ずパスワードを変更してください。\n\n` +
    `メールアドレス: ${email}\n仮パスワード: ${tempPassword}\n\n` +
    `このメールに心当たりがない場合は、破棄してください。`);

  return { success: true, message: genericMsg };
}

function handleLogin(email, password) {
  if (!email || !password) return { success: false, message: 'メールアドレスとパスワードを入力してください。' };
  email = normalizeEmail(email);

  const lock = checkLockout(email);
  if (lock.locked) return { success: false, message: `試行回数が上限に達しました。${lock.remainingMinutes}分後に再度お試しください。` };

  const sheet = SS.getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  const col = colIndexMap(data[0]);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (normalizeEmail(row[col.Email]) === email) {
      const hash = hashPassword(password, row[col.Salt]);
      if (hash === row[col.PasswordHash]) {
        clearLoginFails(email);
        const token = createSession(email, row[col.Nickname]);
        return { success: true, token, nickname: row[col.Nickname], email, mustChangePassword: !!row[col.MustChangePassword] };
      }
      registerLoginFail(email);
      return { success: false, message: 'メールアドレスまたはパスワードが違います。' };
    }
  }
  registerLoginFail(email);
  return { success: false, message: 'メールアドレスまたはパスワードが違います。' };
}

function handleForgotPassword(email) {
  if (!email) return { success: false, message: 'メールアドレスを入力してください。' };
  email = normalizeEmail(email);

  const sheet = SS.getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  const col = colIndexMap(data[0]);
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

      sendMail(email, '【サークル内掲示板】仮パスワード再発行のお知らせ',
        `${row[col.Nickname]} 様\n\nパスワード再発行のご依頼を受け付けました。\n` +
        `以下の仮パスワードでログインし、初回ログイン時に必ずパスワードを変更してください。\n\n` +
        `メールアドレス: ${email}\n仮パスワード: ${tempPassword}\n\n` +
        `このメールに心当たりがない場合は、破棄してください。`);
      break;
    }
  }
  return { success: true, message: genericMessage };
}

function handleChangePassword(token, currentPassword, newPassword) {
  const session = verifySession(token);
  if (!session) return { success: false, message: 'セッションが切れています。再ログインしてください。' };
  if (!currentPassword || !newPassword) return { success: false, message: '現在のパスワードと新しいパスワードを入力してください。' };
  if (newPassword.length < 8) return { success: false, message: '新しいパスワードは8文字以上にしてください。' };

  const sheet = SS.getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  const col = colIndexMap(data[0]);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (normalizeEmail(row[col.Email]) === session.email) {
      const hash = hashPassword(currentPassword, row[col.Salt]);
      if (hash !== row[col.PasswordHash]) return { success: false, message: '現在のパスワードが正しくありません。' };
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
  if (!session) return { success: false, message: 'セッションが切れています。再ログインしてください。' };
  nickname = (nickname || '').trim();
  if (!nickname) return { success: false, message: 'ニックネームを入力してください。' };
  if (nickname.length > 30) return { success: false, message: 'ニックネームは30文字以内にしてください。' };

  const sheet = SS.getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  const col = colIndexMap(data[0]);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (normalizeEmail(row[col.Email]) === session.email) {
      const rowIndex = i + 1;
      sheet.getRange(rowIndex, col.Nickname + 1).setValue(nickname);
      sheet.getRange(rowIndex, col.UpdatedAt + 1).setValue(new Date());
      updateSessionNickname(token, session.email, nickname);
      return { success: true, nickname };
    }
  }
  return { success: false, message: 'ユーザーが見つかりません。' };
}

function handleLogout(token) {
  if (token) CacheService.getScriptCache().remove('session_' + token);
  return { success: true };
}

/* ============ イベント（サークル活動）管理 ============ */

function handleGetEvents(token) {
  const session = verifySession(token);
  if (!session) return { success: false, message: 'セッションが切れています。再ログインしてください。' };

  const eSheet = SS.getSheetByName(EVENTS_SHEET);
  const eData = eSheet.getDataRange().getValues();
  const eCol = colIndexMap(eData[0]);

  const pSheet = SS.getSheetByName(PARTICIPANTS_SHEET);
  const pData = pSheet.getDataRange().getValues();
  const pCol = colIndexMap(pData[0]);

  const events = [];
  for (let i = 1; i < eData.length; i++) {
    const row = eData[i];
    if (!row[eCol.EventID]) continue;

    let joinCount = 0, declineCount = 0, myStatus = null;
    for (let j = 1; j < pData.length; j++) {
      const p = pData[j];
      if (p[pCol.EventID] !== row[eCol.EventID]) continue;
      if (p[pCol.Status] === '参加') joinCount++;
      else if (p[pCol.Status] === '不参加') declineCount++;
      if (normalizeEmail(p[pCol.Email]) === session.email) myStatus = p[pCol.Status];
    }

    events.push({
      eventId: row[eCol.EventID],
      title: row[eCol.Title],
      description: row[eCol.Description],
      startDate: toIsoDate(row[eCol.StartDate]),
      endDate: toIsoDate(row[eCol.EndDate]),
      createdByEmail: row[eCol.CreatedByEmail],
      createdByNickname: row[eCol.CreatedByNickname],
      joinCount,
      declineCount,
      myStatus,
      isOwner: normalizeEmail(row[eCol.CreatedByEmail]) === session.email
    });
  }

  events.sort((a, b) => new Date(a.startDate || 0) - new Date(b.startDate || 0));
  return { success: true, events };
}

function handleCreateEvent(token, title, description, startDate, endDate) {
  const session = verifySession(token);
  if (!session) return { success: false, message: 'セッションが切れています。再ログインしてください。' };
  title = (title || '').trim();
  if (!title) return { success: false, message: 'サークル・イベント名を入力してください。' };
  if (title.length > 60) return { success: false, message: '名称は60文字以内にしてください。' };
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    return { success: false, message: '開始日は期限より前の日付にしてください。' };
  }

  const sheet = SS.getSheetByName(EVENTS_SHEET);
  const eventId = Utilities.getUuid();
  const now = new Date();
  sheet.appendRow([
    eventId, title, (description || '').trim(),
    startDate ? new Date(startDate) : '', endDate ? new Date(endDate) : '',
    session.email, session.nickname, now, now
  ]);

  return { success: true, eventId };
}

function handleUpdateEvent(token, eventId, title, description, startDate, endDate) {
  const session = verifySession(token);
  if (!session) return { success: false, message: 'セッションが切れています。再ログインしてください。' };
  title = (title || '').trim();
  if (!title) return { success: false, message: 'サークル・イベント名を入力してください。' };
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    return { success: false, message: '開始日は期限より前の日付にしてください。' };
  }

  const sheet = SS.getSheetByName(EVENTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const col = colIndexMap(data[0]);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[col.EventID] === eventId) {
      if (normalizeEmail(row[col.CreatedByEmail]) !== session.email) {
        return { success: false, message: 'この操作は作成者のみ行えます。' };
      }
      const rowIndex = i + 1;
      sheet.getRange(rowIndex, col.Title + 1).setValue(title);
      sheet.getRange(rowIndex, col.Description + 1).setValue((description || '').trim());
      sheet.getRange(rowIndex, col.StartDate + 1).setValue(startDate ? new Date(startDate) : '');
      sheet.getRange(rowIndex, col.EndDate + 1).setValue(endDate ? new Date(endDate) : '');
      sheet.getRange(rowIndex, col.UpdatedAt + 1).setValue(new Date());
      return { success: true };
    }
  }
  return { success: false, message: '対象のサークル・イベントが見つかりません。' };
}

function handleDeleteEvent(token, eventId) {
  const session = verifySession(token);
  if (!session) return { success: false, message: 'セッションが切れています。再ログインしてください。' };

  const sheet = SS.getSheetByName(EVENTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const col = colIndexMap(data[0]);

  let targetRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][col.EventID] === eventId) {
      if (normalizeEmail(data[i][col.CreatedByEmail]) !== session.email) {
        return { success: false, message: 'この操作は作成者のみ行えます。' };
      }
      targetRow = i + 1;
      break;
    }
  }
  if (targetRow === -1) return { success: false, message: '対象のサークル・イベントが見つかりません。' };
  sheet.deleteRow(targetRow);

  // 関連する投稿・参加登録も削除
  deleteRowsByColumnValue(POSTS_SHEET, 'EventID', eventId);
  deleteRowsByColumnValue(PARTICIPANTS_SHEET, 'EventID', eventId);

  return { success: true };
}

/* ============ 参加・不参加登録 ============ */

function handleSetParticipation(token, eventId, status) {
  const session = verifySession(token);
  if (!session) return { success: false, message: 'セッションが切れています。再ログインしてください。' };
  if (status !== '参加' && status !== '不参加') {
    return { success: false, message: 'ステータスが不正です。' };
  }

  const sheet = SS.getSheetByName(PARTICIPANTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const col = colIndexMap(data[0]);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[col.EventID] === eventId && normalizeEmail(row[col.Email]) === session.email) {
      const rowIndex = i + 1;
      sheet.getRange(rowIndex, col.Status + 1).setValue(status);
      sheet.getRange(rowIndex, col.Nickname + 1).setValue(session.nickname);
      sheet.getRange(rowIndex, col.UpdatedAt + 1).setValue(new Date());
      return { success: true, status };
    }
  }

  sheet.appendRow([eventId, session.email, session.nickname, status, new Date()]);
  return { success: true, status };
}

function handleGetParticipants(token, eventId) {
  const session = verifySession(token);
  if (!session) return { success: false, message: 'セッションが切れています。再ログインしてください。' };

  const sheet = SS.getSheetByName(PARTICIPANTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const col = colIndexMap(data[0]);

  const joined = [];
  const declined = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[col.EventID] !== eventId) continue;
    const entry = { nickname: row[col.Nickname], updatedAt: toIsoDate(row[col.UpdatedAt]) };
    if (row[col.Status] === '参加') joined.push(entry);
    else if (row[col.Status] === '不参加') declined.push(entry);
  }

  return { success: true, joined, declined };
}

/* ============ 投稿（掲示板）関連 ============ */

function handleGetPosts(token, eventId) {
  const session = verifySession(token);
  if (!session) return { success: false, message: 'セッションが切れています。再ログインしてください。' };
  if (!eventId) return { success: false, message: 'イベントが指定されていません。' };

  const sheet = SS.getSheetByName(POSTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const col = colIndexMap(data[0]);

  const posts = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[col.PostID] || row[col.EventID] !== eventId) continue;
    posts.push({
      postId: row[col.PostID],
      authorName: row[col.AuthorName],
      authorEmail: row[col.AuthorEmail],
      content: row[col.Content],
      createdAt: toIsoDate(row[col.CreatedAt]),
      updatedAt: toIsoDate(row[col.UpdatedAt]),
      isMine: normalizeEmail(row[col.AuthorEmail]) === session.email
    });
  }
  posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return { success: true, posts };
}

function handleAddPost(token, eventId, content) {
  const session = verifySession(token);
  if (!session) return { success: false, message: 'セッションが切れています。再ログインしてください。' };
  if (!eventId) return { success: false, message: 'イベントが指定されていません。' };
  if (!content || !content.trim()) return { success: false, message: '本文を入力してください。' };
  if (content.length > 1000) return { success: false, message: '投稿は1000文字以内にしてください。' };

  const sheet = SS.getSheetByName(POSTS_SHEET);
  const postId = Utilities.getUuid();
  const now = new Date();
  sheet.appendRow([postId, eventId, session.email, session.nickname, content.trim(), now, now]);

  return {
    success: true,
    post: {
      postId, authorName: session.nickname, authorEmail: session.email,
      content: content.trim(), createdAt: now.toISOString(), updatedAt: now.toISOString(), isMine: true
    }
  };
}

function handleEditPost(token, postId, content) {
  const session = verifySession(token);
  if (!session) return { success: false, message: 'セッションが切れています。再ログインしてください。' };
  if (!content || !content.trim()) return { success: false, message: '本文を入力してください。' };
  if (content.length > 1000) return { success: false, message: '投稿は1000文字以内にしてください。' };

  const sheet = SS.getSheetByName(POSTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const col = colIndexMap(data[0]);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[col.PostID] === postId) {
      if (normalizeEmail(row[col.AuthorEmail]) !== session.email) {
        return { success: false, message: 'この操作は投稿者のみ行えます。' };
      }
      const rowIndex = i + 1;
      sheet.getRange(rowIndex, col.Content + 1).setValue(content.trim());
      sheet.getRange(rowIndex, col.UpdatedAt + 1).setValue(new Date());
      return { success: true };
    }
  }
  return { success: false, message: '対象の投稿が見つかりません。' };
}

function handleDeletePost(token, postId) {
  const session = verifySession(token);
  if (!session) return { success: false, message: 'セッションが切れています。再ログインしてください。' };

  const sheet = SS.getSheetByName(POSTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const col = colIndexMap(data[0]);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[col.PostID] === postId) {
      if (normalizeEmail(row[col.AuthorEmail]) !== session.email) {
        return { success: false, message: 'この操作は投稿者のみ行えます。' };
      }
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, message: '対象の投稿が見つかりません。' };
}

/* ============ セッション管理 ============ */

function createSession(email, nickname) {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('session_' + token, JSON.stringify({ email, nickname }), SESSION_HOURS * 60 * 60);
  return token;
}

function verifySession(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get('session_' + token);
  return raw ? JSON.parse(raw) : null;
}

function updateSessionNickname(token, email, nickname) {
  CacheService.getScriptCache().put('session_' + token, JSON.stringify({ email, nickname }), SESSION_HOURS * 60 * 60);
}

/* ============ ログイン失敗ロックアウト ============ */

function registerLoginFail(email) {
  const cache = CacheService.getScriptCache();
  const key = 'fails_' + email;
  const current = Number(cache.get(key) || '0') + 1;
  cache.put(key, String(current), LOCK_MINUTES * 60);
  if (current >= MAX_LOGIN_FAILS) cache.put('locked_' + email, '1', LOCK_MINUTES * 60);
}
function clearLoginFails(email) {
  const cache = CacheService.getScriptCache();
  cache.remove('fails_' + email);
  cache.remove('locked_' + email);
}
function checkLockout(email) {
  const locked = CacheService.getScriptCache().get('locked_' + email);
  return locked ? { locked: true, remainingMinutes: LOCK_MINUTES } : { locked: false };
}

/* ============ パスワード関連ユーティリティ ============ */

function hashPassword(password, salt) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password + PEPPER, Utilities.Charset.UTF_8);
  return digest.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 10; i++) pw += chars.charAt(Math.floor(Math.random() * chars.length));
  return pw;
}
function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function sendMail(to, subject, body) { MailApp.sendEmail(to, subject, body); }

/* ============ 共通ユーティリティ ============ */

function colIndexMap(header) {
  const map = {};
  header.forEach((name, idx) => { map[name] = idx; });
  return map;
}

function toIsoDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  return value;
}

function deleteRowsByColumnValue(sheetName, columnName, value) {
  const sheet = SS.getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  const col = colIndexMap(data[0]);
  // 下から削除することで行番号のズレを防ぐ
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][col[columnName]] === value) {
      sheet.deleteRow(i + 1);
    }
  }
}

/* ============ 動作確認用（手動実行してください） ============ */

function debugUsersSheet() {
  const sheet = SS.getSheetByName(USERS_SHEET);
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const col = colIndexMap(header);

  Logger.log('シートの実際のヘッダー行: ' + JSON.stringify(header));
  Logger.log('認識された列マッピング: ' + JSON.stringify(col));

  const required = ['UserID', 'Email', 'Nickname', 'PasswordHash', 'Salt', 'MustChangePassword', 'AgreedAt', 'CreatedAt', 'UpdatedAt'];
  required.forEach(name => {
    if (col[name] === undefined) Logger.log('⚠️ 見つかりません: ' + name);
  });
}

function testSendMail() {
  const testAddress = 'ここに自分のメールアドレスを入力';
  sendMail(testAddress, '【テスト】サークル掲示板メール送信確認', 'このメールが届いていれば送信設定は正常です。');
  Logger.log('送信しました: ' + testAddress);
}

function testRegisterFlow() {
  const result = handleRegister('ここに自分のメールアドレスを入力', 'テスト太郎', true);
  Logger.log(JSON.stringify(result));
}
