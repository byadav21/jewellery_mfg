#!/usr/bin/env python3
"""
CSP Amazon Token Refresh Script
Refreshes Amazon SP-API access token for CSP account every 3500 seconds (~58 minutes)
Access tokens expire in 3600 seconds (1 hour), so we refresh before expiry.

Usage:
  python csp_amazon_token.py          # Run once
  python csp_amazon_token.py --loop   # Run continuously every 3500 seconds
"""

import os
import sys
import time
import requests
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv, set_key

# Account identifier
ACCOUNT_NAME = "CSP"
ACCOUNT_PREFIX = "CSP_AMAZON"

# Load environment variables from .env file
ENV_FILE = Path(__file__).parent / '.env'
load_dotenv(ENV_FILE)

# Token refresh interval (in seconds)
REFRESH_INTERVAL = 3500  # ~58 minutes (tokens expire in 3600 seconds / 1 hour)

def get_credentials():
    """Get credentials from environment variables"""
    client_id = os.getenv(f'{ACCOUNT_PREFIX}_CLIENT_ID')
    client_secret = os.getenv(f'{ACCOUNT_PREFIX}_CLIENT_SECRET')
    refresh_token = os.getenv(f'{ACCOUNT_PREFIX}_REFRESH_TOKEN')

    if not all([client_id, client_secret, refresh_token]):
        raise RuntimeError(f"Missing {ACCOUNT_NAME} Amazon credentials in .env file")

    return {
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': refresh_token
    }

def refresh_access_token():
    """
    Refresh the Amazon LWA access token using the refresh token.
    Access tokens expire after 1 hour (3600 seconds).
    """
    creds = get_credentials()

    url = "https://api.amazon.com/auth/o2/token"
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": creds['refresh_token'],
        "client_id": creds['client_id'],
        "client_secret": creds['client_secret'],
    }

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] [{ACCOUNT_NAME}] Requesting new access token...")

    try:
        response = requests.post(url, data=payload, timeout=30)
        response.raise_for_status()

        data = response.json()
        access_token = data.get("access_token")
        expires_in = data.get("expires_in", 3600)

        if not access_token:
            raise RuntimeError("No access_token in response")

        # Save the new access token to .env file
        save_access_token(access_token)

        print(f"[{timestamp}] [{ACCOUNT_NAME}] ✅ Access token refreshed successfully")
        print(f"[{timestamp}] [{ACCOUNT_NAME}]    Token expires in: {expires_in} seconds")
        print(f"[{timestamp}] [{ACCOUNT_NAME}]    Token preview: {access_token[:40]}...")

        return access_token, expires_in

    except requests.exceptions.RequestException as e:
        print(f"[{timestamp}] [{ACCOUNT_NAME}] ❌ HTTP Error: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"[{timestamp}] [{ACCOUNT_NAME}]    Response: {e.response.text}")
        raise
    except Exception as e:
        print(f"[{timestamp}] [{ACCOUNT_NAME}] ❌ Error: {e}")
        raise

def save_access_token(access_token):
    """Save the access token to the .env file"""
    env_key = f'{ACCOUNT_PREFIX}_ACCESS_TOKEN'

    # Use dotenv's set_key to update the .env file
    set_key(str(ENV_FILE), env_key, access_token)

    # Also update the current environment
    os.environ[env_key] = access_token

    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [{ACCOUNT_NAME}]    Saved to .env: {env_key}")

def run_once():
    """Run the token refresh once"""
    try:
        access_token, expires_in = refresh_access_token()
        print(f"\n✅ {ACCOUNT_NAME} Amazon SP-API token refresh completed successfully")
        return True
    except Exception as e:
        print(f"\n❌ {ACCOUNT_NAME} Amazon SP-API token refresh FAILED: {e}")
        return False

def run_loop():
    """Run the token refresh in a continuous loop"""
    print(f"=" * 60)
    print(f"{ACCOUNT_NAME} Amazon Token Refresh Service")
    print(f"=" * 60)
    print(f"Refresh interval: {REFRESH_INTERVAL} seconds (~{REFRESH_INTERVAL//60} minutes)")
    print(f"Press Ctrl+C to stop")
    print(f"=" * 60)

    while True:
        try:
            refresh_access_token()
            print(f"\n⏳ Next refresh in {REFRESH_INTERVAL} seconds ({REFRESH_INTERVAL//60} minutes)...\n")
            time.sleep(REFRESH_INTERVAL)
        except KeyboardInterrupt:
            print(f"\n\n🛑 {ACCOUNT_NAME} Token refresh service stopped by user")
            break
        except Exception as e:
            print(f"\n⚠️ Error occurred, retrying in 60 seconds: {e}")
            time.sleep(60)  # Wait 1 minute before retrying on error

def main():
    """Main entry point"""
    if len(sys.argv) > 1 and sys.argv[1] == '--loop':
        run_loop()
    else:
        success = run_once()
        sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
