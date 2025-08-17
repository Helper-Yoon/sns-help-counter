'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, ResponsiveContainer, Cell
} from 'recharts'
import { RefreshCw, Users, Activity, Clock, TrendingUp, Award } from 'lucide-react'

interface DashboardData {
  counselor_id: string
  counselor_name: string
  total_helps_today: number
  last_activity: string
}

interface HourlyData {
  hour: string
  count: number
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

export default function Dashboard() {
  const [realtimeData, setRealtimeData] = useState<DashboardData[]>([])
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([])
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    
    try {
      // 실시간 대시보드 데이터
      const { data: dashboard, error: dashboardError } = await supabase
        .from('realtime_dashboard')
        .select('*')
        .order('total_helps_today', { ascending: false })
      
      if (dashboardError) {
        console.error('대시보드 오류:', dashboardError)
        setError('데이터를 불러올 수 없습니다.')
      } else {
        setRealtimeData(dashboard || [])
      }
      
      // 시간별 통계
      const { data: hourly, error: hourlyError } = await supabase
        .from('hourly_stats')
        .select('*')
      
      if (!hourlyError && hourly) {
        const hourlyMap = new Map()
        hourly.forEach((item: any) => {
          const hour = new Date(item.hour).getHours()
          hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + item.help_count)
        })
        
        const formattedHourly = Array.from({ length: 24 }, (_, i) => ({
          hour: `${i}시`,
          count: hourlyMap.get(i) || 0
        }))
        
        setHourlyData(formattedHourly)
      }
    } catch (error: any) {
      console.error('데이터 로드 오류:', error)
      setError('네트워크 오류가 발생했습니다.')
    } finally {
      setLastUpdate(new Date())
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    
    // 실시간 업데이트
    const subscription = supabase
      .channel('realtime-dashboard')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'help_activities' },
        () => {
          console.log('실시간 업데이트 감지')
          loadData()
        }
      )
      .subscribe()
    
    // 30초마다 자동 새로고침
    const interval = setInterval(() => {
      console.log('자동 새로고침')
      loadData()
    }, 30000)
    
    return () => {
      subscription.unsubscribe()
      clearInterval(interval)
    }
  }, [])

  const totalHelpsToday = realtimeData.reduce((sum, item) => sum + item.total_helps_today, 0)
  const activeCounselors = realtimeData.length
  const topHelper = realtimeData[0]

  // 초기 로딩 화면
  if (loading && realtimeData.length === 0) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-400">데이터를 불러오는 중...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            🔵 SNS센터 도움 카운팅 프로그램
          </h1>
          <div className="flex items-center gap-4 text-gray-400">
            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {format(lastUpdate, 'yyyy-MM-dd HH:mm:ss', { locale: ko })}
            </span>
            <button
              onClick={loadData}
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all hover:scale-105"
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
            {error && (
              <span className="text-red-400 text-sm">{error}</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="card p-6 card-hover bg-gradient-to-br from-gray-900 to-gray-950">
            <div className="flex items-center justify-between mb-2">
              <Activity className="w-8 h-8 text-blue-400" />
              <span className="text-3xl font-bold text-gradient">{totalHelpsToday}</span>
            </div>
            <p className="text-gray-500 text-sm">오늘 총 도움 횟수</p>
          </div>
          
          <div className="card p-6 card-hover bg-gradient-to-br from-gray-900 to-gray-950">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-8 h-8 text-green-400" />
              <span className="text-3xl font-bold text-green-400">{activeCounselors}</span>
            </div>
            <p className="text-gray-500 text-sm">활동 중인 상담사</p>
          </div>
          
          <div className="card p-6 card-hover bg-gradient-to-br from-gray-900 to-gray-950">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-8 h-8 text-purple-400" />
              <span className="text-3xl font-bold text-purple-400">
                {activeCounselors > 0 ? (totalHelpsToday / activeCounselors).toFixed(1) : 0}
              </span>
            </div>
            <p className="text-gray-500 text-sm">평균 도움 횟수</p>
          </div>
          
          <div className="card p-6 card-hover bg-gradient-to-br from-gray-900 to-gray-950">
            <div className="flex items-center justify-between mb-2">
              <Award className="w-8 h-8 text-yellow-400" />
              <span className="text-lg font-bold text-yellow-400">
                {topHelper?.counselor_name || '-'}
              </span>
            </div>
            <p className="text-gray-500 text-sm">오늘의 최고 도우미</p>
          </div>
        </div>

        {/* 차트 영역 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="card p-6 bg-gradient-to-br from-gray-950 to-black">
            <h2 className="text-xl font-bold text-white mb-4">
              상담사별 도움 현황
            </h2>
            {realtimeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={realtimeData.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis 
                    dataKey="counselor_name" 
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                  />
                  <YAxis tick={{ fill: '#6b7280' }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#030712', 
                      border: '1px solid #1f2937',
                      borderRadius: '8px'
                    }}
                    labelStyle={{ color: '#e5e7eb' }}
                  />
                  <Bar dataKey="total_helps_today" name="도움 횟수">
                    {realtimeData.slice(0, 10).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-64 text-gray-600">
                {loading ? '로딩 중...' : '데이터가 없습니다'}
              </div>
            )}
          </div>

          <div className="card p-6 bg-gradient-to-br from-gray-950 to-black">
            <h2 className="text-xl font-bold text-white mb-4">
              시간별 활동 추이
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis 
                  dataKey="hour" 
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                />
                <YAxis tick={{ fill: '#6b7280' }} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#030712', 
                    border: '1px solid #1f2937',
                    borderRadius: '8px'
                  }}
                  labelStyle={{ color: '#e5e7eb' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="count" 
                  stroke="#3b82f6" 
                  strokeWidth={3}
                  name="도움 횟수"
                  dot={{ fill: '#3b82f6', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 테이블 */}
        <div className="card overflow-hidden bg-gradient-to-br from-gray-950 to-black">
          <div className="p-6 border-b border-gray-800">
            <h2 className="text-xl font-bold text-white">
              실시간 상담사 랭킹
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-black">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    순위
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    상담사
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    도움 횟수
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    마지막 활동
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-900">
                {realtimeData.length > 0 ? (
                  realtimeData.map((item, index) => (
                    <tr key={item.counselor_id} className="hover:bg-gray-950 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`text-lg font-bold ${index < 3 ? 'text-yellow-400' : 'text-gray-600'}`}>
                          {index === 0 && '🥇'}
                          {index === 1 && '🥈'}
                          {index === 2 && '🥉'}
                          {index > 2 && `${index + 1}`}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-100">
                          {item.counselor_name}
                        </div>
                        <div className="text-xs text-gray-600">
                          ID: {item.counselor_id}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-3 py-1 inline-flex text-sm font-semibold rounded-full bg-blue-950 text-blue-300">
                          {item.total_helps_today}회
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {item.last_activity 
                          ? format(new Date(item.last_activity), 'HH:mm:ss', { locale: ko })
                          : '-'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="text-center py-12 text-gray-600">
                      {loading ? '데이터를 불러오는 중...' : '아직 데이터가 없습니다. 잠시 후 다시 확인해주세요.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
