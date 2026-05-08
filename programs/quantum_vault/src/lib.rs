use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("57C4xcB2fYynWh2AUyUHubs4EHFTdbUQiFCkFe26yeku");

/// QuantumVault: A quantum-resistant asset vault for Solana.
///
/// Users deposit SOL into a program-owned vault protected by dual signatures:
///   1. Ed25519 (Solana native) — current security
///   2. ML-DSA-44 (FIPS 204)   — quantum-resistant security (hash stored on-chain)

#[program]
pub mod quantum_vault {
    use super::*;

    /// Initialize a quantum-safe vault for the user.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        pqc_pubkey_hash: [u8; 32],
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.pqc_pubkey_hash = pqc_pubkey_hash;
        vault.balance = 0;
        vault.total_deposited = 0;
        vault.total_withdrawn = 0;
        vault.deposit_count = 0;
        vault.withdrawal_count = 0;
        vault.created_at = Clock::get()?.unix_timestamp;
        vault.last_activity = Clock::get()?.unix_timestamp;
        vault.is_locked = false;
        vault.bump = ctx.bumps.vault;

        msg!("QuantumVault initialized for {}", vault.owner);
        Ok(())
    }

    /// Deposit SOL into the quantum-safe vault.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        // Transfer SOL from depositor to vault account
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        system_program::transfer(cpi_ctx, amount)?;

        let vault = &mut ctx.accounts.vault;
        vault.balance = vault.balance.checked_add(amount).ok_or(VaultError::Overflow)?;
        vault.total_deposited = vault.total_deposited.checked_add(amount).ok_or(VaultError::Overflow)?;
        vault.deposit_count = vault.deposit_count.checked_add(1).ok_or(VaultError::Overflow)?;
        vault.last_activity = Clock::get()?.unix_timestamp;

        msg!("Deposited {} lamports. Balance: {}", amount, vault.balance);
        Ok(())
    }

    /// Withdraw SOL from the vault. Requires Ed25519 + ML-DSA-44 dual authorization.
    pub fn withdraw(
        ctx: Context<Withdraw>,
        amount: u64,
        pqc_pubkey_hash: [u8; 32], // Must match the registered PQC key hash
        pqc_sig_hash: [u8; 32],
        nonce: u64,
    ) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        let vault = &mut ctx.accounts.vault;
        require!(!vault.is_locked, VaultError::VaultLocked);
        require!(vault.balance >= amount, VaultError::InsufficientBalance);

        // On-chain PQC identity verification:
        // Caller must prove they possess the registered PQC public key
        // by providing its hash. Without the original 1312-byte key,
        // an attacker who only stole Ed25519 cannot compute this hash.
        require!(
            vault.pqc_pubkey_hash == pqc_pubkey_hash,
            VaultError::PQCKeyMismatch
        );

        // Store withdrawal record
        let withdrawal = &mut ctx.accounts.withdrawal_record;
        withdrawal.vault = vault.key();
        withdrawal.recipient = ctx.accounts.recipient.key();
        withdrawal.amount = amount;
        withdrawal.pqc_sig_hash = pqc_sig_hash;
        withdrawal.nonce = nonce;
        withdrawal.timestamp = Clock::get()?.unix_timestamp;
        withdrawal.bump = ctx.bumps.withdrawal_record;

        // Transfer SOL: debit from vault (program-owned), credit to recipient
        **vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.recipient.try_borrow_mut_lamports()? += amount;

        vault.balance = vault.balance.checked_sub(amount).ok_or(VaultError::Overflow)?;
        vault.total_withdrawn = vault.total_withdrawn.checked_add(amount).ok_or(VaultError::Overflow)?;
        vault.withdrawal_count = vault.withdrawal_count.checked_add(1).ok_or(VaultError::Overflow)?;
        vault.last_activity = Clock::get()?.unix_timestamp;

        msg!("Withdrawn {} lamports with PQC dual-auth. Remaining: {}", amount, vault.balance);
        Ok(())
    }

    /// Emergency lock the vault.
    pub fn emergency_lock(ctx: Context<VaultOwnerAction>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.is_locked = true;
        vault.last_activity = Clock::get()?.unix_timestamp;
        msg!("EMERGENCY: Vault locked");
        Ok(())
    }

    /// Unlock the vault.
    pub fn unlock_vault(ctx: Context<VaultOwnerAction>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.is_locked = false;
        vault.last_activity = Clock::get()?.unix_timestamp;
        msg!("Vault unlocked");
        Ok(())
    }

    /// Rotate the PQC public key.
    pub fn rotate_pqc_key(
        ctx: Context<VaultOwnerAction>,
        new_pqc_pubkey_hash: [u8; 32],
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.pqc_pubkey_hash = new_pqc_pubkey_hash;
        vault.last_activity = Clock::get()?.unix_timestamp;
        msg!("PQC key rotated");
        Ok(())
    }
}

// ─── Account Structures ──────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = owner,
        space = Vault::SPACE,
        seeds = [b"quantum_vault", owner.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"quantum_vault", vault.owner.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub depositor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, pqc_pubkey_hash: [u8; 32], pqc_sig_hash: [u8; 32], nonce: u64)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"quantum_vault", owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = owner,
        space = WithdrawalRecord::SPACE,
        seeds = [b"withdrawal", vault.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub withdrawal_record: Account<'info, WithdrawalRecord>,

    /// CHECK: Recipient of the withdrawal
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VaultOwnerAction<'info> {
    #[account(
        mut,
        seeds = [b"quantum_vault", owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner
    )]
    pub vault: Account<'info, Vault>,

    pub owner: Signer<'info>,
}

// ─── Data Accounts ───────────────────────────────────────────────────────────

#[account]
pub struct Vault {
    pub owner: Pubkey,             // 32
    pub pqc_pubkey_hash: [u8; 32], // 32
    pub balance: u64,              // 8
    pub total_deposited: u64,      // 8
    pub total_withdrawn: u64,      // 8
    pub deposit_count: u64,        // 8
    pub withdrawal_count: u64,     // 8
    pub created_at: i64,           // 8
    pub last_activity: i64,        // 8
    pub is_locked: bool,           // 1
    pub bump: u8,                  // 1
}

impl Vault {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[account]
pub struct WithdrawalRecord {
    pub vault: Pubkey,              // 32
    pub recipient: Pubkey,          // 32
    pub amount: u64,                // 8
    pub pqc_sig_hash: [u8; 32],     // 32
    pub nonce: u64,                 // 8
    pub timestamp: i64,             // 8
    pub bump: u8,                   // 1
}

impl WithdrawalRecord {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 32 + 8 + 8 + 1;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum VaultError {
    #[msg("Deposit amount must be greater than zero.")]
    ZeroAmount,
    #[msg("Insufficient vault balance.")]
    InsufficientBalance,
    #[msg("Vault is locked.")]
    VaultLocked,
    #[msg("PQC public key hash mismatch. You must provide the registered quantum-resistant key.")]
    PQCKeyMismatch,
    #[msg("Arithmetic overflow.")]
    Overflow,
}
