// api/channel-sync.js
export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }
    
    const { accessKey, secretKey } = await req.json();
    
    const headers = {
        'x-access-key': accessKey || '688a26176fcb19aebf8b',
        'x-access-secret': secretKey || 'a0db6c38b95c8ec4d9bb46e7c653b3e2',
        'Content-Type': 'application/json'
    };
    
    try {
        console.log('🔍 채널톡 대화 분석 시작...');
        
        // 1. 모든 열린 대화 가져오기 (페이지네이션)
        let allChats = [];
        let hasNext = true;
        let next = null;
        
        while (hasNext) {
            const url = new URL('https://api.channel.io/open/v5/user-chats');
            url.searchParams.append('state', 'opened');
            url.searchParams.append('limit', '500');
            if (next) url.searchParams.append('next', next);
            
            const response = await fetch(url, { headers });
            
            if (!response.ok) {
                throw new Error(`ChannelTalk API error: ${response.status}`);
            }
            
            const data = await response.json();
            allChats = allChats.concat(data.userChats || []);
            hasNext = data.hasNext;
            next = data.next;
            
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log(`📊 총 ${allChats.length}개 대화 발견`);
        
        // 2. 상담사별 답장 카운팅
        const counselorStats = {};
        const activities = [];
        let totalReplies = 0;
        
        // 배치 처리 (50개씩)
        for (let i = 0; i < allChats.length; i += 50) {
            const batch = allChats.slice(i, Math.min(i + 50, allChats.length));
            
            await Promise.all(batch.map(async (chat) => {
                try {
                    // 메시지 가져오기
                    const msgUrl = `https://api.channel.io/open/v5/user-chats/${chat.id}/messages`;
                    const msgResponse = await fetch(msgUrl + '?limit=100&sortOrder=desc', { headers });
                    
                    if (!msgResponse.ok) return;
                    
                    const msgData = await msgResponse.json();
                    const messages = msgData.messages || [];
                    
                    // 매니저 응답 카운팅 (담당자 제외)
                    messages.forEach(msg => {
                        if (msg.personType === 'Manager' && msg.personId !== chat.assigneeId) {
                            // 통계 업데이트
                            if (!counselorStats[msg.personId]) {
                                counselorStats[msg.personId] = {
                                    id: msg.personId,
                                    name: msg.personName || `상담사_${msg.personId}`,
                                    count: 0
                                };
                            }
                            counselorStats[msg.personId].count++;
                            totalReplies++;
                            
                            // 활동 기록 (Supabase 저장용)
                            activities.push({
                                counselor_id: msg.personId,
                                counselor_name: msg.personName || `상담사_${msg.personId}`,
                                chat_id: chat.id,
                                customer_name: chat.user?.name || '고객',
                                message_preview: msg.plainText?.substring(0, 100),
                                helped_at: new Date(msg.createdAt).toISOString(),
                                created_at: new Date().toISOString()
                            });
                        }
                    });
                } catch (error) {
                    console.error(`Chat ${chat.id} 처리 실패:`, error);
                }
            }));
            
            console.log(`진행률: ${Math.min(i + 50, allChats.length)}/${allChats.length}`);
            
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        console.log(`✅ 분석 완료: ${totalReplies}개 답장`);
        
        return new Response(JSON.stringify({
            success: true,
            totalChats: allChats.length,
            totalReplies: totalReplies,
            counselorStats: counselorStats,
            activities: activities.slice(0, 1000), // 최대 1000개만 저장
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
