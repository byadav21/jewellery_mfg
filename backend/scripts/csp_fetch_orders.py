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
# Pre-refreshed access token (from token refresh service)
PRE_REFRESHED_ACCESS_TOKEN = os.getenv("CSP_AMAZON_ACCESS_TOKEN")
PRE_REFRESHED_TOKEN_TIME = os.getenv("CSP_AMAZON_TOKEN_REFRESHED_AT")
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
    """Get LWA access token - prefers pre-refreshed token if available and fresh"""
    # Check for pre-refreshed token (from token refresh service)
    if PRE_REFRESHED_ACCESS_TOKEN and PRE_REFRESHED_TOKEN_TIME:
        try:
            from datetime import datetime
            refresh_time = datetime.fromisoformat(PRE_REFRESHED_TOKEN_TIME.replace('Z', '+00:00'))
            now = datetime.now(timezone.utc)
            age_minutes = (now - refresh_time).total_seconds() / 60

            if age_minutes < 50:  # Token expires in 60 min, use if less than 50 min old
                log_message(f"Using pre-refreshed access token (age: {age_minutes:.1f} minutes)")
                return PRE_REFRESHED_ACCESS_TOKEN
            else:
                log_message(f"Pre-refreshed token too old ({age_minutes:.1f} minutes), getting fresh token")
        except Exception as e:
            log_message(f"Could not use pre-refreshed token: {e}", "WARNING")

    # Fall back to getting fresh token
    if not all([CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN]):
        raise RuntimeError("Missing CSP Amazon credentials in .env")

    log_message("Requesting fresh LWA access token...")

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

    log_message("Fresh access token obtained successfully")
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

    # Amazon API requires CreatedBefore to be at least 2 minutes in the past
    # Adjust if the calculated time is too recent
    if created_before:
        try:
            # Parse the created_before datetime
            if created_before.endswith('Z'):
                cb_dt = datetime.fromisoformat(created_before.replace('Z', '+00:00'))
            else:
                cb_dt = datetime.fromisoformat(created_before)

            # Current time minus 3 minutes (for safety margin)
            max_allowed_time = datetime.now(timezone.utc) - timedelta(minutes=3)

            # If created_before is in the future or too recent, adjust it
            if cb_dt > max_allowed_time:
                created_before = max_allowed_time.strftime("%Y-%m-%dT%H:%M:%SZ")
                log_message(f"Adjusted CreatedBefore to {created_before} (Amazon requires 2+ min in past)")
        except Exception as e:
            log_message(f"Warning: Could not validate CreatedBefore date: {e}", "WARNING")

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

            log_message(f"  - Processing item: SKU={sku}, ASIN={asin}")

            # Fetch and download image
            image_url = get_image_url(asin, access_token)
            local_image_path = None

            if image_url:
                log_message(f"  - Got image URL for {asin}, attempting download...")
                local_image_path = download_image(image_url, sku)
                if local_image_path:
                    log_message(f"  - Image downloaded successfully: {local_image_path}")
                else:
                    log_message(f"  - Image download failed for {asin}", "WARNING")
            else:
                log_message(f"  - No image URL found for ASIN {asin}", "WARNING")

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
    """Fetch primary image URL for ASIN from Catalog API v2022-04-01"""
    if not asin:
        log_message(f"[Image] No ASIN provided, skipping image fetch", "WARNING")
        return None

    # Use v2022-04-01 API (same as Node.js service)
    path = f"/catalog/2022-04-01/items/{asin}"
    params = {
        "marketplaceIds": MARKETPLACE_ID,
        "includedData": "images,summaries"
    }

    try:
        log_message(f"[Image] Fetching image for ASIN: {asin}")
        data = sp_api_get(path, params=params, access_token=access_token)

        log_message(f"[Image] API response keys for {asin}: {list(data.keys()) if data else 'None'}")

        # Extract images from v2022-04-01 response structure
        # Structure: { images: [{ marketplaceId, images: [{ variant, link, ... }] }] }
        images = data.get("images", [])
        log_message(f"[Image] Found {len(images)} marketplace image groups for {asin}")

        for marketplace_images in images:
            img_list = marketplace_images.get("images", [])
            log_message(f"[Image] Found {len(img_list)} images in marketplace group for {asin}")

            # First try to find MAIN variant
            for img in img_list:
                if img.get("variant") == "MAIN" and img.get("link"):
                    log_message(f"[Image] Found MAIN image for {asin}: {img.get('link')[:80]}...")
                    return img.get("link")

            # If no MAIN, return first available with link
            for img in img_list:
                if img.get("link"):
                    log_message(f"[Image] Using first available image for {asin}: {img.get('link')[:80]}...")
                    return img.get("link")

        log_message(f"[Image] No images found for ASIN {asin}", "WARNING")
        return None
    except Exception as e:
        log_message(f"[Image] Failed to fetch image for ASIN {asin}: {e}", "WARNING")
        import traceback
        log_message(f"[Image] Traceback: {traceback.format_exc()}", "WARNING")
        return None

def download_image(url, sku):
    """Download image to uploads/product-images/{SKU}/"""
    if not url or not sku:
        log_message(f"[Download] Missing url or sku - url: {bool(url)}, sku: {bool(sku)}", "WARNING")
        return None

    log_message(f"[Download] Starting download for SKU {sku}")

    # Clean SKU - uppercase and remove special chars (matching Node.js service)
    safe_sku = sku.upper().replace(" ", "_")
    safe_sku = "".join(c for c in safe_sku if c.isalnum() or c in ('-', '_')).strip()
    if not safe_sku:
        safe_sku = "unknown_sku"
        log_message(f"[Download] SKU normalized to 'unknown_sku'", "WARNING")

    # Directory to match Node.js service path: uploads/product-images/{SKU}/
    base_dir = Path(__file__).parent.parent / "uploads" / "product-images"
    sku_dir = base_dir / safe_sku

    log_message(f"[Download] Target directory: {sku_dir}")

    try:
        sku_dir.mkdir(parents=True, exist_ok=True)
        log_message(f"[Download] Directory created/verified: {sku_dir}")
    except Exception as e:
        log_message(f"[Download] Failed to create directory {sku_dir}: {e}", "ERROR")
        return None

    filename = url.split('/')[-1].split('?')[0]
    if not filename or '.' not in filename:
        filename = f"{safe_sku}_amazon_1.jpg"
        log_message(f"[Download] Generated filename: {filename}")

    file_path = sku_dir / filename

    # Return web-accessible path format (matching Node.js service)
    web_path = f"/uploads/product-images/{safe_sku}/{filename}"

    # Skip if exists
    if file_path.exists():
        log_message(f"[Download] File already exists, returning: {web_path}")
        return web_path

    try:
        log_message(f"[Download] Downloading from: {url[:100]}...")
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()

        with open(file_path, 'wb') as f:
            f.write(resp.content)

        log_message(f"[Download] Successfully saved: {file_path} ({len(resp.content)} bytes)")
        return web_path
    except Exception as e:
        log_message(f"[Download] Failed to download image from {url}: {e}", "WARNING")
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
