import { NextResponse } from 'next/server';
import { captureTier1, captureTier2 } from '@/lib/capture';

// Vercel Cron endpoint for batch captures
// Runs both TIER 1 (threshold) and TIER 2 (expiry) captures
// Configure in vercel.json: { "crons": [{ "path": "/api/capture", "schedule": "*/15 * * * *" }] }
export async function POST(request: Request) {
  try {
    // Validate Vercel cron secret (automatically set by Vercel)
    const authHeader = request.headers.get('Authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Run both capture tiers
    const [tier1Results, tier2Results] = await Promise.all([captureTier1(), captureTier2()]);

    const allResults = [
      ...tier1Results.map((r) => ({ ...r, tier: 1 })),
      ...tier2Results.map((r) => ({ ...r, tier: 2 })),
    ];

    const successful = allResults.filter((r) => r.success);
    const failed = allResults.filter((r) => !r.success);

    return NextResponse.json({
      processed: allResults.length,
      successful: successful.length,
      failed: failed.length,
      tier1: {
        processed: tier1Results.length,
        successful: tier1Results.filter((r) => r.success).length,
      },
      tier2: {
        processed: tier2Results.length,
        successful: tier2Results.filter((r) => r.success).length,
      },
    });
  } catch (err) {
    console.error('Capture error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
