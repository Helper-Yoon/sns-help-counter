import { supabase } from './supabase'
import { fetchOpenChats, fetchChatMessages, sleep, UserChat } from './channeltalk'

interface HelpActivity {
  counselor_id: string
  counselor_name: string
  chat_id: string
  customer_name?: string
  message_preview?: string
  helped_at: string
}

export async function trackCounselorActivities() {
  const startTime = Date.now()
  console.log('[SNS센터] ========== 트래킹 시작 ==========')
  console.log('[SNS센터] 시작 시간:', new Date().toLocaleString('ko-KR'))
  
  try {
    // 최대 10페이지 (1000개) 가져오기
    const openChats = await fetchOpenChats(10)
    
    if (openChats.length === 0) {
      console.log('[SNS센터] ⚠️ 열린 채팅이 없습니다.')
      return {
        success: true,
        stats: {
          totalChats: 0,
          processedChats: 0,
          activitiesFound: 0,
          duration: '0s'
        },
        timestamp: new Date().toISOString()
      }
    }
    
    console.log(`[SNS센터] 📊 ${openChats.length}개 채팅 처리 시작`)
    
    const activities: HelpActivity[] = []
    let processedCount = 0
    let skipCount = 0
    
    // 시간 제한이 있으므로 최근 채팅 우선 처리
    const recentChats = openChats
      .sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt))
      .slice(0, 300) // 최대 300개만 처리
    
    for (const chat of recentChats) {
      // 시간 체크 (25초 제한)
      if (Date.now() - startTime > 25000) {
        console.log('[SNS센터] ⏱️ 시간 제한 도달')
        break
      }
      
      // follower가 있는 채팅만 처리
      const followers = extractFollowers(chat)
      if (followers.length === 0) {
        skipCount++
        continue
      }
      
      // Rate limiting
      if (processedCount > 0 && processedCount % 10 === 0) {
        await sleep(200)
      }
      
      try {
        const messages = await fetchChatMessages(chat.id, 15)
        
        if (messages.length > 0) {
          const customerName = extractCustomerName(chat)
          const helpActivities = findHelpActivities(
            messages,
            chat.assigneeId,
            followers,
            chat.id,
            customerName
          )
          
          if (helpActivities.length > 0) {
            activities.push(...helpActivities)
          }
        }
        
        processedCount++
        
        if (processedCount % 20 === 0) {
          console.log(`[SNS센터] 진행: ${processedCount}/${recentChats.length} 처리`)
        }
        
      } catch (error) {
        console.log(`[SNS센터] 채팅 ${chat.id} 처리 실패`)
      }
    }
    
    // 데이터 저장
    if (activities.length > 0) {
      console.log(`[SNS센터] 💾 ${activities.length}개 활동 저장 중...`)
      
      const { error } = await supabase
        .from('help_activities')
        .upsert(activities, {
          onConflict: 'counselor_id,chat_id,date(helped_at)',
          ignoreDuplicates: true
        })
      
      if (error) {
        console.error('[SNS센터] ❌ 저장 오류:', error)
      } else {
        console.log('[SNS센터] ✅ 저장 완료')
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    
    console.log('[SNS센터] ========== 트래킹 완료 ==========')
    console.log(`[SNS센터] 📊 최종 결과:`)
    console.log(`  - 전체 채팅: ${openChats.length}개`)
    console.log(`  - 처리된 채팅: ${processedCount}개`)
    console.log(`  - 건너뛴 채팅: ${skipCount}개`)
    console.log(`  - 저장된 활동: ${activities.length}개`)
    console.log(`  - 소요 시간: ${duration}초`)
    
    return {
      success: true,
      stats: {
        totalChats: openChats.length,
        processedChats: processedCount,
        skippedChats: skipCount,
        activitiesFound: activities.length,
        duration: `${duration}s`
      },
      timestamp: new Date().toISOString()
    }
    
  } catch (error: any) {
    console.error('[SNS센터] ❌ 치명적 오류:', error)
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }
  }
}

function extractCustomerName(chat: UserChat): string {
  return chat.user?.name || 
         chat.user?.profile?.name || 
         `고객_${chat.userId?.substring(0, 8) || 'unknown'}`
}

function extractFollowers(chat: UserChat): string[] {
  const followers = new Set<string>()
  
  if (chat.followerIds && Array.isArray(chat.followerIds)) {
    chat.followerIds.forEach(id => {
      if (id) followers.add(id)
    })
  }
  
  if (chat.chatTags && Array.isArray(chat.chatTags)) {
    chat.chatTags.forEach(tag => {
      if (tag?.followerIds && Array.isArray(tag.followerIds)) {
        tag.followerIds.forEach(id => {
          if (id) followers.add(id)
        })
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
  
  // 오늘 날짜만 처리
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayTime = today.getTime()
  
  for (const message of messages) {
    // 오늘 이전 메시지는 무시
    if (message.createdAt < todayTime) continue
    
    if (message.personType !== 'Manager') continue
    
    const managerId = message.personId
    
    // 담당자가 아니고, follower이며, 아직 기록 안된 상담사
    if (managerId && 
        managerId !== assigneeId && 
        followers.includes(managerId) && 
        !helpersFound.has(managerId)) {
      
      activities.push({
        counselor_id: managerId,
        counselor_name: message.personName || `상담사_${managerId.substring(0, 8)}`,
        chat_id: chatId,
        customer_name: customerName,
        message_preview: message.plainText?.substring(0, 100) || '메시지 내용 없음',
        helped_at: new Date(message.createdAt).toISOString()
      })
      
      helpersFound.add(managerId)
    }
  }
  
  return activities
}
