import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';

const sql = neon(process.env.DATABASE_URL!);

const MAX_TOTAL_SCORE = 25000;
const MAX_ROUND_SCORE = 5000;
const MAX_SUBMISSIONS_PER_DAY = 5;
const TOTAL_ROUNDS = 5;

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';

    const body = await req.json();
    const { name, total_score, round_scores, round_distances, clip_identifiers } = body;

    // ── Validate types ──
    if (
      typeof name !== 'string' ||
      typeof total_score !== 'number' ||
      !Array.isArray(round_scores) ||
      !Array.isArray(round_distances) ||
      !Array.isArray(clip_identifiers)
    ) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // ── Validate lengths ──
    if (
      round_scores.length !== TOTAL_ROUNDS ||
      round_distances.length !== TOTAL_ROUNDS ||
      clip_identifiers.length !== TOTAL_ROUNDS
    ) {
      return NextResponse.json({ error: 'Invalid round data' }, { status: 400 });
    }

    // ── Validate score math ──
    if (total_score > MAX_TOTAL_SCORE || total_score < 0) {
      return NextResponse.json({ error: 'Invalid total score' }, { status: 400 });
    }
    if (round_scores.some((s: number) => s > MAX_ROUND_SCORE || s < 0)) {
      return NextResponse.json({ error: 'Invalid round score' }, { status: 400 });
    }
    const expectedTotal = round_scores.reduce((a: number, b: number) => a + b, 0);
    if (expectedTotal !== total_score) {
      return NextResponse.json({ error: 'Score mismatch' }, { status: 400 });
    }

    // ── Sanitize name ──
    const cleanName = name.replace(/<[^>]*>/g, '').trim().slice(0, 30);
    if (!cleanName) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 });
    }

    // ── Rate limit: max 5 submissions per IP per day ──
    const todayMidnight = new Date();
    todayMidnight.setUTCHours(0, 0, 0, 0);

    const countResult = await sql`
      SELECT COUNT(*) as count FROM scores
      WHERE ip = ${ip} AND created_at >= ${todayMidnight.toISOString()}
    `;
    const submissionCount = parseInt(countResult[0].count as string, 10);
    if (submissionCount >= MAX_SUBMISSIONS_PER_DAY) {
      return NextResponse.json(
        { error: 'Daily submission limit reached' },
        { status: 429 }
      );
    }

    // ── Insert ──
    const result = await sql`
      INSERT INTO scores (name, total_score, round_scores, round_distances, clip_identifiers, ip)
      VALUES (
        ${cleanName},
        ${total_score},
        ${round_scores},
        ${round_distances},
        ${clip_identifiers},
        ${ip}
      )
      RETURNING id, name, total_score, created_at
    `;

    // ── Return rank alongside the new entry ──
    const rankResult = await sql`
      SELECT COUNT(*) as rank FROM scores
      WHERE total_score > ${total_score}
        AND created_at >= ${todayMidnight.toISOString()}
    `;
    const dailyRank = parseInt(rankResult[0].rank as string, 10) + 1;

    return NextResponse.json({
      success: true,
      entry: result[0],
      dailyRank,
    });
  } catch (err) {
    console.error('POST /api/scores error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}