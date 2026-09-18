import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { LotteryConfig, LotteryStatus, EntryType, DrawMode, PrizeTier, Participant, Winner, BotMessageTemplates, DesignatedWinnerInput } from './types';

const DRAW_DB_PATH = process.env.DRAW_DB_PATH || path.join(process.cwd(), 'drawbot.db');

let dbInstance: Database<sqlite3.Database, sqlite3.Statement> | null = null;

export const DEFAULT_BOT_MESSAGES: BotMessageTemplates = {
  msg_success_join: '🎉 Entry confirmed! Good luck!',
  msg_already_joined: 'ℹ️ You have already joined!',
  msg_not_started: '⏳ This giveaway has not started yet!',
  msg_ended: '⚠️ This giveaway has ended!',
  msg_entries_closed: '⚠️ Entries for this giveaway are closed!',
  msg_og_only: '🔒 This Lucky Draw is exclusive to Whitelisted OGs.',
  msg_must_join_group_channel: '⚠️ You must join the required {target} to participate!',
  msg_rate_limit: '⏳ Please slow down...',
  msg_join_failed: '⚠️ Failed to join. Please try again later.'
};

export async function getDrawDb(): Promise<Database<sqlite3.Database, sqlite3.Statement>> {
  if (dbInstance) return dbInstance;

  dbInstance = await open({
    filename: DRAW_DB_PATH,
    driver: sqlite3.Database,
  });

  await dbInstance.exec('PRAGMA foreign_keys = ON');
  await dbInstance.exec('PRAGMA journal_mode = WAL');
  await dbInstance.exec('PRAGMA synchronous = NORMAL');
  await dbInstance.exec('PRAGMA busy_timeout = 5000');
  await dbInstance.exec('PRAGMA cache_size = -16000'); // 16MB cache

  // Initialize schema if not exists
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS lotteries (
      id TEXT PRIMARY KEY,
      internal_name TEXT NOT NULL,
      target_chat_id TEXT NOT NULL,
      target_topic_id TEXT,
      description TEXT,
      button_text TEXT,
      image_url TEXT,
      draw_mode TEXT DEFAULT 'MANUAL',
      auto_draw_time TEXT,
      announcement_template TEXT,
      status TEXT DEFAULT 'DRAFT',
      telegram_message_id INTEGER,
      allowed_chat_ids TEXT,
      required_channel_id TEXT,
      required_group_id TEXT,
      start_time TEXT,
      end_time TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS prizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lottery_id TEXT NOT NULL,
      name TEXT NOT NULL,
      count INTEGER NOT NULL,
      FOREIGN KEY (lottery_id) REFERENCES lotteries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS participants (
      chat_id TEXT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      join_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      account_age TEXT,
      has_joined_channel BOOLEAN DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS lottery_participants (
      lottery_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      join_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (lottery_id, participant_id),
      FOREIGN KEY (lottery_id) REFERENCES lotteries(id) ON DELETE CASCADE,
      FOREIGN KEY (participant_id) REFERENCES participants(chat_id)
    );

    CREATE TABLE IF NOT EXISTS winners (
      lottery_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      prize_name TEXT NOT NULL,
      claim_status TEXT DEFAULT 'PENDING',
      PRIMARY KEY (lottery_id, participant_id),
      FOREIGN KEY (lottery_id) REFERENCES lotteries(id) ON DELETE CASCADE,
      FOREIGN KEY (participant_id) REFERENCES participants(chat_id)
    );

    CREATE TABLE IF NOT EXISTS bot_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Non-destructive migration for pre-assigned designated winners
  try {
    await dbInstance.exec('ALTER TABLE lotteries ADD COLUMN designated_winners TEXT');
  } catch {}

  return dbInstance;
}

export async function getLotteries(): Promise<LotteryConfig[]> {
  const db = await getDrawDb();
  const rows = await db.all('SELECT * FROM lotteries ORDER BY created_at DESC');

  const lotteries: LotteryConfig[] = [];
  for (const r of rows) {
    const prizes: PrizeTier[] = (await db.all('SELECT id, name, count FROM prizes WHERE lottery_id = ?', r.id)).map(p => ({
      id: String(p.id),
      name: p.name,
      count: p.count
    }));

    const partRows = await db.all(`
      SELECT p.chat_id, p.username, p.first_name, p.last_name, lp.join_time, p.account_age, p.has_joined_channel
      FROM lottery_participants lp
      JOIN participants p ON lp.participant_id = p.chat_id
      WHERE lp.lottery_id = ?
    `, r.id);

    const participants: Participant[] = partRows.map(p => ({
      id: p.chat_id,
      chatId: p.chat_id,
      username: p.username,
      firstName: p.first_name,
      lastName: p.last_name,
      joinTime: p.join_time,
      accountAge: p.account_age,
      hasJoinedChannel: Boolean(p.has_joined_channel)
    }));

    const winRows = await db.all(`
      SELECT w.prize_name, w.claim_status, p.chat_id, p.username, p.first_name, p.last_name, lp.join_time, p.account_age, p.has_joined_channel
      FROM winners w
      JOIN participants p ON w.participant_id = p.chat_id
      LEFT JOIN lottery_participants lp ON (lp.lottery_id = w.lottery_id AND lp.participant_id = w.participant_id)
      WHERE w.lottery_id = ?
    `, r.id);

    const winners: Winner[] = winRows.map(w => ({
      id: w.chat_id,
      chatId: w.chat_id,
      username: w.username,
      firstName: w.first_name,
      lastName: w.last_name,
      joinTime: w.join_time || '',
      accountAge: w.account_age || '',
      hasJoinedChannel: Boolean(w.has_joined_channel),
      prizeName: w.prize_name,
      claimStatus: (w.claim_status as 'PENDING' | 'CLAIMED') || 'PENDING'
    }));

    let allowedChatIds: string[] = [];
    try {
      if (r.allowed_chat_ids) allowedChatIds = JSON.parse(r.allowed_chat_ids);
    } catch {}

    let designatedWinners: DesignatedWinnerInput[] = [];
    try {
      if (r.designated_winners) designatedWinners = JSON.parse(r.designated_winners);
    } catch {}

    lotteries.push({
      id: r.id,
      internalName: r.internal_name,
      description: r.description || '',
      imageUrl: r.image_url || undefined,
      entryType: EntryType.BUTTON,
      buttonText: r.button_text || '🎉 Join',
      requiredChannelId: r.required_channel_id || undefined,
      requiredGroupId: r.required_group_id || undefined,
      targetChatId: r.target_chat_id,
      targetTopicId: r.target_topic_id || undefined,
      allowedChatIds,
      drawMode: (r.draw_mode as DrawMode) || 'MANUAL',
      startTime: r.start_time || '',
      endTime: r.end_time || '',
      autoDrawTime: r.auto_draw_time || undefined,
      prizes,
      status: (r.status as LotteryStatus) || LotteryStatus.DRAFT,
      telegramMessageId: r.telegram_message_id || undefined,
      participantCount: participants.length,
      participants,
      winners,
      designatedWinners,
      announcementTemplate: r.announcement_template || undefined
    });
  }

  return lotteries;
}

// Fast targeted single lottery query to avoid scanning entire database on button clicks
export async function getLotteryById(id: string): Promise<LotteryConfig | null> {
  const db = await getDrawDb();
  const r = await db.get('SELECT * FROM lotteries WHERE id = ?', id);
  if (!r) return null;

  const prizes: PrizeTier[] = (await db.all('SELECT id, name, count FROM prizes WHERE lottery_id = ?', r.id)).map(p => ({
    id: String(p.id),
    name: p.name,
    count: p.count
  }));

  const partRows = await db.all(`
    SELECT p.chat_id, p.username, p.first_name, p.last_name, lp.join_time, p.account_age, p.has_joined_channel
    FROM lottery_participants lp
    JOIN participants p ON lp.participant_id = p.chat_id
    WHERE lp.lottery_id = ?
  `, r.id);

  const participants: Participant[] = partRows.map(p => ({
    id: p.chat_id,
    chatId: p.chat_id,
    username: p.username,
    firstName: p.first_name,
    lastName: p.last_name,
    joinTime: p.join_time,
    accountAge: p.account_age,
    hasJoinedChannel: Boolean(p.has_joined_channel)
  }));

  const winRows = await db.all(`
    SELECT w.prize_name, w.claim_status, p.chat_id, p.username, p.first_name, p.last_name, lp.join_time, p.account_age, p.has_joined_channel
    FROM winners w
    JOIN participants p ON w.participant_id = p.chat_id
    LEFT JOIN lottery_participants lp ON (lp.lottery_id = w.lottery_id AND lp.participant_id = w.participant_id)
    WHERE w.lottery_id = ?
  `, r.id);

  const winners: Winner[] = winRows.map(w => ({
    id: w.chat_id,
    chatId: w.chat_id,
    username: w.username,
    firstName: w.first_name,
    lastName: w.last_name,
    joinTime: w.join_time || '',
    accountAge: w.account_age || '',
    hasJoinedChannel: Boolean(w.has_joined_channel),
    prizeName: w.prize_name,
    claimStatus: (w.claim_status as 'PENDING' | 'CLAIMED') || 'PENDING'
  }));

  let allowedChatIds: string[] = [];
  try {
    if (r.allowed_chat_ids) allowedChatIds = JSON.parse(r.allowed_chat_ids);
  } catch {}

  let designatedWinners: DesignatedWinnerInput[] = [];
  try {
    if (r.designated_winners) designatedWinners = JSON.parse(r.designated_winners);
  } catch {}

  return {
    id: r.id,
    internalName: r.internal_name,
    description: r.description || '',
    imageUrl: r.image_url || undefined,
    entryType: EntryType.BUTTON,
    buttonText: r.button_text || '🎉 Join',
    requiredChannelId: r.required_channel_id || undefined,
    requiredGroupId: r.required_group_id || undefined,
    targetChatId: r.target_chat_id,
    targetTopicId: r.target_topic_id || undefined,
    allowedChatIds,
    drawMode: (r.draw_mode as DrawMode) || 'MANUAL',
    startTime: r.start_time || '',
    endTime: r.end_time || '',
    autoDrawTime: r.auto_draw_time || undefined,
    prizes,
    status: (r.status as LotteryStatus) || LotteryStatus.DRAFT,
    telegramMessageId: r.telegram_message_id || undefined,
    participantCount: participants.length,
    participants,
    winners,
    designatedWinners,
    announcementTemplate: r.announcement_template || undefined
  };
}

// Lightweight query for the background auto-draw scheduler
export async function getActiveAutoDrawLotteries(): Promise<{ id: string; internalName: string; autoDrawTime: string; endTime: string }[]> {
  const db = await getDrawDb();
  const rows = await db.all(`
    SELECT id, internal_name, auto_draw_time, end_time 
    FROM lotteries 
    WHERE status = 'ACTIVE' 
      AND draw_mode = 'AUTO' 
      AND (
        (auto_draw_time IS NOT NULL AND auto_draw_time != '') 
        OR (end_time IS NOT NULL AND end_time != '')
      )
  `);
  return rows.map(r => ({
    id: r.id,
    internalName: r.internal_name,
    autoDrawTime: r.auto_draw_time || '',
    endTime: r.end_time || ''
  }));
}

// Scalable paginated participants query
export async function getLotteryParticipants(
  lotteryId: string, 
  page = 1, 
  limit = 50, 
  search = ''
): Promise<{ total: number; page: number; limit: number; participants: Participant[] }> {
  const db = await getDrawDb();
  const offset = (Math.max(1, page) - 1) * Math.max(1, limit);

  let countSql = `
    SELECT COUNT(*) as cnt 
    FROM lottery_participants lp 
    JOIN participants p ON lp.participant_id = p.chat_id 
    WHERE lp.lottery_id = ?
  `;
  let querySql = `
    SELECT p.chat_id, p.username, p.first_name, p.last_name, lp.join_time, p.account_age, p.has_joined_channel
    FROM lottery_participants lp
    JOIN participants p ON lp.participant_id = p.chat_id
    WHERE lp.lottery_id = ?
  `;
  const params: any[] = [lotteryId];
  const queryParams: any[] = [lotteryId];

  if (search && search.trim()) {
    const term = `%${search.trim().replace(/^@/, '')}%`;
    countSql += ` AND (p.username LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ? OR p.chat_id LIKE ?)`;
    params.push(term, term, term, term);

    querySql += ` AND (p.username LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ? OR p.chat_id LIKE ?)`;
    queryParams.push(term, term, term, term);
  }

  querySql += ` ORDER BY lp.join_time DESC LIMIT ? OFFSET ?`;
  queryParams.push(limit, offset);

  const countRow = await db.get(countSql, ...params);
  const total = countRow ? countRow.cnt : 0;

  const rows = await db.all(querySql, ...queryParams);
  const participants: Participant[] = rows.map(p => ({
    id: p.chat_id,
    chatId: p.chat_id,
    username: p.username,
    firstName: p.first_name,
    lastName: p.last_name,
    joinTime: p.join_time,
    accountAge: p.account_age,
    hasJoinedChannel: Boolean(p.has_joined_channel)
  }));

  return { total, page, limit, participants };
}

export async function saveLottery(data: any): Promise<void> {
  const db = await getDrawDb();

  if (data.id) {
    const existing = await db.get('SELECT status, telegram_message_id FROM lotteries WHERE id = ?', data.id);
    if (existing && (existing.status !== 'DRAFT' || existing.telegram_message_id)) {
      throw new Error('Only unpublished draft events can be edited.');
    }
  }

  const payload = {
    $id: data.id,
    $internalName: data.internalName,
    $targetChatId: data.targetChatId,
    $targetTopicId: data.targetTopicId || null,
    $description: data.description || '',
    $buttonText: data.buttonText || '🎉 Join',
    $imageUrl: data.imageUrl || '',
    $drawMode: data.drawMode || (data.autoDrawTime ? 'AUTO' : 'MANUAL'),
    $startTime: data.startTime || '',
    $endTime: data.endTime || '',
    $autoDrawTime: (data.drawMode === 'AUTO' && data.autoDrawTime) ? data.autoDrawTime : '',
    $announcementTemplate: data.announcementTemplate || '',
    $status: data.status || 'DRAFT',
    $telegramMessageId: data.telegramMessageId || null,
    $allowedChatIds: JSON.stringify(data.allowedChatIds || []),
    $requiredChannelId: data.requiredChannelId || null,
    $requiredGroupId: data.requiredGroupId || null
  };

  await db.run(`
    INSERT INTO lotteries (
      id, internal_name, target_chat_id, target_topic_id, description, 
      button_text, image_url, draw_mode, start_time, end_time, 
      auto_draw_time, announcement_template, status, telegram_message_id, 
      allowed_chat_ids, required_channel_id, required_group_id
    ) 
    VALUES (
      $id, $internalName, $targetChatId, $targetTopicId, $description, 
      $buttonText, $imageUrl, $drawMode, $startTime, $endTime, 
      $autoDrawTime, $announcementTemplate, $status, $telegramMessageId, 
      $allowedChatIds, $requiredChannelId, $requiredGroupId
    )
    ON CONFLICT(id) DO UPDATE SET
      internal_name = excluded.internal_name,
      target_chat_id = excluded.target_chat_id,
      target_topic_id = excluded.target_topic_id,
      description = excluded.description,
      button_text = excluded.button_text,
      image_url = excluded.image_url,
      draw_mode = excluded.draw_mode,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      auto_draw_time = excluded.auto_draw_time,
      announcement_template = excluded.announcement_template,
      status = excluded.status,
      telegram_message_id = excluded.telegram_message_id,
      allowed_chat_ids = excluded.allowed_chat_ids,
      required_channel_id = excluded.required_channel_id,
      required_group_id = excluded.required_group_id
  `, payload);

  await db.run('DELETE FROM prizes WHERE lottery_id = ?', data.id);
  if (data.prizes && Array.isArray(data.prizes)) {
    for (const prize of data.prizes) {
      await db.run('INSERT INTO prizes (lottery_id, name, count) VALUES (?, ?, ?)', data.id, prize.name, Number(prize.count) || 1);
    }
  }
}

export async function deleteLottery(id: string): Promise<void> {
  const db = await getDrawDb();
  await db.run('DELETE FROM lotteries WHERE id = ?', id);
  await db.run('DELETE FROM prizes WHERE lottery_id = ?', id);
  await db.run('DELETE FROM lottery_participants WHERE lottery_id = ?', id);
  await db.run('DELETE FROM winners WHERE lottery_id = ?', id);
}

export async function updateLotteryStatus(id: string, status: LotteryStatus, messageId?: number): Promise<void> {
  const db = await getDrawDb();
  if (messageId !== undefined) {
    await db.run('UPDATE lotteries SET status = ?, telegram_message_id = ? WHERE id = ?', status, messageId, id);
  } else {
    await db.run('UPDATE lotteries SET status = ? WHERE id = ?', status, id);
  }
}

export async function recordParticipant(
  lotteryId: string, 
  user: { id: string; username?: string; firstName: string; lastName?: string }, 
  accountAge: string
): Promise<{ success: boolean; alreadyJoined: boolean }> {
  const db = await getDrawDb();

  // Upsert user
  await db.run(`
    INSERT INTO participants (chat_id, username, first_name, last_name, account_age, has_joined_channel)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(chat_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      account_age = excluded.account_age
  `, user.id, user.username || null, user.firstName || '', user.lastName || null, accountAge);

  try {
    await db.run('INSERT INTO lottery_participants (lottery_id, participant_id) VALUES (?, ?)', lotteryId, user.id);
    return { success: true, alreadyJoined: false };
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE')) {
      return { success: false, alreadyJoined: true };
    }
    throw err;
  }
}

export async function saveWinners(lotteryId: string, winners: { participantId: string; prizeName: string }[]): Promise<void> {
  const db = await getDrawDb();
  for (const w of winners) {
    await db.run(`
      INSERT OR REPLACE INTO winners (lottery_id, participant_id, prize_name, claim_status)
      VALUES (?, ?, ?, 'PENDING')
    `, lotteryId, w.participantId, w.prizeName);
  }
}

export async function updateWinnerClaimStatus(lotteryId: string, participantId: string, claimStatus: 'PENDING' | 'CLAIMED'): Promise<void> {
  const db = await getDrawDb();
  await db.run('UPDATE winners SET claim_status = ? WHERE lottery_id = ? AND participant_id = ?', claimStatus, lotteryId, participantId);
}

export async function saveDesignatedWinners(
  lotteryId: string,
  designatedWinners: DesignatedWinnerInput[],
  autoDrawTime?: string
): Promise<{ ok: boolean; count: number; autoDrawTime?: string }> {
  const db = await getDrawDb();
  const lottery = await db.get('SELECT id, status, auto_draw_time FROM lotteries WHERE id = ?', lotteryId);
  if (!lottery) throw new Error('Lottery event not found');
  if (lottery.status !== 'ACTIVE') throw new Error('Only active events can have designated winners configured');

  const cleanDesignated = (Array.isArray(designatedWinners) ? designatedWinners : []).filter(
    dw => dw && dw.participantId && dw.prizeName
  );

  // Validate designated winners against event prize quotas and uniqueness
  if (cleanDesignated.length > 0) {
    const prizeRows = await db.all('SELECT name, count FROM prizes WHERE lottery_id = ?', lotteryId);
    const prizeQuotaMap = new Map<string, number>();
    for (const p of prizeRows) {
      prizeQuotaMap.set(p.name, Number(p.count));
    }

    const seenParticipants = new Set<string>();
    const assignedCounts = new Map<string, number>();

    for (const dw of cleanDesignated) {
      if (seenParticipants.has(dw.participantId)) {
        throw new Error(`参与者已被重复指定，同一用户只能中奖一次 (ID: ${dw.participantId})`);
      }
      seenParticipants.add(dw.participantId);

      const maxLimit = prizeQuotaMap.get(dw.prizeName);
      if (maxLimit === undefined) {
        throw new Error(`指定了不存在的奖品类型：【${dw.prizeName}】`);
      }

      const currentAssigned = (assignedCounts.get(dw.prizeName) || 0) + 1;
      if (currentAssigned > maxLimit) {
        throw new Error(`奖品【${dw.prizeName}】总数仅有 ${maxLimit} 份，但指定了 ${currentAssigned} 人，超出配额上限！`);
      }
      assignedCounts.set(dw.prizeName, currentAssigned);
    }
  }

  const serialized = cleanDesignated.length > 0 ? JSON.stringify(cleanDesignated) : null;

  if (autoDrawTime && autoDrawTime.trim()) {
    await db.run(
      'UPDATE lotteries SET designated_winners = ?, auto_draw_time = ?, draw_mode = ? WHERE id = ?',
      serialized,
      autoDrawTime.trim(),
      'AUTO',
      lotteryId
    );
  } else {
    await db.run(
      'UPDATE lotteries SET designated_winners = ? WHERE id = ?',
      serialized,
      lotteryId
    );
  }

  return { ok: true, count: cleanDesignated.length, autoDrawTime: autoDrawTime || lottery.auto_draw_time };
}

export async function clearDesignatedWinners(lotteryId: string): Promise<void> {
  const db = await getDrawDb();
  await db.run('UPDATE lotteries SET designated_winners = NULL WHERE id = ?', lotteryId);
}

export async function getBotMessages(): Promise<BotMessageTemplates> {
  const db = await getDrawDb();
  const rows = await db.all('SELECT key, value FROM bot_settings');
  const msgs = { ...DEFAULT_BOT_MESSAGES };
  for (const r of rows) {
    if (r.key in msgs) {
      (msgs as any)[r.key] = r.value;
    }
  }
  return msgs;
}

export async function saveBotMessages(messages: Partial<BotMessageTemplates>): Promise<BotMessageTemplates> {
  const db = await getDrawDb();
  for (const [k, v] of Object.entries(messages)) {
    if (v && typeof v === 'string') {
      await db.run('INSERT OR REPLACE INTO bot_settings (key, value) VALUES (?, ?)', k, v);
    }
  }
  return getBotMessages();
}

export async function isDrawModuleEnabled(): Promise<boolean> {
  const db = await getDrawDb();
  const row = await db.get("SELECT value FROM bot_settings WHERE key = 'draw_module_enabled'");
  return row ? row.value === '1' : false; // Default: dormant (false)
}


export async function getSavedBotToken(): Promise<string> {
  const db = await getDrawDb();
  const row = await db.get("SELECT value FROM bot_settings WHERE key = 'drawbot_token'");
  return row ? (row.value || '') : '';
}

export async function saveBotToken(token: string): Promise<void> {
  const db = await getDrawDb();
  await db.run("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('drawbot_token', ?)", token);
}

export async function setDrawModuleEnabled(enabled: boolean): Promise<boolean> {
  const db = await getDrawDb();
  await db.run("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('draw_module_enabled', ?)", enabled ? '1' : '0');
  return enabled;
}
