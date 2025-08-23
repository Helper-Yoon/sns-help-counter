// api/track.js
// 채널톡 Webhook 수신 및 데이터 처리 - 텍스트 추출 강화 버전

// Supabase 클라이언트 직접 구현 (라이브러리 없이)
const supabaseRequest = async (table, method, data = null) => {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}`;
  const options = {
    method,
    headers: {
      'apikey': process.env.SUPABASE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
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
  const response = await fetch(`https://api.channel.io/open/v5${endpoint}`, {
    headers: {
      'X-Access-Key': process.env.CHANNEL_KEY,
      'X-Access-Secret': process.env.CHANNEL_SECRET,
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
    /^userChat-[a-f0-9]{20,}$/i,  // userChat-ID 형식
    /^chat-[a-f0-9]{20,}$/i,       // chat-ID 형식
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,  // UUID
    /^[a-f0-9]{24,}$/,              // MongoDB ObjectId 스타일
    /^msg_[a-zA-Z0-9]{20,}$/,      // 메시지 ID 형식
    /^manager-[a-f0-9]{20,}$/i,    // 매니저 ID 형식
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

// 메시지 텍스트 추출 함수 - 모든 가능한 필드 체크
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
      hasBody: !!message.body,
      hasValue: !!message.value,
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
    
    // 2. blocks 구조 처리 (구조화된 메시지)
    if (message.blocks && Array.isArray(message.blocks)) {
      text = parseBlocks(message.blocks);
      if (text) {
        console.log('blocks에서 추출:', text.substring(0, 50));
        return text;
      }
    }
    
    // 3. message 필드
    if (message.message) {
      // message가 객체인 경우
      if (typeof message.message === 'object') {
        text = findTextRecursive(message.message);
      } 
      // message가 문자열인 경우
      else if (typeof message.message === 'string') {
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
      // content가 JSON 문자열인 경우 파싱 시도
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
    
    // 6. body 필드 (이메일 형식 등)
    if (message.body) {
      if (typeof message.body === 'string') {
        text = stripHtml(message.body);
      } else if (typeof message.body === 'object') {
        text = findTextRecursive(message.body);
      }
      if (text) {
        console.log('body 필드에서 추출:', text.substring(0, 50));
        return text;
      }
    }
    
    // 7. value 필드
    if (message.value) {
      if (typeof message.value === 'string') {
        text = stripHtml(message.value);
      } else if (typeof message.value === 'object') {
        text = findTextRecursive(message.value);
      }
      if (text) {
        console.log('value 필드에서 추출:', text.substring(0, 50));
        return text;
      }
    }
    
    // 8. 특수 메시지 타입 처리
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
    
    if (message.video) {
      const videoName = message.video.filename || message.video.name || '';
      text = videoName ? `[동영상: ${videoName}]` : '[동영상]';
      console.log('동영상 메시지 처리:', text);
      return text;
    }
    
    if (message.sticker) {
      text = '[스티커]';
      return text;
    }
    
    // 9. data 필드 확인 (일부 webhook에서 사용)
    if (message.data) {
      if (typeof message.data === 'string') {
        try {
          const parsed = JSON.parse(message.data);
          text = findTextRecursive(parsed);
        } catch {
          text = stripHtml(message.data);
        }
      } else if (typeof message.data === 'object') {
        text = findTextRecursive(message.data);
      }
      if (text) {
        console.log('data 필드에서 추출:', text.substring(0, 50));
        return text;
      }
    }
    
    // 10. 재귀적으로 전체 메시지 객체 탐색 (최후의 수단)
    text = findTextRecursive(message);
    if (text) {
      console.log('재귀 탐색으로 추출:', text.substring(0, 50));
      return text;
    }
    
    // 11. 정말 아무것도 못 찾은 경우
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
  // CORS 설정 (대시보드 접근용)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // OPTIONS 요청 처리 (CORS preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET: 통계 조회 API
  if (req.method === 'GET') {
    try {
      const days = parseInt(req.query.days || '7');
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      // Supabase에서 데이터 조회
      const url = `${process.env.SUPABASE_URL}/rest/v1/manager_messages?created_at=gte.${startDate.toISOString()}&order=created_at.desc`;
      const response = await fetch(url, {
        headers: {
          'apikey': process.env.SUPABASE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_KEY}`
        }
      });
      
      const data = await response.json();
      
      // 통계 집계
      const stats = {};
      data.forEach(msg => {
        const id = msg.writer_manager_id;
        if (!stats[id]) {
          stats[id] = {
            managerId: id,
            managerName: msg.writer_manager_name,
            totalMessages: 0,
            totalCharacters: 0,
            chats: new Set()
          };
        }
        stats[id].totalMessages++;
        stats[id].totalCharacters += msg.message_length;
        stats[id].chats.add(msg.user_chat_id);
      });
      
      // 결과 정리
      const result = Object.values(stats).map(s => ({
        ...s,
        uniqueChats: s.chats.size,
        avgLength: Math.round(s.totalCharacters / s.totalMessages)
      }));
      
      return res.json({
        success: true,
        period: days,
        stats: result.sort((a, b) => b.totalMessages - a.totalMessages),
        recentMessages: data.slice(0, 20) // 최근 20개 메시지
      });
      
    } catch (error) {
      console.error('조회 오류:', error);
      return res.status(500).json({ error: error.message });
    }
  }
  
  // POST: Webhook 처리
  if (req.method === 'POST') {
    try {
      const payload = req.body;
      
      console.log('========== Webhook 수신 ==========');
      console.log('이벤트 정보:', {
        event: payload.event,
        type: payload.type,
        personType: payload.entity?.personType
      });
      
      // 메시지 이벤트만 처리
      if (payload.event !== 'push' || payload.type !== 'message') {
        return res.json({ ignored: true, reason: 'Not a message event' });
      }
      
      // 매니저 메시지만 처리
      if (payload.entity?.personType !== 'manager') {
        return res.json({ ignored: true, reason: 'Not a manager message' });
      }
      
      const message = payload.entity;
      const manager = payload.refers?.manager;
      const user = payload.refers?.user;
      
      // 전체 페이로드 로깅 (디버깅용)
      console.log('전체 메시지 entity:', JSON.stringify(message, null, 2));
      
      // 채팅방 정보 조회
      const chatData = await channelRequest(`/user-chats/${message.chatId}`);
      if (!chatData) {
        throw new Error('채팅방 조회 실패');
      }
      
      const userChat = chatData.userChat;
      
      // 조건 검사: opened 상태이고, 담당자가 있고, 담당자 != 작성자
      if (userChat.state !== 'opened') {
        return res.json({ ignored: true, reason: 'Chat not opened' });
      }
      
      if (!userChat.assigneeId) {
        return res.json({ ignored: true, reason: 'No assignee' });
      }
      
      if (userChat.assigneeId === manager.id) {
        return res.json({ ignored: true, reason: 'Same manager' });
      }
      
      // 메시지 텍스트 추출
      let messageText = extractMessageText(message);
      
      // 시스템 메시지는 무시
      if (messageText === '[시스템 메시지]') {
        console.log('시스템 메시지 감지되어 무시함');
        return res.json({ ignored: true, reason: 'System message' });
      }
      
      // 텍스트가 없으면 추가 시도
      if (!messageText || messageText === '') {
        console.warn('⚠️ 첫 시도에서 빈 메시지 감지! 추가 탐색 시작...');
        
        // payload.refers에서도 메시지 정보 찾기
        if (payload.refers?.message) {
          messageText = extractMessageText(payload.refers.message);
        }
        
        // 시스템 메시지 재확인
        if (messageText === '[시스템 메시지]') {
          console.log('추가 탐색에서 시스템 메시지 감지되어 무시함');
          return res.json({ ignored: true, reason: 'System message' });
        }
        
        // 그래도 없으면 payload 전체에서 찾기
        if (!messageText) {
          messageText = findTextRecursive(payload);
          
          // 찾은 텍스트가 시스템 메시지인지 확인
          if (messageText && isSystemMessage(messageText)) {
            console.log('재귀 탐색에서 시스템 메시지 감지되어 무시함:', messageText);
            return res.json({ ignored: true, reason: 'System message' });
          }
        }
        
        if (!messageText) {
          console.error('⚠️ 모든 시도 후에도 텍스트 추출 실패!');
          console.error('payload 전체:', JSON.stringify(payload, null, 2));
          messageText = '(내용 추출 실패)';
        }
      }
      
      // 담당자 이름 조회
      let assignedManagerName = userChat.assigneeId;
      try {
        const managerData = await channelRequest(`/managers/${userChat.assigneeId}`);
        if (managerData?.manager) {
          assignedManagerName = managerData.manager.name;
        }
      } catch (e) {
        console.log('담당자 이름 조회 실패, ID 사용');
      }
      
      // 최종 시스템 메시지 체크
      if (isSystemMessage(messageText)) {
        console.log('최종 체크에서 시스템 메시지 감지되어 무시함:', messageText);
        return res.json({ ignored: true, reason: 'System message detected' });
      }
      
      // 너무 짧은 메시지 필터링 (선택적)
      if (messageText.length < 2 && !['?', '!', '.', '네', '예', 'ㅋ', 'ㅎ'].includes(messageText)) {
        console.log('너무 짧은 메시지 무시:', messageText);
        return res.json({ ignored: true, reason: 'Message too short' });
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
      
      console.log('저장 데이터:', {
        messageId: saveData.message_id,
        text: saveData.message_text.substring(0, 100),
        length: saveData.message_length,
        writer: saveData.writer_manager_name
      });
      
      await supabaseRequest('manager_messages', 'POST', saveData);
      
      console.log('========== 처리 완료 ==========\n');
      
      return res.json({
        success: true,
        processed: {
          messageId: message.id,
          writer: manager.name,
          helpedManager: assignedManagerName,
          messageLength: messageText.length,
          textPreview: messageText.substring(0, 50)
        }
      });
      
    } catch (error) {
      console.error('❌ 처리 오류:', error);
      return res.status(500).json({ 
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
  
  // 지원하지 않는 메소드
  return res.status(405).json({ error: 'Method not allowed' });
}
