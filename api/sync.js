export default async function handler(req, res) {
  // CORS 처리
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { channelKey, channelSecret, supabaseUrl, supabaseKey } = req.body;

    // 동적 import 사용 (Vercel 호환성)
    const { createClient } = await import('@supabase/supabase-js');
    const axios = (await import('axios')).default;

    const supabase = createClient(supabaseUrl, supabaseKey);

    const channelAPI = axios.create({
      baseURL: 'https://api.channel.io/open',
      headers: {
        'x-access-key': channelKey,
        'x-access-secret': channelSecret,
        'accept': 'application/json'
      }
    });

    // 최근 50개 대화만 빠르게 동기화
    const response = await channelAPI.get('/v5/user-chats', {
      params: { 
        state: 'opened', 
        limit: 50,
        sortOrder: 'desc'
      }
    });

    const chats = response.data.userChats || [];
    let synced = 0;

    for (const chat of chats) {
      // 미답변 상담만 처리
      if (chat.frontUpdatedAt > chat.deskUpdatedAt || !chat.firstRepliedAtAfterOpen) {
        // 빠른 동기화를 위해 상세 분석 없이 기본 정보만 저장
        const { data, error } = await supabase
          .from('manager_responses')
          .upsert({
            manager_id: 'pending_analysis',
            manager_name: 'Pending',
            chat_id: chat.id,
            user_id: chat.userId,
            source: 'sync',
            metadata: {
              synced_at: new Date().toISOString(),
              needs_analysis: true,
              front_updated: chat.frontUpdatedAt,
              desk_updated: chat.deskUpdatedAt
            }
          })
          .select();
        
        if (!error) synced++;
      }
    }

    return res.status(200).json({
      success: true,
      synced,
      total: chats.length,
      message: `${synced}개 대화 동기화 완료`
    });

  } catch (error) {
    console.error('Sync error:', error);
    return res.status(200).json({ 
      success: false,
      error: error.message || 'Sync failed',
      details: error.response?.data || error.toString()
    });
  }
}
