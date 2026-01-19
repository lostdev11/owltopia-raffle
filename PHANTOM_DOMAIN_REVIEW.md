# Phantom Wallet Domain Review Guide

## Issue
Phantom wallet on Android is showing a "This dApp could be malicious" security warning when users try to connect to **owltopia.xyz**.

## Solution Steps

### 1. Register Your App in Phantom Developer Portal (Recommended - Do This First)

1. Visit [Phantom Developer Portal - Edit App Info](https://docs.phantom.com/phantom-portal/edit-app-info)
2. Add your domain: **owltopia.xyz**
3. Complete DNS TXT verification to confirm domain ownership
4. Fill out app details:
   - App name: Owl Raffle
   - Description: Trusted raffles with full transparency. Every entry verified on-chain.
   - Social links: https://x.com/Owltopia_sol
   - Icon: https://owltopia.xyz/icon.png
   - Other relevant information

This helps establish legitimacy and can resolve warnings automatically within a few days.

### 2. Contact Phantom Domain Review Team

If the warning persists after ~1 week:

**Email**: review@phantom.com

**Include in your email:**
- Domain: owltopia.xyz
- Project description: Owl Raffle - A transparent raffle platform on Solana
- What the app does: Users can create and enter raffles with full on-chain verification
- GitHub link (if available): [Your repo URL]
- Social presence: https://x.com/Owltopia_sol
- Team information
- Any audits or security reviews

**Subject line example**: "Domain Review Request: owltopia.xyz - Owl Raffle Platform"

### 3. Alternative: Submit Pull Request to Phantom Blocklist Repo

If your domain is mistakenly flagged:

1. Visit [Phantom Blocklist Repository](https://github.com/phantom/blocklist)
2. Check if `owltopia.xyz` appears in `blocklist.yaml`
3. If it does (and it's a false positive), submit a PR to remove it or add it to `whitelist.yaml`
4. Explain clearly why it should be whitelisted in the PR description

### 4. Contact Blowfish (Fast Option - 24-48 hours)

Phantom uses Blowfish for security/reputation. You can also contact Blowfish directly for whitelisting:

- Check if there's a Blowfish approval form or contact method
- Mention that you're using the domain with Phantom wallet
- Provide the same information as above

## Timeframes

- **Automatic review**: New domains are often reviewed automatically within a few days
- **Manual review**: 1-2 weeks typically
- **Blowfish whitelisting**: 24-48 hours (if available)

## For Users (Temporary Workaround)

While waiting for review, users can:
- Click "Proceed anyway (unsafe)" if they trust the dApp (not recommended for general users)
- Use alternative wallets (Solflare, Coinbase Wallet, etc.) - already configured in your app

## Technical Notes

Your app configuration has been updated:
- ✅ App identity uses correct domain: `owltopia.xyz`
- ✅ Icon is available at: `/icon.png`
- ✅ Mobile Wallet Adapter is properly configured
- ✅ Multiple wallet options available (Phantom, Solflare, Coinbase, Trust)

## Next Steps

1. **Immediately**: Register in Phantom Developer Portal and complete DNS verification
2. **Within 1 week**: If warning persists, send email to review@phantom.com
3. **Monitor**: Check Phantom's blocklist repo periodically

## Links

- Phantom Developer Portal: https://docs.phantom.com/phantom-portal/edit-app-info
- Phantom Blocklist Repo: https://github.com/phantom/blocklist
- Phantom Review Email: review@phantom.com
