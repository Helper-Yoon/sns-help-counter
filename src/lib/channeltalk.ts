import axios from 'axios'

const API_BASE_URL = 'https://api.channel.io/open'

const channelApi = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'x-access-key': process.env.CHANNELTALK_ACCESS_KEY!,
    'x-access-secret': process.env.CHANNELTALK_SECRET!,
    'Content-Type': 'application/json'
  },
  timeout: 20000
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

// 모든 열린 채팅 가져오기 (페이지네이션)
export async function fetchOpenChats(maxPages: number = 5): Promise<UserChat[]> {
  const allChats: UserChat[] = []
  let next: string | null = null
  let page = 0
  
  console.log('[ChannelTalk] 열린 채팅 수집 시작...')
  
  try {
    do {
      const params: any = {
        state: 'opened',
        limit: 100,
        sortOrder: 'desc'
      }
      
      // next 파라미터가 있으면 추가
      if (next) {
        params.next = next
      }
      
      console.log(`[ChannelTalk] 페이지 ${page + 1} 요청 중...`)
      
      const response = await channelApi.get('/v5/user-chats', { params })
      const chats = response.data.userChats || []
      
      if (chats.length === 0) {
        console.log('[ChannelTalk] 더 이상 채팅이 없습니다.')
        break
      }
      
      allChats.push(...chats)
      next = response.data.next || null
      page++
      
      console.log(`[ChannelTalk] 페이지 ${page}: ${chats.length}개 수집 (총 ${allChats.length}개)`)
      
      // Rate limiting 방지
      if (next && page < maxPages) {
        await sleep(100)
      }
      
    } while (next && page < maxPages)
    
    console.log(`[ChannelTalk] ✅ 총 ${allChats.length}개 채팅 수집 완료`)
    return allChats
    
  } catch (error: any) {
    console.error('[ChannelTalk] ❌ 채팅 가져오기 오류:', error.message)
    if (error.response) {
      console.error('[ChannelTalk] 응답 데이터:', error.response.data)
    }
    return allChats
  }
}

export async function fetchChatMessages(chatId: string, limit = 20): Promise<Message[]> {
  try {
    const response = await channelApi.get(`/v4/user-chats/${chatId}/messages`, {
      params: {
        limit,
        sortOrder: 'desc'
      },
      timeout: 5000
    })
    return response.data.messages || []
  } catch (error: any) {
    if (error.code === 'ECONNABORTED') {
      console.log(`[ChannelTalk] 타임아웃: ${chatId}`)
      return []
    }
    if (error.response?.status === 429) {
      console.log(`[ChannelTalk] Rate limit: ${chatId}`)
      await sleep(2000)
      return []
    }
    return []
  }
}

export async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
