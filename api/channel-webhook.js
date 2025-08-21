export default async function handler(req, res) {
    // CORS 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Signature');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { event, entity } = req.body;

        console.log('Webhook 수신:', event);

        // 이벤트 타입별 처리
        switch (event) {
            case 'message:create':
            case 'message.created':
                // 메시지 생성 처리
                console.log('새 메시지:', entity);
                break;
                
            case 'userChat:assignee:changed':
            case 'chat.assignee.changed':
                // 담당자 변경 처리
                console.log('담당자 변경:', entity);
                break;
                
            case 'push':
                // 연결 테스트
                return res.status(200).json({ 
                    success: true,
                    message: 'Webhook connected'
                });
                
            default:
                console.log('미처리 이벤트:', event);
        }

        return res.status(200).json({
            success: true,
            processed: true
        });

    } catch (error) {
        console.error('Webhook 처리 에러:', error);
        return res.status(200).json({
            success: false,
            error: error.message
        });
    }
}
