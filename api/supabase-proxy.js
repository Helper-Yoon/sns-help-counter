// api/supabase-proxy.js
// Supabase 프록시 API - 보안 연결

export default async function handler(req, res) {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
  
  // Preflight 요청 처리
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // 환경변수 확인
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  
  console.log('Environment check:', {
    hasUrl: !!SUPABASE_URL,
    hasKey: !!SUPABASE_ANON_KEY,
    url: SUPABASE_URL
  });
  
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Missing environment variables:', {
      SUPABASE_URL: !!SUPABASE_URL,
      SUPABASE_ANON_KEY: !!SUPABASE_ANON_KEY
    });
    
    return res.status(500).json({ 
      error: 'Server configuration error',
      message: 'Database credentials not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.',
      debug: {
        hasUrl: !!SUPABASE_URL,
        hasKey: !!SUPABASE_ANON_KEY
      }
    });
  }
  
  try {
    // 요청 파라미터 파싱
    const requestData = req.method === 'POST' ? req.body : req.query;
    const { 
      table,
      select,
      filters = [],
      order,
      limit,
      offset,
      range,
      method = 'GET'
    } = requestData;
    
    if (!table) {
      return res.status(400).json({ 
        error: 'Bad Request',
        message: 'Table name is required',
        received: requestData
      });
    }
    
    // URL 구성
    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    const queryParams = [];
    
    // SELECT
    if (select) {
      queryParams.push(`select=${select}`);
    }
    
    // WHERE (필터)
    if (Array.isArray(filters) && filters.length > 0) {
      filters.forEach(filter => {
        if (filter.column && filter.operator && filter.value !== undefined) {
          queryParams.push(`${filter.column}=${filter.operator}.${filter.value}`);
        }
      });
    }
    
    // ORDER BY
    if (order) {
      const { column, ascending = false } = order;
      if (column) {
        queryParams.push(`order=${column}.${ascending ? 'asc' : 'desc'}`);
      }
    }
    
    // LIMIT
    if (limit) {
      queryParams.push(`limit=${limit}`);
    }
    
    // OFFSET
    if (offset) {
      queryParams.push(`offset=${offset}`);
    }
    
    // Query string 조합
    if (queryParams.length > 0) {
      url += '?' + queryParams.join('&');
    }
    
    console.log('Proxy request to:', url);
    
    // Supabase API 호출
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'return=representation'
    };
    
    // Range 헤더 (페이지네이션)
    if (range) {
      headers['Range'] = `${range.from}-${range.to}`;
      headers['Prefer'] += ',count=exact';
    }
    
    const supabaseResponse = await fetch(url, {
      method: method,
      headers: headers
    });
    
    // 응답 헤더 전달
    const contentRange = supabaseResponse.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
    }
    
    // 응답 처리
    const responseText = await supabaseResponse.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse Supabase response:', responseText);
      return res.status(500).json({
        error: 'Invalid response from database',
        message: responseText
      });
    }
    
    if (!supabaseResponse.ok) {
      console.error('Supabase error:', data);
      return res.status(supabaseResponse.status).json({
        error: 'Database error',
        message: data.message || data.error || 'Unknown error',
        details: data
      });
    }
    
    // 성공 응답
    return res.status(200).json({
      data: data,
      error: null,
      count: contentRange ? parseInt(contentRange.split('/')[1]) : null
    });
    
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Vercel 설정
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};
