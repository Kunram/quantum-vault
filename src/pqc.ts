import { ml_dsa44 } from '@noble/post-quantum/ml-dsa';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export interface PQCKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicKeyHex: string;
  fingerprint: string;
  createdAt: number;
}

export interface PQCSignatureResult {
  signature: Uint8Array;
  signatureHex: string;
  message: Uint8Array;
  messageHex: string;
  timestamp: number;
  algorithm: string;
  securityLevel: string;
}

export interface PQCVerifyResult {
  valid: boolean;
  algorithm: string;
  securityLevel: string;
  publicKeyFingerprint: string;
  verifiedAt: number;
}

export interface VaultWithdrawalAuth {
  vaultAddress: string;
  recipientAddress: string;
  amount: number;
  nonce: number;
  pqcSignature: Uint8Array;
  signedMessage: Uint8Array;
  timestamp: number;
}

const ALGORITHM = 'ML-DSA-44';
const SECURITY_LEVEL = 'NIST Level 2';
const NIST_STANDARD = 'FIPS 204';
const STORAGE_KEY = 'quantumvault_pqc_keypair';

export function generateKeyPair(): PQCKeyPair {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const keys = ml_dsa44.keygen(seed);
  const fingerprint = bytesToHex(sha256(keys.publicKey)).slice(0, 16);

  const kp: PQCKeyPair = {
    publicKey: keys.publicKey,
    secretKey: keys.secretKey,
    publicKeyHex: bytesToHex(keys.publicKey),
    fingerprint,
    createdAt: Date.now(),
  };

  saveKeyPair(kp);
  return kp;
}

export function saveKeyPair(kp: PQCKeyPair): void {
  try {
    const data = {
      publicKey: bytesToHex(kp.publicKey),
      secretKey: bytesToHex(kp.secretKey),
      fingerprint: kp.fingerprint,
      createdAt: kp.createdAt,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save PQC key:', e);
  }
}

export function loadKeyPair(): PQCKeyPair | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    
    const data = JSON.parse(raw);
    return {
      publicKey: hexToBytes(data.publicKey),
      secretKey: hexToBytes(data.secretKey),
      publicKeyHex: data.publicKey,
      fingerprint: data.fingerprint,
      createdAt: data.createdAt,
    };
  } catch (e) {
    console.error('Failed to load PQC key:', e);
    return null;
  }
}

export function clearKeyPair(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getFingerprint(publicKey: Uint8Array): string {
  return bytesToHex(sha256(publicKey)).slice(0, 16);
}

export function signMessage(message: Uint8Array, secretKey: Uint8Array): PQCSignatureResult {
  const signature = ml_dsa44.sign(secretKey, message);

  return {
    signature,
    signatureHex: bytesToHex(signature),
    message,
    messageHex: bytesToHex(message),
    timestamp: Date.now(),
    algorithm: ALGORITHM,
    securityLevel: SECURITY_LEVEL,
  };
}

export function signWithdrawal(
  vaultAddress: string,
  recipientAddress: string,
  amountLamports: number,
  nonce: number,
  secretKey: Uint8Array,
): VaultWithdrawalAuth {
  const message = buildWithdrawalMessage(vaultAddress, recipientAddress, amountLamports, nonce);
  const signature = ml_dsa44.sign(secretKey, message);

  return {
    vaultAddress,
    recipientAddress,
    amount: amountLamports,
    nonce,
    pqcSignature: signature,
    signedMessage: message,
    timestamp: Date.now(),
  };
}

export function buildWithdrawalMessage(
  vaultAddress: string,
  recipientAddress: string,
  amountLamports: number,
  nonce: number,
): Uint8Array {
  const prefix = new TextEncoder().encode('QuantumVault:Withdraw:');
  const vaultHash = sha256(new TextEncoder().encode(vaultAddress));
  const recipientHash = sha256(new TextEncoder().encode(recipientAddress));

  const amountBytes = new Uint8Array(8);
  const amountView = new DataView(amountBytes.buffer);
  amountView.setBigUint64(0, BigInt(amountLamports), true);

  const nonceBytes = new Uint8Array(8);
  const nonceView = new DataView(nonceBytes.buffer);
  nonceView.setBigUint64(0, BigInt(nonce), true);

  const total = new Uint8Array(prefix.length + 32 + 32 + 8 + 8);
  let offset = 0;
  
  total.set(prefix, offset); offset += prefix.length;
  total.set(vaultHash, offset); offset += 32;
  total.set(recipientHash, offset); offset += 32;
  total.set(amountBytes, offset); offset += 8;
  total.set(nonceBytes, offset);

  return total;
}

export function verifySignature(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): PQCVerifyResult {
  const valid = ml_dsa44.verify(publicKey, message, signature);
  const fingerprint = bytesToHex(sha256(publicKey)).slice(0, 16);

  return {
    valid,
    algorithm: ALGORITHM,
    securityLevel: SECURITY_LEVEL,
    publicKeyFingerprint: fingerprint,
    verifiedAt: Date.now(),
  };
}

export function verifyWithdrawal(
  auth: VaultWithdrawalAuth,
  publicKey: Uint8Array,
): { valid: boolean; details: string } {
  const expectedMessage = buildWithdrawalMessage(
    auth.vaultAddress,
    auth.recipientAddress,
    auth.amount,
    auth.nonce,
  );

  if (bytesToHex(expectedMessage) !== bytesToHex(auth.signedMessage)) {
    return { valid: false, details: 'Message integrity check failed' };
  }

  const valid = ml_dsa44.verify(publicKey, auth.signedMessage, auth.pqcSignature);

  return {
    valid,
    details: valid
      ? `Withdrawal of ${(auth.amount / 1e9).toFixed(4)} SOL verified`
      : 'Signature verification failed',
  };
}

export function calculateSecurityScore(config: {
  hasPQCKey: boolean;
  hasVault: boolean;
  vaultBalance: number;
  recentWithdrawals: number;
  keyAge: number;
}): { score: number; grade: string; recommendations: string[] } {
  let score = 0;
  const recommendations: string[] = [];

  if (config.hasPQCKey) {
    score += 40;
  } else {
    recommendations.push('Generate an ML-DSA-44 key pair');
  }

  if (config.hasVault) {
    score += 30;
  } else {
    recommendations.push('Create a vault instance');
  }

  if (config.vaultBalance > 0) {
    score += 15;
  } else {
    recommendations.push('Fund your vault');
  }

  if (config.keyAge < 90) {
    score += 10;
  } else {
    recommendations.push('Rotate PQC key (older than 90 days)');
  }

  if (config.recentWithdrawals < 10) {
    score += 5;
  }

  const grade =
    score >= 90 ? 'A+' :
    score >= 80 ? 'A' :
    score >= 70 ? 'B' :
    score >= 50 ? 'C' :
    score >= 30 ? 'D' : 'F';

  return { score, grade, recommendations };
}

export function getAlgorithmInfo() {
  return {
    name: ALGORITHM,
    standard: NIST_STANDARD,
    securityLevel: SECURITY_LEVEL,
    family: 'CRYSTALS-Dilithium',
    type: 'Lattice-based digital signature',
    quantumSafe: true,
    keySizes: {
      publicKey: 1312,
      secretKey: 2560,
      signature: 2420,
    },
    hardness: 'Module Learning With Errors (M-LWE)',
    classicalSecurity: '~128 bits',
    quantumSecurity: '~128 bits (NIST Level 2)',
  };
}

export function lamportsToSol(lamports: number): string {
  return (lamports / 1e9).toFixed(4);
}

export { bytesToHex, hexToBytes };
