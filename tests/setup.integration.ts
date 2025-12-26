import { config } from 'dotenv';
import { beforeAll } from 'vitest';
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

// Load test environment variables
config({ path: '.env.test' });

// Validate required environment variables
const requiredEnvVars = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'TEST_PAYER_PRIVATE_KEY',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(
      `Missing required environment variable: ${envVar}\nPlease copy .env.test.example to .env.test and fill in your values.`
    );
  }
}

// Create test accounts
// Note: facilitator is managed by CDP Server Wallet, we just need the payer for signing
export const payerAccount = privateKeyToAccount(
  process.env.TEST_PAYER_PRIVATE_KEY as `0x${string}`
);

// Facilitator account is optional (only for direct contract tests)
export const facilitatorAccount = process.env.FACILITATOR_PRIVATE_KEY
  ? privateKeyToAccount(process.env.FACILITATOR_PRIVATE_KEY as `0x${string}`)
  : null;

// Create viem clients
export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

// Facilitator wallet is optional (only if private key provided)
export const facilitatorWallet = facilitatorAccount
  ? createWalletClient({
      account: facilitatorAccount,
      chain: baseSepolia,
      transport: http(),
    })
  : null;

export const payerWallet = createWalletClient({
  account: payerAccount,
  chain: baseSepolia,
  transport: http(),
});

// Test configuration - facilitatorAddress will be set dynamically from API
export const testConfig = {
  networkId: process.env.TEST_NETWORK_ID || 'eip155:84532',
  chainId: parseInt(process.env.TEST_CHAIN_ID || '84532'),
  usdcAddress: (process.env.TEST_USDC_ADDRESS ||
    '0x036cbd53842c5426634e7929541ec2318f3dcf7e') as `0x${string}`,
  escrowContract: (process.env.TEST_ESCROW_CONTRACT ||
    '0xbdea0d1bcc5966192b070fdf62ab4ef5b4420cff') as `0x${string}`,
  tokenCollector: (process.env.TEST_TOKEN_COLLECTOR ||
    '0x0e3df9510de65469c4518d7843919c0b8c7a7757') as `0x${string}`,
  authorizeAmount: BigInt(process.env.TEST_AUTHORIZE_AMOUNT || '50000'), // 0.05 USDC (reduced for low test balance)
  debitAmount: BigInt(process.env.TEST_DEBIT_AMOUNT || '1000'), // 0.001 USDC
  facilitatorAddress: '' as `0x${string}`, // Will be fetched from API
  payerAddress: payerAccount.address,
};

// Fetch facilitator address from API (CDP Server Wallet manages this)
async function fetchFacilitatorAddress(): Promise<`0x${string}`> {
  const response = await fetch('http://localhost:3000/api/supported');
  if (!response.ok) {
    throw new Error(`Failed to fetch facilitator address: ${response.statusText}`);
  }
  const data = await response.json();
  const signers = data.signers[testConfig.networkId];
  if (!signers || signers.length === 0) {
    throw new Error('No signers found for network');
  }
  return signers[0] as `0x${string}`;
}

// USDC contract ABI (minimal for testing)
export const USDC_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'nonces',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'DOMAIN_SEPARATOR',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const;

// Helper to check USDC balance
export async function getUsdcBalance(address: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: testConfig.usdcAddress,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
}

// Helper to format USDC amounts
export function formatUsdc(amount: bigint): string {
  return formatUnits(amount, 6);
}

// Helper to parse USDC amounts
export function parseUsdc(amount: string): bigint {
  return parseUnits(amount, 6);
}

// Log test account info and fetch facilitator address from API
beforeAll(async () => {
  // Fetch facilitator address from the running server
  testConfig.facilitatorAddress = await fetchFacilitatorAddress();

  console.log('\n=== Integration Test Setup ===');
  console.log(`Network: Base Sepolia (${testConfig.chainId})`);
  console.log(`Facilitator: ${testConfig.facilitatorAddress}`);
  console.log(`Test Payer: ${payerAccount.address}`);

  // Check balances
  const facilitatorEth = await publicClient.getBalance({
    address: testConfig.facilitatorAddress,
  });
  const payerEth = await publicClient.getBalance({ address: payerAccount.address });
  const payerUsdc = await getUsdcBalance(payerAccount.address);

  console.log(`\nBalances:`);
  console.log(`  Facilitator ETH: ${formatUnits(facilitatorEth, 18)} ETH`);
  console.log(`  Payer ETH: ${formatUnits(payerEth, 18)} ETH`);
  console.log(`  Payer USDC: ${formatUsdc(payerUsdc)} USDC`);

  // Warn if balances are low
  if (facilitatorEth < parseUnits('0.001', 18)) {
    console.warn('\n  FACILITATOR ETH BALANCE LOW! Tests may fail.');
  }
  if (payerUsdc < testConfig.authorizeAmount) {
    console.warn('\n  PAYER USDC BALANCE LOW! Authorize tests will fail.');
    console.warn(`  Need at least ${formatUsdc(testConfig.authorizeAmount)} USDC`);
    console.warn('  Get testnet USDC from: https://faucet.circle.com/');
  }

  console.log('==============================\n');
});
