// api/sync.js - 실제 채널톡 API 연동
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://bhtqjipygkawoyieidgp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJodHFqaXB5Z2thd285aWVpZGdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0ODg5NjgsImV4cCI6MjA3MDA2NDk2OH0.hu2EAj9RCq436QBtfbEVF4aGOau4WWomLMDKahN4iAA'
);

// 채널톡 API 키
const CHANNEL_ACCESS_KEY = '688a26176fcb19aebf8b';
const CHANNEL_SECRET = 'a0db6c38b95c8ec4d9bb46e7c653b3e2';

// 상담사 ID-이름 매핑 (완전한 목록)
const counselorMap = {
  '520798': '채주은',
  '521212': '손진우',
  '520799': '윤도우리',
  '521213': '차정환',
  '521214': '서민국',
  '521215': '구본영',
  '521217': '권재현',
  '521218': '조시현',
  '521220': '김상아',
  '521227': '정주연',
  '521221': '김지원',
  '521222': '정다혜',
  '521223': '김시진',
  '521224': '신혜서',
  '521226': '이민주',
  '521230': '김진후',
  '521231': '이혜영',
  '521232': '김영진',
  '521233': '최호익',
  '521234': '서정국',
  '521236': '박해영',
  '521239': '이종민',
  '521243': '강형욱',
  '521378': '오민경',
  '521379': '최수능',
  '521381': '김채영',
  '521382': '전지윤',
  '521383': '이유주',
  '521384': '김범주',
  '521385': '김예진',
  '521386': '차승현',
  '521392': '이성철',
  '521393': '박은진',
  '521410': '오민환',
  '521416': '전미란',
  '521902': '김시윤',
  '521564': '김국현',
  '521567': '김성현',
  '521937': '김종현',
  '521942': '주은지',
  '521965': '강헌준',
  '522038': '문홍주',
  '523260': '주수현',
  '523268': '오현수',
  '527833': '유종현',
  '527836': '김진협',
  '527910': '옥서아',
  '528425': '정용욱',
  '528628': '김소영',
  '529149': '동수진',
  '529561': '한승윤',
  '544751': '성일훈',
  '555633': '아정당',
  '555865': '공현준'
};

// ID로 이름 찾기 (Unknown 방지)
function getCounselorName(id) {
  const cleanId = String(id).trim();
  return counselorMap[cleanId] || `미확인(${cleanId})`;
}

// Rate limiter
let lastCall = 0;
async function rateLimit() {
  const now = Date.now();
  const wait = Math.max(0, 100 - (now - lastCall)); // 100ms 간격
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
}

// 채널톡 API 호출
async function callChannelAPI(endpoint, params = {}) {
  await rateLimit();
  
  const url = new URL(`https://api.channel.io/open/v5/${endpoint}`);
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
  
  const response = await fetch(url, {
    headers: {
      'x-access-key': CHANNEL_ACCESS_KEY,
      'x-access-secret': CHANNEL_SECRET,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`API 호출 실패: ${response.status}`);
  }
  
  return response.json();
}

// 글자수 정확하게 계산
function countChars(text) {
  if (!text) return 0;
  // 한글, 이모지 포함 정확한 글자수
  return [...text].length;
}

module.exports = async (req, res) => {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    console.log('=== API 시작 ===');
    
    // 오늘 날짜
    const today = new Date();
    const startDate = req.body?.startDate || today.toISOString().split('T')[0];
    const endDate = req.body?.endDate || today.toISOString().split('T')[0];
    
    // 오늘 0시부터 23시 59분까지
    const startTime = new Date(startDate + 'T00:00:00Z').getTime();
    const endTime = new Date(endDate + 'T23:59:59Z').getTime();
    
    console.log(`날짜 범위: ${startDate} 00:00 ~ ${endDate} 23:59`);
    
    // 웹훅 처리
    if (req.headers['x-signature'] || req.headers['x-token']) {
      console.log('웹훅 이벤트 수신');
      const { event, resource } = req.body;
      
      if (event === 'message.create' && resource?.message) {
        const msg = resource.message;
        const chat = resource.userChat || {};
        
        // assignee가 아닌 매니저가 답변한 경우만
        if (msg.personType === 'manager' && 
            msg.personId && 
            msg.personId !== chat.assignee?.id) {
          
          const counselorId = String(msg.personId).trim();
          const counselorName = getCounselorName(counselorId);
          
          const record = {
            message_id: msg.id,
            conversation_id: chat.id || 'unknown',
            counselor_id: counselorId,
            counselor_name: counselorName,
            message_content: msg.plainText || msg.message || '',
            char_count: countChars(msg.plainText || msg.message || ''),
            helped_at: new Date(msg.createdAt || Date.now()).toISOString()
          };
          
          console.log(`도움 기록: ${counselorName}(${counselorId}) - ${record.char_count}자`);
          
          // 도움 기록 저장
          await supabase.from('help_records').upsert(record, { 
            onConflict: 'message_id' 
          });
          
          // 통계 업데이트
          await updateStats(counselorId, counselorName, record.char_count, startDate, endDate);
        }
      }
      
      return res.status(200).json({ success: true });
    }
    
    // 정기 동기화 - 실제 채널톡 API 호출
    console.log('채널톡 대화 목록 가져오기...');
    
    const conversations = [];
    const states = ['opened', 'closed', 'snoozed'];
    
    // 모든 상태의 대화 가져오기
    for (const state of states) {
      let cursor = null;
      let pageCount = 0;
      
      do {
        const params = {
          state,
          limit: 500,
          ...(cursor && { since: cursor })
        };
        
        const data = await callChannelAPI('user-chats', params);
        
        if (data.userChats && data.userChats.length > 0) {
          // 오늘 날짜 대화만 필터링
          const todayChats = data.userChats.filter(chat => {
            const chatTime = new Date(chat.updatedAt || chat.createdAt).getTime();
            return chatTime >= startTime && chatTime <= endTime;
          });
          
          conversations.push(...todayChats);
          console.log(`${state} 상태: ${todayChats.length}개 대화 추가`);
        }
        
        cursor = data.next;
        pageCount++;
        
        // 너무 많은 페이지 방지
        if (pageCount > 30) break;
        
      } while (cursor);
    }
    
    console.log(`총 ${conversations.length}개 대화 발견`);
    
    // 각 대화의 메시지 확인
    const counselorStats = new Map();
    const helpMessages = [];
    let processedCount = 0;
    
    for (const conv of conversations) {
      try {
        // 메시지 가져오기
        const msgData = await callChannelAPI(`user-chats/${conv.id}/messages`, {
          limit: 100
        });
        
        if (msgData.messages) {
          for (const msg of msgData.messages) {
            // assignee가 아닌 매니저가 답변한 경우만
            if (msg.personType === 'manager' && 
                msg.personId && 
                msg.personId !== conv.assignee?.id) {
              
              const counselorId = String(msg.personId).trim();
              const counselorName = getCounselorName(counselorId);
              const charCount = countChars(msg.plainText || msg.message || '');
              
              // 도움 메시지 기록
              helpMessages.push({
                message_id: msg.id,
                conversation_id: conv.id,
                counselor_id: counselorId,
                counselor_name: counselorName,
                message_content: msg.plainText || msg.message || '',
                char_count: charCount,
                helped_at: new Date(msg.createdAt).toISOString()
              });
              
              // 통계 집계
              if (!counselorStats.has(counselorId)) {
                counselorStats.set(counselorId, {
                  counselor_id: counselorId,
                  counselor_name: counselorName,
                  help_count: 0,
                  total_chars: 0,
                  messages: []
                });
              }
              
              const stats = counselorStats.get(counselorId);
              stats.help_count++;
              stats.total_chars += charCount;
              stats.messages.push({
                content: msg.plainText || msg.message || '',
                chars: charCount,
                time: msg.createdAt
              });
            }
          }
        }
        
        processedCount++;
        if (processedCount % 10 === 0) {
          console.log(`처리 진행: ${processedCount}/${conversations.length}`);
        }
        
      } catch (error) {
        console.error(`대화 ${conv.id} 처리 실패:`, error);
      }
    }
    
    console.log(`총 ${helpMessages.length}개 도움 메시지 발견`);
    
    // 데이터베이스에 저장
    if (helpMessages.length > 0) {
      // 배치로 저장
      for (let i = 0; i < helpMessages.length; i += 100) {
        const batch = helpMessages.slice(i, i + 100);
        await supabase.from('help_records').upsert(batch, {
          onConflict: 'message_id'
        });
      }
    }
    
    // 통계 저장
    const statsArray = Array.from(counselorStats.values()).map(stats => ({
      counselor_id: stats.counselor_id,
      counselor_name: stats.counselor_name,
      period_start: startDate,
      period_end: endDate,
      help_count: stats.help_count,
      total_chars: stats.total_chars,
      avg_chars: Math.round(stats.total_chars / stats.help_count)
    }));
    
    if (statsArray.length > 0) {
      await supabase.from('counselor_stats').upsert(statsArray, {
        onConflict: 'counselor_id,period_start,period_end'
      });
    }
    
    console.log('=== 동기화 완료 ===');
    
    res.status(200).json({
      success: true,
      date: startDate,
      conversations: conversations.length,
      helpMessages: helpMessages.length,
      counselors: counselorStats.size,
      summary: statsArray.map(s => `${s.counselor_name}: ${s.help_count}건`)
    });
    
  } catch (error) {
    console.error('API 에러:', error);
    res.status(200).json({ 
      success: false,
      error: error.message
    });
  }
};

// 통계 업데이트 함수
async function updateStats(counselorId, counselorName, charCount, startDate, endDate) {
  const { data: existing } = await supabase
    .from('counselor_stats')
    .select('*')
    .eq('counselor_id', counselorId)
    .eq('period_start', startDate)
    .eq('period_end', endDate)
    .single();
  
  if (existing) {
    const newCount = existing.help_count + 1;
    const newTotal = existing.total_chars + charCount;
    
    await supabase
      .from('counselor_stats')
      .update({
        help_count: newCount,
        total_chars: newTotal,
        avg_chars: Math.round(newTotal / newCount),
        counselor_name: counselorName
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('counselor_stats')
      .insert({
        counselor_id: counselorId,
        counselor_name: counselorName,
        period_start: startDate,
        period_end: endDate,
        help_count: 1,
        total_chars: charCount,
        avg_chars: charCount
      });
  }
}
