// app/page.tsx
'use client'

import { useEffect, useState } from 'react'

export default function Dashboard() {
  const [stats, setStats] = useState([])
  const [lastSync, setLastSync] = useState(null)
  
  const fetchStats = async () => {
    const response = await fetch('/api/stats')
    const data = await response.json()
    setStats(data.stats)
    setLastSync(data.lastSync)
  }
  
  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 10000) // 10초마다
    return () => clearInterval(interval)
  }, [])
  
  return (
    <div className="min-h-screen bg-black text-white p-8">
      <h1 className="text-3xl font-bold mb-8">
        실시간 상담사 도움 통계
      </h1>
      
      <div className="bg-gray-900 rounded-lg p-4 mb-6">
        <p className="text-sm text-gray-400">
          마지막 동기화: {lastSync || '없음'}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Webhook 실시간 + API 5분 보정
        </p>
      </div>
      
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-800">
            <th className="text-left p-4">순위</th>
            <th className="text-left p-4">상담사</th>
            <th className="text-left p-4">오늘 도움 횟수</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((stat, idx) => (
            <tr key={stat.counselor_id} className="border-b border-gray-900">
              <td className="p-4">
                {idx === 0 && '🥇'}
                {idx === 1 && '🥈'}
                {idx === 2 && '🥉'}
                {idx > 2 && idx + 1}
              </td>
              <td className="p-4">{stat.counselor_name}</td>
              <td className="p-4">
                <span className="bg-blue-900 text-blue-200 px-3 py-1 rounded">
                  {stat.help_count}회
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
