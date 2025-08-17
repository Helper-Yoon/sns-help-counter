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
          
          <div className="card p-6 card-hover bg
