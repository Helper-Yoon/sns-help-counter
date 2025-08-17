import axios from 'axios'

const API_BASE_URL = 'https://api.channel.io/open'

const channelApi = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'x-access-key': process.env.CHANNELTALK_ACCESS_KEY!,
    'x-access-secret': process.env.CHANNELTALK_SECRET!,
    'Content-Type': 'application/json'
  },
  timeout: 25000 // 25초 타임아웃
})

export interface UserChat {
  id: string
  userId: string
  assigneeId?: string
  state: string
  createdAt: number
  lastMessageAt: number
  followerIds?: string[]
  chatTags?: Array<{
    followerIds?: string[]
  }>
  user?: {
    name?: string
    profile?: {
      name?: string
    }
  }
}

export interface Message {
  id: string
  chatId: string
  personId: string
  personType: 'User' | 'Manager' | 'Bot'
  personName?: string
  plainText?: string
  createdAt: number
}

// 페이지네이션으로 모든 채팅 가져오기
export async function fetchAllOpenChats(): Promise<UserChat[]> {
  const allChats: UserChat[] = []
  let next: string | null = null
  let page = 0
  const maxPages = 10 // 최대 1000개 (100 * 10)
  
  console.log('[ChannelTalk] 열린 채팅 가져오기 시작...')
  
  try {
    do {
      const params: any = {
        state: 'opened',
        limit: 100
      }
      
      if (next) {
        params.next = next
      }
      
      const response = await channelApi.get('/v5/user-chats', { params })
      const chats = response.data.userChats || []
      
      allChats.push(...chats)
      next = response.data.next || null
      page++
      
      console.log(`[ChannelTalk] 페이지 ${page}: ${chats.length}개 채팅 수집 (총 ${allChats.length}개)`)
      
      // Rate limiting 방지
      if (next && page < maxPages) {
        await sleep(50) // 50ms 대기
      }
      
    } while (next && page < maxPages)
    
    console.log(`[ChannelTalk] 총 ${allChats.length}개 채팅 수집 완료`)
    return allChats
    
  } catch (error: any) {
    console.error('[ChannelTalk] 채팅 가져오기 오류:', error.message)
    console.error('[ChannelTalk] 현재까지 수집된 채팅:', allChats.length)
    return allChats // 에러 발생해도 지금까지 수집한 것 반환
  }
}

// 최근 활동이 있는 채팅만 가져오기 (최적화)
export async function fetchRecentOpenChats(minutesAgo: number = 60): Promise<UserChat[]> {
  try {
    const since = Date.now() - (minutesAgo * 60 * 1000)
    
    const response = await channelApi.get('/v5/user-chats', {
      params: {
        state: 'opened',
        limit: 100,
        since: since
      }
    })
    
    const chats = response.data.userChats || []
    console.log(`[ChannelTalk] 최근 ${minutesAgo}분 내 활동: ${chats.length}개 채팅`)
    
    return chats
  } catch (error) {
    console.error('[ChannelTalk] 최근 채팅 가져오기 오류:', error)
    return []
  }
}

export async function fetchChatMessages(chatId: string, limit = 30): Promise<Message[]> {
  try {
    const response = await channelApi.get(`/v4/user-chats/${chatId}/messages`, {
      params: {
        limit,
        sortOrder: 'desc'
      }
    })
    return response.data.messages || []
  } catch (error: any) {
    if (error.response?.status === 429) {
      console.log(`[ChannelTalk] Rate limit for chat ${chatId}, waiting...`)
      await sleep(1000)
      return []
    }
    console.error(`[ChannelTalk] 메시지 가져오기 오류 ${chatId}:`, error.message)
    return []
  }
}

export async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
