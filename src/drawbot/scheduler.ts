import { getActiveAutoDrawLotteries } from './database';
import { performDraw, getConnectedBot } from './bot';

let schedulerTimer: NodeJS.Timeout | null = null;
let isChecking = false;

export function startDrawScheduler(intervalMs = 60000): void {
  if (schedulerTimer) return;

  console.log('[DrawBot Scheduler] Started auto-draw scheduler (interval: 60s)');

  // Run immediately once, then on interval
  checkAutoDraws();

  schedulerTimer = setInterval(() => {
    checkAutoDraws();
  }, intervalMs);
}

export function stopDrawScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[DrawBot Scheduler] Stopped auto-draw scheduler');
  }
}

async function checkAutoDraws(): Promise<void> {
  if (isChecking) return;
  isChecking = true;

  try {
    const lotteries = await getActiveAutoDrawLotteries();
    const now = Date.now();

    for (const lottery of lotteries) {
      const triggerTimeStr = lottery.autoDrawTime || lottery.endTime;
      if (!triggerTimeStr || !triggerTimeStr.trim()) continue;

      const triggerTimeMs = new Date(triggerTimeStr).getTime();
      if (isNaN(triggerTimeMs)) continue;

      if (now >= triggerTimeMs) {
        // Hold draw if bot is disconnected so results can be announced on Telegram
        const bot = getConnectedBot();
        if (!bot) {
          console.warn('[DrawBot Scheduler] Event ' + lottery.id + ' (' + lottery.internalName + ') reached draw time, but DrawBot is disconnected. Holding draw until bot reconnects.');
          continue;
        }

        console.log('[DrawBot Scheduler] Triggering auto draw for lottery ' + lottery.id + ' (' + lottery.internalName + ')');
        try {
          await performDraw(lottery.id);
          console.log(`[DrawBot Scheduler] Auto draw completed for ${lottery.id}`);
        } catch (drawErr: any) {
          console.error(`[DrawBot Scheduler] Error auto-drawing ${lottery.id}:`, drawErr.message);
        }
      }
    }
  } catch (err: any) {
    console.error('[DrawBot Scheduler] Check cycle error:', err.message);
  } finally {
    isChecking = false;
  }
}
