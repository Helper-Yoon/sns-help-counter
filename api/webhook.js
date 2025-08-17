import { createClient } from '@supabase/supabase-js';

// Webhook Secret (ChannelTalk 관리자에서 설정)
const WEBHOOK_SECRET = process.env.CHANNELTALK_WEBHOOK_SECRET || '';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Webhook 서명 검증 (선택사항)
    if (WEBHOOK_SECRET) {
      const signature = req.headers['x-signature'];
      // 서명 검증 로직 (생략 가능)
    }

    const { type, entity, refers } = req.body;
    
    // Supabase URL과 Key는 환경변수 또는 body에서
    const supabaseUrl = process.env.SUPABASE_URL || 'https://bhtqjipygkawoyieidgp.supabase.co';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJodHFqaXB5Z2thd295aWVpZGdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0ODg5NjgsImV4cCI6MjA3MDA2NDk2OH0.hu2EAj9RCq436QBtfbEVF4aGOau4WWomLMDKahN4iAA';
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 메시지 생성 이벤트
    if (type === 'message.created' && entity) {
      if (entity.personType === 'manager') {
        // 매니저가 답변한 경우
        await supabase
          .from('manager_responses')
          .upsert({
            manager_id: entity.personId || 'unknown',
            manager_name: entity.personName || 'Unknown',
            chat_id: entity.chatId,
            user_id: entity.userId || null,
            response_time: new Date(entity.createdAt).toISOString(),
            source: 'webhook',
            metadata: {
              message_id: entity.id,
              message_type: entity.type,
              webhook_received: new Date().toISOString()
            }
          }, {
            onConflict: 'chat_id,manager_id',
            ignoreDuplicates: true
          });
      }
    }
    
    // 대화 상태 변경 이벤트
    else if (type === 'chat.state_changed' && entity) {
      // 활동 로그 저장 (선택사항)
      await supabase
        .from('activity_logs')
        .insert({
          action: 'chat_state_changed',
          details: {
            chat_id: entity.id,
            new_state: entity.state,
            webhook_type: type
          }
        });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Webhook processed' 
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ 
      error: 'Webhook processing failed', 
      details: error.message 
    });
  }
}
