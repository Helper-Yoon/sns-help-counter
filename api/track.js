// api/track.js
// 채널톡 Webhook 수신 및 데이터 처리

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
      
      console.log('Webhook 수신:', {
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
      
      // 담당자 이름 조회 (선택사항)
      let assignedManagerName = userChat.assigneeId;
      try {
        const managerData = await channelRequest(`/managers/${userChat.assigneeId}`);
        if (managerData?.manager) {
          assignedManagerName = managerData.manager.name;
        }
      } catch (e) {
        console.log('담당자 이름 조회 실패, ID 사용');
      }
      
      // 데이터 저장
      const saveData = {
        message_id: message.id,
        message_text: message.plainText || '',
        message_length: (message.plainText || '').length,
        user_chat_id: message.chatId,
        chat_state: userChat.state,
        assigned_manager_id: userChat.assigneeId,
        assigned_manager_name: assignedManagerName,
        writer_manager_id: manager.id,
        writer_manager_name: manager.name,
        user_name: user?.name || userChat.name || 'Unknown',
        created_at: new Date(message.createdAt).toISOString()
      };
      
      console.log('저장할 데이터:', saveData);
      
      await supabaseRequest('manager_messages', 'POST', saveData);
      
      return res.json({
        success: true,
        processed: {
          messageId: message.id,
          writer: manager.name,
          helpedManager: assignedManagerName,
          messageLength: message.plainText?.length || 0
        }
      });
      
    } catch (error) {
      console.error('처리 오류:', error);
      return res.status(500).json({ 
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
  
  // 지원하지 않는 메소드
  return res.status(405).json({ error: 'Method not allowed' });
}
