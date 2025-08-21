// api/sync-non-assignee.js
// Vercel API Route for syncing non-assignee responses

import { createClient } from '@supabase/supabase-js';

// Supabase 클라이언트 초기화
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY // 서비스 키 사용 (서버 사이드)
);

// 상담사 매핑
const counselorMap = {
    '520798': '채주은', '520799': '윤도우리', '521212': '손진우',
    '521213': '차정환', '521214': '서민국', '521215': '구본영',
    '521217': '권재현', '521218': '조시현', '521220': '김상아',
    '521221': '김지원', '521222': '정다혜', '521223': '김시진',
    '521224': '신혜서', '521226': '이민주', '521227': '정주연',
    '521230': '김진후', '521231': '이혜영', '521232': '김영진',
    '521233': '최호익', '521234': '서정국', '521236': '박해영',
    '521239': '이종민', '521243': '강형욱', '521378': '오민경',
    '521379': '최수능', '521381': '김채영', '521382': '전지윤',
    '521383': '이유주', '521384': '김범주', '521385': '김예진',
    '521386': '차승현', '521392': '이성철', '521393': '박은진',
    '521410': '오민환', '521416': '전미란', '521564': '김국현',
    '521567': '김성현', '521902': '김시윤', '521937': '김종현',
    '521942': '주은지', '521965': '강헌준', '522038': '문홍주',
    '523260': '주수현', '523268': '오현수', '527833': '유종현',
    '527836': '김진협', '527910': '옥서아', '528425': '정용욱',
    '528628': '김소영', '529149': '동수진', '529561': '한승윤',
    '544751': '성일훈', '555633': '아정당', '555865': '공현준'
};

// SNS API에서 데이터 가져오기
async function fetchSNSData(date) {
    try {
        // 실제 SNS API 엔드포인트와 인증 정보를 사용하세요
        const response = await fetch(`${process.env.SNS_API_URL}/conversations`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${process.env.SNS_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            params: {
                date: date,
                include_messages: true
            }
        });

        if (!response.ok) {
            throw new Error('SNS API 호출 실패');
        }

        return await response.json();
    } catch (error) {
        console.error('SNS API 에러:', error);
        throw error;
    }
}

// 비담당 답변 필터링 및 처리
function processNonAssigneeResponses(conversations) {
    const nonAssigneeResponses = [];

    conversations.forEach(conversation => {
        const assigneeId = conversation.assignee_id;
        const messages = conversation.messages || [];

        messages.forEach(message => {
            // 상담사의 답변이고, 담당자가 아닌 경우
            if (message.author_id && 
                counselorMap[message.author_id] && 
                message.author_id !== assigneeId) {
                
                nonAssigneeResponses.push({
                    counselor_id: message.author_id,
                    counselor_name: counselorMap[message.author_id],
                    ticket_id: conversation.id,
                    assignee_id: assigneeId,
                    response_content: message.content,
                    char_count: message.content ? message.content.length : 0,
                    response_time: calculateResponseTime(message, conversation),
                    is_helpful: checkIfHelpful(message),
                    created_at: message.created_at
                });
            }
        });
    });

    return nonAssigneeResponses;
}

// 응답 시간 계산 (분 단위)
function calculateResponseTime(message, conversation) {
    // 이전 메시지와의 시간 차이 계산
    const messageIndex = conversation.messages.findIndex(m => m.id === message.id);
    if (messageIndex > 0) {
        const prevMessage = conversation.messages[messageIndex - 1];
        const timeDiff = new Date(message.created_at) - new Date(prevMessage.created_at);
        return Math.round(timeDiff / 60000); // 밀리초를 분으로 변환
    }
    return null;
}

// 도움이 되는 답변인지 체크
function checkIfHelpful(message) {
    // 간단한 휴리스틱: 100자 이상이고 특정 키워드 포함
    const helpfulKeywords = ['도움', '해결', '방법', '안내', '확인', '처리'];
    const content = message.content || '';
    
    if (content.length < 100) return false;
    
    return helpfulKeywords.some(keyword => content.includes(keyword));
}

// 메인 핸들러
export default async function handler(req, res) {
    // CORS 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { date } = req.body;
        const targetDate = date || new Date().toISOString().split('T')[0];

        console.log(`동기화 시작: ${targetDate}`);

        // 1. SNS API에서 데이터 가져오기
        const conversations = await fetchSNSData(targetDate);
        console.log(`${conversations.length}개 대화 조회됨`);

        // 2. 비담당 답변 필터링
        const nonAssigneeResponses = processNonAssigneeResponses(conversations);
        console.log(`${nonAssigneeResponses.length}개 비담당 답변 발견`);

        // 3. Supabase에 저장 (중복 제거)
        const insertPromises = nonAssigneeResponses.map(async (response) => {
            // 중복 체크
            const { data: existing } = await supabase
                .from('non_assignee_responses')
                .select('id')
                .eq('ticket_id', response.ticket_id)
                .eq('counselor_id', response.counselor_id)
                .eq('created_at', response.created_at)
                .single();

            if (!existing) {
                return supabase
                    .from('non_assignee_responses')
                    .insert(response);
            }
            return null;
        });

        const results = await Promise.all(insertPromises);
        const inserted = results.filter(r => r !== null).length;

        // 4. 결과 반환
        return res.status(200).json({
            success: true,
            processed: nonAssigneeResponses.length,
            inserted: inserted,
            date: targetDate,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('동기화 에러:', error);
        return res.status(500).json({
            error: '동기화 실패',
            message: error.message
        });
    }
}
