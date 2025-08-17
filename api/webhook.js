export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, entity, refers } = req.body;
    
    // Supabase 설정
    const supabaseUrl = process.env.SUPABASE_URL || 'https://bhtqjipygkawoyieidgp.supabase.co';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJodHFqaXB5Z2thd295aWVpZGdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0ODg5NjgsImV4cCI6MjA3MDA2NDk2OH0.hu2EAj9RCq436QBtfbEVF4aGOau4WWomLMDKahN4iAA';
    
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 메시지 생성 이벤트
    if (type === 'message.created' && entity) {
      if (entity.personType === 'manager') {
        // 매니저가 답변한 경우
        const { data, error } = await supabase
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
          })
          .select();
      }
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Webhook processed' 
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ 
      success: false,
      error: error.message || 'Webhook processing failed'
    });
  }
}
