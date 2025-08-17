'use client'

import { useState } from 'react'

export default function TestPage() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)

  const runTest = async (fullScan = false) => {
    setLoading(true)
    setResult(null)
    
    try {
      const res = await fetch('/api/cron/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fullScan })
      })
      
      const data = await res.json()
      setResult(data)
    } catch (error: any) {
      setResult({ error: error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">
          🔧 SNS센터 트래킹 테스트
        </h1>
        
        <div className="flex gap-4 mb-8">
          <button
            onClick={() => runTest(false)}
            disabled={loading}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50"
          >
            {loading ? '실행중...' : '빠른 스캔 (최근 1시간)'}
          </button>
          
          <button
            onClick={() => runTest(true)}
            disabled={loading}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50"
          >
            {loading ? '실행중...' : '전체 스캔 (최대 500개)'}
          </button>
        </div>
        
        {result && (
          <div className="bg-gray-950 rounded-xl p-6 border border-gray-800">
            <h2 className="text-xl font-bold text-white mb-4">실행 결과</h2>
            <pre className="text-sm text-gray-300 overflow-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
