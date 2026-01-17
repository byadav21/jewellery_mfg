import os
import json
import requests
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Any, Optional
from dotenv import load_dotenv

# ==============================
# Config / Environment
# ==============================

load_dotenv()

# Using CSP Amazon account credentials from .env
CLIENT_ID = os.getenv("CSP_AMAZON_CLIENT_ID") or os.getenv("AMAZON_CLIENT_ID")
CLIENT_SECRET = os.getenv("CSP_AMAZON_CLIENT_SECRET") or os.getenv("AMAZON_CLIENT_SECRET")
REFRESH_TOKEN = os.getenv("CSP_AMAZON_REFRESH_TOKEN") or os.getenv("AMAZON_REFRESH_TOKEN")
MARKETPLACE_ID = os.getenv("CSP_AMAZON_MARKETPLACE_ID", "ATVPDKIKX0DER")  # US marketplace

# SP-API Endpoint (NA = North America)
BASE_URL = os.getenv(
    "SP_API_ENDPOINT",
    "https://sellingpartnerapi-na.amazon.com",
).rstrip("/")


# ==============================
# LWA Token Manager
# ==============================

class LWATokenManager:
    """
    Simple in-memory token manager.
    Caches the current access token and expiry time.
    Automatically refreshes token when missing or about to expire.
    """

    def __init__(self, client_id: str, client_secret: str, refresh_token: str):
        if not (client_id and client_secret and refresh_token):
            raise RuntimeError(
                "CLIENT_ID, CLIENT_SECRET, and REFRESH_TOKEN must be set in .env"
            )
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token

        self._access_token: Optional[str] = None
        self._expires_at: Optional[datetime] = None

    def _fetch_new_token(self) -> None:
        """Request a new LWA access token from Amazon."""
        token_url = "https://api.amazon.com/auth/o2/token"
        payload = {
            "grant_type": "refresh_token",
            "refresh_token": self.refresh_token,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }

        print("Requesting NEW LWA access token...")
        resp = requests.post(token_url, data=payload, timeout=30)
        try:
            resp.raise_for_status()
        except Exception as e:
            print("❌ Failed to get LWA token. Response:")
            print(resp.text)
            raise e

        data = resp.json()
        access_token = data["access_token"]
        expires_in = int(data.get("expires_in", 3600))

        now_utc = datetime.now(timezone.utc)
        self._access_token = access_token
        self._expires_at = now_utc + timedelta(seconds=expires_in)

        print("✅ New LWA token acquired.")
        print(f"   Expires in {expires_in} seconds at {self._expires_at.isoformat()}.")

    def get_valid_access_token(self) -> str:
        """
        Return a valid LWA access token.
        Refreshes the token if missing or will expire in < 5 minutes.
        """
        now_utc = datetime.now(timezone.utc)
        if self._access_token and self._expires_at:
            if self._expires_at - now_utc > timedelta(minutes=5):
                return self._access_token

        self._fetch_new_token()
        return self._access_token


token_manager = LWATokenManager(CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN)


# ==============================
# SP-API Helper Functions
# ==============================

def sp_api_get(path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Generic helper for GET calls to SP-API.
    Ensures we always send a valid LWA token.
    """
    access_token = token_manager.get_valid_access_token()
    headers = {
        "x-amz-access-token": access_token,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    url = f"{BASE_URL}{path}"

    resp = requests.get(url, headers=headers, params=params, timeout=30)

    if resp.status_code >= 400:
        print("\n❌ Error from SP-API:")
        print("URL:", resp.url)
        print("Status:", resp.status_code)
        print("Body:", resp.text)
        resp.raise_for_status()

    try:
        return resp.json() or {}
    except json.JSONDecodeError:
        return {}


# ==============================
# Fetch All Orders
# ==============================

def fetch_all_orders(
    days_back: int = 30,
    order_statuses: Optional[List[str]] = None,
    fulfillment_channels: Optional[List[str]] = None,
    max_results_per_page: int = 100,
) -> List[Dict[str, Any]]:
    """
    Fetch all orders from the seller account with pagination support.

    Args:
        days_back: Number of days to look back for orders (default: 30)
        order_statuses: List of order statuses to filter. Options:
            - PendingAvailability
            - Pending
            - Unshipped
            - PartiallyShipped
            - Shipped
            - InvoiceUnconfirmed
            - Canceled
            - Unfulfillable
            If None, fetches all statuses.
        fulfillment_channels: List of fulfillment channels to filter. Options:
            - MFN (Merchant Fulfilled Network)
            - AFN (Amazon Fulfilled Network / FBA)
            If None, fetches both.
        max_results_per_page: Number of results per API call (max 100)

    Returns:
        List of order dictionaries
    """
    if not MARKETPLACE_ID:
        raise RuntimeError(
            "MARKETPLACE_ID is not set in .env "
            "(e.g. A21TJRUUN4KGV for Amazon.in, ATVPDKIKX0DER for Amazon.com)"
        )

    created_after_dt = datetime.now(timezone.utc) - timedelta(days=days_back)
    created_after = created_after_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    print(f"\n📦 Fetching orders since {created_after}")
    print(f"   Marketplace: {MARKETPLACE_ID}")
    if order_statuses:
        print(f"   Order Statuses: {', '.join(order_statuses)}")
    if fulfillment_channels:
        print(f"   Fulfillment Channels: {', '.join(fulfillment_channels)}")

    params: Dict[str, Any] = {
        "MarketplaceIds": MARKETPLACE_ID,
        "CreatedAfter": created_after,
        "MaxResultsPerPage": max_results_per_page,
    }

    if order_statuses:
        params["OrderStatuses"] = ",".join(order_statuses)

    if fulfillment_channels:
        params["FulfillmentChannels"] = ",".join(fulfillment_channels)

    all_orders: List[Dict[str, Any]] = []
    path = "/orders/v0/orders"
    page_count = 0

    while True:
        page_count += 1
        print(f"\n   Fetching page {page_count}...")

        data = sp_api_get(path, params=params)
        payload = data.get("payload", {})
        orders = payload.get("Orders", [])

        print(f"   Retrieved {len(orders)} orders in this page.")
        all_orders.extend(orders)

        next_token = payload.get("NextToken")
        if not next_token:
            break

        print("   NextToken found, requesting next page...")
        params = {"NextToken": next_token}

    print(f"\n✅ Total orders fetched: {len(all_orders)}")
    return all_orders


def fetch_order_items(order_id: str) -> List[Dict[str, Any]]:
    """Fetch all items for a given order, handling pagination."""
    path = f"/orders/v0/orders/{order_id}/orderItems"
    params: Dict[str, Any] = {"MaxResultsPerPage": 100}

    all_items: List[Dict[str, Any]] = []

    while True:
        data = sp_api_get(path, params=params)
        payload = data.get("payload", {})
        items = payload.get("OrderItems", [])
        all_items.extend(items)

        next_token = payload.get("NextToken")
        if not next_token:
            break

        params = {"NextToken": next_token}

    return all_items


def fetch_order_by_id(order_id: str) -> Dict[str, Any]:
    """Fetch a single order by its Amazon Order ID."""
    path = f"/orders/v0/orders/{order_id}"
    data = sp_api_get(path)
    return data.get("payload", {})


def fetch_order_address(order_id: str) -> Dict[str, Any]:
    """Fetch shipping address for an order (requires PII permission)."""
    path = f"/orders/v0/orders/{order_id}/address"
    data = sp_api_get(path)
    return data.get("payload", {}).get("ShippingAddress", {})


def fetch_order_buyer_info(order_id: str) -> Dict[str, Any]:
    """Fetch buyer info for an order (requires PII permission)."""
    path = f"/orders/v0/orders/{order_id}/buyerInfo"
    data = sp_api_get(path)
    return data.get("payload", {})


# ==============================
# Export Functions
# ==============================

def export_orders_to_json(orders: List[Dict[str, Any]], filename: str = "all_orders.json") -> str:
    """Export orders to JSON file."""
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(orders, f, indent=2, default=str)
    print(f"✅ Orders exported to: {os.path.abspath(filename)}")
    return os.path.abspath(filename)


def print_order_summary(orders: List[Dict[str, Any]]) -> None:
    """Print a summary of fetched orders."""
    if not orders:
        print("\n📋 No orders found.")
        return

    print(f"\n📋 Order Summary ({len(orders)} total orders):")
    print("-" * 60)

    # Count by status
    status_counts: Dict[str, int] = {}
    for order in orders:
        status = order.get("OrderStatus", "Unknown")
        status_counts[status] = status_counts.get(status, 0) + 1

    print("\nBy Status:")
    for status, count in sorted(status_counts.items()):
        print(f"   {status}: {count}")

    # Count by fulfillment channel
    channel_counts: Dict[str, int] = {}
    for order in orders:
        channel = order.get("FulfillmentChannel", "Unknown")
        channel_counts[channel] = channel_counts.get(channel, 0) + 1

    print("\nBy Fulfillment Channel:")
    for channel, count in sorted(channel_counts.items()):
        print(f"   {channel}: {count}")

    # Show first 10 orders
    print(f"\nFirst 10 Orders:")
    print("-" * 60)
    for i, order in enumerate(orders[:10], 1):
        order_id = order.get("AmazonOrderId", "N/A")
        status = order.get("OrderStatus", "N/A")
        purchase_date = order.get("PurchaseDate", "N/A")
        total = order.get("OrderTotal", {})
        amount = total.get("Amount", "N/A")
        currency = total.get("CurrencyCode", "")
        print(f"   {i}. {order_id} | {status} | {purchase_date[:10] if purchase_date != 'N/A' else 'N/A'} | {currency} {amount}")


# ==============================
# Main
# ==============================

if __name__ == "__main__":
    try:
        # Fetch all orders from the last 30 days (all statuses, all channels)
        orders = fetch_all_orders(
            days_back=30,
            order_statuses=None,  # All statuses
            fulfillment_channels=None,  # Both MFN and AFN
        )

        # Print summary
        print_order_summary(orders)

        # Export to JSON
        if orders:
            export_orders_to_json(orders, "all_orders.json")

            # Optionally fetch items for the first order as an example
            if orders:
                first_order_id = orders[0].get("AmazonOrderId")
                print(f"\n📦 Fetching items for first order: {first_order_id}")
                items = fetch_order_items(first_order_id)
                print(f"   Items in order: {len(items)}")
                for item in items:
                    print(f"   - {item.get('SellerSKU')} | {item.get('Title', 'N/A')[:50]}... | Qty: {item.get('QuantityOrdered')}")

        print("\n✅ Done!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        raise
