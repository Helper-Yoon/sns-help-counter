// api/sync.js - ChannelTalk API 동기화 & Webhook 처리
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://bhtqjipygkawoyieidgp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJodHFqaXB5Z2thd295aWVpZGdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0ODg5NjgsImV4cCI6MjA3MDA2NDk2OH0.hu2EAj9RCq436QBtfbEVF4aGOau4WWomLMDKahN4iAA'
);

const CHANNEL_KEY = '688a26176fcb19aebf8b';
const CHANNEL_SECRET = 'a0db6c38b95c8ec4d9bb46e7c653b3e2';

// Rate limiter
let lastCall = 0;
const rateLimit = async () => {
  const now = Date.now();
  const wait = Math.max(0, 100 - (now - lastCall));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
};

// ChannelTalk API 호출
async function channelAPI(endpoint, params = {}) {
  await rateLimit();
  const url = new URL(`https://api.channel.io/open/v5/${endpoint}`);
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
  
  const res = await fetch(url, {
    headers: {
      'x-access-key': CHANNEL_KEY,
      'x-access-secret': CHANNEL_SECRET
    }
  });
  return res.json();
}

// 글자수 카운팅
function countChars(text) {
  if (!text) return 0;
  try {
    const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text)).length;
  } catch {
    return [...text].length;
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    // Webhook 처리
    if (req.headers['x-signature']) {
      const { event, resource } = req.body;
      if (event === 'message.create') {
        const msg = resource.message;
        const chat = resource.userChat;
        
        if (msg.personType === 'manager' && msg.personId !== chat.assignee?.id) {
          await supabase.from('help_records').upsert({
            message_id: msg.id,
            conversation_id: chat.id,
            counselor_id: msg.personId,
            counselor_name: msg.person?.name || 'Unknown',
            char_count: countChars(msg.plainText || ''),
            helped_at: new Date(msg.createdAt).toISOString()
          }, { onConflict: 'message_id' });
        }
      }
      return res.status(200).json({ ok: true });
    }
    
    // 동기화 처리
    const { startDate, endDate } = req.body || req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Dates required' });
    }
    
    console.log('Syncing:', startDate, 'to', endDate);
    
    // 대화 가져오기
    const conversations = [];
    for (const state of ['opened', 'closed', 'snoozed']) {
      let cursor = null;
      do {
        const data = await channelAPI('user-chats', {
          state,
          limit: 500,
          ...(cursor && { since: cursor })
        });
        conversations.push(...(data.userChats || []));
        cursor = data.next;
      } while (cursor && conversations.length < 15000);
    }
    
    // 날짜 필터링
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime() + 86400000;
    const filtered = conversations.filter(c => {
      const time = new Date(c.createdAt).getTime();
      return time >= start && time < end;
    });
    
    console.log(`Processing ${filtered.length} conversations`);
    
    // 통계 집계
    const stats = new Map();
    const batchSize = 10;
    
    for (let i = 0; i < filtered.length; i += batchSize) {
      await Promise.all(
        filtered.slice(i, i + batchSize).map(async conv => {
          try {
            const messages = await channelAPI(`user-chats/${conv.id}/messages`, { limit: 100 });
            
            for (const msg of (messages.messages || [])) {
              if (msg.personType === 'manager' && msg.personId !== conv.assignee?.id) {
                const key = msg.personId;
                if (!stats.has(key)) {
                  stats.set(key, {
                    counselor_id: msg.personId,
                    counselor_name: msg.person?.name || 'Unknown',
                    help_count: 0,
                    total_chars: 0
                  });
                }
                const s = stats.get(key);
                s.help_count++;
                s.total_chars += countChars(msg.plainText || '');
              }
            }
          } catch (e) {
            console.error(`Error processing ${conv.id}:`, e);
          }
        })
      );
    }
    
    // 저장
    const results = Array.from(stats.values()).map(s => ({
      ...s,
      period_start: startDate,
      period_end: endDate,
      avg_chars: s.total_chars / s.help_count
    }));
    
    if (results.length > 0) {
      await supabase.from('counselor_stats').upsert(results, {
        onConflict: 'counselor_id,period_start,period_end'
      });
    }
    
    res.status(200).json({
      success: true,
      processed: filtered.length,
      counselors: results.length
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}

export const config = { maxDuration: 300 };
