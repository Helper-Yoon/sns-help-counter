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
  console.log('[SNS센터] 상담사 활동 트래킹 시작...')
  
  try {
    const openChats = await fetchOpenChats()
    console.log(`[SNS센터] ${openChats.length}개의 열린 상담 발견`)
    
    const activities: HelpActivity[] = []
    
    for (const chat of openChats) {
      await sleep(100)
      
      const followers = extractFollowers(chat)
      if (followers.length === 0) continue
      
      const messages = await fetchChatMessages(chat.id)
      const customerName = extractCustomerName(chat)
      
      const helpActivities = findHelpActivities(
        messages,
        chat.assigneeId,
        followers,
        chat.id,
        customerName
      )
      
      activities.push(...helpActivities)
    }
    
    if (activities.length > 0) {
      const { error } = await supabase
        .from('help_activities')
        .upsert(activities, {
          onConflict: 'counselor_id,chat_id,date(helped_at)',
          ignoreDuplicates: true
        })
      
      if (error) {
        console.error('[SNS센터] 저장 오류:', error)
      } else {
        console.log(`[SNS센터] ${activities.length}개 도움 활동 저장 완료`)
      }
    }
    
    return {
      success: true,
      activitiesCount: activities.length,
      timestamp: new Date().toISOString()
    }
    
  } catch (error) {
    console.error('[SNS센터] 트래킹 오류:', error)
    return {
      success: false,
      error: error,
      timestamp: new Date().toISOString()
    }
  }
}

function extractCustomerName(chat: UserChat): string {
  return chat.user?.name || chat.user?.profile?.name || '고객'
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
  
  for (const message of messages) {
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
