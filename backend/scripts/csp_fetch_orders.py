#!/usr/bin/env python3
"""
CSP Amazon Order Fetcher
Fetches orders from Amazon SP-API and outputs JSON for backend import.
Includes detailed logging for debugging sync issues.
Supports configurable settings via command line arguments.
"""

import os
import sys
import json
import argparse
import requests
from datetime import datetime, timedelta, timezone
from pathlib import Path
from dotenv import load_dotenv

# Load environment from backend/.env
ENV_FILE = Path(__file__).parent.parent / '.env'
load_dotenv(ENV_FILE)

# CSP Account credentials
CLIENT_ID = os.getenv("CSP_AMAZON_CLIENT_ID")
CLIENT_SECRET = os.getenv("CSP_AMAZON_CLIENT_SECRET")
REFRESH_TOKEN = os.getenv("CSP_AMAZON_REFRESH_TOKEN")
MARKETPLACE_ID = os.getenv("CSP_AMAZON_MARKETPLACE_ID", "ATVPDKIKX0DER")
BASE_URL = "https://sellingpartnerapi-na.amazon.com"
ACCOUNT_CODE = "CSP"

# Default settings (can be overridden by command line args)
DEFAULT_DAYS_BACK = int(os.getenv("AMAZON_SYNC_DAYS_BACK", "7"))
DEFAULT_MAX_RESULTS_PER_PAGE = int(os.getenv("AMAZON_MAX_RESULTS_PER_PAGE", "100"))
DEFAULT_FETCH_ALL_PAGES = os.getenv("AMAZON_FETCH_ALL_PAGES", "false").lower() == "true"

# Log file for sync operations
LOG_FILE = Path(__file__).parent.parent / 'logs' / 'amazon_sync.log'

def log_message(message, level="INFO"):
    """Log message to file and stderr"""
    timestamp = datetime.now(timezone.utc).isoformat()
    log_entry = f"[{timestamp}] [{level}] {message}"
    print(log_entry, file=sys.stderr)

    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, 'a') as f:
            f.write(log_entry + '\n')
    except Exception as e:
        print(f"Failed to write log: {e}", file=sys.stderr)

def get_access_token():
    """Get LWA access token"""
    if not all([CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN]):
        raise RuntimeError("Missing CSP Amazon credentials in .env")

    log_message("Requesting LWA access token...")

    resp = requests.post(
        "https://api.amazon.com/auth/o2/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": REFRESH_TOKEN,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
        },
        timeout=30
    )

    if resp.status_code != 200:
        log_message(f"Token request failed: {resp.status_code} - {resp.text}", "ERROR")
        resp.raise_for_status()

    log_message("Access token obtained successfully")
    return resp.json()["access_token"]

def sp_api_get(path, params=None, access_token=None, max_retries=5):
    """Make SP-API GET request with retry logic for rate limiting"""
    import time

    headers = {
        "x-amz-access-token": access_token,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    log_message(f"API Request: GET {path}")
    # Only log params if not a NextToken request (to avoid huge logs)
    if params and "NextToken" not in params:
        log_message(f"Params: {json.dumps(params or {})}")

    for attempt in range(max_retries):
        resp = requests.get(f"{BASE_URL}{path}", headers=headers, params=params, timeout=60)

        if resp.status_code == 429:
            # Rate limited - wait and retry with longer backoff
            # Amazon SP-API recommends waiting at least 60 seconds for rate limits
            wait_time = min(30 * (attempt + 1), 120)  # 30, 60, 90, 120, 120 seconds
            log_message(f"Rate limited (429). Waiting {wait_time} seconds before retry {attempt + 1}/{max_retries}...", "WARNING")
            time.sleep(wait_time)
            continue

        if resp.status_code >= 400:
            log_message(f"API Error: {resp.status_code} - {resp.text[:500]}", "ERROR")
            resp.raise_for_status()

        return resp.json() or {}

    # If we exhausted retries, raise the last error
    log_message(f"Max retries ({max_retries}) exceeded for rate limiting", "ERROR")
    resp.raise_for_status()
    return {}

def fetch_all_orders(access_token, days_back, max_results_per_page, fetch_all_pages, include_all_statuses=True, import_all=False, start_date=None, end_date=None):
    """
    Fetch orders from Amazon SP-API

    Args:
        access_token: LWA access token
        days_back: Number of days to look back (if start_date not provided)
        max_results_per_page: Maximum results per API page (1-100)
        fetch_all_pages: If True, fetch all pages; if False, only first page
        include_all_statuses: If True, fetch all order statuses; if False, only pending/unshipped
        import_all: If True, return all fetched orders; if False, only MFN Pending
        start_date: ISO date string for CreatedAfter
        end_date: ISO date string for CreatedBefore
    """
    if start_date:
        created_after = start_date
        if not (created_after.endswith('Z') or '+' in created_after):
            created_after += 'T00:00:00Z'
    else:
        created_after = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%dT%H:%M:%SZ")

    created_before = None
    if end_date:
        created_before = end_date
        if not (created_before.endswith('Z') or '+' in created_before):
            created_before += 'T23:59:59Z'

    # Ensure max_results_per_page is within valid range
    max_results_per_page = max(1, min(100, max_results_per_page))

    log_message(f"=== Starting Order Fetch ===")
    log_message(f"Account: {ACCOUNT_CODE}")
    log_message(f"Marketplace: {MARKETPLACE_ID}")
    log_message(f"Date Range: {created_after} to {created_before or 'now'}")
    if not start_date:
        log_message(f"Days Back: {days_back}")
    log_message(f"Max Results Per Page: {max_results_per_page}")
    log_message(f"Fetch All Pages: {fetch_all_pages}")

    # Build params - fetch ALL orders first to see what's available
    params = {
        "MarketplaceIds": MARKETPLACE_ID,
        "CreatedAfter": created_after,
        "MaxResultsPerPage": max_results_per_page,
    }

    if created_before:
        params["CreatedBefore"] = created_before

    # Filter by status if not including all
    if not include_all_statuses:
        params["OrderStatuses"] = "Pending,Unshipped,PartiallyShipped"
        params["FulfillmentChannels"] = "MFN"
        log_message("Filtering: MFN orders with Pending/Unshipped/PartiallyShipped status only")
    else:
        log_message("Fetching ALL order statuses and fulfillment channels")

    all_orders = []
    mfn_pending_orders = []
    fba_orders = []
    shipped_orders = []
    other_orders = []

    path = "/orders/v0/orders"
    page_count = 0

    while True:
        page_count += 1
        log_message(f"Fetching page {page_count}...")

        data = sp_api_get(path, params=params, access_token=access_token)
        payload = data.get("payload", {})
        orders = payload.get("Orders", [])

        log_message(f"Page {page_count}: Retrieved {len(orders)} orders")

        # Categorize orders for logging
        for o in orders:
            all_orders.append(o)

            fulfillment = o.get("FulfillmentChannel", "Unknown")
            status = o.get("OrderStatus", "Unknown")
            order_id = o.get("AmazonOrderId", "Unknown")

            if fulfillment == "MFN" and status in ("Pending", "Unshipped", "PartiallyShipped"):
                mfn_pending_orders.append(o)
            elif fulfillment == "AFN":
                fba_orders.append(o)
            elif status == "Shipped":
                shipped_orders.append(o)
            else:
                other_orders.append(o)

        next_token = payload.get("NextToken")

        # Stop if no more pages OR if fetch_all_pages is False (only fetch first page)
        if not next_token or not fetch_all_pages:
            if next_token and not fetch_all_pages:
                log_message(f"Stopping after first page (fetch_all_pages=False). More orders available.")
            break
        params = {"NextToken": next_token}

    # Log summary
    log_message(f"=== Order Fetch Summary ===")
    log_message(f"Total Orders Retrieved: {len(all_orders)}")
    log_message(f"Pages Fetched: {page_count}")
    log_message(f"  - MFN Pending/Unshipped: {len(mfn_pending_orders)} (these will be imported)")
    log_message(f"  - FBA Orders: {len(fba_orders)} (excluded - fulfilled by Amazon)")
    log_message(f"  - Shipped Orders: {len(shipped_orders)} (excluded - already shipped)")
    log_message(f"  - Other Status: {len(other_orders)} (excluded)")

    # Log first few orders of each type for debugging
    if mfn_pending_orders:
        log_message(f"Sample MFN Pending Orders:")
        for o in mfn_pending_orders[:3]:
            log_message(f"  - {o.get('AmazonOrderId')}: {o.get('OrderStatus')} ({o.get('FulfillmentChannel')})")

    if fba_orders:
        log_message(f"Sample FBA Orders (excluded):")
        for o in fba_orders[:3]:
            log_message(f"  - {o.get('AmazonOrderId')}: {o.get('OrderStatus')} ({o.get('FulfillmentChannel')})")

    if shipped_orders:
        log_message(f"Sample Shipped Orders (excluded):")
        for o in shipped_orders[:3]:
            log_message(f"  - {o.get('AmazonOrderId')}: {o.get('OrderStatus')} ({o.get('FulfillmentChannel')})")

    # Return orders based on import_all flag
    orders_to_return = all_orders if import_all else mfn_pending_orders
    
    # Sort by purchase date descending
    orders_to_return.sort(key=lambda x: x.get("PurchaseDate", ""), reverse=True)

    return orders_to_return, {
        "total_retrieved": len(all_orders),
        "pages_fetched": page_count,
        "mfn_pending": len(mfn_pending_orders),
        "fba_excluded": len(fba_orders),
        "shipped_excluded": len(shipped_orders),
        "other_excluded": len(other_orders),
        "fetch_all_pages": fetch_all_pages,
        "max_results_per_page": max_results_per_page,
        "import_all": import_all
    }

def fetch_order_items(order_id, access_token):
    """Fetch items for an order"""
    path = f"/orders/v0/orders/{order_id}/orderItems"
    params = {"MaxResultsPerPage": 100}
    all_items = []

    while True:
        data = sp_api_get(path, params=params, access_token=access_token)
        payload = data.get("payload", {})
        items = payload.get("OrderItems", [])
        all_items.extend(items)

        next_token = payload.get("NextToken")
        if not next_token:
            break
        params = {"NextToken": next_token}

    return all_items

def build_order_data(orders, access_token):
    """Build order data for import"""
    result = []

    log_message(f"Building order data for {len(orders)} orders...")

    # Define cache inside build_order_data or globally
    # Simple in-memory cache for this run
    image_cache = {}

    def get_image_url(asin, access_token):
        if asin in image_cache:
            return image_cache[asin]
        
        url = fetch_primary_image_for_asin(asin, access_token)
        image_cache[asin] = url
        return url

    for i, order in enumerate(orders, 1):
        order_id = order.get("AmazonOrderId")
        log_message(f"Processing order {i}/{len(orders)}: {order_id}")

        buyer_info = order.get("BuyerInfo") or {}
        shipping_address = order.get("ShippingAddress") or {}
        order_total = order.get("OrderTotal") or {}

        # Fetch items
        items = fetch_order_items(order_id, access_token)
        log_message(f"  - Found {len(items)} items")

        order_data = {
            "externalOrderId": order_id,
            "channel": "amazon",
            "accountCode": ACCOUNT_CODE,
            "status": order.get("OrderStatus", "Pending").lower(),
            "fulfillmentChannel": order.get("FulfillmentChannel", "MFN"),
            "buyerName": buyer_info.get("BuyerName") or order.get("BuyerName") or "Amazon Customer",
            "buyerEmail": buyer_info.get("BuyerEmail") or order.get("BuyerEmail"),
            "orderDate": order.get("PurchaseDate"),
            "promisedDate": order.get("LatestShipDate"),
            "totalAmount": float(order_total.get("Amount", 0)) if order_total.get("Amount") else 0,
            "currency": order_total.get("CurrencyCode", "USD"),
            "shippingAddress": {
                "name": shipping_address.get("Name"),
                "addressLine1": shipping_address.get("AddressLine1"),
                "addressLine2": shipping_address.get("AddressLine2"),
                "city": shipping_address.get("City"),
                "state": shipping_address.get("StateOrRegion"),
                "postalCode": shipping_address.get("PostalCode"),
                "country": shipping_address.get("CountryCode"),
            },
            "items": []
        }

        for item in items:
            item_price = item.get("ItemPrice") or {}
            sku = item.get("SellerSKU")
            asin = item.get("ASIN")
            
            # Fetch and download image
            image_url = get_image_url(asin, access_token)
            local_image_path = None
            if image_url:
                local_image_path = download_image(image_url, sku)

            order_data["items"].append({
                "sku": sku,
                "asin": asin,
                "productName": item.get("Title"),
                "quantity": item.get("QuantityOrdered", 1),
                "itemPrice": float(item_price.get("Amount", 0)) if item_price.get("Amount") else 0,
                "currency": item_price.get("CurrencyCode", "USD"),
                "imageUrl": image_url,
                "localImagePath": local_image_path
            })

        result.append(order_data)

    return result

def extract_image_url_from_catalog_payload(payload):
    """Extract image URL from Catalog Items v0 payload"""
    if not payload:
        return None
        
    attr_sets = payload.get("AttributeSets") or []
    if attr_sets:
        attrs = attr_sets[0]
        for key in ("SmallImage", "MediumImage", "LargeImage"):
            img = attrs.get(key)
            if isinstance(img, dict):
                url = img.get("URL") or img.get("Url") or img.get("link")
                if isinstance(url, str) and url.startswith("http"):
                    return url

    # Fallback: recursive search
    def find_url(obj):
        if isinstance(obj, dict):
            for v in obj.values():
                u = find_url(v)
                if u: return u
        elif isinstance(obj, list):
            for v in obj:
                u = find_url(v)
                if u: return u
        elif isinstance(obj, str) and obj.startswith("http") and any(ext in obj.lower() for ext in ['.jpg', '.jpeg', '.png']):
             return obj
        return None

    return find_url(payload)

def fetch_primary_image_for_asin(asin, access_token):
    """Fetch primary image URL for ASIN from Catalog API"""
    if not asin:
        return None

    path = f"/catalog/v0/items/{asin}"
    params = {"MarketplaceId": MARKETPLACE_ID}

    try:
        # Use existing sp_api_get with retry logic
        data = sp_api_get(path, params=params, access_token=access_token)
        payload = data.get("payload", {})
        return extract_image_url_from_catalog_payload(payload)
    except Exception as e:
        log_message(f"Failed to fetch image for ASIN {asin}: {e}", "WARNING")
        return None

def download_image(url, sku):
    """Download image to sku_images/{SKU}/"""
    if not url or not sku:
        return None

    # Clean SKU
    safe_sku = "".join(c for c in sku if c.isalnum() or c in ('-', '_')).strip()
    if not safe_sku:
        safe_sku = "unknown_sku"

    # Directory relative to script execution (usually backend root)
    # We want it in backend/sku_images or just sku_images
    base_dir = Path("sku_images") 
    sku_dir = base_dir / safe_sku
    
    try:
        sku_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        log_message(f"Failed to create directory {sku_dir}: {e}", "ERROR")
        return None

    filename = url.split('/')[-1].split('?')[0]
    if not filename:
        filename = "image.jpg"
    
    file_path = sku_dir / filename
    
    # Skip if exists
    if file_path.exists():
        return str(file_path)

    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        
        with open(file_path, 'wb') as f:
            f.write(resp.content)
            
        log_message(f"Downloaded image for {sku}: {filename}")
        return str(file_path)
    except Exception as e:
        log_message(f"Failed to download image from {url}: {e}", "WARNING")
        return None

def parse_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(description='Fetch Amazon orders via SP-API')
    parser.add_argument('--days-back', type=int, default=DEFAULT_DAYS_BACK,
                        help=f'Number of days to look back for orders (default: {DEFAULT_DAYS_BACK})')
    parser.add_argument('--max-results', type=int, default=DEFAULT_MAX_RESULTS_PER_PAGE,
                        help=f'Maximum results per API page, 1-100 (default: {DEFAULT_MAX_RESULTS_PER_PAGE})')
    parser.add_argument('--fetch-all-pages', action='store_true', default=DEFAULT_FETCH_ALL_PAGES,
                        help=f'Fetch all pages of orders (default: {DEFAULT_FETCH_ALL_PAGES})')
    parser.add_argument('--single-page', action='store_true',
                        help='Fetch only the first page of orders')
    parser.add_argument('--import-all', action='store_true',
                        help='Import ALL orders regardless of status (default: False - only Pending MFN)')
    parser.add_argument('--start-date', type=str, help='Start date (ISO format) for order fetch')
    parser.add_argument('--end-date', type=str, help='End date (ISO format) for order fetch')
    return parser.parse_args()

def main():
    """Main function"""
    try:
        args = parse_args()

        # --single-page overrides --fetch-all-pages
        fetch_all_pages = args.fetch_all_pages and not args.single_page

        log_message("="*60)
        log_message("AMAZON ORDER SYNC STARTED")
        log_message(f"Settings: days_back={args.days_back}, max_results={args.max_results}, fetch_all_pages={fetch_all_pages}, import_all={args.import_all}")
        log_message("="*60)

        access_token = get_access_token()

        # Fetch orders with configurable settings
        orders, stats = fetch_all_orders(
            access_token,
            days_back=args.days_back,
            max_results_per_page=args.max_results,
            fetch_all_pages=fetch_all_pages,
            include_all_statuses=True,
            import_all=args.import_all,
            start_date=args.start_date,
            end_date=args.end_date
        )

        if not orders:
            msg = "No MFN pending orders found" if not args.import_all else "No orders found"
            log_message(f"{msg} to import")
            result = {
                "success": True,
                "orders": [],
                "message": msg,
                "accountCode": ACCOUNT_CODE,
                "stats": stats,
                "fetchedAt": datetime.now(timezone.utc).isoformat()
            }
            print(json.dumps(result))
            return

        order_data = build_order_data(orders, access_token)

        log_message(f"=== SYNC COMPLETE ===")
        log_message(f"Orders ready for import: {len(order_data)}")

        # Output JSON to stdout
        result = {
            "success": True,
            "accountCode": ACCOUNT_CODE,
            "orders": order_data,
            "stats": stats,
            "fetchedAt": datetime.now(timezone.utc).isoformat()
        }
        print(json.dumps(result))

    except Exception as e:
        log_message(f"SYNC FAILED: {str(e)}", "ERROR")
        import traceback
        log_message(traceback.format_exc(), "ERROR")

        print(json.dumps({
            "success": False,
            "error": str(e),
            "accountCode": ACCOUNT_CODE
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
