import { neon } from '@neondatabase/serverless';
import { NextResponse } from 'next/server';

const sql = neon(process.env.DATABASE_URL!);

export async function GET() {
  try {
    const todayMidnight = new Date();
    todayMidnight.setUTCHours(0, 0, 0, 0);

    const results = await sql`
      SELECT id, name, total_score, created_at
      FROM scores
      WHERE created_at >= ${todayMidnight.toISOString()}
      ORDER BY total_score DESC
      LIMIT 10
    `;

    return NextResponse.json({ leaderboard: results });
  } catch (err) {
    console.error('GET /api/scores/daily error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}