import { SiweMessage } from 'siwe';
import { createPublicClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';

export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getChain(chainId: number) {
  switch (chainId) {
    case 8453:
      return base;
    case 84532:
      return baseSepolia;
    default:
      throw new Error(`Unsupported chain: ${chainId}`);
  }
}

export async function verifySiweMessage(
  message: string,
  signature: string
): Promise<{ success: boolean; address?: string; error?: string }> {
  try {
    const siweMessage = new SiweMessage(message);
    const address = siweMessage.address as `0x${string}`;
    const chainId = siweMessage.chainId;

    const chain = getChain(chainId);
    const client = createPublicClient({ chain, transport: http() });

    // Verify signature (supports both EOA and smart contract wallets via ERC-1271)
    const isValid = await client.verifyMessage({
      address,
      message,
      signature: signature as `0x${string}`,
    });

    if (isValid) {
      return { success: true, address: siweMessage.address };
    }
    return { success: false, error: 'Signature verification failed' };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
