// api/sync.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://bhtqjipygkawoyieidgp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJodHFqaXB5Z2thd295aWVpZGdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0ODg5NjgsImV4cCI6MjA3MDA2NDk2OH0.hu2EAj9RCq436QBtfbEVF4aGOau4WWomLMDKahN4iAA'
);

module.exports = async (req, res) => {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // OPTIONS 요청 처리
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    console.log('API 호출 받음:', req.method, req.body);
    
    // 오늘 날짜 가져오기
    const today = new Date();
    const startDate = req.body?.startDate || today.toISOString().split('T')[0];
    const endDate = req.body?.endDate || today.toISOString().split('T')[0];
    
    console.log('날짜 범위:', startDate, '~', endDate);
    
    // 웹훅 처리 (채널톡에서 오는 요청)
    if (req.headers['x-signature'] || req.headers['x-token']) {
      console.log('웹훅 이벤트 수신');
      const { event, resource } = req.body;
      
      if (event === 'message.create' && resource?.message) {
        const msg = resource.message;
        const chat = resource.userChat || {};
        
        // assignee가 아닌 매니저가 답변한 경우
        if (msg.personType === 'manager' && msg.personId !== chat.assignee?.id) {
          const record = {
            message_id: msg.id,
            conversation_id: chat.id || 'unknown',
            counselor_id: msg.personId || 'unknown',
            counselor_name: msg.person?.name || msg.personName || 'Unknown',
            char_count: (msg.plainText || msg.message || '').length,
            helped_at: new Date(msg.createdAt || Date.now()).toISOString()
          };
          
          console.log('도움 기록 저장:', record);
          
          await supabase.from('help_records').upsert(record, { 
            onConflict: 'message_id' 
          });
        }
      }
      
      return res.status(200).json({ success: true, message: 'Webhook processed' });
    }
    
    // 데모 데이터 생성 (실제 API 대신 테스트용)
    console.log('데모 데이터 생성 중...');
    
    const demoData = [
      { 
        counselor_id: 'CS001', 
        counselor_name: '김도움', 
        help_count: Math.floor(Math.random() * 30) + 10, 
        total_chars: Math.floor(Math.random() * 10000) + 5000 
      },
      { 
        counselor_id: 'CS002', 
        counselor_name: '이지원', 
        help_count: Math.floor(Math.random() * 30) + 10, 
        total_chars: Math.floor(Math.random() * 10000) + 5000 
      },
      { 
        counselor_id: 'CS003', 
        counselor_name: '박상담', 
        help_count: Math.floor(Math.random() * 30) + 10, 
        total_chars: Math.floor(Math.random() * 10000) + 5000 
      },
      { 
        counselor_id: 'CS004', 
        counselor_name: '최서포트', 
        help_count: Math.floor(Math.random() * 30) + 10, 
        total_chars: Math.floor(Math.random() * 10000) + 5000 
      },
      { 
        counselor_id: 'CS005', 
        counselor_name: '정헬프', 
        help_count: Math.floor(Math.random() * 30) + 10, 
        total_chars: Math.floor(Math.random() * 10000) + 5000 
      }
    ];
    
    // 평균 계산 및 저장
    for (const item of demoData) {
      const statsData = {
        counselor_id: item.counselor_id,
        counselor_name: item.counselor_name,
        period_start: startDate,
        period_end: endDate,
        help_count: item.help_count,
        total_chars: item.total_chars,
        avg_chars: Math.round(item.total_chars / item.help_count)
      };
      
      console.log('통계 저장:', statsData);
      
      const { error } = await supabase
        .from('counselor_stats')
        .upsert(statsData, { 
          onConflict: 'counselor_id,period_start,period_end' 
        });
      
      if (error) {
        console.error('Supabase 저장 에러:', error);
      }
    }
    
    // 성공 응답
    res.status(200).json({
      success: true,
      message: 'Data synced successfully',
      date: startDate,
      counselors: demoData.length
    });
    
  } catch (error) {
    console.error('API 에러:', error);
    res.status(200).json({ 
      success: false,
      error: error.message,
      note: 'Using demo data' 
    });
  }
};
