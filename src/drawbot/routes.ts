import { Router, Request, Response } from 'express';
import { 
  getLotteries, 
  getLotteryById, 
  getLotteryParticipants,
  saveLottery, 
  deleteLottery, 
  updateWinnerClaimStatus, 
  getBotMessages, 
  saveBotMessages,
  isDrawModuleEnabled,
  setDrawModuleEnabled,
  saveBotToken,
  getSavedBotToken,
  saveDesignatedWinners
} from './database';
import { 
  connectBot, 
  disconnectBot, 
  getConnectedBot, 
  testConnection, 
  publishLotteryToTelegram, 
  performDraw,
  reannounceWinners,
  normalizeTelegramChatId
} from './bot';
import { LotteryStatus } from './types';
import { startDrawScheduler, stopDrawScheduler } from './scheduler';

const router = Router();

// GET /api/draw/status
router.get('/status', async (req: Request, res: Response) => {
  try {
    const connectedBot = getConnectedBot();
    res.json({
      ok: true,
      enabled: true,
      isConnected: !!connectedBot,
      connectedBot
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/draw/status/toggle
router.post('/status/toggle', async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    const targetState = !!enabled;
    await setDrawModuleEnabled(targetState);
    if (targetState) {
      startDrawScheduler();
      const token = await getSavedBotToken();
      if (token && token.trim() && !getConnectedBot()) {
        await connectBot(token.trim()).catch(err => {
          console.warn('[DrawBot] Auto-connect on wake warning:', err.message);
        });
      }
    } else {
      stopDrawScheduler();
      await disconnectBot();
    }
    res.json({
      ok: true,
      enabled: targetState,
      isConnected: !!getConnectedBot()
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/draw/config
router.get('/config', async (req: Request, res: Response) => {
  const enabled = await isDrawModuleEnabled();
  const connectedBot = getConnectedBot();
  res.json({
    ok: true,
    enabled,
    connectedBot,
    isConnected: !!connectedBot
  });
});

// POST /api/draw/bot/connect
router.post('/bot/connect', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ ok: false, error: 'Bot token is required' });
    }
    const result = await connectBot(token.trim());
    await saveBotToken(token.trim());
    await setDrawModuleEnabled(true);
    startDrawScheduler();
    res.json({ ...result, enabled: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/draw/bot/disconnect
router.post('/bot/disconnect', async (req: Request, res: Response) => {
  try {
    await disconnectBot();
    await saveBotToken('');
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/draw/test-connection
router.post('/test-connection', async (req: Request, res: Response) => {
  try {
    const { chatId, topicId, token } = req.body;
    if (!chatId || typeof chatId !== 'string' || !chatId.trim()) {
      return res.status(400).json({ ok: false, error: 'Target Chat ID is required' });
    }
    await testConnection(chatId, topicId, token);
    res.json({ ok: true, message: 'Message sent successfully' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/draw/lotteries
router.get('/lotteries', async (req: Request, res: Response) => {
  try {
    const lotteries = await getLotteries();
    res.json(lotteries);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/draw/lotteries/:id/participants (Paginated & Searchable)
router.get('/lotteries/:id/participants', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = (req.query.search as string) || '';
    const result = await getLotteryParticipants(req.params.id, page, limit, search);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/draw/lotteries
router.post('/lotteries', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.internalName || typeof data.internalName !== 'string' || !data.internalName.trim()) {
      return res.status(400).json({ ok: false, error: 'Event Name (internalName) is required' });
    }
    if (!data.targetChatId || typeof data.targetChatId !== 'string' || !data.targetChatId.trim()) {
      return res.status(400).json({ ok: false, error: 'Target Chat ID is required' });
    }

    if (!data.id) {
      data.id = 'lottery_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    }
        if (data.targetChatId) data.targetChatId = normalizeTelegramChatId(data.targetChatId);
    if (data.requiredChannelId) data.requiredChannelId = normalizeTelegramChatId(data.requiredChannelId);
    if (data.requiredGroupId) data.requiredGroupId = normalizeTelegramChatId(data.requiredGroupId);
    await saveLottery(data);
    const updated = await getLotteryById(data.id);
    res.json({ ok: true, lottery: updated });
  } catch (err: any) {
    const status = err.message && err.message.includes('Only unpublished draft') ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// DELETE /api/draw/lotteries/:id
router.delete('/lotteries/:id', async (req: Request, res: Response) => {
  try {
    const existing = await getLotteryById(req.params.id);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Lottery not found' });
    }
    if (existing.status === LotteryStatus.DRAWING) {
      return res.status(400).json({ ok: false, error: 'Cannot delete a lottery that is currently in DRAWING state' });
    }
    await deleteLottery(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/draw/lotteries/:id/publish
router.post('/lotteries/:id/publish', async (req: Request, res: Response) => {
  try {
    const result = await publishLotteryToTelegram(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/draw/lotteries/:id/draw
router.post('/lotteries/:id/draw', async (req: Request, res: Response) => {
  try {
    const { designatedWinners } = req.body || {};
    const result = await performDraw(req.params.id, designatedWinners);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/draw/lotteries/:id/pre-assign-winners
router.post('/lotteries/:id/pre-assign-winners', async (req: Request, res: Response) => {
  try {
    const { designatedWinners, autoDrawTime } = req.body || {};
    const result = await saveDesignatedWinners(req.params.id, designatedWinners, autoDrawTime);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/draw/lotteries/:id/winners/claim-status
router.post('/lotteries/:id/winners/claim-status', async (req: Request, res: Response) => {
  try {
    const { participantId, claimStatus } = req.body;
    if (!participantId || !claimStatus) {
      return res.status(400).json({ ok: false, error: 'participantId and claimStatus are required' });
    }
    await updateWinnerClaimStatus(req.params.id, participantId, claimStatus);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/draw/bot-messages
router.get('/bot-messages', async (req: Request, res: Response) => {
  try {
    const messages = await getBotMessages();
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/draw/bot-messages
router.post('/bot-messages', async (req: Request, res: Response) => {
  try {
    const messages = req.body.messages || req.body;
    const updated = await saveBotMessages(messages);
    res.json({ ok: true, messages: updated });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});


// POST /api/draw/lotteries/:id/reannounce
router.post('/lotteries/:id/reannounce', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const result = await reannounceWinners(id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
