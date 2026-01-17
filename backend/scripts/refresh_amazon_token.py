#!/usr/bin/env python3
"""
Amazon SP-API Token Refresher
Runs periodically to refresh the LWA access token and update the .env file.
Also logs all token operations for auditing.
"""

import os
import sys
import json
import requests
from datetime import datetime, timezone
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent
BACKEND_DIR = SCRIPT_DIR.parent
ENV_FILE = BACKEND_DIR / '.env'
LOG_FILE = BACKEND_DIR / 'logs' / 'token_refresh.log'

# Ensure logs directory exists
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

def log_message(message, level="INFO"):
    """Log message to file and stderr"""
    timestamp = datetime.now(timezone.utc).isoformat()
    log_entry = f"[{timestamp}] [{level}] {message}"
    print(log_entry, file=sys.stderr)

    try:
        with open(LOG_FILE, 'a') as f:
            f.write(log_entry + '\n')
    except Exception as e:
        print(f"Failed to write to log file: {e}", file=sys.stderr)

def read_env_file():
    """Read current .env file contents"""
    if not ENV_FILE.exists():
        raise FileNotFoundError(f".env file not found at {ENV_FILE}")

    with open(ENV_FILE, 'r') as f:
        return f.read()

def write_env_file(content):
    """Write updated content to .env file"""
    with open(ENV_FILE, 'w') as f:
        f.write(content)

def get_env_value(content, key):
    """Extract value for a key from .env content"""
    for line in content.split('\n'):
        line = line.strip()
        if line.startswith(f'{key}='):
            value = line[len(key)+1:]
            # Remove quotes if present
            if (value.startswith('"') and value.endswith('"')) or \
               (value.startswith("'") and value.endswith("'")):
                value = value[1:-1]
            return value
    return None

def update_env_value(content, key, new_value):
    """Update a value in .env content"""
    lines = content.split('\n')
    updated = False

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(f'{key}='):
            lines[i] = f'{key}={new_value}'
            updated = True
            break

    if not updated:
        # Add the key if it doesn't exist
        lines.append(f'{key}={new_value}')

    return '\n'.join(lines)

def refresh_token(client_id, client_secret, refresh_token):
    """Get new LWA access token using refresh token"""
    url = "https://api.amazon.com/auth/o2/token"
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
    }

    response = requests.post(url, data=payload, timeout=30)
    response.raise_for_status()

    data = response.json()
    return {
        "access_token": data["access_token"],
        "expires_in": data.get("expires_in", 3600),
        "token_type": data.get("token_type", "bearer")
    }

def test_api_connection(access_token, marketplace_id="ATVPDKIKX0DER"):
    """Test if the access token works with SP-API"""
    url = "https://sellingpartnerapi-na.amazon.com/orders/v0/orders"
    headers = {
        "x-amz-access-token": access_token,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    params = {
        "MarketplaceIds": marketplace_id,
        "CreatedAfter": "2025-01-01T00:00:00Z",
        "MaxResultsPerPage": 1,
    }

    response = requests.get(url, headers=headers, params=params, timeout=30)
    return response.status_code == 200, response.status_code, response.text[:200] if response.text else ""

def main():
    """Main token refresh logic"""
    result = {
        "success": False,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "message": "",
        "accounts": []
    }

    try:
        log_message("Starting Amazon token refresh...")

        # Read current .env
        env_content = read_env_file()

        # Process CSP account
        account_code = "CSP"
        prefix = f"{account_code}_AMAZON"

        client_id = get_env_value(env_content, f"{prefix}_CLIENT_ID")
        client_secret = get_env_value(env_content, f"{prefix}_CLIENT_SECRET")
        refresh_token_value = get_env_value(env_content, f"{prefix}_REFRESH_TOKEN")
        marketplace_id = get_env_value(env_content, f"{prefix}_MARKETPLACE_ID") or "ATVPDKIKX0DER"

        if not all([client_id, client_secret, refresh_token_value]):
            log_message(f"[{account_code}] Missing credentials, skipping", "WARN")
            result["accounts"].append({
                "accountCode": account_code,
                "success": False,
                "message": "Missing credentials"
            })
        else:
            log_message(f"[{account_code}] Refreshing access token...")

            try:
                # Get new access token
                token_data = refresh_token(client_id, client_secret, refresh_token_value)
                new_access_token = token_data["access_token"]
                expires_in = token_data["expires_in"]

                log_message(f"[{account_code}] Access token obtained (expires in {expires_in}s)")

                # Test the token
                api_ok, status_code, response_text = test_api_connection(new_access_token, marketplace_id)

                if api_ok:
                    log_message(f"[{account_code}] API connection test PASSED")

                    # Update .env with new access token
                    env_content = update_env_value(env_content, f"{prefix}_ACCESS_TOKEN", new_access_token)

                    # Add timestamp for tracking
                    env_content = update_env_value(env_content, f"{prefix}_TOKEN_REFRESHED_AT",
                                                   datetime.now(timezone.utc).isoformat())

                    result["accounts"].append({
                        "accountCode": account_code,
                        "success": True,
                        "message": f"Token refreshed successfully, expires in {expires_in}s",
                        "expiresIn": expires_in
                    })
                else:
                    log_message(f"[{account_code}] API test FAILED: HTTP {status_code}", "ERROR")
                    log_message(f"[{account_code}] Response: {response_text}", "ERROR")

                    result["accounts"].append({
                        "accountCode": account_code,
                        "success": False,
                        "message": f"API test failed with HTTP {status_code}",
                        "statusCode": status_code
                    })

            except requests.exceptions.HTTPError as e:
                log_message(f"[{account_code}] Token refresh HTTP error: {e}", "ERROR")
                result["accounts"].append({
                    "accountCode": account_code,
                    "success": False,
                    "message": f"HTTP error: {str(e)}"
                })
            except Exception as e:
                log_message(f"[{account_code}] Token refresh error: {e}", "ERROR")
                result["accounts"].append({
                    "accountCode": account_code,
                    "success": False,
                    "message": str(e)
                })

        # Write updated .env file
        write_env_file(env_content)
        log_message("Updated .env file with new tokens")

        # Check overall success
        successful_accounts = [a for a in result["accounts"] if a["success"]]
        result["success"] = len(successful_accounts) > 0
        result["message"] = f"Refreshed {len(successful_accounts)}/{len(result['accounts'])} accounts"

        log_message(f"Token refresh complete: {result['message']}")

    except Exception as e:
        log_message(f"Token refresh failed: {e}", "ERROR")
        result["message"] = str(e)

    # Output JSON result
    print(json.dumps(result, indent=2))

    return 0 if result["success"] else 1

if __name__ == "__main__":
    sys.exit(main())
