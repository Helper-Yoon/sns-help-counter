// api/supabase-proxy.js
// Supabase 프록시 API - 설정 저장 기능 추가

export default async function handler(req, res) {
  // ===============================================
  // ✨ 1. IP 화이트리스트 보안 검사
  // ===============================================
  const allowedIps = process.env.ALLOWED_IPS?.split(',') || [];
  const incomingIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (allowedIps.length > 0 && !allowedIps.includes(incomingIp)) {
    console.warn(`[ACCESS DENIED] Blocked IP: ${incomingIp}`);
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Your IP address is not allowed to access this resource.'
    });
  }

  // 2. CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 3. 환경변수 확인
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Missing environment variables');
    return res.status(500).json({
      error: 'Server configuration error',
      message: 'Database credentials not configured.'
    });
  }

  try {
    // 4. 요청 파라미터 파싱
    const requestData = req.method === 'POST' ? req.body : req.query;
    const {
      table,
      select,
      filters = [],
      order,
      limit,
      offset,
      range,
      method = 'GET',
      // 설정 저장을 위한 추가 파라미터
      special_action,
      settings_data
    } = requestData;

    // ===============================================
    // ✨ 설정 저장 처리 (새로 추가된 부분)
    // ===============================================
    if (special_action === 'save_settings' && settings_data) {
      console.log('설정 저장 요청:', settings_data);
      
      const { key, value } = settings_data;
      
      // 먼저 기존 설정이 있는지 확인
      const checkUrl = `${SUPABASE_URL}/rest/v1/app_settings?setting_key=eq.${key}`;
      const checkResponse = await fetch(checkUrl, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });
      
      const existing = await checkResponse.json();
      
      let saveResponse;
      
      if (existing && existing.length > 0) {
        // UPDATE
        const updateUrl = `${SUPABASE_URL}/rest/v1/app_settings?setting_key=eq.${key}`;
        saveResponse = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            setting_value: value,
            updated_at: new Date().toISOString()
          })
        });
      } else {
        // INSERT
        const insertUrl = `${SUPABASE_URL}/rest/v1/app_settings`;
        saveResponse = await fetch(insertUrl, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            setting_key: key,
            setting_value: value,
            updated_at: new Date().toISOString()
          })
        });
      }
      
      const result = await saveResponse.json();
      
      if (!saveResponse.ok) {
        console.error('설정 저장 실패:', result);
        return res.status(saveResponse.status).json({
          error: 'Settings save failed',
          message: result.message || 'Failed to save settings'
        });
      }
      
      console.log('설정 저장 성공:', key);
      return res.status(200).json({
        data: { success: true, key: key },
        error: null
      });
    }
    // ===============================================

    // 기존 로직 (SELECT 쿼리 처리)
    if (!table) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Table name is required',
        received: requestData
      });
    }

    // 5. Supabase API URL 구성
    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    const queryParams = [];

    if (select) {
      queryParams.push(`select=${select}`);
    }

    if (Array.isArray(filters) && filters.length > 0) {
      filters.forEach(filter => {
        if (filter.column && filter.operator && filter.value !== undefined) {
          queryParams.push(`${filter.column}=${filter.operator}.${filter.value}`);
        }
      });
    }

    if (order) {
      const { column, ascending = false } = order;
      if (column) {
        queryParams.push(`order=${column}.${ascending ? 'asc' : 'desc'}`);
      }
    }

    if (limit) {
      queryParams.push(`limit=${limit}`);
    }

    if (offset) {
      queryParams.push(`offset=${offset}`);
    }

    if (queryParams.length > 0) {
      url += '?' + queryParams.join('&');
    }

    // 6. Supabase API 호출
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'return=representation'
    };

    if (range) {
      headers['Range'] = `${range.from}-${range.to}`;
      headers['Prefer'] += ',count=exact';
    }

    const supabaseResponse = await fetch(url, {
      method: method,
      headers: headers
    });

    // 7. 응답 처리
    const contentRange = supabaseResponse.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
    }

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

    return res.status(200).json({
      data: data,
      error: null,
      count: contentRange ? parseInt(contentRange.split('/')[1]) : null
    });

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};
