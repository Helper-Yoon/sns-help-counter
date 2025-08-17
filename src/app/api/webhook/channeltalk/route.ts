// app/api/webhook/channeltalk/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    
    // ChannelTalk Webhook 검증
    const signature = req.headers.get('x-signature')
    if (!verifySignature(body, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
    
    // 메시지 이벤트만 처리
    if (body.type !== 'message') {
      return NextResponse.json({ ok: true })
    }
    
    const { message, chat } = body.entity
    
    // 상담사 메시지만 처리
    if (message.personType !== 'Manager') {
      return NextResponse.json({ ok: true })
    }
    
    // 이전 메시지 확인 (고객 메시지 다음인지)
    const { data: previousMessages } = await supabase
      .from('message_tracking')
      .select('*')
      .eq('chat_id', chat.id)
      .order('created_at', { ascending: false })
      .limit(1)
    
    const isHelpMessage = previousMessages?.[0]?.previous_message_type === 'User'
    
    // 메시지 저장
    await supabase.from('message_tracking').upsert({
      message_id: message.id,
      chat_id: chat.id,
      counselor_id: message.personId,
      counselor_name: message.personName,
      is_help_message: isHelpMessage,
      previous_message_type: 'Manager',
      created_at: new Date(message.createdAt).toISOString(),
      source: 'webhook'
    })
    
    // 도움 메시지인 경우 통계 업데이트
    if (isHelpMessage) {
      await updateDailyStats(message.personId, message.personName)
    }
    
    return NextResponse.json({ success: true })
    
  } catch (error) {
    console.error('Webhook 처리 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

function verifySignature(body: any, signature: string | null): boolean {
  // ChannelTalk Webhook 서명 검증
  const crypto = require('crypto')
  const secret = process.env.CHANNELTALK_WEBHOOK_SECRET!
  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex')
  return hash === signature
}

async function updateDailyStats(counselorId: string, counselorName: string) {
  const today = new Date().toISOString().split('T')[0]
  
  await supabase.from('daily_stats').upsert({
    counselor_id: counselorId,
    counselor_name: counselorName,
    stat_date: today,
    help_count: supabase.sql`help_count + 1`
  }, {
    onConflict: 'counselor_id,stat_date'
  })
}
