import { NextResponse } from 'next/server';

// POST /api/payer/sessions/reclaim-all - TEMPORARILY DISABLED
// Batch reclaim requires a forwarder contract to be deployed.
// Multicall3 cannot be used because it changes msg.sender, breaking the
// escrow contract's operator access control: onlySender(paymentInfo.operator)
//
// TODO: Re-enable after deploying ERC8004Forwarder contract
// See: /Users/pancheisajeski/.claude/plans/compiled-launching-tulip.md
export async function POST() {
  return NextResponse.json(
    {
      error: 'Batch reclaim temporarily disabled. Please reclaim sessions individually.',
      reason: 'Forwarder contract not yet deployed',
    },
    { status: 501 }
  );
}
