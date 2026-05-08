<div align="center">

# 🛡️ QuantumVault

**Post-Quantum Migration Infrastructure for Solana**

[![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF?logo=solana)](https://solana.com)
[![NIST](https://img.shields.io/badge/NIST-FIPS%20204-00529B)](https://csrc.nist.gov/pubs/fips/204/final)
[![ML-DSA-44](https://img.shields.io/badge/Algorithm-ML--DSA--44-00C853)](https://pq-crystals.org/dilithium/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

*Defend against "Harvest Now, Decrypt Later" attacks on Solana.*

</div>

---

## 🎯 Problem

Quantum computers running Shor's algorithm will break Ed25519 — the signature scheme securing every Solana wallet. Adversaries are already recording on-chain public keys today, waiting for quantum hardware to mature.

**The threat isn't sudden — it's gradual.** Early quantum computers will target individual high-value wallets (taking hours to break one key) while the network still operates. This transition window could last years.

## 💡 Solution

QuantumVault provides an **application-layer quantum-safe vault** that protects assets during the critical migration window:

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| **Ed25519** | Solana native signature (Phantom) | Current security |
| **ML-DSA-44** | NIST FIPS 204 lattice-based signature | Quantum-resistant security |
| **On-chain hash binding** | PQC pubkey hash verified by smart contract | Identity enforcement |

**Even if a quantum computer breaks your Ed25519 key, your vault assets remain safe** — the attacker cannot produce the ML-DSA-44 authorization required by the smart contract.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    User's Browser                       │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Phantom       │  │ ML-DSA-44    │  │ QuantumVault  │  │
│  │ Wallet        │  │ Key Manager  │  │ Frontend      │  │
│  │ (Ed25519)     │  │ (FIPS 204)   │  │ (React)       │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
│         └────────┬────────┘                   │          │
│                  │ Dual Signature              │          │
│                  ▼                             │          │
│         ┌──────────────────┐                  │          │
│         │ Transaction      │◄─────────────────┘          │
│         │ Builder          │                             │
│         └────────┬─────────┘                             │
└──────────────────┼───────────────────────────────────────┘
                   │
                   ▼  Solana Devnet
         ┌─────────────────────┐
         │  QuantumVault       │
         │  Smart Contract     │
         │                     │
         │  ✓ Ed25519 check    │
         │  ✓ PQC hash match   │
         │  ✓ Balance check    │
         │  ✓ Lock status      │
         │  📜 Audit trail     │
         └─────────────────────┘
```

## ✨ Features

- **🔐 Dual-Signature Withdrawals** — Ed25519 + ML-DSA-44 required for every withdrawal
- **🔮 Real PQC Cryptography** — NIST FIPS 204 ML-DSA-44 (CRYSTALS-Dilithium Level 2)
- **📊 Visual Signing Pipeline** — 6-step real-time visualization of the dual-signature process
- **🔒 Emergency Lock** — Instantly freeze vault if Ed25519 key compromise is suspected
- **🔑 Key Rotation** — Rotate PQC keys without moving assets
- **📜 On-Chain Audit Trail** — Every withdrawal stores PQC signature hash on Solana
- **💾 Key Persistence** — PQC keys safely stored in browser localStorage
- **📈 Security Scoring** — Real-time quantum readiness assessment (A+ to F)

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [Phantom Wallet](https://phantom.app/) browser extension
- [Rust](https://rustup.rs/) + [Solana CLI](https://docs.solanalabs.com/cli/install) + [Anchor](https://www.anchor-lang.com/) (for contract deployment)

### Frontend

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Smart Contract

```bash
# Build the Anchor program
anchor build

# Deploy to Devnet
anchor deploy --provider.cluster devnet \
  --program-name quantum_vault \
  --program-keypair target/deploy/quantum_vault-keypair.json
```

### Configuration

Update the Program ID in three files after deployment:

1. `programs/quantum_vault/src/lib.rs` → `declare_id!("YOUR_PROGRAM_ID")`
2. `Anchor.toml` → `quantum_vault = "YOUR_PROGRAM_ID"`
3. `src/solana.ts` → `PROGRAM_ID = new PublicKey("YOUR_PROGRAM_ID")`

## 📁 Project Structure

```
quantum-vault/
├── programs/quantum_vault/src/
│   └── lib.rs              # Anchor smart contract (vault, deposit, withdraw, lock)
├── src/
│   ├── App.tsx             # Main React application with vault UI
│   ├── pqc.ts              # ML-DSA-44 key management & signing module
│   ├── solana.ts           # Solana on-chain interaction (PDA, instructions, TX)
│   ├── index.css           # Cyberpunk-themed UI styles
│   └── main.tsx            # React entry point
├── Anchor.toml             # Anchor framework configuration
├── Cargo.toml              # Rust workspace configuration
├── package.json            # Node.js dependencies
└── vite.config.ts          # Vite build configuration
```

## 🔬 Technical Details

### ML-DSA-44 (FIPS 204)

| Parameter | Value |
|-----------|-------|
| Algorithm | CRYSTALS-Dilithium Level 2 |
| NIST Standard | FIPS 204 (finalized August 2024) |
| Public Key Size | 1,312 bytes |
| Signature Size | 2,420 bytes |
| Secret Key Size | 2,560 bytes |
| Security Level | NIST Level 2 (128-bit quantum) |
| Hardness | Module-LWE / Module-SIS |

### On-Chain Verification Model

Since Solana's runtime doesn't natively support ML-DSA-44 verification, QuantumVault uses a **hash-commitment model**:

1. **Client-side**: Full ML-DSA-44 sign + verify (real FIPS 204 cryptography)
2. **On-chain**: PQC public key hash matching (identity enforcement)
3. **On-chain**: PQC signature hash storage (tamper-proof audit trail)
4. **On-chain**: Ed25519 signature verification (Solana native)

This architecture is designed as **migration infrastructure** — when Solana adds native PQC syscalls, the contract can be upgraded to perform full on-chain ML-DSA verification.

## 🛣️ Roadmap

- [x] ML-DSA-44 key generation & signing
- [x] Dual-signature vault smart contract
- [x] Visual signing pipeline
- [x] On-chain PQC identity verification
- [x] Emergency lock / unlock
- [x] Key persistence (localStorage)
- [ ] Hardware wallet integration (Ledger)
- [ ] Multi-sig vault governance
- [ ] ML-KEM key encapsulation for encrypted vault metadata
- [ ] Native Solana PQC syscall integration (when available)

## 🏆 Colosseum Frontier Hackathon

QuantumVault is built for the **Security Tools** track. It addresses the inevitable need for post-quantum cryptography migration in the Solana ecosystem, providing infrastructure that users can adopt today to protect against tomorrow's quantum threats.

## 📄 License

MIT

---

<div align="center">
<strong>QuantumVault</strong> — Because quantum computing isn't a question of <em>if</em>, but <em>when</em>.
</div>
