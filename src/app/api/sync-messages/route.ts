// app/api/sync-messages/route.ts
import { NextResponse } from 'next/server'
import { fetchRecentMessages } from '@/lib/channeltalk'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET() {
  try {
    // 최근 10분간 메시지 조회
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000)
    const messages = await fetchRecentMessages(tenMinutesAgo)
    
    let newMessages = 0
    let helpMessages = 0
    
    for (const msg of messages) {
      // 이미 처리된 메시지인지 확인
      const { data: existing } = await supabase
        .from('message_tracking')
        .select('message_id')
        .eq('message_id', msg.id)
        .single()
      
      if (existing) continue // 이미 처리됨
      
      // 상담사 메시지만 처리
      if (msg.personType !== 'Manager') continue
      
      // 이전 메시지 타입 확인
      const previousType = await getPreviousMessageType(msg.chatId, msg.createdAt)
      const isHelp = previousType === 'User'
      
      // 누락된 메시지 저장
      await supabase.from('message_tracking').insert({
        message_id: msg.id,
        chat_id: msg.chatId,
        counselor_id: msg.personId,
        counselor_name: msg.personName,
        is_help_message: isHelp,
        previous_message_type: msg.personType,
        created_at: new Date(msg.createdAt).toISOString(),
        source: 'api' // API로 수집됨 표시
      })
      
      newMessages++
      if (isHelp) {
        helpMessages++
        await updateDailyStats(msg.personId, msg.personName)
      }
    }
    
    return NextResponse.json({
      success: true,
      processed: newMessages,
      helpMessages: helpMessages,
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('동기화 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

async function getPreviousMessageType(chatId: string, beforeTime: number) {
  const { data } = await supabase
    .from('message_tracking')
    .select('previous_message_type')
    .eq('chat_id', chatId)
    .lt('created_at', new Date(beforeTime).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  
  return data?.previous_message_type
}
