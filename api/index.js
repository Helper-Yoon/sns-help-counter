// api/index.js - Vercel용 올인원 API
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// Supabase 설정
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ChannelTalk API 설정
const CHANNEL_CONFIG = {
  headers: {
    'x-access-key': process.env.CHANNELTALK_ACCESS_KEY,
    'x-access-secret': process.env.CHANNELTALK_SECRET
  }
};

// ============= 통계 업데이트 함수 =============
async function updateStats(counselorId, counselorName) {
  const today = new Date().toISOString().split('T')[0];
  
  const { data: existing } = await supabase
    .from('daily_stats')
    .select('help_count')
    .eq('counselor_id', counselorId)
    .eq('stat_date', today)
    .single();
  
  const newCount = (existing?.help_count || 0) + 1;
  
  await supabase.from('daily_stats').upsert({
    counselor_id: counselorId,
    counselor_name: counselorName,
    help_count: newCount,
    stat_date: today,
    updated_at: new Date().toISOString()
  }, {
    onConflict: 'counselor_id,stat_date'
  });
}

// ============= 메시지 동기화 함수 =============
async function syncMessages() {
  console.log('🔄 동기화 시작...');
  
  try {
    // 최근 채팅 가져오기
    const response = await axios.get(
      'https://api.channel.io/open/v5/user-chats',
      {
        params: { state: 'opened', limit: 100, sortOrder: 'desc' },
        ...CHANNEL_CONFIG
      }
    );
    
    const chats = response.data.userChats || [];
    let processedCount = 0;
    
    // 각 채팅의 최근 메시지 확인 (최대 20개)
    for (const chat of chats.slice(0, 20)) {
      try {
        const msgResponse = await axios.get(
          `https://api.channel.io/open/v5/user-chats/${chat.id}/messages`,
          {
            params: { limit: 10, sortOrder: 'desc' },
            ...CHANNEL_CONFIG
          }
        );
        
        const messages = msgResponse.data.messages || [];
        
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          
          // 상담사 메시지만 처리
          if (msg.personType !== 'Manager') continue;
          
          // 이미 처리된 메시지인지 확인
          const { data: existing } = await supabase
            .from('message_tracking')
            .select('message_id')
            .eq('message_id', msg.id)
            .single();
          
          if (existing) continue;
          
          // 이전 메시지가 고객 메시지인지 확인
          const prevMsg = messages[i + 1];
          const isHelpMessage = prevMsg && prevMsg.personType === 'User';
          
          // 메시지 저장
          await supabase.from('message_tracking').insert({
            message_id: msg.id,
            chat_id: chat.id,
            counselor_id: msg.personId,
            counselor_name: msg.personName || `상담사_${msg.personId.slice(-4)}`,
            is_help_message: isHelpMessage,
            previous_message_type: prevMsg?.personType || 'Unknown',
            created_at: new Date(msg.createdAt).toISOString(),
            source: 'api'
          });
          
          // 도움 메시지면 통계 업데이트
          if (isHelpMessage) {
            await updateStats(msg.personId, msg.personName);
            processedCount++;
          }
        }
      } catch (err) {
        console.error(`채팅 ${chat.id} 처리 실패:`, err.message);
      }
    }
    
    return { success: true, processed: processedCount };
  } catch (error) {
    console.error('동기화 오류:', error);
    return { success: false, error: error.message };
  }
}

// ============= Vercel 핸들러 =============
module.exports = async (req, res) => {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  
  // ===== /api/webhook - Webhook 처리 =====
  if (pathname === '/api/webhook' && req.method === 'POST') {
    try {
      const { type, entity } = req.body;
      
      if (type !== 'message') {
        return res.json({ ok: true });
      }
      
      const { message, chat } = entity;
      
      if (message.personType !== 'Manager') {
        return res.json({ ok: true });
      }
      
      // 이전 메시지 확인
      const { data: prevMessages } = await supabase
        .from('message_tracking')
        .select('*')
        .eq('chat_id', chat.id)
        .order('created_at', { ascending: false })
        .limit(1);
      
      const isHelpMessage = prevMessages?.[0]?.previous_message_type === 'User';
      
      // 메시지 저장
      await supabase.from('message_tracking').insert({
        message_id: message.id,
        chat_id: chat.id,
        counselor_id: message.personId,
        counselor_name: message.personName,
        is_help_message: isHelpMessage,
        previous_message_type: 'Manager',
        created_at: new Date(message.createdAt).toISOString(),
        source: 'webhook'
      });
      
      if (isHelpMessage) {
        await updateStats(message.personId, message.personName);
      }
      
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
  
  // ===== /api/sync - 수동 동기화 =====
  if (pathname === '/api/sync') {
    const result = await syncMessages();
    return res.json(result);
  }
  
  // ===== /api/cron - 크론잡 자동 동기화 =====
  if (pathname === '/api/cron') {
    const result = await syncMessages();
    return res.json(result);
  }
  
  // ===== /api/stats - 통계 조회 (기본) =====
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const { data: stats } = await supabase
      .from('daily_stats')
      .select('*')
      .eq('stat_date', today)
      .order('help_count', { ascending: false })
      .limit(20);
    
    const { data: recentMessages } = await supabase
      .from('message_tracking')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    
    return res.json({
      success: true,
      stats: stats || [],
      recentMessages: recentMessages || [],
      lastSync: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
