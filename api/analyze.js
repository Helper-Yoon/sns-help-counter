export default async function handler(req, res) {
  // CORS 처리
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      channelKey, 
      channelSecret, 
      supabaseUrl, 
      supabaseKey,
      lookbackHours = 24 
    } = req.body;

    // 동적 import
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

    // 대화 목록 가져오기
    const response = await channelAPI.get('/v5/user-chats', {
      params: { 
        state: 'opened', 
        limit: 100,
        sortOrder: 'desc'
      }
    });

    const chats = response.data.userChats || [];
    let processed = 0;

    // 시간 필터링
    const cutoffTime = Date.now() - (lookbackHours * 60 * 60 * 1000);
    
    for (const chat of chats) {
      // 시간 체크
      if ((chat.createdAt || 0) < cutoffTime) continue;
      
      // 미답변 상담 체크
      if (chat.frontUpdatedAt > chat.deskUpdatedAt || !chat.firstRepliedAtAfterOpen) {
        
        // 메시지 가져오기
        try {
          const msgResponse = await channelAPI.get(`/v4/user-chats/${chat.id}/messages`, {
            params: { limit: 50 }
          });
          
          const messages = msgResponse.data.messages || [];
          
          // 자기상담 체크
          const personTypes = new Set(messages.map(m => m.personType));
          if (!personTypes.has('user') || personTypes.size < 2) continue;
          
          // 마지막 매니저 응답 찾기
          const sortedMessages = messages.sort((a, b) => a.createdAt - b.createdAt);
          let lastUserIndex = -1;
          
          for (let i = sortedMessages.length - 1; i >= 0; i--) {
            if (sortedMessages[i].personType === 'user') {
              lastUserIndex = i;
              break;
            }
          }
          
          if (lastUserIndex >= 0) {
            // 매니저 응답 찾기
            for (let i = lastUserIndex + 1; i < sortedMessages.length; i++) {
              const msg = sortedMessages[i];
              if (msg.personType === 'manager') {
                // Supabase에 저장
                const { data, error } = await supabase
                  .from('manager_responses')
                  .upsert({
                    manager_id: msg.personId || 'unknown',
                    manager_name: msg.personName || 'Unknown',
                    chat_id: chat.id,
                    user_id: chat.userId,
                    response_time: new Date(msg.createdAt).toISOString(),
                    source: 'api',
                    metadata: {
                      analyzed_at: new Date().toISOString(),
                      chat_state: chat.state
                    }
                  })
                  .select();
                
                if (!error) processed++;
                break;
              }
            }
          }
        } catch (msgError) {
          console.error(`Error processing chat ${chat.id}:`, msgError);
        }
        
        // Rate limit 방지
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return res.status(200).json({
      success: true,
      processed,
      total: chats.length,
      message: `${processed}건의 미답변 상담 답변을 분석했습니다`
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(200).json({ 
      success: false,
      error: error.message || 'Analysis failed',
      details: error.response?.data || error.toString()
    });
  }
}
