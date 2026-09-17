# 🎁 TelegramDrawBot (Standalone)

> Autonomous, lightweight, and anti-cheat Telegram Giveaway & Lucky Draw Management System with a dedicated Web3 Dark Admin Dashboard.

---

## 🌟 Key Features

- **Autonomous Telegram Bot Gateway**:
  - Direct integration with Telegram Bot API via **GrammY**.
  - Interactive `[🎉 Join Lucky Draw]` inline buttons.
  - Automatic button sealing to `[🔒 Ended]` upon draw completion with passive self-healing guards.
  - Formatted winner announcements grouped by prize tier (`Prize: @user1 @user2`) with 4096-character overflow protection.
- **Dedicated Web3 Dark Admin Console**:
  - **Master Switch & Sleep Curtain**: One-click dormant/active switch with frosted shadow door (`#draw-shadow-door`) and pulse animation.
  - **Quill Rich Text Editor**: Format event descriptions with bold, italics, headers, lists, and links. Automatically sanitized to Telegram HTML entities.
  - **One-Click "Copy as Template"**: Clone existing events into new drafts in 1 second.
  - **Anti-Misclick Confirmation Modal**: 3-button confirmation displaying entrant quotas and event summaries before execution.
  - **Dual-Track Designated Winners (内定指定)**: Pre-assign specific entrants to designated prize tiers, with automatic Fisher-Yates random fill for remaining slots. Supports immediate draw (`⚡ Draw Now`) or scheduled auto draw (`⏰ Schedule at Auto Draw Time`).
  - **Customizable Interaction Templates**: 9 core Telegram pop-up response templates (100% English) editable from the UI and persisted to SQLite.
  - **Winner Claim Management & CSV Export**: Track prize delivery status and export audit spreadsheets with UTF-8 BOM encoding.
- **Strict Anti-Spam & Gatekeeping**:
  - Enforced Group & Channel membership checks (supports handles, `t.me` links, and numerical chat IDs).
  - Optional Whitelist (OG-only) restriction.
  - 1.5s per-user rate limit debounce.
  - Single-entry deduplication per event.
- **Pure Local Storage & Zero Paid Cloud Dependencies**:
  - Powered by local SQLite (`drawbot.db`) with WAL mode.
  - **Strict Zero AWS / Paid API policy** — 100% free of external service fees.

---

## 🏗️ Architecture & Technology Stack

```
TelegramDrawBot/
├── drawbot.db                   # SQLite Database (Auto-initialized with schema)
├── markdown/
│   └── telegram_draw_prd.md      # Product Requirement Document (PRD)
├── public/                      # Web Admin Console (Static Assets)
│   ├── index.html               # Main Dashboard Interface & Modals
│   ├── css/
│   │   └── style.css            # Dark Web3 Design System & Quill Overrides
│   └── js/
│       └── app.js               # Client-Side Controller & Auth Management
├── src/
│   ├── server.ts                # Express Web Server & Admin Auth Middleware
│   └── drawbot/
│       ├── bot.ts               # Telegram Bot Engine & Callback Handlers
│       ├── database.ts          # SQLite DAO & Schema Migrations
│       ├── routes.ts            # RESTful API Endpoints (/api/draw/*)
│       ├── scheduler.ts         # 60s Auto-Draw Background Cron Worker
│       └── types.ts             # TypeScript Type Definitions
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v18.0.0 or later (v20+ recommended)
- **Telegram Bot Token**: Obtain from [@BotFather](https://t.me/BotFather)

### 2. Installation
```bash
# Navigate to project directory
cd F:/Project_Research/TelegramDrawBot

# Install dependencies
npm install
```

### 3. Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Default `.env` options:
```ini
PORT=3200
ADMIN_PASSWORD=admin123
```

### 4. Running the Development Server
```bash
npm run dev
```
The server will start at `http://localhost:3200`.

### 5. Accessing the Dashboard
1. Open `http://localhost:3200` in your browser.
2. Enter your admin password (default: `admin123`).
3. Click **⚙️ Bot Settings**:
   - Paste your **Telegram Bot Token** from @BotFather.
   - Enter your community chat ID (e.g., `@yourcommunity`) and optional Topic ID.
   - Click **🔔 Send Test Ping** to verify connectivity.
   - Click **💾 Save Templates**.
4. Flip the top **开关** to **ON** (Green / 运行中). The engine will start polling and background task scheduler will activate!

---

## 📦 Production Deployment

### Build TypeScript
```bash
npm run build
```

### Start Production Server
```bash
npm start
```

### PM2 Process Manager
```bash
npm install -g pm2
pm2 start dist/server.js --name "telegram-draw-bot"
pm2 save
pm2 startup
```

---

## 🔒 Security & Data Persistence

1. **Token Isolation**: Bot tokens are stored purely in local SQLite (`bot_settings` table) and are never exposed to public frontend clients.
2. **Crash Immunity**: Unhandled Telegram network exceptions and API timeouts are safely intercepted with process-level guards, guaranteeing 99.9% uptime.
3. **Database Safety**: Schema migrations are strictly non-destructive (`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN IF NOT EXISTS`). Zero data loss on server restarts.

---

## 📄 Documentation
For detailed functional specifications, interaction workflows, data dictionaries, and exception handling standards, see:
- [telegram_draw_prd.md](markdown/telegram_draw_prd.md)
