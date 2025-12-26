import { SignJWT, jwtVerify } from 'jose';

const JWT_ISSUER = 'x402-escrow';
const JWT_AUDIENCE = 'x402-escrow-api';
const JWT_EXPIRATION = '24h';

// Lazy initialization - throws at runtime when used, not at build time
let _jwtSecret: Uint8Array | null = null;
function getJwtSecret(): Uint8Array {
  if (!_jwtSecret) {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    _jwtSecret = new TextEncoder().encode(process.env.JWT_SECRET);
  }
  return _jwtSecret;
}

export interface JWTPayload {
  sub: string; // User ID
  address: string; // Wallet address
  iat: number;
  exp: number;
}

export async function createToken(userId: string, walletAddress: string): Promise<string> {
  return new SignJWT({
    sub: userId,
    address: walletAddress.toLowerCase(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(JWT_EXPIRATION)
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    return {
      sub: payload.sub as string,
      address: payload.address as string,
      iat: payload.iat as number,
      exp: payload.exp as number,
    };
  } catch {
    return null;
  }
}
