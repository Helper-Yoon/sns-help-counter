import { NextResponse } from 'next/server'
import { trackCounselorActivities, fullScanActivities } from '@/lib/tracker'

export async function GET(request: Request) {
  console.log('[API] Cron 실행 시작:', new Date().toISOString())
  
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log('[API] ❌ 인증 실패')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  try {
    const result = await trackCounselorActivities()
    console.log('[API] ✅ Cron 완료:', result)
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[API] ❌ Cron 오류:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      message: error.message 
    }, { status: 500 })
  }
}

// 수동 실행 (전체 스캔)
export async function POST(request: Request) {
  console.log('[API] 수동 실행 요청')
  
  try {
    const { fullScan } = await request.json().catch(() => ({ fullScan: false }))
    
    const result = fullScan 
      ? await fullScanActivities()
      : await trackCounselorActivities()
      
    console.log('[API] 수동 실행 완료:', result)
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[API] 수동 실행 오류:', error)
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 })
  }
}
