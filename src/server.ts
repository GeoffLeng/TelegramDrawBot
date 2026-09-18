import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import drawbotRouter from './drawbot/routes';
import { startDrawScheduler } from './drawbot/scheduler';
import { isDrawModuleEnabled, getSavedBotToken } from './drawbot/database';
import { connectBot } from './drawbot/bot';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3200;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static asset delivery with zero-cache headers
app.use(express.static(path.join(process.cwd(), 'public'), {
  maxAge: 0,
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Admin Authorization Middleware
export function authorizeAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.substring(7);
  if (token !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Invalid admin credentials' });
  }

  return next();
}

// Authentication check and login endpoints
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ ok: true, token: ADMIN_PASSWORD });
  } else {
    res.status(401).json({ ok: false, error: 'Incorrect admin password' });
  }
});

app.get('/api/auth/check', authorizeAdmin, (req: Request, res: Response) => {
  res.json({ ok: true });
});

// Mount DrawBot REST API
app.use('/api/draw', authorizeAdmin, drawbotRouter);

// Frontend SPA route aliases
app.get('/admin', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Global crash immunity
process.on('unhandledRejection', (reason, promise) => {
  console.warn('[TelegramDrawBot] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[TelegramDrawBot] Uncaught Exception:', err);
});

// Boot lifecycle
app.listen(PORT, async () => {
  console.log('====================================================');
  console.log(`  🚀 TelegramDrawBot Server Running on http://localhost:${PORT}`);
  console.log(`  🔑 Default Admin Password: ${ADMIN_PASSWORD}`);
  console.log('====================================================');

  try {
    await isDrawModuleEnabled();
    console.log('[TelegramDrawBot] Standalone service active. Starting scheduler...');
    startDrawScheduler();

    const token = await getSavedBotToken();
    if (token) {
      console.log('[TelegramDrawBot] Reconnecting saved Telegram Bot...');
      const botInfo = await connectBot(token);
      console.log(`[TelegramDrawBot] Bot connected successfully: @${botInfo.bot.username}`);
    } else {
      console.log('[TelegramDrawBot] No saved bot token found. Please set bot token in Admin Console.');
    }
  } catch (err: any) {
    console.error('[TelegramDrawBot] Startup hook error:', err.message);
  }
});
