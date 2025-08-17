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

  const loadData = async () => {
    setLoading(true)
    
    try {
      const { data: dashboard } = await supabase
        .from('realtime_dashboard')
        .select('*')
        .order('total_helps_today', { ascending: false })
      
      if (dashboard) {
        setRealtimeData(dashboard)
      }
      
      const { data: hourly } = await supabase
        .from('hourly_stats')
        .select('*')
      
      if (hourly) {
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
    } catch (error) {
      console.error('데이터 로드 오류:', error)
    } finally {
      setLastUpdate(new Date())
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    
    const subscription = supabase
      .channel('realtime-dashboard')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'help_activities' },
        () => loadData()
      )
      .subscribe()
    
    const interval = setInterval(loadData, 30000)
    
    return () => {
      subscription.unsubscribe()
      clearInterval(interval)
    }
  }, [])

  const totalHelpsToday = realtimeData.reduce((sum, item) => sum + item.total_helps_today, 0)
  const activeCounselors = realtimeData.length
  const topHelper = realtimeData[0]

  return (
    <div className="min-h-screen bg-gray-900 p-4 md:p-8">
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
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-2">
              <Activity className="w-8 h-8 text-blue-500" />
              <span className="text-2xl font-bold text-blue-500">{totalHelpsToday}</span>
            </div>
            <p className="text-gray-400 text-sm">오늘 총 도움 횟수</p>
          </div>
          
          <div className="card p-6">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-8 h-8 text-green-500" />
              <span className="text-2xl font-bold text-green-500">{activeCounselors}</span>
            </div>
            <p className="text-gray-400 text-sm">활동 중인 상담사</p>
          </div>
          
          <div className="card p-6">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-8 h-8 text-purple-500" />
              <span className="text-2xl font-bold text-purple-500">
                {activeCounselors > 0 ? (totalHelpsToday / activeCounselors).toFixed(1) : 0}
              </span>
            </div>
            <p className="text-gray-400 text-sm">평균 도움 횟수</p>
          </div>
          
          <div className="card p-6">
            <div className="flex items-center justify-between mb-2">
              <Award className="w-8 h-8 text-yellow-500" />
              <span className="text-lg font-bold text-yellow-500">
                {topHelper?.counselor_name || '-'}
              </span>
            </div>
            <p className="text-gray-400 text-sm">오늘의 최고 도우미</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="card p-6">
            <h2 className="text-xl font-bold text-white mb-4">
              상담사별 도움 현황
            </h2>
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
              </div>
            ) : realtimeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={realtimeData.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis 
                    dataKey="counselor_name" 
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tick={{ fill: '#9CA3AF', fontSize: 12 }}
                  />
                  <YAxis tick={{ fill: '#9CA3AF' }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#1F2937', 
                      border: '1px solid #374151',
                      borderRadius: '8px'
                    }}
                    labelStyle={{ color: '#F3F4F6' }}
                  />
                  <Bar dataKey="total_helps_today" name="도움 횟수">
                    {realtimeData.slice(0, 10).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center py-8 text-gray-500">
                데이터가 없습니다.
              </p>
            )}
          </div>

          <div className="card p-6">
            <h2 className="text-xl font-bold text-white mb-4">
              시간별 활동 추이
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="hour" 
                  tick={{ fill: '#9CA3AF', fontSize: 12 }}
                />
                <YAxis tick={{ fill: '#9CA3AF' }} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1F2937', 
                    border: '1px solid #374151',
                    borderRadius: '8px'
                  }}
                  labelStyle={{ color: '#F3F4F6' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="count" 
                  stroke="#3B82F6" 
                  strokeWidth={3}
                  name="도움 횟수"
                  dot={{ fill: '#3B82F6', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="p-6 border-b border-gray-700">
            <h2 className="text-xl font-bold text-white">
              실시간 상담사 랭킹
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    순위
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    상담사
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    도움 횟수
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    마지막 활동
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {realtimeData.map((item, index) => (
                  <tr key={item.counselor_id} className="hover:bg-gray-800 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`text-lg font-bold ${index < 3 ? 'text-yellow-500' : 'text-gray-400'}`}>
                        {index === 0 && '🥇'}
                        {index === 1 && '🥈'}
                        {index === 2 && '🥉'}
                        {index > 2 && `${index + 1}`}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-white">
                        {item.counselor_name}
                      </div>
                      <div className="text-xs text-gray-500">
                        ID: {item.counselor_id}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-3 py-1 inline-flex text-sm font-semibold rounded-full bg-blue-900 text-blue-300">
                        {item.total_helps_today}회
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                      {item.last_activity 
                        ? format(new Date(item.last_activity), 'HH:mm:ss', { locale: ko })
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {realtimeData.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                아직 데이터가 없습니다.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
