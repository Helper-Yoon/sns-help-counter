export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { supabaseUrl, supabaseKey } = req.body;
    
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 테이블이 이미 있는지 확인
    const { data: testData, error: testError } = await supabase
      .from('manager_responses')
      .select('id')
      .limit(1);

    if (!testError) {
      return res.status(200).json({ 
        success: true, 
        message: 'Tables already exist' 
      });
    }

    // 테이블 생성 SQL
    const setupSQL = `
      -- manager_responses 테이블
      CREATE TABLE IF NOT EXISTS manager_responses (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        manager_id TEXT NOT NULL,
        manager_name TEXT,
        manager_email TEXT,
        chat_id TEXT NOT NULL,
        user_id TEXT,
        response_time TIMESTAMPTZ,
        source TEXT DEFAULT 'api',
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- 인덱스
      CREATE INDEX IF NOT EXISTS idx_manager_id ON manager_responses(manager_id);
      CREATE INDEX IF NOT EXISTS idx_chat_id ON manager_responses(chat_id);
      CREATE INDEX IF NOT EXISTS idx_created_at ON manager_responses(created_at);
      
      -- 실시간 구독 활성화
      ALTER PUBLICATION supabase_realtime ADD TABLE manager_responses;
    `;

    return res.status(200).json({ 
      success: true, 
      message: 'Please run the SQL manually in Supabase SQL Editor',
      sql: setupSQL
    });

  } catch (error) {
    console.error('Setup error:', error);
    return res.status(200).json({ 
      success: false,
      error: error.message || 'Setup failed'
    });
  }
}
