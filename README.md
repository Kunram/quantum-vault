# QuantumVault

QuantumVault is a post-quantum migration infrastructure for the Solana blockchain. It provides an application-layer vault that protects digital assets against "Harvest Now, Decrypt Later" quantum computing threats by requiring a hybrid dual-signature authorization for all withdrawals.

## Overview

Current blockchain wallets, including those on Solana, rely on elliptic curve cryptography (like Ed25519) which is vulnerable to Shor's algorithm on a sufficiently powerful quantum computer. While the network itself may eventually upgrade, individual wallets remain vulnerable during the transition period. 

QuantumVault addresses this by wrapping assets in a smart contract that enforces a secondary, quantum-resistant signature.

### Security Model

- **Ed25519 (Solana Native)**: Provides current cryptographic security.
- **ML-DSA-44 (FIPS 204)**: Provides NIST Level 2 quantum-resistant security.
- **On-chain Enforcement**: The smart contract verifies the Ed25519 signature natively and enforces PQC identity by matching the ML-DSA-44 public key hash.

Even if an attacker compromises a user's Ed25519 private key using a quantum computer, they cannot authorize a withdrawal without the corresponding ML-DSA-44 private key.

## Architecture

1. **Frontend Client**: Generates and manages the ML-DSA-44 key pair locally. Constructs withdrawal messages and signs them with both the traditional Solana wallet and the ML-DSA-44 key.
2. **Smart Contract (Anchor)**: Manages the vault state, validates the traditional signature, verifies the PQC public key hash, and logs the PQC signature hash for auditing.

## Tech Stack

- **Smart Contract**: Rust, Anchor Framework
- **Frontend**: React, TypeScript, Vite
- **Cryptography**: `@noble/post-quantum` for ML-DSA-44 (CRYSTALS-Dilithium)

## Getting Started

### Prerequisites

- Node.js >= 18
- Rust and Cargo
- Solana CLI
- Anchor CLI (v0.30.1 or later)
- Phantom Wallet extension

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/quantum-vault.git
   cd quantum-vault
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the smart contract**
   ```bash
   anchor build
   ```

4. **Deploy to Solana Devnet**
   ```bash
   anchor deploy --provider.cluster devnet --program-name quantum_vault --program-keypair target/deploy/quantum_vault-keypair.json
   ```

5. **Update configuration**
   After deployment, update the generated Program ID in the following files:
   - `programs/quantum_vault/src/lib.rs` (in the `declare_id!` macro)
   - `Anchor.toml` (under `[programs.devnet]`)
   - `src/solana.ts` (the `PROGRAM_ID` constant)

6. **Start the frontend**
   ```bash
   npm run dev
   ```

## License

This project is licensed under the MIT License - see the LICENSE file for details.
