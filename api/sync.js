// api/sync.js - 순수한 Webhook 데이터 처리 (보정 없음)
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://bhtqjipygkawoyieidgp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJodHFqaXB5Z2thd285aWVpZGdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0ODg5NjgsImV4cCI6MjA3MDA2NDk2OH0.hu2EAj9RCq436QBtfbEVF4aGOau4WWomLMDKahN4iAA'
);

// 채널톡 API 키
const CHANNEL_ACCESS_KEY = '688a26176fcb19aebf8b';
const CHANNEL_SECRET = 'a0db6c38b95c8ec4d9bb46e7c653b3e2';

// CSV 파일 기준 정확한 상담사 매핑 (54명)
const counselorMap = {
  '520798': '채주은',
  '520799': '윤도우리',
  '521212': '손진우',
  '521213': '차정환',
  '521214': '서민국',
  '521215': '구본영',
  '521217': '권재현',
  '521218': '조시현',
  '521220': '김상아',
  '521221': '김지원',
  '521222': '정다혜',
  '521223': '김시진',
  '521224': '신혜서',
  '521226': '이민주',
  '521227': '정주연',
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
  '544751': '성일훈',
  '555633': '아정당',
  '555865': '공현준'
};

// ID로 이름 찾기 (순수하게)
function getCounselorName(id) {
  if (!id) return null;
  const cleanId = String(id).trim();
  return counselorMap[cleanId] || null;
}

// 글자수 계산 (순수하게)
function countChars(text) {
  if (!text) return 0;
  return [...text].length;
}

// 채널톡 API 호출
async function callChannelAPI(endpoint, params = {}) {
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

// Webhook 처리 - 순수한 데이터만
async function handleWebhook(req, res) {
  const { event, resource } = req.body;
  
  console.log(`Webhook 수신: ${event}`);
  
  if (event === 'message.create' && resource?.message && resource?.userChat) {
    const msg = resource.message;
    const chatId = resource.userChat.id;
    
    try {
      // 채널톡 API에서 해당 대화 정보 가져오기
      const chatData = await callChannelAPI(`user-chats/${chatId}`);
      
      if (!chatData.userChat) {
        console.log('대화 정보를 찾을 수 없음');
        return res.status(200).json({ success: false, reason: 'chat not found' });
      }
      
      const chat = chatData.userChat;
      const assigneeId = chat.assignee?.id;  // 담당자 ID
      const messagePersonId = String(msg.personId).trim();  // 메시지 작성자 ID
      
      console.log(`대화 ${chatId}: 담당자=${assigneeId}, 작성자=${messagePersonId}`);
      
      // 담당자가 아닌 매니저가 답변한 경우만 (도움 답변)
      if (msg.personType === 'manager' && 
          messagePersonId && 
          assigneeId && 
          messagePersonId !== assigneeId) {
        
        const counselorName = getCounselorName(messagePersonId);
        
        // 매핑된 상담사만 처리
        if (counselorName) {
          const charCount = countChars(msg.plainText || msg.message || '');
          const today = new Date().toISOString().split('T')[0];
          
          console.log(`도움 답변: ${counselorName}(${messagePersonId}) - ${charCount}자`);
          
          // 도움 기록 저장 (순수한 데이터)
          await supabase.from('help_records').upsert({
            message_id: msg.id,
            conversation_id: chatId,
            counselor_id: messagePersonId,
            counselor_name: counselorName,
            message_content: msg.plainText || msg.message || '',
            char_count: charCount,
            helped_at: new Date(msg.createdAt || Date.now()).toISOString()
          }, { 
            onConflict: 'message_id' 
          });
          
          // 통계 업데이트 (순수한 집계)
          const { data: existing } = await supabase
            .from('counselor_stats')
            .select('*')
            .eq('counselor_id', messagePersonId)
            .eq('period_start', today)
            .single();
          
          if (existing) {
            // 기존 데이터에 추가
            const newCount = existing.help_count + 1;
            const newTotal = existing.total_chars + charCount;
            
            await supabase
              .from('counselor_stats')
              .update({
                help_count: newCount,
                total_chars: newTotal,
                avg_chars: Math.round(newTotal / newCount),
                updated_at: new Date().toISOString()
              })
              .eq('id', existing.id);
          } else {
            // 새 데이터 생성
            await supabase
              .from('counselor_stats')
              .insert({
                counselor_id: messagePersonId,
                counselor_name: counselorName,
                period_start: today,
                period_end: today,
                help_count: 1,
                total_chars: charCount,
                avg_chars: charCount,
                updated_at: new Date().toISOString()
              });
          }
          
          res.status(200).json({ 
            success: true, 
            processed: true,
            counselor: counselorName,
            chars: charCount 
          });
        } else {
          console.log(`매핑 없음: ${messagePersonId} - 무시`);
          res.status(200).json({ 
            success: true, 
            processed: false, 
            reason: 'counselor not mapped' 
          });
        }
      } else {
        console.log('도움 답변 아님 (담당자 본인 답변)');
        res.status(200).json({ 
          success: true, 
          processed: false, 
          reason: 'not help message' 
        });
      }
    } catch (error) {
      console.error('대화 정보 조회 실패:', error);
      res.status(200).json({ 
        success: false, 
        error: error.message 
      });
    }
  } else {
    res.status(200).json({ 
      success: true, 
      processed: false, 
      reason: 'not message.create event' 
    });
  }
}

// 수동 동기화 (API로 오늘 데이터 확인)
async function manualSync(req, res) {
  const today = new Date();
  const startDate = today.toISOString().split('T')[0];
  const endDate = startDate;
  
  const startTime = new Date(startDate + 'T00:00:00Z').getTime();
  const endTime = new Date(endDate + 'T23:59:59Z').getTime();
  
  console.log(`수동 동기화: ${startDate}`);
  
  try {
    // 이미 처리된 메시지 ID 가져오기
    const { data: existingRecords } = await supabase
      .from('help_records')
      .select('message_id')
      .gte('helped_at', startDate + 'T00:00:00Z')
      .lte('helped_at', endDate + 'T23:59:59Z');
    
    const processedMessages = new Set();
    if (existingRecords) {
      existingRecords.forEach(r => processedMessages.add(r.message_id));
    }
    
    console.log(`기존 메시지: ${processedMessages.size}개`);
    
    // 오늘 대화 목록 가져오기
    const conversations = [];
    for (const state of ['opened', 'closed', 'snoozed']) {
      const data = await callChannelAPI('user-chats', {
        state,
        limit: 100
      });
      
      if (data.userChats) {
        const todayChats = data.userChats.filter(chat => {
          const chatTime = new Date(chat.updatedAt || chat.createdAt).getTime();
          return chatTime >= startTime && chatTime <= endTime;
        });
        conversations.push(...todayChats);
      }
    }
    
    console.log(`오늘 대화: ${conversations.length}개`);
    
    let newMessages = 0;
    let duplicates = 0;
    
    // 각 대화의 메시지 확인
    for (const conv of conversations) {
      const assigneeId = conv.assignee?.id;  // 담당자 ID
      
      if (!assigneeId) continue;
      
      try {
        // 해당 대화의 메시지 가져오기
        const msgData = await callChannelAPI(`user-chats/${conv.id}/messages`, {
          limit: 100
        });
        
        if (msgData.messages) {
          for (const msg of msgData.messages) {
            // 이미 처리된 메시지는 스킵
            if (processedMessages.has(msg.id)) {
              duplicates++;
              continue;
            }
            
            // 오늘 메시지만
            const msgTime = new Date(msg.createdAt).getTime();
            if (msgTime < startTime || msgTime > endTime) {
              continue;
            }
            
            // 담당자가 아닌 매니저가 답변한 경우만
            if (msg.personType === 'manager' && 
                msg.personId && 
                String(msg.personId).trim() !== assigneeId) {
              
              const counselorId = String(msg.personId).trim();
              const counselorName = getCounselorName(counselorId);
              
              // 매핑된 상담사만
              if (counselorName) {
                const charCount = countChars(msg.plainText || msg.message || '');
                
                // 도움 기록 저장
                await supabase.from('help_records').insert({
                  message_id: msg.id,
                  conversation_id: conv.id,
                  counselor_id: counselorId,
                  counselor_name: counselorName,
                  message_content: msg.plainText || msg.message || '',
                  char_count: charCount,
                  helped_at: new Date(msg.createdAt).toISOString()
                });
                
                newMessages++;
                processedMessages.add(msg.id);
              }
            }
          }
        }
      } catch (error) {
        console.error(`대화 ${conv.id} 처리 실패:`, error);
      }
    }
    
    // 통계 재계산 (순수한 집계)
    const { data: todayRecords } = await supabase
      .from('help_records')
      .select('counselor_id, counselor_name, char_count')
      .gte('helped_at', startDate + 'T00:00:00Z')
      .lte('helped_at', endDate + 'T23:59:59Z');
    
    if (todayRecords && todayRecords.length > 0) {
      // 상담사별 집계
      const stats = {};
      todayRecords.forEach(record => {
        if (!stats[record.counselor_id]) {
          stats[record.counselor_id] = {
            counselor_name: record.counselor_name,
            help_count: 0,
            total_chars: 0
          };
        }
        stats[record.counselor_id].help_count++;
        stats[record.counselor_id].total_chars += record.char_count;
      });
      
      // 통계 테이블 업데이트
      for (const [counselorId, stat] of Object.entries(stats)) {
        await supabase.from('counselor_stats').upsert({
          counselor_id: counselorId,
          counselor_name: stat.counselor_name,
          period_start: startDate,
          period_end: endDate,
          help_count: stat.help_count,
          total_chars: stat.total_chars,
          avg_chars: stat.help_count > 0 ? Math.round(stat.total_chars / stat.help_count) : 0,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'counselor_id,period_start,period_end'
        });
      }
    }
    
    console.log(`동기화 완료: ${newMessages}개 새 메시지, ${duplicates}개 중복`);
    
    res.status(200).json({
      success: true,
      date: startDate,
      conversations: conversations.length,
      newMessages,
      duplicates,
      totalMessages: processedMessages.size
    });
    
  } catch (error) {
    console.error('동기화 오류:', error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
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
    // Webhook 요청 (채널톡에서 오는 실시간 데이터)
    if (req.headers['x-signature'] || req.headers['x-token']) {
      return await handleWebhook(req, res);
    }
    
    // 수동 동기화 요청 (누락된 데이터 확인)
    if (req.body?.sync === true) {
      return await manualSync(req, res);
    }
    
    // 기본 응답
    res.status(200).json({ 
      success: true,
      message: 'API is running',
      webhook: 'Send webhook to this endpoint',
      sync: 'POST with {sync: true} to manually sync'
    });
    
  } catch (error) {
    console.error('API 에러:', error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
};
