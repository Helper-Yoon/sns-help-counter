// api/track.js
// 채널톡 Webhook 수신 및 데이터 처리 - 보안 강화 버전
// Service Role Key는 서버 환경변수에서만 사용

// Supabase 클라이언트 직접 구현 (라이브러리 없이)
const supabaseRequest = async (table, method, data = null) => {
  // Vercel 환경변수에서 Service Role Key 사용
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bhtqjipygkawoyieidgp.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // Service Role Key 사용
  
  if (!SUPABASE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다');
    throw new Error('Database configuration error');
  }
  
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const options = {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    }
  };
  
  if (data) {
    options.body = JSON.stringify(data);
  }
  
  const response = await fetch(url, options);
  return response.ok ? (await response.text() || '{"success":true}') : null;
};

// 채널톡 API 요청
const channelRequest = async (endpoint) => {
  const CHANNEL_KEY = process.env.CHANNEL_KEY;
  const CHANNEL_SECRET = process.env.CHANNEL_SECRET;
  
  if (!CHANNEL_KEY || !CHANNEL_SECRET) {
    console.error('❌ 채널톡 API 키가 설정되지 않았습니다');
    throw new Error('Channel.io configuration error');
  }
  
  const response = await fetch(`https://api.channel.io/open/v5${endpoint}`, {
    headers: {
      'X-Access-Key': CHANNEL_KEY,
      'X-Access-Secret': CHANNEL_SECRET,
      'Content-Type': 'application/json'
    }
  });
  return response.ok ? await response.json() : null;
};

// HTML 태그 제거 함수
const stripHtml = (html) => {
  if (!html) return '';
  // HTML 엔티티 디코드
  let text = html.replace(/&nbsp;/gi, ' ')
                 .replace(/&amp;/gi, '&')
                 .replace(/&lt;/gi, '<')
                 .replace(/&gt;/gi, '>')
                 .replace(/&quot;/gi, '"')
                 .replace(/&#39;/gi, "'");
  // HTML 태그 제거
  text = text.replace(/<br\s*\/?>/gi, ' ')
             .replace(/<\/?[^>]+(>|$)/g, '');
  return text.trim();
};

// 재귀적으로 객체에서 텍스트 찾기
const findTextRecursive = (obj, depth = 0, visited = new Set()) => {
  // 순환 참조 방지
  if (visited.has(obj) || depth > 10) return '';
  if (typeof obj === 'object' && obj !== null) {
    visited.add(obj);
  }
  
  // 문자열인 경우 바로 반환
  if (typeof obj === 'string') {
    return obj.trim();
  }
  
  // 배열인 경우
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const text = findTextRecursive(item, depth + 1, visited);
      if (text && text.length > 0) {
        return text;
      }
    }
  }
  
  // 객체인 경우
  if (obj && typeof obj === 'object') {
    // 우선순위가 높은 필드들
    const priorityFields = [
      'plainText', 'text', 'message', 'content', 'value', 
      'body', 'description', 'title', 'name', 'label'
    ];
    
    // 우선순위 필드 먼저 확인
    for (const field of priorityFields) {
      if (obj[field]) {
        const text = findTextRecursive(obj[field], depth + 1, visited);
        if (text && text.length > 0) {
          return text;
        }
      }
    }
    
    // 나머지 필드 확인 (메타데이터 필드 제외)
    const excludeFields = ['id', 'chatId', 'personType', 'createdAt', 'updatedAt', 'type', 'version'];
    for (const [key, value] of Object.entries(obj)) {
      if (!excludeFields.includes(key) && value) {
        const text = findTextRecursive(value, depth + 1, visited);
        if (text && text.length > 0) {
          return text;
        }
      }
    }
  }
  
  return '';
};

// 블록 배열 파싱 함수
const parseBlocks = (blocks) => {
  if (!Array.isArray(blocks)) return '';
  
  const texts = [];
  
  for (const block of blocks) {
    let blockText = '';
    
    // 블록 타입별 처리
    switch (block.type) {
      case 'text':
      case 'message':
        blockText = block.value || block.text || block.content || block.message || '';
        break;
        
      case 'bullets':
      case 'list':
        if (block.blocks && Array.isArray(block.blocks)) {
          blockText = parseBlocks(block.blocks);
        } else if (block.items && Array.isArray(block.items)) {
          blockText = block.items.map(item => 
            typeof item === 'string' ? item : (item.value || item.text || '')
          ).join(' ');
        }
        break;
        
      case 'code':
        blockText = `[코드: ${block.value || block.code || ''}]`;
        break;
        
      case 'quote':
        blockText = block.value || block.quote || block.text || '';
        break;
        
      case 'link':
        blockText = block.text || block.title || block.url || '[링크]';
        break;
        
      case 'image':
        blockText = '[이미지]';
        break;
        
      case 'file':
        blockText = `[파일: ${block.filename || block.name || '파일'}]`;
        break;
        
      default:
        // 알 수 없는 타입도 재귀적으로 텍스트 찾기
        blockText = findTextRecursive(block);
    }
    
    if (blockText) {
      texts.push(blockText);
    }
  }
  
  return texts.filter(Boolean).join(' ');
};

// 시스템 메시지나 ID 패턴 감지
const isSystemMessage = (text) => {
  if (!text) return false;
  
  // ID 패턴들 (UUID, 채팅방 ID 등)
  const idPatterns = [
    /^userChat-[a-f0-9]{20,}$/i,
    /^chat-[a-f0-9]{20,}$/i,
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
    /^[a-f0-9]{24,}$/,
    /^msg_[a-zA-Z0-9]{20,}$/,
    /^manager-[a-f0-9]{20,}$/i,
  ];
  
  // 시스템 메시지 패턴들
  const systemPatterns = [
    /^(상담사?가?\s*)?(배정|할당|변경|전환|종료)(되었습니다|됐습니다|했습니다)?$/,
    /^(대화|상담|채팅)을?\s*(시작|종료|완료)(합니다|했습니다)?$/,
    /^\[시스템\]/,
    /^\[자동\s*응답\]/,
    /^Bot:/i,
    /^System:/i,
    /채팅방이?\s*(생성|열림|닫힘)/,
    /상담\s*대기/,
    /자동\s*배정/,
  ];
  
  const trimmedText = text.trim();
  
  // ID 패턴 체크
  for (const pattern of idPatterns) {
    if (pattern.test(trimmedText)) {
      console.log('ID 패턴 감지:', trimmedText);
      return true;
    }
  }
  
  // 시스템 메시지 패턴 체크
  for (const pattern of systemPatterns) {
    if (pattern.test(trimmedText)) {
      console.log('시스템 메시지 패턴 감지:', trimmedText);
      return true;
    }
  }
  
  // 너무 짧은 메시지 중 특정 키워드만 있는 경우
  if (trimmedText.length < 10) {
    const systemKeywords = ['open', 'close', 'assign', 'transfer', 'start', 'end', 'system'];
    const lowerText = trimmedText.toLowerCase();
    for (const keyword of systemKeywords) {
      if (lowerText === keyword) {
        console.log('시스템 키워드 감지:', trimmedText);
        return true;
      }
    }
  }
  
  return false;
};

// 메시지 텍스트 추출 함수
const extractMessageText = (message) => {
  let text = '';
  
  try {
    // 시스템 메시지 타입 체크
    if (message.type && ['system', 'bot', 'automated', 'assignment'].includes(message.type)) {
      console.log('시스템 메시지 타입 감지, 스킵:', message.type);
      return '[시스템 메시지]';
    }
    
    // 디버깅: 메시지 전체 구조 확인
    console.log('메시지 필드 확인:', {
      type: message.type,
      hasPlainText: !!message.plainText,
      hasMessage: !!message.message,
      hasText: !!message.text,
      hasContent: !!message.content,
      hasBlocks: !!message.blocks,
      allKeys: Object.keys(message)
    });
    
    // 1. plainText 필드 (최우선)
    if (message.plainText && typeof message.plainText === 'string') {
      text = stripHtml(message.plainText);
      if (text) {
        console.log('plainText에서 추출:', text.substring(0, 50));
        return text;
      }
    }
    
    // 2. blocks 구조 처리
    if (message.blocks && Array.isArray(message.blocks)) {
      text = parseBlocks(message.blocks);
      if (text) {
        console.log('blocks에서 추출:', text.substring(0, 50));
        return text;
      }
    }
    
    // 3. message 필드
    if (message.message) {
      if (typeof message.message === 'object') {
        text = findTextRecursive(message.message);
      } else if (typeof message.message === 'string') {
        text = stripHtml(message.message);
      }
      if (text) {
        console.log('message 필드에서 추출:', text.substring(0, 50));
        return text;
      }
    }
    
    // 4. text 필드
    if (message.text) {
      if (typeof message.text === 'string') {
        text = stripHtml(message.text);
      } else if (typeof message.text === 'object') {
        text = findTextRecursive(message.text);
      }
      if (text) {
        console.log('text 필드에서 추출:', text.substring(0, 50));
        return text;
      }
    }
    
    // 5. content 필드
    if (message.content) {
      if (typeof message.content === 'string') {
        try {
          const parsed = JSON.parse(message.content);
          text = findTextRecursive(parsed);
        } catch {
          text = stripHtml(message.content);
        }
      } else if (typeof message.content === 'object') {
        text = findTextRecursive(message.content);
      }
      if (text) {
        console.log('content 필드에서 추출:', text.substring(0, 50));
        return text;
      }
    }
    
    // 6. 특수 메시지 타입 처리
    if (message.file) {
      const fileName = message.file.filename || message.file.name || '파일';
      const fileSize = message.file.size ? ` (${Math.round(message.file.size / 1024)}KB)` : '';
      text = `[파일: ${fileName}${fileSize}]`;
      console.log('파일 메시지 처리:', text);
      return text;
    }
    
    if (message.image) {
      const imageName = message.image.filename || message.image.name || '';
      text = imageName ? `[이미지: ${imageName}]` : '[이미지]';
      console.log('이미지 메시지 처리:', text);
      return text;
    }
    
    // 7. 재귀적으로 전체 메시지 객체 탐색 (최후의 수단)
    text = findTextRecursive(message);
    if (text) {
      console.log('재귀 탐색으로 추출:', text.substring(0, 50));
      return text;
    }
    
    console.error('❌ 텍스트 추출 완전 실패. 원본 메시지:', JSON.stringify(message, null, 2));
    
  } catch (error) {
    console.error('텍스트 추출 오류:', error);
    console.error('문제가 된 메시지:', JSON.stringify(message, null, 2));
  }
  
  // 최종 텍스트 정리
  if (text) {
    text = text.trim().replace(/\s+/g, ' ');
    
    // 시스템 메시지인지 확인
    if (isSystemMessage(text)) {
      console.log('⚠️ 시스템 메시지 감지되어 필터링:', text);
      return '[시스템 메시지]';
    }
  }
  
  return text || '';
};

// 메인 핸들러
export default async function handler(req, res) {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // OPTIONS 요청 처리 (CORS preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET: 헬스체크
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'ok',
      message: 'Channel.io webhook endpoint is running',
      timestamp: new Date().toISOString()
    });
  }
  
  // POST: Webhook 처리
  if (req.method === 'POST') {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);
    
    try {
      const payload = req.body;
      
      console.log(`[${requestId}] ========== Webhook 수신 ==========`);
      console.log(`[${requestId}] 이벤트:`, {
        event: payload.event,
        type: payload.type,
        personType: payload.entity?.personType
      });
      
      // 채널톡 검증 요청 처리
      if (payload.type === 'url_verification') {
        console.log(`[${requestId}] URL 검증 요청`);
        return res.status(200).json({
          challenge: payload.challenge
        });
      }
      
      // 메시지 이벤트만 처리
      if (payload.event !== 'push' || payload.type !== 'message') {
        return res.status(200).json({ 
          success: true,
          ignored: true, 
          reason: 'Not a message event' 
        });
      }
      
      // 매니저 메시지만 처리
      if (payload.entity?.personType !== 'manager') {
        return res.status(200).json({ 
          success: true,
          ignored: true, 
          reason: 'Not a manager message' 
        });
      }
      
      const message = payload.entity;
      const manager = payload.refers?.manager;
      const user = payload.refers?.user;
      
      // 필수 데이터 확인
      if (!message || !manager) {
        console.log(`[${requestId}] 필수 데이터 누락`);
        return res.status(200).json({ 
          success: true,
          ignored: true,
          reason: 'Missing required data'
        });
      }
      
      // 채팅방 정보 조회
      let chatData = null;
      try {
        chatData = await channelRequest(`/user-chats/${message.chatId}`);
      } catch (error) {
        console.error(`[${requestId}] 채팅방 조회 실패:`, error);
        // 채팅방 조회 실패해도 계속 진행 (200 반환)
        return res.status(200).json({ 
          success: false,
          error: 'Failed to fetch chat data',
          processed: true
        });
      }
      
      if (!chatData || !chatData.userChat) {
        return res.status(200).json({ 
          success: true,
          ignored: true,
          reason: 'No chat data'
        });
      }
      
      const userChat = chatData.userChat;
      
      // 조건 검사
      if (userChat.state !== 'opened') {
        return res.status(200).json({ 
          success: true,
          ignored: true, 
          reason: 'Chat not opened' 
        });
      }
      
      if (!userChat.assigneeId) {
        return res.status(200).json({ 
          success: true,
          ignored: true, 
          reason: 'No assignee' 
        });
      }
      
      if (userChat.assigneeId === manager.id) {
        return res.status(200).json({ 
          success: true,
          ignored: true, 
          reason: 'Same manager' 
        });
      }
      
      // 메시지 텍스트 추출
      let messageText = extractMessageText(message);
      
      // 시스템 메시지는 무시
      if (messageText === '[시스템 메시지]' || isSystemMessage(messageText)) {
        console.log(`[${requestId}] 시스템 메시지 감지되어 무시함`);
        return res.status(200).json({ 
          success: true,
          ignored: true, 
          reason: 'System message' 
        });
      }
      
      // 빈 메시지 처리
      if (!messageText || messageText === '') {
        console.warn(`[${requestId}] ⚠️ 빈 메시지 감지`);
        
        // payload.refers에서도 찾기
        if (payload.refers?.message) {
          messageText = extractMessageText(payload.refers.message);
        }
        
        if (!messageText) {
          messageText = findTextRecursive(payload);
        }
        
        if (!messageText || isSystemMessage(messageText)) {
          console.log(`[${requestId}] 최종 체크에서 시스템 메시지 또는 빈 메시지`);
          return res.status(200).json({ 
            success: true,
            ignored: true,
            reason: 'Empty or system message'
          });
        }
      }
      
      // 너무 짧은 메시지 필터링
      if (messageText.length < 2 && !['?', '!', '.', '네', '예', 'ㅋ', 'ㅎ'].includes(messageText)) {
        console.log(`[${requestId}] 너무 짧은 메시지 무시:`, messageText);
        return res.status(200).json({ 
          success: true,
          ignored: true, 
          reason: 'Message too short' 
        });
      }
      
      // 담당자 이름 조회 (캐싱 고려)
      let assignedManagerName = userChat.assigneeId;
      try {
        const managerData = await channelRequest(`/managers/${userChat.assigneeId}`);
        if (managerData?.manager) {
          assignedManagerName = managerData.manager.name;
        }
      } catch (e) {
        console.log(`[${requestId}] 담당자 이름 조회 실패, ID 사용`);
      }
      
      // 데이터 저장
      const saveData = {
        message_id: message.id,
        message_text: messageText,
        message_length: messageText.length || 0,
        user_chat_id: message.chatId,
        chat_state: userChat.state,
        assigned_manager_id: userChat.assigneeId,
        assigned_manager_name: assignedManagerName,
        writer_manager_id: manager.id,
        writer_manager_name: manager.name,
        user_name: user?.name || userChat.name || 'Unknown',
        created_at: new Date(message.createdAt).toISOString()
      };
      
      console.log(`[${requestId}] 저장 데이터:`, {
        messageId: saveData.message_id,
        text: saveData.message_text.substring(0, 100),
        length: saveData.message_length,
        writer: saveData.writer_manager_name
      });
      
      // Supabase에 저장
      try {
        await supabaseRequest('manager_messages', 'POST', saveData);
        console.log(`[${requestId}] 데이터 저장 성공`);
      } catch (error) {
        console.error(`[${requestId}] 데이터 저장 실패:`, error);
        // 저장 실패해도 200 반환 (재시도 방지)
        return res.status(200).json({ 
          success: false,
          error: 'Failed to save data',
          processed: true
        });
      }
      
      const duration = Date.now() - startTime;
      console.log(`[${requestId}] ========== 처리 완료 (${duration}ms) ==========\n`);
      
      return res.status(200).json({
        success: true,
        processed: {
          messageId: message.id,
          writer: manager.name,
          helpedManager: assignedManagerName,
          messageLength: messageText.length,
          duration: duration
        }
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[${requestId}] ❌ 처리 오류 (${duration}ms):`, error);
      
      // 에러가 발생해도 항상 200 반환 (채널톡 재시도 방지)
      return res.status(200).json({ 
        success: false,
        error: error.message,
        duration: duration,
        processed: true
      });
    }
  }
  
  // 지원하지 않는 메소드
  return res.status(405).json({ error: 'Method not allowed' });
}

// Vercel 설정
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};
