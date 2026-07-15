//! Owltopia governance (v1): SPL OWL vault stake/unstake, on-chain proposals, token-weighted votes.
//! Vote weight uses **current** staked balance at `cast_vote` time × `vote_stake_weight_bps / 10_000`.
//! Voting window length is chosen per proposal and enforced on-chain: **48h ≤ duration ≤ 7d**.
//!
//! Discord webhooks (later): emit `ProposalCreated` / `VoteCast` events; a small indexer or Helius
//! webhook can POST to Discord when these appear in transaction logs.
//!
//! Program keypair (for reproducible `program_id`): `governance-anchor/keys/owltopia_governance-keypair.json`
//! — copy to `target/deploy/` before `anchor build` if your Anchor version expects it there, or use `anchor keys sync`.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("CJD7H2URWfCqUBqntRgaEe6yzB2f1MmHofoXDi7BuYQR");

/// 48 hours in seconds (minimum voting period).
pub const MIN_VOTING_SECS: i64 = 48 * 3600;
/// 7 days in seconds (maximum voting period).
pub const MAX_VOTING_SECS: i64 = 7 * 24 * 3600;

#[program]
pub mod owltopia_governance {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        min_stake_to_propose: u64,
        vote_stake_weight_bps: u64,
    ) -> Result<()> {
        require!(vote_stake_weight_bps > 0, GovernanceError::ZeroVoteWeight);
        let global = &mut ctx.accounts.global;
        global.authority = ctx.accounts.authority.key();
        global.owl_mint = ctx.accounts.owl_mint.key();
        global.vault = ctx.accounts.vault.key();
        global.bump = ctx.bumps.global;
        global.proposal_count = 0;
        global.min_voting_secs = MIN_VOTING_SECS;
        global.max_voting_secs = MAX_VOTING_SECS;
        global.min_stake_to_propose = min_stake_to_propose;
        global.vote_stake_weight_bps = vote_stake_weight_bps;
        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(amount > 0, GovernanceError::ZeroAmount);
        let global = &ctx.accounts.global;
        require_keys_eq!(ctx.accounts.owl_mint.key(), global.owl_mint, GovernanceError::BadMint);

        let cpi = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_owl_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi, amount)?;

        let user_stake = &mut ctx.accounts.user_stake;
        if user_stake.owner == Pubkey::default() {
            user_stake.owner = ctx.accounts.user.key();
            user_stake.bump = ctx.bumps.user_stake;
        }
        user_stake.amount = user_stake
            .amount
            .checked_add(amount)
            .ok_or(GovernanceError::AmountOverflow)?;
        Ok(())
    }

    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        require!(amount > 0, GovernanceError::ZeroAmount);
        let global = &ctx.accounts.global;
        require_keys_eq!(ctx.accounts.owl_mint.key(), global.owl_mint, GovernanceError::BadMint);

        let user_stake = &mut ctx.accounts.user_stake;
        require!(user_stake.amount >= amount, GovernanceError::InsufficientStake);
        user_stake.amount = user_stake
            .amount
            .checked_sub(amount)
            .ok_or(GovernanceError::AmountOverflow)?;

        let seeds: &[&[u8]] = &[b"global", &[global.bump]];
        let signer = &[seeds];
        let cpi = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_owl_ata.to_account_info(),
                authority: global.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi, amount)?;
        Ok(())
    }

    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        title: String,
        voting_duration_secs: i64,
    ) -> Result<()> {
        let global = &mut ctx.accounts.global;
        require_keys_eq!(ctx.accounts.owl_mint.key(), global.owl_mint, GovernanceError::BadMint);
        require!(
            voting_duration_secs >= global.min_voting_secs
                && voting_duration_secs <= global.max_voting_secs,
            GovernanceError::InvalidVotingDuration
        );
        require!(
            title.len() <= Proposal::TITLE_MAX,
            GovernanceError::TitleTooLong
        );

        let user_stake = &ctx.accounts.user_stake;
        require_keys_eq!(user_stake.owner, ctx.accounts.proposer.key(), GovernanceError::BadStakeOwner);
        require!(
            user_stake.amount >= global.min_stake_to_propose,
            GovernanceError::InsufficientStakeToPropose
        );

        let clock = Clock::get()?;
        let voting_start = clock.unix_timestamp;
        let voting_end = voting_start
            .checked_add(voting_duration_secs)
            .ok_or(GovernanceError::TimestampOverflow)?;

        let id = global.proposal_count;
        global.proposal_count = global
            .proposal_count
            .checked_add(1)
            .ok_or(GovernanceError::AmountOverflow)?;

        let proposal = &mut ctx.accounts.proposal;
        proposal.id = id;
        proposal.proposer = ctx.accounts.proposer.key();
        proposal.voting_start = voting_start;
        proposal.voting_end = voting_end;
        proposal.title = title.clone();
        proposal.yes_weight = 0;
        proposal.no_weight = 0;
        proposal.bump = ctx.bumps.proposal;

        emit!(ProposalCreated {
            proposal_id: id,
            proposer: proposal.proposer,
            voting_start,
            voting_end,
            title,
        });
        Ok(())
    }

    pub fn cast_vote(ctx: Context<CastVote>, side: VoteSide) -> Result<()> {
        let global = &ctx.accounts.global;
        let proposal = &mut ctx.accounts.proposal;
        let clock = Clock::get()?;

        require_keys_eq!(ctx.accounts.owl_mint.key(), global.owl_mint, GovernanceError::BadMint);
        require!(
            clock.unix_timestamp >= proposal.voting_start && clock.unix_timestamp < proposal.voting_end,
            GovernanceError::VotingClosed
        );

        let user_stake = &ctx.accounts.user_stake;
        require_keys_eq!(user_stake.owner, ctx.accounts.voter.key(), GovernanceError::BadStakeOwner);

        let weight_u128 = u128::from(user_stake.amount)
            .checked_mul(u128::from(global.vote_stake_weight_bps))
            .and_then(|v| v.checked_div(10_000))
            .ok_or(GovernanceError::WeightOverflow)?;
        require!(weight_u128 > 0, GovernanceError::ZeroVoteWeightAccount);

        match side {
            VoteSide::Yes => {
                proposal.yes_weight = proposal
                    .yes_weight
                    .checked_add(weight_u128)
                    .ok_or(GovernanceError::WeightOverflow)?;
            }
            VoteSide::No => {
                proposal.no_weight = proposal
                    .no_weight
                    .checked_add(weight_u128)
                    .ok_or(GovernanceError::WeightOverflow)?;
            }
        }

        let receipt = &mut ctx.accounts.vote_receipt;
        receipt.bump = ctx.bumps.vote_receipt;
        receipt.proposal = proposal.key();
        receipt.voter = ctx.accounts.voter.key();
        receipt.side = side as u8;
        receipt.weight = weight_u128;

        emit!(VoteCast {
            proposal: proposal.key(),
            voter: receipt.voter,
            side: receipt.side,
            weight: weight_u128,
        });
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum VoteSide {
    Yes = 0,
    No = 1,
}

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub authority: Pubkey,
    pub owl_mint: Pubkey,
    pub vault: Pubkey,
    pub bump: u8,
    pub proposal_count: u64,
    pub min_voting_secs: i64,
    pub max_voting_secs: i64,
    pub min_stake_to_propose: u64,
    pub vote_stake_weight_bps: u64,
}

#[account]
#[derive(InitSpace)]
pub struct UserStake {
    pub bump: u8,
    pub owner: Pubkey,
    pub amount: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Pubkey,
    pub voting_start: i64,
    pub voting_end: i64,
    #[max_len(200)]
    pub title: String,
    pub yes_weight: u128,
    pub no_weight: u128,
    pub bump: u8,
}

impl Proposal {
    pub const TITLE_MAX: usize = 200;
}

#[account]
#[derive(InitSpace)]
pub struct VoteReceipt {
    pub bump: u8,
    pub proposal: Pubkey,
    pub voter: Pubkey,
    pub side: u8,
    pub weight: u128,
}

#[event]
pub struct ProposalCreated {
    pub proposal_id: u64,
    pub proposer: Pubkey,
    pub voting_start: i64,
    pub voting_end: i64,
    pub title: String,
}

#[event]
pub struct VoteCast {
    pub proposal: Pubkey,
    pub voter: Pubkey,
    pub side: u8,
    pub weight: u128,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + GlobalConfig::INIT_SPACE,
        seeds = [b"global"],
        bump
    )]
    pub global: Account<'info, GlobalConfig>,
    pub owl_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        token::mint = owl_mint,
        token::authority = global,
        seeds = [b"vault", global.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"global"],
        bump = global.bump
    )]
    pub global: Account<'info, GlobalConfig>,
    pub owl_mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", global.key().as_ref()],
        bump,
        constraint = vault.key() == global.vault @ GovernanceError::BadVault
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_owl_ata.owner == user.key() @ GovernanceError::BadAtaOwner,
        constraint = user_owl_ata.mint == owl_mint.key() @ GovernanceError::BadMint
    )]
    pub user_owl_ata: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserStake::INIT_SPACE,
        seeds = [b"stake", user.key().as_ref()],
        bump
    )]
    pub user_stake: Account<'info, UserStake>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"global"],
        bump = global.bump
    )]
    pub global: Account<'info, GlobalConfig>,
    pub owl_mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", global.key().as_ref()],
        bump,
        constraint = vault.key() == global.vault @ GovernanceError::BadVault
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_owl_ata.owner == user.key() @ GovernanceError::BadAtaOwner,
        constraint = user_owl_ata.mint == owl_mint.key() @ GovernanceError::BadMint
    )]
    pub user_owl_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"stake", user.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == user.key() @ GovernanceError::BadStakeOwner
    )]
    pub user_stake: Account<'info, UserStake>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(title: String, voting_duration_secs: i64)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"global"],
        bump = global.bump
    )]
    pub global: Account<'info, GlobalConfig>,
    pub owl_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"stake", proposer.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == proposer.key() @ GovernanceError::BadStakeOwner
    )]
    pub user_stake: Account<'info, UserStake>,
    #[account(
        init,
        payer = proposer,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [b"proposal", global.key().as_ref(), &global.proposal_count.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    #[account(
        seeds = [b"global"],
        bump = global.bump
    )]
    pub global: Account<'info, GlobalConfig>,
    pub owl_mint: Account<'info, Mint>,
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(
        seeds = [b"stake", voter.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == voter.key() @ GovernanceError::BadStakeOwner
    )]
    pub user_stake: Account<'info, UserStake>,
    #[account(
        init,
        payer = voter,
        space = 8 + VoteReceipt::INIT_SPACE,
        seeds = [b"vote", proposal.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote_receipt: Account<'info, VoteReceipt>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum GovernanceError {
    #[msg("Amount must be > 0")]
    ZeroAmount,
    #[msg("Stake amount overflow/underflow")]
    AmountOverflow,
    #[msg("Not enough staked OWL")]
    InsufficientStake,
    #[msg("Voting duration must be between min (48h) and max (7d)")]
    InvalidVotingDuration,
    #[msg("Title exceeds max length")]
    TitleTooLong,
    #[msg("Not enough staked OWL to create a proposal")]
    InsufficientStakeToPropose,
    #[msg("OWL mint does not match global config")]
    BadMint,
    #[msg("Vault does not match global config")]
    BadVault,
    #[msg("Token account owner mismatch")]
    BadAtaOwner,
    #[msg("Stake account owner mismatch")]
    BadStakeOwner,
    #[msg("Voting is not open for this proposal")]
    VotingClosed,
    #[msg("Vote weight multiplier must be > 0")]
    ZeroVoteWeight,
    #[msg("Computed vote weight is zero (need stake)")]
    ZeroVoteWeightAccount,
    #[msg("Vote weight overflow")]
    WeightOverflow,
    #[msg("Timestamp overflow")]
    TimestampOverflow,
}
