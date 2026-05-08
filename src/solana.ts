/**
 * QuantumVault — Solana On-Chain Interaction Module
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha256';

// ─── Config ──────────────────────────────────────────────────────────────────

export const PROGRAM_ID = new PublicKey('57C4xcB2fYynWh2AUyUHubs4EHFTdbUQiFCkFe26yeku');
export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const connection = new Connection(DEVNET_RPC, 'confirmed');

function getDiscriminator(name: string): Buffer {
  const hash = sha256(new TextEncoder().encode(`global:${name}`));
  return Buffer.from(hash.slice(0, 8));
}

// ─── PDA Derivation ──────────────────────────────────────────────────────────

export function getVaultPDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('quantum_vault'), owner.toBuffer()],
    PROGRAM_ID
  );
}

export function getWithdrawalPDA(vault: PublicKey, nonce: number): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));
  return PublicKey.findProgramAddressSync(
    [Buffer.from('withdrawal'), vault.toBuffer(), nonceBuf],
    PROGRAM_ID
  );
}

// ─── Instructions ────────────────────────────────────────────────────────────

export function buildInitializeVaultIx(
  owner: PublicKey,
  pqcPubkey: Uint8Array,
): TransactionInstruction {
  const [vaultPDA] = getVaultPDA(owner);
  const pubkeyHash = sha256(pqcPubkey);

  const disc = getDiscriminator('initialize_vault');
  const data = Buffer.alloc(8 + 32);
  disc.copy(data, 0);
  Buffer.from(pubkeyHash).copy(data, 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

export function buildDepositIx(
  depositor: PublicKey,
  vaultOwner: PublicKey,
  amountLamports: number,
): TransactionInstruction {
  const [vaultPDA] = getVaultPDA(vaultOwner);

  const disc = getDiscriminator('deposit');
  const data = Buffer.alloc(16);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(amountLamports), 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: depositor, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

export function buildWithdrawIx(
  owner: PublicKey,
  recipient: PublicKey,
  amountLamports: number,
  pqcPubkey: Uint8Array,
  pqcSignature: Uint8Array,
  nonce: number,
): TransactionInstruction {
  const [vaultPDA] = getVaultPDA(owner);
  const [withdrawalPDA] = getWithdrawalPDA(vaultPDA, nonce);
  const pubkeyHash = sha256(pqcPubkey);
  const sigHash = sha256(pqcSignature);

  const disc = getDiscriminator('withdraw');
  const data = Buffer.alloc(8 + 8 + 32 + 32 + 8);
  let offset = 0;
  disc.copy(data, offset); offset += 8;
  data.writeBigUInt64LE(BigInt(amountLamports), offset); offset += 8;
  Buffer.from(pubkeyHash).copy(data, offset); offset += 32;
  Buffer.from(sigHash).copy(data, offset); offset += 32;
  data.writeBigUInt64LE(BigInt(nonce), offset);

  return new TransactionInstruction({
    keys: [
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: withdrawalPDA, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

export function buildEmergencyLockIx(owner: PublicKey): TransactionInstruction {
  const [vaultPDA] = getVaultPDA(owner);
  return new TransactionInstruction({
    keys: [
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: getDiscriminator('emergency_lock'),
  });
}

export function buildUnlockVaultIx(owner: PublicKey): TransactionInstruction {
  const [vaultPDA] = getVaultPDA(owner);
  return new TransactionInstruction({
    keys: [
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: getDiscriminator('unlock_vault'),
  });
}

// ─── Transaction Helpers ─────────────────────────────────────────────────────

export async function sendTransaction(
  instruction: TransactionInstruction,
  feePayer: PublicKey,
): Promise<string> {
  const solana = (window as any).solana;
  if (!solana?.isPhantom) throw new Error('Phantom wallet not found');

  const tx = new Transaction().add(instruction);
  tx.feePayer = feePayer;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const signed = await solana.signTransaction(tx);
  const txid = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(txid, 'confirmed');

  return txid;
}

export async function fetchVaultData(owner: PublicKey) {
  const [vaultPDA] = getVaultPDA(owner);
  try {
    const info = await connection.getAccountInfo(vaultPDA);
    if (!info) return null;

    const data = info.data;
    // 8 disc + 32 owner + 32 hash + fields
    const off = 8 + 32 + 32;
    return {
      exists: true,
      balance: Number(data.readBigUInt64LE(off)),
      totalDeposited: Number(data.readBigUInt64LE(off + 8)),
      totalWithdrawn: Number(data.readBigUInt64LE(off + 16)),
      depositCount: Number(data.readBigUInt64LE(off + 24)),
      withdrawalCount: Number(data.readBigUInt64LE(off + 32)),
      createdAt: Number(data.readBigInt64LE(off + 40)),
      isLocked: data[off + 56] === 1,
    };
  } catch (e) {
    console.error('Fetch vault failed:', e);
    return null;
  }
}

export async function getBalance(address: PublicKey): Promise<number> {
  return connection.getBalance(address);
}

export async function requestAirdrop(address: PublicKey, sol: number = 1): Promise<string> {
  const sig = await connection.requestAirdrop(address, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}
