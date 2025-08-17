import { NextResponse } from 'next/server'
import { trackCounselorActivities } from '@/lib/tracker'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  try {
    const result = await trackCounselorActivities()
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }
  
  const result = await trackCounselorActivities()
  return NextResponse.json(result)
}
