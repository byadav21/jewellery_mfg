#!/usr/bin/env python3
"""
Multi-Account Token Refresh Scheduler
Manages token refresh for all marketplace accounts (Amazon CSP, Amazon GEMHUB, eBay accounts)
Runs token refresh every 3500 seconds (~58 minutes) for each account.

Usage:
  python token_refresh_scheduler.py              # Run all account refreshes in a loop
  python token_refresh_scheduler.py --once       # Run once for all accounts
  python token_refresh_scheduler.py --csp        # Run only CSP Amazon
  python token_refresh_scheduler.py --gemhub     # Run only GEMHUB Amazon
"""

import os
import sys
import time
import threading
import requests
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv, set_key

# Load environment variables from .env file
ENV_FILE = Path(__file__).parent / '.env'
load_dotenv(ENV_FILE)

# Token refresh interval (in seconds)
REFRESH_INTERVAL = 3500  # ~58 minutes (tokens expire in 3600 seconds / 1 hour)

# Account configurations
AMAZON_ACCOUNTS = [
    {
        'name': 'CSP',
        'prefix': 'CSP_AMAZON',
        'enabled': True
    },
    {
        'name': 'GEMHUB',
        'prefix': 'GEMHUB_AMAZON',
        'enabled': True
    }
]

EBAY_ACCOUNTS = [
    {
        'name': 'CSP',
        'prefix': 'CSP_EBAY',
        'enabled': False  # Enable when credentials are available
    },
    {
        'name': 'GEMHUB',
        'prefix': 'GEMHUB_EBAY',
        'enabled': False  # Enable when credentials are available
    }
]

def log(account_name, message, level='INFO'):
    """Log a message with timestamp and account name"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] [{level}] [{account_name}] {message}")

def get_amazon_credentials(prefix):
    """Get Amazon credentials from environment variables"""
    client_id = os.getenv(f'{prefix}_CLIENT_ID')
    client_secret = os.getenv(f'{prefix}_CLIENT_SECRET')
    refresh_token = os.getenv(f'{prefix}_REFRESH_TOKEN')

    if not all([client_id, client_secret, refresh_token]):
        return None

    return {
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': refresh_token
    }

def refresh_amazon_token(account):
    """Refresh Amazon LWA access token for a specific account"""
    name = account['name']
    prefix = account['prefix']

    creds = get_amazon_credentials(prefix)
    if not creds:
        log(name, f"Skipping - credentials not configured in .env ({prefix}_*)", 'WARN')
        return False

    url = "https://api.amazon.com/auth/o2/token"
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": creds['refresh_token'],
        "client_id": creds['client_id'],
        "client_secret": creds['client_secret'],
    }

    log(name, "Requesting new Amazon access token...")

    try:
        response = requests.post(url, data=payload, timeout=30)
        response.raise_for_status()

        data = response.json()
        access_token = data.get("access_token")
        expires_in = data.get("expires_in", 3600)

        if not access_token:
            raise RuntimeError("No access_token in response")

        # Save the new access token to .env file
        env_key = f'{prefix}_ACCESS_TOKEN'
        set_key(str(ENV_FILE), env_key, access_token)
        os.environ[env_key] = access_token

        log(name, f"✅ Token refreshed successfully (expires in {expires_in}s)")
        log(name, f"   Saved to: {env_key}")
        return True

    except requests.exceptions.RequestException as e:
        log(name, f"❌ HTTP Error: {e}", 'ERROR')
        if hasattr(e, 'response') and e.response is not None:
            log(name, f"   Response: {e.response.text}", 'ERROR')
        return False
    except Exception as e:
        log(name, f"❌ Error: {e}", 'ERROR')
        return False

def get_ebay_credentials(prefix):
    """Get eBay credentials from environment variables"""
    app_id = os.getenv(f'{prefix}_APP_ID')
    cert_id = os.getenv(f'{prefix}_CERT_ID')
    refresh_token = os.getenv(f'{prefix}_REFRESH_TOKEN')

    if not all([app_id, cert_id, refresh_token]):
        return None

    return {
        'app_id': app_id,
        'cert_id': cert_id,
        'refresh_token': refresh_token
    }

def refresh_ebay_token(account):
    """Refresh eBay OAuth token for a specific account"""
    name = account['name']
    prefix = account['prefix']

    creds = get_ebay_credentials(prefix)
    if not creds:
        log(name, f"Skipping eBay - credentials not configured ({prefix}_*)", 'WARN')
        return False

    # eBay OAuth token refresh endpoint
    # Note: This is a placeholder - implement actual eBay refresh logic
    log(name, "eBay token refresh not yet implemented", 'WARN')
    return False

def refresh_all_tokens():
    """Refresh tokens for all configured accounts"""
    results = {'success': 0, 'failed': 0, 'skipped': 0}

    print("\n" + "=" * 60)
    print("TOKEN REFRESH - ALL ACCOUNTS")
    print("=" * 60)

    # Refresh Amazon accounts
    for account in AMAZON_ACCOUNTS:
        if not account['enabled']:
            log(account['name'], "Amazon account disabled", 'INFO')
            results['skipped'] += 1
            continue

        if refresh_amazon_token(account):
            results['success'] += 1
        else:
            results['failed'] += 1

    # Refresh eBay accounts
    for account in EBAY_ACCOUNTS:
        if not account['enabled']:
            log(account['name'], "eBay account disabled", 'INFO')
            results['skipped'] += 1
            continue

        if refresh_ebay_token(account):
            results['success'] += 1
        else:
            results['failed'] += 1

    print("=" * 60)
    print(f"Results: {results['success']} success, {results['failed']} failed, {results['skipped']} skipped")
    print("=" * 60 + "\n")

    return results

def run_once():
    """Run token refresh once for all accounts"""
    print("=" * 60)
    print("MARKETPLACE TOKEN REFRESH SERVICE (Single Run)")
    print("=" * 60)

    results = refresh_all_tokens()
    return results['failed'] == 0

def run_loop():
    """Run token refresh in a continuous loop"""
    print("=" * 60)
    print("MARKETPLACE TOKEN REFRESH SERVICE")
    print("=" * 60)
    print(f"Refresh interval: {REFRESH_INTERVAL} seconds (~{REFRESH_INTERVAL//60} minutes)")
    print(f"Amazon accounts: {len([a for a in AMAZON_ACCOUNTS if a['enabled']])} enabled")
    print(f"eBay accounts: {len([a for a in EBAY_ACCOUNTS if a['enabled']])} enabled")
    print("Press Ctrl+C to stop")
    print("=" * 60)

    while True:
        try:
            refresh_all_tokens()
            print(f"⏳ Next refresh in {REFRESH_INTERVAL} seconds ({REFRESH_INTERVAL//60} minutes)...\n")
            time.sleep(REFRESH_INTERVAL)
        except KeyboardInterrupt:
            print("\n\n🛑 Token refresh service stopped by user")
            break
        except Exception as e:
            print(f"\n⚠️ Error occurred, retrying in 60 seconds: {e}")
            time.sleep(60)

def run_single_account(account_name):
    """Run token refresh for a single account"""
    account_name = account_name.upper()

    # Find the account
    for account in AMAZON_ACCOUNTS:
        if account['name'] == account_name:
            print(f"Refreshing {account_name} Amazon token...")
            if refresh_amazon_token(account):
                print(f"✅ {account_name} Amazon token refresh completed")
                return True
            else:
                print(f"❌ {account_name} Amazon token refresh failed")
                return False

    print(f"❌ Account '{account_name}' not found")
    return False

def main():
    """Main entry point"""
    if len(sys.argv) > 1:
        arg = sys.argv[1].lower()

        if arg == '--once':
            success = run_once()
            sys.exit(0 if success else 1)
        elif arg == '--csp':
            success = run_single_account('CSP')
            sys.exit(0 if success else 1)
        elif arg == '--gemhub':
            success = run_single_account('GEMHUB')
            sys.exit(0 if success else 1)
        elif arg == '--help':
            print(__doc__)
            sys.exit(0)
        else:
            print(f"Unknown argument: {arg}")
            print("Use --help for usage information")
            sys.exit(1)
    else:
        run_loop()

if __name__ == "__main__":
    main()
