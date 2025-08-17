import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { supabaseUrl, supabaseKey } = req.body;
    
    // Service Role Key가 필요한 경우 (테이블 생성)
    const supabase = createClient(
      supabaseUrl, 
      process.env.SUPABASE_SERVICE_KEY || supabaseKey
    );

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

    // 테이블이 없으면 생성 (Supabase 대시보드에서 수동으로 하는 것을 권장)
    // SQL Editor에서 실행할 쿼리:
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
      
      -- Unique constraint
      ALTER TABLE manager_responses 
      ADD CONSTRAINT unique_chat_manager 
      UNIQUE (chat_id, manager_id);
      
      -- activity_logs 테이블 (선택사항)
      CREATE TABLE IF NOT EXISTS activity_logs (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        action TEXT NOT NULL,
        details JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
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
    return res.status(500).json({ 
      error: 'Setup failed', 
      details: error.message 
    });
  }
}
