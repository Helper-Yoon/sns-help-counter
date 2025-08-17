import { supabase } from './supabase'
import { fetchRecentOpenChats, fetchAllOpenChats, fetchChatMessages, sleep, UserChat } from './channeltalk'

interface HelpActivity {
  counselor_id: string
  counselor_name: string
  chat_id: string
  customer_name?: string
  message_preview?: string
  helped_at: string
}

// 메인 트래킹 함수 - 최근 1시간 활동만 체크
export async function trackCounselorActivities() {
  const startTime = Date.now()
  console.log('[SNS센터] ========== 트래킹 시작 ==========')
  console.log('[SNS센터] 시작 시간:', new Date().toLocaleString('ko-KR'))
  
  try {
    // 최근 1시간 내 활동이 있는 채팅만 가져오기
    const openChats = await fetchRecentOpenChats(60)
    console.log(`[SNS센터] 최근 1시간 활동 채팅: ${openChats.length}개`)
    
    if (openChats.length === 0) {
      console.log('[SNS센터] 최근 활동 채팅 없음, 전체 스캔 시작...')
      const allChats = await fetchAllOpenChats()
      openChats.push(...allChats.slice(0, 200)) // 최대 200개만 처리
    }
    
    const activities: HelpActivity[] = []
    const processedChats: string[] = []
    const errors: string[] = []
    
    // 배치 처리 (10개씩)
    const batchSize = 10
    for (let i = 0; i < openChats.length; i += batchSize) {
      const batch = openChats.slice(i, i + batchSize)
      
      const batchPromises = batch.map(async (chat) => {
        try {
          const followers = extractFollowers(chat)
          if (followers.length === 0) return null
          
          await sleep(20) // Rate limiting
          const messages = await fetchChatMessages(chat.id, 20) // 메시지 수 줄임
          
          if (messages.length === 0) return null
          
          const customerName = extractCustomerName(chat)
          const helpActivities = findHelpActivities(
            messages,
            chat.assigneeId,
            followers,
            chat.id,
            customerName
          )
          
          processedChats.push(chat.id)
          return helpActivities
        } catch (error: any) {
          errors.push(`Chat ${chat.id}: ${error.message}`)
          return null
        }
      })
      
      const batchResults = await Promise.all(batchPromises)
      batchResults.forEach(result => {
        if (result) activities.push(...result)
      })
      
      // 25초 넘으면 중단 (Vercel 30초 제한)
      if (Date.now() - startTime > 25000) {
        console.log('[SNS센터] ⚠️ 시간 제한 접근, 처리 중단')
        break
      }
      
      console.log(`[SNS센터] 진행: ${Math.min((i + batchSize), openChats.length)}/${openChats.length} 채팅 처리`)
    }
    
    // 데이터 저장
    if (activities.length > 0) {
      console.log(`[SNS센터] 💾 ${activities.length}개 활동 저장 시작...`)
      
      // 배치로 저장 (50개씩)
      for (let i = 0; i < activities.length; i += 50) {
        const batch = activities.slice(i, i + 50)
        const { error } = await supabase
          .from('help_activities')
          .upsert(batch, {
            onConflict: 'counselor_id,chat_id,date(helped_at)',
            ignoreDuplicates: true
          })
        
        if (error) {
          console.error(`[SNS센터] 저장 오류 (배치 ${i/50 + 1}):`, error.message)
        } else {
          console.log(`[SNS센터] ✅ 배치 ${i/50 + 1} 저장 완료`)
        }
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    
    console.log('[SNS센터] ========== 트래킹 완료 ==========')
    console.log(`[SNS센터] 📊 결과:`)
    console.log(`  - 처리된 채팅: ${processedChats.length}개`)
    console.log(`  - 발견된 활동: ${activities.length}개`)
    console.log(`  - 소요 시간: ${duration}초`)
    console.log(`  - 에러 수: ${errors.length}개`)
    
    return {
      success: true,
      stats: {
        totalChats: openChats.length,
        processedChats: processedChats.length,
        activitiesFound: activities.length,
        errors: errors.length,
        duration: `${duration}s`
      },
      timestamp: new Date().toISOString()
    }
    
  } catch (error: any) {
    console.error('[SNS센터] ❌ 치명적 오류:', error.message)
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }
  }
}

// 전체 스캔 (수동 실행용)
export async function fullScanActivities() {
  console.log('[SNS센터] 전체 스캔 시작...')
  const allChats = await fetchAllOpenChats()
  console.log(`[SNS센터] 총 ${allChats.length}개 채팅 발견`)
  
  // 여기서는 최대 500개만 처리
  const chatsToProcess = allChats.slice(0, 500)
  
  // 임시로 채팅 목록 저장하고 트래킹 실행
  const originalFetch = fetchRecentOpenChats
  ;(global as any).fetchRecentOpenChats = async () => chatsToProcess
  
  const result = await trackCounselorActivities()
  
  ;(global as any).fetchRecentOpenChats = originalFetch
  
  return result
}

function extractCustomerName(chat: UserChat): string {
  return chat.user?.name || 
         chat.user?.profile?.name || 
         '고객'
}

function extractFollowers(chat: UserChat): string[] {
  const followers = new Set<string>()
  
  if (chat.followerIds && Array.isArray(chat.followerIds)) {
    chat.followerIds.forEach(id => followers.add(id))
  }
  
  if (chat.chatTags && Array.isArray(chat.chatTags)) {
    chat.chatTags.forEach(tag => {
      if (tag.followerIds && Array.isArray(tag.followerIds)) {
        tag.followerIds.forEach(id => followers.add(id))
      }
    })
  }
  
  return Array.from(followers)
}

function findHelpActivities(
  messages: any[],
  assigneeId: string | undefined,
  followers: string[],
  chatId: string,
  customerName: string
): HelpActivity[] {
  const activities: HelpActivity[] = []
  const helpersFound = new Set<string>()
  
  // 최근 24시간 내 메시지만 처리
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000)
  
  for (const message of messages) {
    if (message.createdAt < oneDayAgo) continue
    if (message.personType !== 'Manager') continue
    
    const managerId = message.personId
    
    if (managerId !== assigneeId && 
        followers.includes(managerId) && 
        !helpersFound.has(managerId)) {
      
      activities.push({
        counselor_id: managerId,
        counselor_name: message.personName || managerId,
        chat_id: chatId,
        customer_name: customerName,
        message_preview: message.plainText?.substring(0, 100),
        helped_at: new Date(message.createdAt).toISOString()
      })
      
      helpersFound.add(managerId)
    }
  }
  
  return activities
}
