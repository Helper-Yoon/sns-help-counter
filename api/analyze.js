export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }
    
    const { accessKey, secret, limit = 15000 } = await req.json();
    
    // 채널톡 API 기본 설정
    const headers = {
        'x-access-key': accessKey || '688a26176fcb19aebf8b',
        'x-access-secret': secret || 'a0db6c38b95c8ec4d9bb46e7c653b3e2',
        'Content-Type': 'application/json'
    };
    
    try {
        console.log(`🔍 ${limit}개 대화 분석 시작...`);
        
        // 1. 열린 채팅 목록 가져오기 (페이지네이션)
        const allChats = [];
        let hasNext = true;
        let next = null;
        
        while (hasNext && allChats.length < limit) {
            const url = new URL('https://api.channel.io/open/v5/user-chats');
            url.searchParams.append('state', 'opened');
            url.searchParams.append('limit', '500');
            url.searchParams.append('sortOrder', 'desc');
            if (next) url.searchParams.append('next', next);
            
            const response = await fetch(url, { headers });
            
            if (!response.ok) {
                throw new Error(`ChannelTalk API error: ${response.status}`);
            }
            
            const data = await response.json();
            allChats.push(...data.userChats);
            hasNext = data.hasNext;
            next = data.next;
            
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log(`📊 총 ${allChats.length}개 진행중 대화 발견`);
        
        // 2. 각 채팅의 메시지 분석 (배치 처리)
        const activities = [];
        const batchSize = 50;
        
        for (let i = 0; i < allChats.length; i += batchSize) {
            const batch = allChats.slice(i, Math.min(i + batchSize, allChats.length));
            
            const batchPromises = batch.map(async (chat) => {
                try {
                    // 메시지 가져오기
                    const msgUrl = `https://api.channel.io/open/v5/user-chats/${chat.id}/messages`;
                    const msgResponse = await fetch(msgUrl + '?limit=50&sortOrder=desc', { headers });
                    
                    if (!msgResponse.ok) return null;
                    
                    const msgData = await msgResponse.json();
                    const messages = msgData.messages || [];
                    
                    // 고객의 마지막 메시지 찾기
                    const lastUserMsg = messages.find(m => m.personType === 'User');
                    if (!lastUserMsg) return null;
                    
                    // 그 이후의 매니저 응답 찾기
                    const managerResponses = messages.filter(m => 
                        m.personType === 'Manager' && 
                        m.createdAt > lastUserMsg.createdAt &&
                        m.personId !== chat.assigneeId // 담당자가 아닌 사람
                    );
                    
                    // 도움 활동 기록
                    managerResponses.forEach(response => {
                        activities.push({
                            counselor_id: response.personId,
                            counselor_name: response.personName || `상담사_${response.personId}`,
                            chat_id: chat.id,
                            customer_name: chat.user?.name || '고객',
                            message_preview: response.plainText?.substring(0, 100),
                            helped_at: new Date(response.createdAt).toISOString(),
                            created_at: new Date().toISOString()
                        });
                    });
                } catch (error) {
                    console.error(`Chat ${chat.id} 처리 실패:`, error);
                }
            });
            
            await Promise.all(batchPromises);
            
            console.log(`진행률: ${Math.min(i + batchSize, allChats.length)}/${allChats.length}`);
            
            // Rate limiting between batches
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log(`✅ ${activities.length}개 도움 활동 발견`);
        
        // 3. 결과 반환
        return new Response(JSON.stringify({
            success: true,
            processed: allChats.length,
            helpCount: activities.length,
            activities: activities,
            timestamp: new Date().toISOString()
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (error) {
        console.error('분석 실패:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
