import { neon } from '@neondatabase/serverless';
import { NextResponse } from 'next/server';

const sql = neon(process.env.DATABASE_URL!);

export async function GET() {
  try {
    const results = await sql`
      SELECT id, name, total_score, created_at
      FROM scores
      ORDER BY total_score DESC
      LIMIT 10
    `;

    return NextResponse.json({ leaderboard: results });
  } catch (err) {
    console.error('GET /api/scores/alltime error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}