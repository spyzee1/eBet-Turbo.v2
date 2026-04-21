// Telegram bot integration: send tip notifications + handle bot commands

import type { TopTipsResponse } from './scanner.js';

const TG_API = 'https://api.telegram.org/bot';

export interface TelegramConfig {
  botToken: string;
  chatId: string; // user or group chat ID
}

let config: TelegramConfig | null = null;

export function configureTelegram(botToken: string, chatId: string) {
  config = { botToken, chatId };
}

export function isTelegramConfigured(): boolean {
  return config !== null && !!config.botToken && !!config.chatId;
}

export function loadConfigFromEnv(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (token && chatId) {
    configureTelegram(token, chatId);
    console.log('Telegram configured from environment variables');
  }
}

export async function sendMessage(text: string, parseMode: 'Markdown' | 'HTML' = 'Markdown'): Promise<boolean> {
  if (!config) return false;
  try {
    const res = await fetch(`${TG_API}${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Telegram send error:', res.status, err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Telegram send exception:', e);
    return false;
  }
}

export interface TipForTelegram {
  time: string;
  date: string;
  league: string;
  playerA: string; teamA: string;
  playerB: string; teamB: string;
  valueBet: string;
  confidence: number;
  edge: number;
  ouLine: number;
  oddsA?: number;
  oddsB?: number;
  oddsOver?: number;
  oddsUnder?: number;
  category?: string;
  h2hMode?: boolean;
  h2hWinsA?: number;
  h2hWinsB?: number;
  h2hTotal?: number;
  oddsSource?: string;
  warning?: string | null;
  matchKey?: string; // for dedupe
}

function formatTipMessage(tip: TipForTelegram, isPush: boolean = false): string {
  const cat = tip.category === 'STRONG_BET' ? '🔥 STRONG BET' : tip.category === 'BET' ? '✅ BET' : 'TIPP';
  const lines: string[] = [];

  const header = isPush ? `🚨 *Új ${cat}!*` : `*${cat}*`;
  lines.push(header);
  lines.push('');
  lines.push(`*${tip.playerA}* vs *${tip.playerB}*`);
  lines.push(`_${tip.teamA}_ vs _${tip.teamB}_`);
  lines.push(`📅 ${tip.date} ${tip.time}  ·  ${tip.league}`);
  lines.push('');
  lines.push(`*Tipp:* ${tip.valueBet}`);

  // Pick the relevant odd
  let odds: number | undefined;
  if (tip.valueBet === 'OVER') odds = tip.oddsOver;
  else if (tip.valueBet === 'UNDER') odds = tip.oddsUnder;
  else if (tip.valueBet.includes('A gyozelem')) odds = tip.oddsA;
  else if (tip.valueBet.includes('B gyozelem')) odds = tip.oddsB;

  if (odds) lines.push(`*Odds:* ${odds.toFixed(2)} ${tip.oddsSource === 'bet365' ? '(Bet365)' : '(becsült)'}`);
  if (tip.valueBet === 'OVER' || tip.valueBet === 'UNDER') {
    lines.push(`*O/U Line:* ${tip.ouLine}`);
  }
  lines.push(`*Confidence:* ${Math.round(tip.confidence * 100)}%`);
  lines.push(`*Edge:* ${(tip.edge * 100).toFixed(1)}%`);

  if (tip.h2hMode && tip.h2hTotal) {
    lines.push(`*H2H ONLY:* ${tip.h2hWinsA}W-${tip.h2hWinsB}L (${tip.h2hTotal} meccs)`);
  }
  if (tip.warning) {
    lines.push(`⚠️ ${tip.warning}`);
  }
  return lines.join('\n');
}

export async function pushTip(tip: TipForTelegram): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  return sendMessage(formatTipMessage(tip, true));
}

export async function sendTopTipsList(tips: TipForTelegram[], header: string = '*Napi Top Tippek*'): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  if (tips.length === 0) {
    return sendMessage(`${header}\n\n_Nincs aktuális value bet._`);
  }
  const messages = [header, ''];
  tips.forEach((tip, i) => {
    const cat = tip.category === 'STRONG_BET' ? '🔥' : '✅';
    let odds: number | undefined;
    if (tip.valueBet === 'OVER') odds = tip.oddsOver;
    else if (tip.valueBet === 'UNDER') odds = tip.oddsUnder;
    else if (tip.valueBet.includes('A gyozelem')) odds = tip.oddsA;
    else if (tip.valueBet.includes('B gyozelem')) odds = tip.oddsB;
    const oddsStr = odds ? ` @ ${odds.toFixed(2)}` : '';
    const h2hStr = tip.h2hMode && tip.h2hTotal ? ` [H2H ${tip.h2hWinsA}-${tip.h2hWinsB}/${tip.h2hTotal}]` : '';
    messages.push(`${i + 1}. ${cat} *${tip.playerA}* vs *${tip.playerB}*`);
    messages.push(`   ${tip.valueBet}${oddsStr} · ${Math.round(tip.confidence * 100)}% · edge ${(tip.edge * 100).toFixed(1)}%${h2hStr}`);
    messages.push(`   _${tip.date} ${tip.time} · ${tip.league}_`);
    messages.push('');
  });
  return sendMessage(messages.join('\n'));
}

// Long-polling for bot commands
let lastUpdateId = 0;
let polling = false;

export async function startBotPolling(commandHandler: (cmd: string, args: string) => Promise<string>) {
  if (polling || !isTelegramConfigured()) return;
  polling = true;
  console.log('Telegram bot polling started');

  const poll = async () => {
    if (!polling || !config) return;
    try {
      const url = `${TG_API}${config.botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=25`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json() as { ok: boolean; result: Array<{ update_id: number; message?: { chat: { id: number }; text?: string } }> };
        if (data.ok && data.result) {
          for (const update of data.result) {
            lastUpdateId = update.update_id;
            const msg = update.message;
            if (!msg?.text) continue;
            const text = msg.text.trim();
            if (!text.startsWith('/')) continue;
            const [cmd, ...rest] = text.slice(1).split(/\s+/);
            const args = rest.join(' ');
            try {
              const reply = await commandHandler(cmd.toLowerCase(), args);
              if (reply) {
                // Reply to the chat that sent the command
                await fetch(`${TG_API}${config.botToken}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: msg.chat.id,
                    text: reply,
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                  }),
                });
              }
            } catch (e) {
              console.error('Telegram command handler error:', e);
            }
          }
        }
      }
    } catch (e) {
      console.error('Telegram poll error:', e);
    }
    // Schedule next poll
    setTimeout(poll, 1000);
  };

  poll();
}

export function stopBotPolling() {
  polling = false;
}

// Suppress unused import warning
export type _TopTipsResponse = TopTipsResponse;
