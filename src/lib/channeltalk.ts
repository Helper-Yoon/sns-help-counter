import axios from 'axios'

const API_BASE_URL = 'https://api.channel.io/open'

const channelApi = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'x-access-key': process.env.CHANNELTALK_ACCESS_KEY!,
    'x-access-secret': process.env.CHANNELTALK_SECRET!,
    'Content-Type': 'application/json'
  }
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

export async function fetchOpenChats(): Promise<UserChat[]> {
  try {
    const response = await channelApi.get('/v5/user-chats', {
      params: {
        state: 'opened',
        limit: 100
      }
    })
    return response.data.userChats || []
  } catch (error) {
    console.error('Error fetching open chats:', error)
    return []
  }
}

export async function fetchChatMessages(chatId: string, limit = 50): Promise<Message[]> {
  try {
    const response = await channelApi.get(`/v4/user-chats/${chatId}/messages`, {
      params: {
        limit,
        sortOrder: 'desc'
      }
    })
    return response.data.messages || []
  } catch (error) {
    console.error(`Error fetching messages for chat ${chatId}:`, error)
    return []
  }
}

export async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
