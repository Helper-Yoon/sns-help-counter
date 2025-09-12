// api/supabase-proxy.js
// Supabase 요청을 프록시하는 Edge Function
// 클라이언트는 이 API를 통해서만 Supabase에 접근

export default async function handler(req, res) {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // 환경변수에서 키 가져오기 (Vercel Dashboard에 설정)
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bhtqjipygkawoyieidgp.supabase.co';
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Configuration error' });
  }
  
  try {
    const { query, table, method = 'GET', body } = req.body || req.query;
    
    // Supabase REST API 호출
    const url = `${SUPABASE_URL}/rest/v1/${table}${query || ''}`;
    
    const response = await fetch(url, {
      method: method,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    
    const data = await response.json();
    
    return res.status(response.status).json(data);
    
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Proxy error' });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};
