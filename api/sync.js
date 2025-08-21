// api/sync.js - 개선된 채널톡 API 연동
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://bhtqjipygkawoyieidgp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJodHFqaXB5Z2thd295aWVpZGdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0ODg5NjgsImV4cCI6MjA3MDA2NDk2OH0.hu2EAj9RCq436QBtfbEVF4aGOau4WWomLMDKahN4iAA'
);

// 채널톡 API 키
const CHANNEL_ACCESS_KEY = '688a26176fcb19aebf8b';
const CHANNEL_SECRET = 'a0db6c38b95c8ec4d9bb46e7c653b3e2';

// CSV 파일 기반 정확한 상담사 매핑
const counselorMap = {
  '520798': '채주은',
  '520799': '윤도우리',
  '521212': '손진우',
  '521213': '차정환',
  '521214': '서민국',  // 확인됨
  '521215': '구본영',
  '521217': '권재현',  // 확인됨
  '521218': '조시현',
  '521220': '김상아',
  '521221': '김지원',
  '521222': '정다혜',
  '521223': '김시진',
  '521224': '신혜서',
  '521226': '이민주',
  '521227': '정주연',  // 확인됨
  '521230': '김진후',
  '521231': '이혜영',
  '521232': '김영진',
  '521233': '최호익',
  '521234': '서정국',  // 확인됨
  '521236': '박해영',
  '521239': '이종민',  // 확인됨
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
  '521564': '김국현',
  '521567': '김성현',
  '521902': '김시윤',
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
  '544751': '성일훈',  // 확인됨
  '555633': '아정당',
  '555865': '공현준'
};

// ID로 이름 찾기 (단순하고 정확한 버전)
function getCounselorName(id) {
  if (!id) return '미확인';
  
  // ID를 문자열로 변환하고 공백 제거
  const cleanId = String(id).trim();
  
  // 직접 매칭
  const name = counselorMap[cleanId];
  
  if (name) {
    return name;
  }
  
  // 매칭 실패 시 로그
  console.error(`매핑 실패 - ID: ${cleanId}`);
  return `Unknown_${cleanId}`;
}

// 데이터 검증 함수 추가
function validateHelpCount(count, counselorName) {
  // 하루 최대 도움 횟수 제한 (현실적인 수치)
  const MAX_HELPS_PER_DAY = 200;
  
  if (count > MAX_HELPS_PER_DAY) {
    console.error(`비정상 데이터 감지: ${counselorName} - ${count}회 (최대 ${MAX_HELPS_PER_DAY}회로 제한)`);
    return MAX_HELPS_PER_DAY;
  }
  
  return count;
}

function validateCharCount(chars) {
  // 메시지당 최대 글자수 제한
  const MAX_CHARS_PER_MESSAGE = 5000;
  
  if (chars > MAX_CHARS_PER_MESSAGE) {
    console.error(`비정상 글자수 감지: ${chars}자 (최대 ${MAX_CHARS_PER_MESSAGE}자로 제한)`);
    return MAX_CHARS_PER_MESSAGE;
  }
  
  return chars;
}

// Rate limiter with exponential backoff
class RateLimiter {
  constructor() {
    this.lastCall = 0;
    this.backoffMs = 100;
    this.maxBackoff = 2000;
  }
  
  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    const wait = Math.max(0, this.backoffMs - elapsed);
    
    if (wait > 0) {
      await new Promise(r => setTimeout(r, wait));
    }
    
    this.lastCall = Date.now();
  }
  
  increaseBackoff() {
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoff);
  }
  
  resetBackoff() {
    this.backoffMs = 100;
  }
}

const rateLimiter = new RateLimiter();

// 채널톡 API 호출 with retry
async function callChannelAPI(endpoint, params = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await rateLimiter.wait();
      
      const url = new URL(`https://api.channel.io/open/v5/${endpoint}`);
      Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10초 타임아웃
      
      const response = await fetch(url, {
        headers: {
          'x-access-key': CHANNEL_ACCESS_KEY,
          'x-access-secret': CHANNEL_SECRET,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (response.status === 429) {
        // Rate limit hit
        rateLimiter.increaseBackoff();
        console.log(`Rate limit hit, waiting ${rateLimiter.backoffMs}ms`);
        await new Promise(r => setTimeout(r, rateLimiter.backoffMs));
        continue;
      }
      
      if (!response.ok) {
        throw new Error(`API 호출 실패: ${response.status}`);
      }
      
      rateLimiter.resetBackoff();
      return response.json();
      
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`재시도 ${i + 1}/${retries}: ${error.message}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// 글자수 계산
function countChars(text) {
  if (!text) return 0;
  return [...text].length;
}

// 배치 처리 헬퍼
async function processBatch(items, batchSize, processor) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(item => processor(item))
    );
    results.push(...batchResults);
  }
  return results;
}

// 웹훅 처리 (빠른 응답)
async function handleWebhook(req, res) {
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
      const charCount = countChars(msg.plainText || msg.message || '');
      
      // 비동기로 처리 (응답 지연 방지)
      setImmediate(async () => {
        try {
          // 도움 기록 저장
          await supabase.from('help_records').upsert({
            message_id: msg.id,
            conversation_id: chat.id || 'unknown',
            counselor_id: counselorId,
            counselor_name: counselorName,
            message_content: msg.plainText || msg.message || '',
            char_count: charCount,
            helped_at: new Date(msg.createdAt || Date.now()).toISOString()
          }, { 
            onConflict: 'message_id' 
          });
          
          // 통계 업데이트
          const today = new Date().toISOString().split('T')[0];
          await updateStatsIncremental(counselorId, counselorName, charCount, today);
          
        } catch (error) {
          console.error('웹훅 처리 오류:', error);
        }
      });
    }
  }
  
  // 즉시 응답
  res.status(200).json({ success: true });
}

// 증분 통계 업데이트
async function updateStatsIncremental(counselorId, counselorName, charCount, date) {
  const { data: existing } = await supabase
    .from('counselor_stats')
    .select('*')
    .eq('counselor_id', counselorId)
    .eq('period_start', date)
    .eq('period_end', date)
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
        counselor_name: counselorName,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('counselor_stats')
      .insert({
        counselor_id: counselorId,
        counselor_name: counselorName,
        period_start: date,
        period_end: date,
        help_count: 1,
        total_chars: charCount,
        avg_chars: charCount,
        updated_at: new Date().toISOString()
      });
  }
}

// 빠른 동기화 (최근 데이터만) - 중복 방지 개선
async function quickSync(startDate, endDate) {
  console.log('빠른 동기화 시작 (중복 방지)');
  
  const startTime = new Date(startDate + 'T00:00:00Z').getTime();
  const endTime = new Date(endDate + 'T23:59:59Z').getTime();
  
  // 처리된 메시지 ID 추적 (중복 방지)
  const processedMessages = new Set();
  
  // 최근 열린 대화만 확인 (빠른 응답)
  const params = {
    state: 'opened',
    limit: 100
  };
  
  const data = await callChannelAPI('user-chats', params);
  
  if (!data.userChats || data.userChats.length === 0) {
    return { conversations: 0, messages: 0 };
  }
  
  // 오늘 대화만 필터링
  const todayChats = data.userChats.filter(chat => {
    const chatTime = new Date(chat.updatedAt || chat.createdAt).getTime();
    return chatTime >= startTime && chatTime <= endTime;
  });
  
  const counselorStats = new Map();
  let messageCount = 0;
  let duplicateCount = 0;
  
  // 병렬 처리 (빠른 속도)
  await processBatch(todayChats, 10, async (conv) => {
    try {
      const msgData = await callChannelAPI(`user-chats/${conv.id}/messages`, {
        limit: 50 // 최근 메시지만
      });
      
      if (msgData.messages) {
        for (const msg of msgData.messages) {
          // 중복 체크
          if (processedMessages.has(msg.id)) {
            duplicateCount++;
            console.log(`중복 메시지 스킵: ${msg.id}`);
            continue;
          }
          
          // 오늘 메시지인지 확인
          const msgTime = new Date(msg.createdAt).getTime();
          if (msgTime < startTime || msgTime > endTime) {
            continue;
          }
          
          if (msg.personType === 'manager' && 
              msg.personId && 
              msg.personId !== conv.assignee?.id) {
            
            const counselorId = String(msg.personId).trim();
            const counselorName = getCounselorName(counselorId);
            const charCount = validateCharCount(countChars(msg.plainText || msg.message || ''));
            
            // 처리된 메시지로 표시
            processedMessages.add(msg.id);
            
            if (!counselorStats.has(counselorId)) {
              counselorStats.set(counselorId, {
                counselor_id: counselorId,
                counselor_name: counselorName,
                help_count: 0,
                total_chars: 0
              });
            }
            
            const stats = counselorStats.get(counselorId);
            stats.help_count++;
            stats.total_chars += charCount;
            messageCount++;
          }
        }
      }
    } catch (error) {
      console.error(`대화 ${conv.id} 처리 실패:`, error);
    }
  });
  
  console.log(`처리 완료: ${messageCount}개 메시지, ${duplicateCount}개 중복 제거`);
  
  // 통계 저장 (배치) - 검증된 데이터만
  if (counselorStats.size > 0) {
    const statsArray = Array.from(counselorStats.values()).map(stats => {
      const validatedHelpCount = validateHelpCount(stats.help_count, stats.counselor_name);
      const avgChars = validatedHelpCount > 0 ? 
        Math.round(stats.total_chars / validatedHelpCount) : 0;
      
      return {
        counselor_id: stats.counselor_id,
        counselor_name: stats.counselor_name,
        period_start: startDate,
        period_end: endDate,
        help_count: validatedHelpCount,
        total_chars: stats.total_chars,
        avg_chars: validateCharCount(avgChars),
        updated_at: new Date().toISOString()
      };
    });
    
    // 기존 데이터 삭제 후 새로 저장 (중복 방지)
    await supabase
      .from('counselor_stats')
      .delete()
      .eq('period_start', startDate)
      .eq('period_end', endDate);
    
    await supabase.from('counselor_stats').insert(statsArray);
  }
  
  return {
    conversations: todayChats.length,
    messages: messageCount,
    counselors: counselorStats.size,
    duplicates_removed: duplicateCount
  };
}

// 전체 동기화 (모든 데이터)
async function fullSync(startDate, endDate, progressCallback) {
  console.log('전체 동기화 시작');
  
  const startTime = new Date(startDate + 'T00:00:00Z').getTime();
  const endTime = new Date(endDate + 'T23:59:59Z').getTime();
  
  const conversations = [];
  const states = ['opened', 'closed', 'snoozed'];
  let totalProgress = 0;
  
  // 각 상태별로 대화 가져오기
  for (const state of states) {
    progressCallback && progressCallback(`${state} 대화 조회 중...`, totalProgress, 100);
    
    let cursor = null;
    let pageCount = 0;
    
    do {
      const params = {
        state,
        limit: 200, // 더 작은 배치로
        ...(cursor && { since: cursor })
      };
      
      const data = await callChannelAPI('user-chats', params);
      
      if (data.userChats && data.userChats.length > 0) {
        const todayChats = data.userChats.filter(chat => {
          const chatTime = new Date(chat.updatedAt || chat.createdAt).getTime();
          return chatTime >= startTime && chatTime <= endTime;
        });
        
        conversations.push(...todayChats);
      }
      
      cursor = data.next;
      pageCount++;
      
      // 너무 많은 페이지 방지
      if (pageCount > 10) break;
      
    } while (cursor);
    
    totalProgress += 20;
  }
  
  progressCallback && progressCallback(`${conversations.length}개 대화 처리 중...`, 60, 100);
  
  const counselorStats = new Map();
  const helpMessages = [];
  let processedCount = 0;
  
  // 병렬 처리로 속도 개선
  const results = await processBatch(conversations, 5, async (conv) => {
    try {
      const msgData = await callChannelAPI(`user-chats/${conv.id}/messages`, {
        limit: 100
      });
      
      const messages = [];
      
      if (msgData.messages) {
        for (const msg of msgData.messages) {
          if (msg.personType === 'manager' && 
              msg.personId && 
              msg.personId !== conv.assignee?.id) {
            
            const counselorId = String(msg.personId).trim();
            const counselorName = getCounselorName(counselorId);
            const charCount = countChars(msg.plainText || msg.message || '');
            
            messages.push({
              message_id: msg.id,
              conversation_id: conv.id,
              counselor_id: counselorId,
              counselor_name: counselorName,
              message_content: msg.plainText || msg.message || '',
              char_count: charCount,
              helped_at: new Date(msg.createdAt).toISOString()
            });
            
            if (!counselorStats.has(counselorId)) {
              counselorStats.set(counselorId, {
                counselor_id: counselorId,
                counselor_name: counselorName,
                help_count: 0,
                total_chars: 0
              });
            }
            
            const stats = counselorStats.get(counselorId);
            stats.help_count++;
            stats.total_chars += charCount;
          }
        }
      }
      
      processedCount++;
      if (processedCount % 10 === 0) {
        const progress = 60 + (30 * processedCount / conversations.length);
        progressCallback && progressCallback(
          `처리 중: ${processedCount}/${conversations.length}`,
          progress,
          100
        );
      }
      
      return messages;
      
    } catch (error) {
      console.error(`대화 ${conv.id} 처리 실패:`, error);
      return [];
    }
  });
  
  // 결과 수집
  results.forEach(result => {
    if (result.status === 'fulfilled' && result.value) {
      helpMessages.push(...result.value);
    }
  });
  
  progressCallback && progressCallback('데이터베이스 저장 중...', 90, 100);
  
  // 데이터베이스에 저장
  if (helpMessages.length > 0) {
    // 배치로 저장
    for (let i = 0; i < helpMessages.length; i += 50) {
      const batch = helpMessages.slice(i, i + 50);
      await supabase.from('help_records').upsert(batch, {
        onConflict: 'message_id'
      });
    }
  }
  
  // 통계 저장
  if (counselorStats.size > 0) {
    const statsArray = Array.from(counselorStats.values()).map(stats => ({
      counselor_id: stats.counselor_id,
      counselor_name: stats.counselor_name,
      period_start: startDate,
      period_end: endDate,
      help_count: stats.help_count,
      total_chars: stats.total_chars,
      avg_chars: Math.round(stats.total_chars / stats.help_count),
      updated_at: new Date().toISOString()
    }));
    
    await supabase.from('counselor_stats').upsert(statsArray, {
      onConflict: 'counselor_id,period_start,period_end'
    });
  }
  
  progressCallback && progressCallback('완료!', 100, 100);
  
  return {
    conversations: conversations.length,
    helpMessages: helpMessages.length,
    counselors: counselorStats.size,
    summary: Array.from(counselorStats.values())
      .sort((a, b) => b.help_count - a.help_count)
      .slice(0, 5)
      .map(s => `${s.counselor_name}: ${s.help_count}건`)
  };
}

// 메인 핸들러
module.exports = async (req, res) => {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Signature, X-Token');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // 웹훅 요청 처리
    if (req.headers['x-signature'] || req.headers['x-token']) {
      return await handleWebhook(req, res);
    }
    
    // 동기화 요청 처리
    const today = new Date();
    const startDate = req.body?.startDate || today.toISOString().split('T')[0];
    const endDate = req.body?.endDate || today.toISOString().split('T')[0];
    const syncType = req.body?.type || 'quick';
    
    console.log(`${syncType} 동기화: ${startDate} ~ ${endDate}`);
    
    let result;
    
    if (syncType === 'full') {
      // 전체 동기화 (SSE로 진행상황 전송 가능)
      if (req.headers.accept === 'text/event-stream') {
        // Server-Sent Events로 진행상황 전송
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        
        result = await fullSync(startDate, endDate, (message, current, total) => {
          res.write(`data: ${JSON.stringify({ message, current, total })}\n\n`);
        });
        
        res.write(`data: ${JSON.stringify({ ...result, done: true })}\n\n`);
        res.end();
        
      } else {
        // 일반 응답
        result = await fullSync(startDate, endDate);
        res.status(200).json({ success: true, ...result });
      }
      
    } else {
      // 빠른 동기화
      result = await quickSync(startDate, endDate);
      res.status(200).json({ success: true, ...result });
    }
    
  } catch (error) {
    console.error('API 에러:', error);
    
    // 타임아웃 에러 처리
    if (error.name === 'AbortError') {
      res.status(504).json({ 
        success: false,
        error: '요청 시간 초과. 나중에 다시 시도해주세요.'
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: error.message || '서버 오류가 발생했습니다.'
      });
    }
  }
};
