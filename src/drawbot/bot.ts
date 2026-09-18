
export function sanitizeTelegramHtml(text: string): string {
  if (!text) return '';
  let str = text;
  // If HTML entities like &lt;p&gt; or &lt;br&gt; were in the input, unescape them first
  str = str.replace(/&lt;(\/?[a-z0-9]+[^&]*)&gt;/gi, '<$1>');
  // Convert standard rich text elements to Telegram friendly formatting
  str = str.replace(/<p><br\/?><\/p>/gi, '\n');
  str = str.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '<b>$1</b>\n\n');
  str = str.replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n');
  str = str.replace(/<\/?(ul|ol)[^>]*>/gi, '');
  str = str.replace(/<\/p>/gi, '\n');
  str = str.replace(/<p[^>]*>/gi, '');
  str = str.replace(/<br\s*\/?>/gi, '\n');
  str = str.replace(/<\/div>/gi, '\n');
  str = str.replace(/<div[^>]*>/gi, '');
  // Retain only Telegram supported tags: b, strong, i, em, u, ins, s, strike, del, a, code, pre, tg-spoiler, blockquote
  str = str.replace(/<(?!\/?(b|strong|i|em|u|ins|s|strike|del|a|code|pre|tg-spoiler|blockquote)(\s+[^>]*)?>)[^>]+>/gi, '');
  // Escape unescaped ampersands so Telegram parser never fails
  str = str.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
  // Clean up excessive blank lines
  str = str.replace(/\n{3,}/g, '\n\n');
  return str.trim();
}

export function normalizeTelegramChatId(rawChatId: string): string {
  if (!rawChatId) return '';
  let clean = rawChatId.trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^t\.me\//i, '').trim();
  // If not starting with - or digit and not starting with @, prefix with @
  if (!clean.startsWith('@') && !clean.startsWith('-') && !/^-?\d+$/.test(clean)) {
    clean = '@' + clean;
  }
  return clean;
}
import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { 
  getLotteryById, 
  updateLotteryStatus, 
  recordParticipant, 
  saveWinners, 
  getBotMessages, 
  getDrawDb,
  clearDesignatedWinners
} from './database';
import { BotConfig, LotteryConfig, LotteryStatus, Winner, DesignatedWinnerInput, Participant, PrizeTier } from './types';

let currentBot: Bot | null = null;
let currentBotConfig: BotConfig | null = null;
const userRateLimits = new Map<string, number>();
const membershipCache = new Map<string, { inGroup: boolean; expire: number }>();

// Auto-prune expired rate limits and membership cache every 60s
setInterval(() => {
  const cutoff = Date.now() - 10000;
  for (const [uid, timestamp] of userRateLimits.entries()) {
    if (timestamp < cutoff) {
      userRateLimits.delete(uid);
    }
  }

  const now = Date.now();
  for (const [key, val] of membershipCache.entries()) {
    if (val.expire < now) {
      membershipCache.delete(key);
    }
  }
}, 60000).unref();

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getConnectedBot(): BotConfig | null {
  return currentBotConfig;
}

export function getBotInstance(): Bot | null {
  return currentBot;
}

export async function handleDrawCallbackQuery(ctx: any): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const botMsgs = await getBotMessages();

  if (data === 'ended_notice' || data.startsWith('ended_notice')) {
    await ctx.answerCallbackQuery({
      text: botMsgs.msg_ended || '⚠️ This giveaway has ended!',
      show_alert: true
    }).catch(() => {});
    return;
  }
  if (!data.startsWith('join_')) return;

  const lotteryId = data.replace('join_', '');
  const from = ctx.from;
  if (!from) return;
  const userId = String(from.id);

  // Rate limit check (1.5s debounce)
  const now = Date.now();
  const lastClick = userRateLimits.get(userId) || 0;
  if (now - lastClick < 1500) {
    await ctx.answerCallbackQuery({ text: botMsgs.msg_rate_limit || '⏳ Please slow down...' }).catch(() => {});
    return;
  }
  userRateLimits.set(userId, now);

  try {
    const lottery = await getLotteryById(lotteryId);
    if (!lottery) {
      await ctx.answerCallbackQuery({ text: 'Lottery not found.', show_alert: true }).catch(() => {});
      return;
    }

    // 1. Status Guard: Must be ACTIVE
    if (lottery.status === LotteryStatus.ENDED) {
      try {
        await ctx.editMessageReplyMarkup({
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔒 Ended', callback_data: 'ended_notice' }]
            ]
          }
        });
      } catch {}
      await ctx.answerCallbackQuery({ text: botMsgs.msg_ended || '⚠️ This giveaway has ended!', show_alert: true });
      return;
    }

    if (lottery.status === LotteryStatus.DRAWING) {
      await ctx.answerCallbackQuery({ text: botMsgs.msg_entries_closed || '⚠️ Entries for this giveaway are closed!', show_alert: true });
      return;
    }

    if (lottery.status !== LotteryStatus.ACTIVE) {
      await ctx.answerCallbackQuery({ text: '⚠️ This giveaway is not currently active.', show_alert: true });
      return;
    }

    // 2. Time Guard
    if (lottery.startTime) {
      const startTimestamp = new Date(lottery.startTime).getTime();
      if (!isNaN(startTimestamp) && Date.now() < startTimestamp) {
        await ctx.answerCallbackQuery({ text: botMsgs.msg_not_started || '⏳ This giveaway has not started yet!', show_alert: true });
        return;
      }
    }

    if (lottery.endTime) {
      const endTimestamp = new Date(lottery.endTime).getTime();
      if (!isNaN(endTimestamp) && Date.now() >= endTimestamp) {
        await ctx.answerCallbackQuery({ text: botMsgs.msg_ended || '⚠️ This giveaway has ended!', show_alert: true });
        return;
      }
    }

    // 3. Mandatory Group / Channel Membership Check
    const checkMembership = async (chatId?: string) => {
      if (!chatId || !chatId.trim()) return true;
      const targetApi = currentBot ? currentBot.api : ctx.api;
      try {
        const member = await targetApi.getChatMember(normalizeTelegramChatId(chatId.trim()), from.id);
        return ['creator', 'administrator', 'member', 'restricted'].includes(member.status);
      } catch (err) {
        console.warn(`[DrawBot Membership Check Warning] Chat: ${chatId}, User: ${from.id}:`, err);
        return true;
      }
    };

    const inGroup = await checkMembership(lottery.requiredGroupId || lottery.targetChatId);
    const inChannel = await checkMembership(lottery.requiredChannelId);

    if (!inGroup || !inChannel) {
      let target = '';
      if (!inGroup && !inChannel) target = 'Group and Channel';
      else if (!inGroup) target = 'Group';
      else target = 'Channel';

      const rawMsg = botMsgs.msg_must_join_group_channel || '⚠️ You must join the required {target} to participate!';
      const msg = rawMsg.replace('{target}', target);
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
      return;
    }

    // 4. Whitelisted User IDs Check (if configured)
    if (lottery.allowedChatIds && lottery.allowedChatIds.length > 0) {
      const normalizedWhitelist = lottery.allowedChatIds
        .map((id: string) => id.trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').toLowerCase())
        .filter(Boolean);

      if (normalizedWhitelist.length > 0) {
        const userIdStr = String(from.id);
        const usernameClean = (from.username || '').trim().toLowerCase();

        const isWhitelisted = normalizedWhitelist.includes(userIdStr) || 
          (usernameClean && normalizedWhitelist.includes(usernameClean));

        if (!isWhitelisted) {
          const alertMsg = botMsgs.msg_og_only || '⚠️ This giveaway is restricted to whitelisted participants only.';
          await ctx.answerCallbackQuery({ text: alertMsg, show_alert: true });
          return;
        }
      }
    }

    // Account age estimation
    const getAccountAge = (id: number) => {
      if (id < 100000000) return '> 7 years';
      if (id < 500000000) return '~5-7 years';
      if (id < 1000000000) return '~3-5 years';
      if (id < 2000000000) return '~1-3 years';
      return '< 1 year';
    };

    const result = await recordParticipant(
      lotteryId,
      {
        id: userId,
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name
      },
      getAccountAge(from.id)
    );

    if (result.alreadyJoined) {
      await ctx.answerCallbackQuery({
        text: botMsgs.msg_already_joined || 'ℹ️ You have already joined!',
        show_alert: true
      });
    } else if (result.success) {
      await ctx.answerCallbackQuery({
        text: botMsgs.msg_success_join || '🎉 Entry confirmed! Good luck!'
      });
    } else {
      await ctx.answerCallbackQuery({
        text: botMsgs.msg_join_failed || '⚠️ Failed to join. Please try again later.'
      });
    }
  } catch (err: any) {
    console.error('[DrawBot Callback Error]:', err);
    await ctx.answerCallbackQuery({ text: 'Server error, please try again.' }).catch(() => {});
  }
}

export async function connectBot(token: string): Promise<{ ok: boolean; bot: BotConfig }> {
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new Error('Bot token is required');
  }

  // Disconnect previous instance if any
  await disconnectBot();

  try {
    const testBot = new Bot(cleanToken);
    const me = await testBot.api.getMe();

    // Register callback query listener
    testBot.on('callback_query:data', handleDrawCallbackQuery);

    testBot.catch((err) => {
      console.error('[DrawBot Runner Catch]:', err);
    });

    // Check if cleanToken is identical to Main Bot's BOT_TOKEN
    const isMainBotToken = Boolean(process.env.BOT_TOKEN && cleanToken === process.env.BOT_TOKEN.trim());

    if (!isMainBotToken) {
      // Start independent polling for dedicated secondary sub-bot
      testBot.start({
        onStart: (botInfo) => {
          console.log(`[DrawBot] Started polling as @${botInfo.username}`);
        }
      }).catch((err) => {
        console.warn(`[DrawBot Polling Conflict / Network Warning]: ${err.message}`);
      });
    } else {
      console.log(`[DrawBot] Token matches Main Bot (@${me.username}). Polling shared with Main Bot to prevent 409 Conflict.`);
    }

    currentBot = testBot;
    currentBotConfig = {
      id: me.id,
      username: me.username || '',
      firstName: me.first_name
    };

    return { ok: true, bot: currentBotConfig };
  } catch (err: any) {
    console.error('[DrawBot Connect Error]:', err.message);
    throw new Error(`Failed to connect bot: ${err.message}`);
  }
}

export async function disconnectBot(): Promise<void> {
  if (currentBot) {
    try {
      await currentBot.stop();
    } catch (e) {
      console.warn('[DrawBot Disconnect Stop Warning]:', e);
    }
    currentBot = null;
    currentBotConfig = null;
  }
}

export async function testConnection(chatId: string, topicId?: string, token?: string): Promise<void> {
  let targetApi: any = null;
  if (token && token.trim()) {
    const temp = new Bot(token.trim());
    targetApi = temp.api;
  } else if (currentBot) {
    targetApi = currentBot.api;
  }

  if (!targetApi) {
    throw new Error('Bot is not connected. Please enter Bot Token first.');
  }

  const cleanChat = normalizeTelegramChatId(chatId);
  const options: any = {};
  if (topicId && topicId.trim()) {
    const tid = parseInt(topicId.trim(), 10);
    if (!isNaN(tid)) {
      options.message_thread_id = tid;
    }
  }

  await targetApi.sendMessage(cleanChat, '🔔 Test Connection Successful from Telegram Draw Bot', options);
}

export async function publishLotteryToTelegram(id: string): Promise<{ ok: boolean; messageId: number }> {
  if (!currentBot) {
    throw new Error('Bot is not connected. Please connect Bot Token first.');
  }

  const lottery = await getLotteryById(id);
  if (!lottery) throw new Error('Lottery not found');
  const targetChat = normalizeTelegramChatId(lottery.targetChatId);

  const keyboard = new InlineKeyboard().text(lottery.buttonText || '🎉 Join Lucky Draw', `join_${lottery.id}`);

  let text = '';
  const cleanDesc = lottery.description ? sanitizeTelegramHtml(lottery.description).trim() : '';

  if (cleanDesc) {
    const hasHeaderOrTitle = cleanDesc.startsWith('<b>') || 
                             cleanDesc.startsWith('<strong>') || 
                             (lottery.internalName && cleanDesc.toLowerCase().includes(lottery.internalName.trim().toLowerCase()));
    if (!hasHeaderOrTitle && lottery.internalName && lottery.internalName.trim()) {
      text = `🏆 <b>${escapeHtml(lottery.internalName.trim())}</b>\n\n${cleanDesc}`;
    } else {
      text = cleanDesc;
    }
  } else if (lottery.internalName && lottery.internalName.trim()) {
    text = `🏆 <b>${escapeHtml(lottery.internalName.trim())}</b>`;
  }

  const options: any = {
    reply_markup: keyboard,
    parse_mode: 'HTML'
  };
  if (lottery.targetTopicId) {
    options.message_thread_id = parseInt(lottery.targetTopicId);
  }

  let sentMsg: any;
  if (lottery.imageUrl && lottery.imageUrl.trim()) {
    try {
      sentMsg = await currentBot.api.sendPhoto(targetChat, lottery.imageUrl.trim(), {
        caption: text,
        ...options
      });
    } catch (imgErr) {
      console.warn('[DrawBot Publish Photo Fallback]:', imgErr);
      sentMsg = await currentBot.api.sendMessage(normalizeTelegramChatId(lottery.targetChatId), text, options);
    }
  } else {
    sentMsg = await currentBot.api.sendMessage(targetChat, text, options);
  }

  await updateLotteryStatus(id, LotteryStatus.ACTIVE, sentMsg.message_id);
  return { ok: true, messageId: sentMsg.message_id };
}

export function formatWinnerAnnouncement(
  lottery: LotteryConfig,
  winnersList: Winner[],
  prizes: PrizeTier[]
): string {
  const cleanHeader = (lottery.announcementTemplate || `🎉 <b>Congratulations to our Winners!</b>\n\nThe lucky draw for <b>${escapeHtml(lottery.internalName)}</b> has concluded!`).trim();
  let msg = cleanHeader + '\n\n';

  if (!winnersList || winnersList.length === 0) {
    msg += 'No participants joined this draw.';
  } else {
    let truncatedCount = 0;
    for (const prize of prizes) {
      const prizeWinners = winnersList.filter(w => w.prizeName === prize.name);
      if (prizeWinners.length === 0) continue;

      const handles: string[] = [];
      for (const w of prizeWinners) {
        if (w.username && !w.username.startsWith('User')) {
          handles.push(`@${escapeHtml(w.username)}`);
        } else {
          const fullName = [w.firstName, w.lastName].filter(Boolean).join(' ') || w.username || `User#${w.chatId.slice(-4)}`;
          handles.push(`<a href="tg://user?id=${w.chatId}">${escapeHtml(fullName)}</a>`);
        }
      }

      const line = `<b>${escapeHtml(prize.name)}</b>: ${handles.join(' ')}\n`;
      if ((msg + line).length > 3800) {
        truncatedCount = winnersList.length - prizeWinners.length;
        break;
      }
      msg += line;
    }

    if (truncatedCount > 0) {
      msg += `\n<i>...and ${truncatedCount} more winners! (View complete list in dashboard)</i>`;
    }
  }

  const totalPrizes = prizes.reduce((sum, p) => sum + p.count, 0);
  const totalWinners = winnersList.length;
  const unallocatedCount = Math.max(0, totalPrizes - totalWinners);
  if (unallocatedCount > 0) {
    msg += '\n\n<i>⚠️ Note: Total prizes: ' + totalPrizes + ', eligible participants: ' + totalWinners + '. Remaining ' + unallocatedCount + ' prize(s) unallocated due to insufficient participants.</i>';
  }

  return msg;
}

export async function performDraw(
  id: string,
  designatedWinners?: DesignatedWinnerInput[]
): Promise<{ ok: boolean; winners: Winner[]; error?: string }> {
  const lottery = await getLotteryById(id);
  if (!lottery) throw new Error('Lottery not found');
  if (lottery.status === LotteryStatus.ENDED) {
    return { ok: false, winners: lottery.winners, error: 'Lottery has already ended' };
  }
  if (lottery.status === LotteryStatus.DRAWING) {
    return { ok: false, winners: lottery.winners, error: 'Lottery is currently drawing' };
  }

  await updateLotteryStatus(id, LotteryStatus.DRAWING);

  try {
    const participants = lottery.participants || [];
    const prizes = lottery.prizes || [];

    if (!participants || participants.length === 0) {
      await updateLotteryStatus(id, LotteryStatus.ENDED);
      await clearDesignatedWinners(id);

      // Seal original Telegram broadcast message button
      if (currentBot && lottery.targetChatId && lottery.telegramMessageId) {
        try {
          await currentBot.api.editMessageReplyMarkup(
            normalizeTelegramChatId(lottery.targetChatId),
            lottery.telegramMessageId,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔒 Ended', callback_data: 'ended_notice' }]
                ]
              }
            }
          );
        } catch (sealErr: any) {
          console.warn('[DrawBot] Failed to seal Telegram message ' + lottery.telegramMessageId + ':', sealErr.message);
        }
      }

      // Send announcement to Telegram indicating zero participants
      if (currentBot && lottery.targetChatId) {
        try {
          const msg = `🏆 <b>${escapeHtml(lottery.internalName.trim())}</b>\n\nThis giveaway has concluded. No winners were selected as there were no eligible participants.`;
          const options: any = { parse_mode: 'HTML' };
          if (lottery.targetTopicId) {
            options.message_thread_id = parseInt(lottery.targetTopicId);
          }
          if (lottery.telegramMessageId) {
            options.reply_to_message_id = lottery.telegramMessageId;
          }
          await currentBot.api.sendMessage(normalizeTelegramChatId(lottery.targetChatId), msg, options);
        } catch (postErr) {
          console.warn('[DrawBot Announcement Post Warning]:', postErr);
        }
      }

      return { ok: true, winners: [] };
    }

    const participantMap = new Map<string, Participant>();
    for (const p of participants) {
      participantMap.set(p.id, p);
      participantMap.set(p.chatId, p);
    }

    const winnersList: Winner[] = [];
    const winnersToDb: { participantId: string; prizeName: string }[] = [];
    const designatedWinnerIds = new Set<string>();

    // 1. Process valid designated winners first
    const prizeSlotsLeft = new Map<string, number>();
    for (const p of prizes) {
      prizeSlotsLeft.set(p.name, p.count);
    }

    const effectiveDesignated = (designatedWinners && Array.isArray(designatedWinners) && designatedWinners.length > 0)
      ? designatedWinners
      : (lottery.designatedWinners && Array.isArray(lottery.designatedWinners) ? lottery.designatedWinners : []);

    if (designatedWinners && Array.isArray(designatedWinners) && designatedWinners.length > 0) {
      const quotaCheck = new Map<string, number>();
      for (const p of prizes) quotaCheck.set(p.name, p.count);
      const seenCheck = new Set<string>();
      for (const dw of designatedWinners) {
        if (!dw.participantId || !dw.prizeName) continue;
        if (seenCheck.has(dw.participantId)) {
          throw new Error(`参与者已被重复指定，同一用户只能中奖一次 (ID: ${dw.participantId})`);
        }
        seenCheck.add(dw.participantId);
        const maxS = quotaCheck.get(dw.prizeName) || 0;
        if (maxS <= 0) {
          throw new Error(`奖品【${dw.prizeName}】指定人数超出配额上限！`);
        }
        quotaCheck.set(dw.prizeName, maxS - 1);
      }
    }

    if (effectiveDesignated && Array.isArray(effectiveDesignated)) {
      for (const dw of effectiveDesignated) {
        if (!dw.participantId || !dw.prizeName) continue;
        const part = participantMap.get(dw.participantId);
        if (!part) continue;
        if (designatedWinnerIds.has(part.id)) continue;

        const slots = prizeSlotsLeft.get(dw.prizeName) || 0;
        if (slots <= 0) continue;

        designatedWinnerIds.add(part.id);
        prizeSlotsLeft.set(dw.prizeName, slots - 1);
        winnersList.push({
          ...part,
          prizeName: dw.prizeName,
          claimStatus: 'PENDING'
        });
        winnersToDb.push({
          participantId: part.id,
          prizeName: dw.prizeName
        });
      }
    }

    // 2. Remaining random pool from non-designated participants
    const remainingParticipants = participants.filter(p => !designatedWinnerIds.has(p.id));
    const shuffledRemaining = shuffleArray(remainingParticipants);
    let remIdx = 0;

    // Fill remaining prize slots in order of prize tiers
    for (const prize of prizes) {
      const needed = prizeSlotsLeft.get(prize.name) || 0;
      for (let i = 0; i < needed; i++) {
        if (remIdx < shuffledRemaining.length) {
          const randPart = shuffledRemaining[remIdx];
          winnersList.push({
            ...randPart,
            prizeName: prize.name,
            claimStatus: 'PENDING'
          });
          winnersToDb.push({
            participantId: randPart.id,
            prizeName: prize.name
          });
          remIdx++;
        }
      }
    }

    await saveWinners(id, winnersToDb);
    await updateLotteryStatus(id, LotteryStatus.ENDED);
    await clearDesignatedWinners(id);

    // 3. Seal original Telegram broadcast message button
    if (currentBot && lottery.targetChatId && lottery.telegramMessageId) {
      try {
        await currentBot.api.editMessageReplyMarkup(
          normalizeTelegramChatId(lottery.targetChatId),
          lottery.telegramMessageId,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔒 Ended', callback_data: 'ended_notice' }]
              ]
            }
          }
        );
      } catch (sealErr: any) {
        console.warn('[DrawBot] Failed to seal Telegram message ' + lottery.telegramMessageId + ':', sealErr.message);
      }
    }

    // 4. Send announcement to Telegram with 4096 character safe formatting
    if (currentBot && lottery.targetChatId) {
      try {
        const msg = formatWinnerAnnouncement(lottery, winnersList, prizes);
        const options: any = { parse_mode: 'HTML' };
        if (lottery.targetTopicId) {
          options.message_thread_id = parseInt(lottery.targetTopicId);
        }
        if (lottery.telegramMessageId) {
          options.reply_to_message_id = lottery.telegramMessageId;
        }

        await currentBot.api.sendMessage(normalizeTelegramChatId(lottery.targetChatId), msg, options);
      } catch (postErr) {
        console.warn('[DrawBot Announcement Post Warning]:', postErr);
      }
    }

    return { ok: true, winners: winnersList };
  } catch (err: any) {
    console.error('[DrawBot Perform Draw Error]:', err);
    await updateLotteryStatus(id, LotteryStatus.ACTIVE);
    throw err;
  }
}

export async function reannounceWinners(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!currentBot) {
    throw new Error('Telegram Bot is not connected');
  }
  const lottery = await getLotteryById(id);
  if (!lottery) throw new Error('Event not found');
  if (!lottery.targetChatId) throw new Error('Target chat ID is not configured for this event');

  const winners = lottery.winners || [];
  const prizes = lottery.prizes || [];
  const msg = formatWinnerAnnouncement(lottery, winners, prizes);

  const options: any = { parse_mode: 'HTML' };
  if (lottery.targetTopicId) {
    options.message_thread_id = parseInt(lottery.targetTopicId);
  }
  if (lottery.telegramMessageId) {
    options.reply_to_message_id = lottery.telegramMessageId;
  }

  await currentBot.api.sendMessage(normalizeTelegramChatId(lottery.targetChatId), msg, options);
  return { ok: true };
}
