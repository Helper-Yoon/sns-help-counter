// api/webhook.js
// 실시간 데이터를 받기 위한 Webhook 핸들러

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
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

// Webhook 서명 검증
function verifyWebhookSignature(payload, signature, secret) {
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
    
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );
}

// 메시지 처리
async function processMessage(data) {
    const { 
        conversation_id,
        message,
        author,
        assignee_id,
        created_at 
    } = data;

    // 상담사인지 확인
    if (!counselorMap[author.id]) {
        console.log(`${author.id}는 상담사가 아님`);
        return null;
    }

    // 담당자가 아닌 경우만 처리
    if (author.id === assignee_id) {
        console.log(`${author.id}는 담당자임`);
        return null;
    }

    // 비담당 답변 데이터 생성
    const responseData = {
        counselor_id: author.id,
        counselor_name: counselorMap[author.id],
        ticket_id: conversation_id,
        assignee_id: assignee_id,
        response_content: message.content,
        char_count: message.content ? message.content.length : 0,
        is_helpful: checkIfHelpful(message),
        created_at: created_at || new Date().toISOString()
    };

    // Supabase에 저장
    const { data, error } = await supabase
        .from('non_assignee_responses')
        .insert(responseData)
        .select()
        .single();

    if (error) {
        console.error('데이터 저장 실패:', error);
        throw error;
    }

    return data;
}

// 도움 여부 체크
function checkIfHelpful(message) {
    const content = message.content || '';
    const helpfulPatterns = [
        /해결|방법|안내|도움|처리|확인/,
        /감사|고맙/,
        /알려드리|말씀드리/
    ];
    
    // 길이와 패턴 체크
    if (content.length < 50) return false;
    
    return helpfulPatterns.some(pattern => pattern.test(content));
}

// 메인 핸들러
export default async function handler(req, res) {
    // 로깅
    console.log('Webhook 수신:', {
        method: req.method,
        headers: req.headers,
        body: req.body
    });

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Signature');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // 서명 검증 (프로덕션에서 활성화)
        if (process.env.WEBHOOK_SECRET) {
            const signature = req.headers['x-webhook-signature'];
            const payload = JSON.stringify(req.body);
            
            if (!signature || !verifyWebhookSignature(payload, signature, process.env.WEBHOOK_SECRET)) {
                return res.status(401).json({ error: 'Invalid signature' });
            }
        }

        const { event, data } = req.body;

        // 이벤트 타입별 처리
        switch (event) {
            case 'message.created':
            case 'message.updated':
                const result = await processMessage(data);
                
                if (result) {
                    console.log('비담당 답변 처리 완료:', result.id);
                    return res.status(200).json({
                        success: true,
                        processed: true,
                        data: result
                    });
                } else {
                    return res.status(200).json({
                        success: true,
                        processed: false,
                        reason: 'Not a non-assignee response'
                    });
                }

            case 'conversation.updated':
                // 대화 업데이트 처리 (필요시)
                console.log('대화 업데이트:', data.id);
                return res.status(200).json({ success: true });

            default:
                console.log('알 수 없는 이벤트:', event);
                return res.status(200).json({ 
                    success: true,
                    message: 'Event ignored'
                });
        }

    } catch (error) {
        console.error('Webhook 처리 에러:', error);
        
        // 에러 로깅 (선택사항)
        await supabase
            .from('webhook_logs')
            .insert({
                event_type: req.body.event || 'unknown',
                payload: req.body,
                processed: false,
                error_message: error.message
            });

        return res.status(500).json({
            error: 'Webhook processing failed',
            message: error.message
        });
    }
}
