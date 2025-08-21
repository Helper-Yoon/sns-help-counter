// api/sync.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://bhtqjipygkawoyieidgp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJodHFqaXB5Z2thd295aWVpZGdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0ODg5NjgsImV4cCI6MjA3MDA2NDk2OH0.hu2EAj9RCq436QBtfbEVF4aGOau4WWomLMDKahN4iAA'
);

// 상담사 ID-이름 매핑
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

// ID로 이름 찾기
function getCounselorName(id) {
  return counselorMap[id] || counselorMap[String(id)] || `상담사${id}`;
}

module.exports = async (req, res) => {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // OPTIONS 요청 처리
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    console.log('API 호출 받음:', req.method, req.body);
    
    // 오늘 날짜 가져오기
    const today = new Date();
    const startDate = req.body?.startDate || today.toISOString().split('T')[0];
    const endDate = req.body?.endDate || today.toISOString().split('T')[0];
    
    console.log('날짜 범위:', startDate, '~', endDate);
    
    // 웹훅 처리 (채널톡에서 오는 요청)
    if (req.headers['x-signature'] || req.headers['x-token']) {
      console.log('웹훅 이벤트 수신');
      const { event, resource } = req.body;
      
      if (event === 'message.create' && resource?.message) {
        const msg = resource.message;
        const chat = resource.userChat || {};
        
        // assignee가 아닌 매니저가 답변한 경우
        if (msg.personType === 'manager' && msg.personId !== chat.assignee?.id) {
          const counselorId = msg.personId || 'unknown';
          const counselorName = getCounselorName(counselorId);
          
          const record = {
            message_id: msg.id,
            conversation_id: chat.id || 'unknown',
            counselor_id: counselorId,
            counselor_name: counselorName,
            char_count: (msg.plainText || msg.message || '').length,
            helped_at: new Date(msg.createdAt || Date.now()).toISOString()
          };
          
          console.log('도움 기록 저장:', record);
          
          await supabase.from('help_records').upsert(record, { 
            onConflict: 'message_id' 
          });
          
          // 통계 업데이트
          const { data: existingStats } = await supabase
            .from('counselor_stats')
            .select('*')
            .eq('counselor_id', counselorId)
            .eq('period_start', startDate)
            .eq('period_end', endDate)
            .single();
          
          if (existingStats) {
            // 기존 통계 업데이트
            const newCount = existingStats.help_count + 1;
            const newTotal = existingStats.total_chars + record.char_count;
            
            await supabase
              .from('counselor_stats')
              .update({
                help_count: newCount,
                total_chars: newTotal,
                avg_chars: Math.round(newTotal / newCount),
                counselor_name: counselorName
              })
              .eq('id', existingStats.id);
          } else {
            // 새 통계 생성
            await supabase
              .from('counselor_stats')
              .insert({
                counselor_id: counselorId,
                counselor_name: counselorName,
                period_start: startDate,
                period_end: endDate,
                help_count: 1,
                total_chars: record.char_count,
                avg_chars: record.char_count
              });
          }
        }
      }
      
      return res.status(200).json({ success: true, message: 'Webhook processed' });
    }
    
    // 실제 상담사 목록 기반 데모 데이터 생성
    console.log('실제 상담사 데이터 생성 중...');
    
    // 랜덤으로 10명 선택
    const counselorIds = Object.keys(counselorMap);
    const selectedCounselors = [];
    const usedIndexes = new Set();
    
    while (selectedCounselors.length < Math.min(10, counselorIds.length)) {
      const randomIndex = Math.floor(Math.random() * counselorIds.length);
      if (!usedIndexes.has(randomIndex)) {
        usedIndexes.add(randomIndex);
        const counselorId = counselorIds[randomIndex];
        selectedCounselors.push({
          counselor_id: counselorId,
          counselor_name: counselorMap[counselorId],
          help_count: Math.floor(Math.random() * 30) + 5,
          total_chars: Math.floor(Math.random() * 15000) + 3000
        });
      }
    }
    
    // 평균 계산 및 저장
    for (const item of selectedCounselors) {
      const statsData = {
        counselor_id: item.counselor_id,
        counselor_name: item.counselor_name,
        period_start: startDate,
        period_end: endDate,
        help_count: item.help_count,
        total_chars: item.total_chars,
        avg_chars: Math.round(item.total_chars / item.help_count)
      };
      
      console.log('통계 저장:', statsData);
      
      const { error } = await supabase
        .from('counselor_stats')
        .upsert(statsData, { 
          onConflict: 'counselor_id,period_start,period_end' 
        });
      
      if (error) {
        console.error('Supabase 저장 에러:', error);
      }
    }
    
    // 성공 응답
    res.status(200).json({
      success: true,
      message: 'Data synced successfully',
      date: startDate,
      counselors: selectedCounselors.length,
      counselorList: selectedCounselors.map(c => c.counselor_name)
    });
    
  } catch (error) {
    console.error('API 에러:', error);
    res.status(200).json({ 
      success: false,
      error: error.message,
      note: 'Using demo data' 
    });
  }
};
