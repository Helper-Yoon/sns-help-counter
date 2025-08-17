// 파일명: api/index.js
// 테이블명 변경 부분

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  
  // 대량 동기화 트리거 (동일)
  if (pathname === '/api/bulk-sync') {
    try {
      const response = await fetch(
        `${process.env.SUPABASE_URL}/functions/v1/bulk-sync`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        }
      );
      
      const result = await response.json();
      return res.json(result);
      
    } catch (error) {
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  // 통계 조회 - 테이블명 변경
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // 변경: help_daily_stats 뷰에서 조회
    const { data: stats, error: statsError } = await supabase
      .from('help_daily_stats')
      .select('*')
      .eq('help_date', today)
      .order('total_helps', { ascending: false })
      .limit(50);
    
    if (statsError) throw statsError;
    
    // 변경: help_chat_cache 테이블에서 조회
    const { data: summary, error: summaryError } = await supabase
      .from('help_chat_cache')
      .select('is_waiting_reply');
    
    if (summaryError) throw summaryError;
    
    const waitingCount = summary?.filter(s => s.is_waiting_reply).length || 0;
    const totalCount = summary?.length || 0;
    
    // 변경: help_chat_cache 테이블에서 조회
    const { data: lastChat } = await supabase
      .from('help_chat_cache')
      .select('synced_at')
      .order('synced_at', { ascending: false })
      .limit(1)
      .single();
    
    return res.json({
      success: true,
      stats: stats || [],
      summary: {
        total: totalCount,
        waiting: waitingCount,
        answered: totalCount - waitingCount,
        responseRate: totalCount > 0 
          ? Math.round(((totalCount - waitingCount) / totalCount) * 100) 
          : 0
      },
      isEmpty: !stats || stats.length === 0,
      lastSync: lastChat?.synced_at || new Date().toISOString()
    });
    
  } catch (error) {
    console.error('API 오류:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message,
      stats: [],
      summary: { total: 0, waiting: 0, answered: 0 },
      isEmpty: true
    });
  }
};
