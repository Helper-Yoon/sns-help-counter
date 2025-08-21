export default function handler(req, res) {
    res.status(200).json({
        message: 'API가 정상 작동중입니다!',
        timestamp: new Date().toISOString(),
        environment: {
            hasSupabaseKey: !!process.env.SUPABASE_SERVICE_KEY,
            hasChannelKey: !!process.env.CHANNEL_ACCESS_KEY
        }
    });
}
