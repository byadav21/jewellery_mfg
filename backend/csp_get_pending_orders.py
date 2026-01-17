import os
import json
import requests
import pandas as pd
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Any, Optional
from dotenv import load_dotenv
from weasyprint import HTML

# ==============================
# Config / Environment
# ==============================

load_dotenv()  # loads .env from current directory

CLIENT_ID = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
REFRESH_TOKEN = os.getenv("REFRESH_TOKEN")

MARKETPLACE_ID = os.getenv("MARKETPLACE_ID")  # e.g. A21TJRUUN4KGV (IN), ATVPDKIKX0DER (US)
BASE_URL = os.getenv(
    "SP_API_ENDPOINT",
    "https://sellingpartnerapi-na.amazon.com",
).rstrip("/")

# How many days back we look for orders
DAYS_BACK = 30

# Output file names
OUTPUT_EXCEL = "pending_orders.xlsx"
OUTPUT_PDF = "pending_orders.pdf"


# ==============================
# LWA Token Manager
# ==============================

class LWATokenManager:
    """
    Simple in-memory token manager.
    - Caches the current access token and expiry time.
    - Automatically refreshes token when missing or about to expire.
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
        self._expires_at: Optional[datetime] = None  # UTC time

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
        print(f"   Expires in {expires_in} seconds "
              f"at {self._expires_at.isoformat()}.")

    def get_valid_access_token(self) -> str:
        """
        Return a valid LWA access token.
        Refreshes the token if:
        - There is no token yet, or
        - It will expire in < 5 minutes.
        """
        now_utc = datetime.now(timezone.utc)
        if self._access_token and self._expires_at:
            # Refresh if less than 5 minutes left
            if self._expires_at - now_utc > timedelta(minutes=5):
                return self._access_token

        # Token missing or expiring soon – fetch new
        self._fetch_new_token()
        return self._access_token


token_manager = LWATokenManager(CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN)


# ==============================
# Helper: SP-API GET Wrapper
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
# Fetch Orders, Items & Images
# ==============================

def fetch_mfn_pending_orders(days_back: int = DAYS_BACK) -> List[Dict[str, Any]]:
    """
    Fetch MFN orders with status Pending, Unshipped, or PartiallyShipped,
    created in the last `days_back` days.
    """
    if not MARKETPLACE_ID:
        raise RuntimeError(
            "MARKETPLACE_ID is not set in .env "
            "(e.g. A21TJRUUN4KGV for Amazon.in, ATVPDKIKX0DER for Amazon.com)"
        )

    created_after_dt = datetime.now(timezone.utc) - timedelta(days=days_back)
    # ISO8601 format with trailing Z (UTC)
    created_after = created_after_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    print(
        f"\nCalling SP-API Orders for MFN Pending/Unshipped/PartiallyShipped "
        f"orders since {created_after} (Marketplace {MARKETPLACE_ID}) ..."
    )

    params: Dict[str, Any] = {
        "MarketplaceIds": MARKETPLACE_ID,
        "CreatedAfter": created_after,
        "MaxResultsPerPage": 100,
        "OrderStatuses": "Pending,Unshipped,PartiallyShipped",
        "FulfillmentChannels": "MFN",
    }

    all_orders: List[Dict[str, Any]] = []
    path = "/orders/v0/orders"

    while True:
        data = sp_api_get(path, params=params)
        payload = data.get("payload", {})
        orders = payload.get("Orders", [])

        print(f"   Retrieved {len(orders)} orders in this page (before filtering).")

        # Extra safety filter in case API ignores FulfillmentChannels
        for o in orders:
            if (
                o.get("FulfillmentChannel") == "MFN"
                and o.get("OrderStatus") in ("Pending", "Unshipped", "PartiallyShipped")
            ):
                all_orders.append(o)

        next_token = payload.get("NextToken")
        if not next_token:
            break

        print("   NextToken found, requesting next page...")
        params = {"NextToken": next_token}

    print(f"Total MFN pending/open orders after filtering: {len(all_orders)}")
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


# Simple cache so we don't call Catalog for the same ASIN repeatedly
IMAGE_CACHE: Dict[str, Optional[str]] = {}


def extract_image_url_from_catalog_payload(payload: Dict[str, Any]) -> Optional[str]:
    """
    Try to extract a plausible image URL from Catalog Items v0 payload.
    We handle common patterns and then fall back to a recursive search.
    """
    attr_sets = payload.get("AttributeSets") or []
    if attr_sets:
        attrs = attr_sets[0]
        for key in ("SmallImage", "MediumImage", "LargeImage"):
            img = attrs.get(key)
            if isinstance(img, dict):
                url = img.get("URL") or img.get("Url") or img.get("link")
                if isinstance(url, str) and url.startswith("http"):
                    return url

    # Fallback: recursive search for first http URL
    def find_url(obj: Any) -> Optional[str]:
        if isinstance(obj, dict):
            for v in obj.values():
                u = find_url(v)
                if u:
                    return u
        elif isinstance(obj, list):
            for v in obj:
                u = find_url(v)
                if u:
                    return u
        elif isinstance(obj, str) and obj.startswith("http"):
            return obj
        return None

    return find_url(payload)


def fetch_primary_image_for_asin(asin: str) -> Optional[str]:
    """Fetch / cache a primary image URL for a given ASIN using Catalog Items v0."""
    if not asin:
        return None

    if asin in IMAGE_CACHE:
        return IMAGE_CACHE[asin]

    path = f"/catalog/v0/items/{asin}"
    params = {"MarketplaceId": MARKETPLACE_ID}

    try:
        data = sp_api_get(path, params=params)
        payload = data.get("payload", {})
        url = extract_image_url_from_catalog_payload(payload)
    except Exception:
        url = None

    IMAGE_CACHE[asin] = url
    return url


def download_image(url: str, sku: str) -> Optional[str]:
    """
    Download image from URL and save to sku_images/{SKU}/ directory.
    
    Args:
        url: Image URL to download
        sku: SKU string (used for directory name)
        
    Returns:
        Path to saved file or None if failed
    """
    if not url or not sku:
        return None

    # Clean SKU for filesystem safety
    safe_sku = "".join(c for c in sku if c.isalnum() or c in ('-', '_')).strip()
    if not safe_sku:
        safe_sku = "unknown_sku"

    # Create base directory if not exists
    base_dir = "sku_images"
    sku_dir = os.path.join(base_dir, safe_sku)
    
    try:
        os.makedirs(sku_dir, exist_ok=True)
    except OSError as e:
        print(f"⚠️ Failed to create directory for SKU {sku}: {e}")
        return None

    # Determine filename
    filename = url.split('/')[-1]
    # Remove query parameters if any
    if '?' in filename:
        filename = filename.split('?')[0]
    
    if not filename:
        filename = "image.jpg"
        
    file_path = os.path.join(sku_dir, filename)
    
    # If file already exists, we can skip or overwrite. 
    # Let's skip if it exists to save bandwidth/time
    if os.path.exists(file_path):
        return file_path

    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        
        with open(file_path, 'wb') as f:
            f.write(resp.content)
            
        print(f"   ⬇️ Downloaded image for {sku}: {filename}")
        return file_path
    except Exception as e:
        print(f"   ⚠️ Failed to download image for {sku}: {e}")
        return None


# ==============================
# Build Dataset & Export
# ==============================

def build_pending_orders_dataset() -> pd.DataFrame:
    """
    Fetch MFN pending/open orders + items + image URLs,
    and return a pandas DataFrame with one row per order item.
    """
    orders = fetch_mfn_pending_orders(DAYS_BACK)
    rows: List[Dict[str, Any]] = []

    for order in orders:
        order_id = order.get("AmazonOrderId")
        status = order.get("OrderStatus")
        fulfillment = order.get("FulfillmentChannel")
        purchase_date = order.get("PurchaseDate")

        shipping_address = order.get("ShippingAddress") or {}
        buyer_info = order.get("BuyerInfo") or {}

        buyer_name = buyer_info.get("BuyerName") or order.get("BuyerName")
        buyer_email = buyer_info.get("BuyerEmail") or order.get("BuyerEmail")

        city = shipping_address.get("City")
        state = shipping_address.get("StateOrRegion")
        country = shipping_address.get("CountryCode")

        print(f"\nFetching items for order {order_id} ...")
        items = fetch_order_items(order_id)

        for item in items:
            asin = item.get("ASIN")
            sku = item.get("SellerSKU")
            title = item.get("Title")

            qty = item.get("QuantityOrdered")
            item_price = (item.get("ItemPrice") or {})
            price_amount = item_price.get("Amount")
            price_currency = item_price.get("CurrencyCode")

            image_url = fetch_primary_image_for_asin(asin)
            
            # Download image locally
            local_image_path = None
            if image_url:
                local_image_path = download_image(image_url, sku)

            row = {
                "AmazonOrderId": order_id,
                "PurchaseDate": purchase_date,
                "OrderStatus": status,
                "FulfillmentChannel": fulfillment,
                "BuyerName": buyer_name,
                "BuyerEmail": buyer_email,
                "ASIN": asin,
                "SellerSKU": sku,
                "Title": title,
                "QuantityOrdered": qty,
                "ItemPriceAmount": price_amount,
                "ItemPriceCurrency": price_currency,
                "ShippingAddressCity": city,
                "ShippingAddressStateOrRegion": state,
                "ShippingAddressCountryCode": country,
                "ImageUrl": image_url,
                "LocalImagePath": local_image_path,
            }
            rows.append(row)

    df = pd.DataFrame(rows)
    return df


def export_to_excel(df: pd.DataFrame, filename: str = OUTPUT_EXCEL) -> str:
    """Export DataFrame to Excel and return the file path."""
    if df.empty:
        print("⚠️ No rows to write to Excel.")
    else:
        df.to_excel(filename, index=False)
        print(f"✅ Excel file written: {os.path.abspath(filename)}")
    return os.path.abspath(filename)


def export_to_pdf(df: pd.DataFrame, filename: str = OUTPUT_PDF) -> str:
    """Generate a simple PDF report using WeasyPrint."""
    if df.empty:
        print("⚠️ No rows to include in PDF.")
        # Still create an empty-style PDF
        html = "<h1>Pending MFN Orders Report</h1><p>No data available.</p>"
    else:
        # Limit rows shown in PDF if huge, but keep everything in Excel
        display_df = df.copy()

        # Build HTML table
        table_rows = []
        for _, r in display_df.iterrows():
            img_cell = (
                f'<img src="{r["ImageUrl"]}" style="width:60px; height:auto;" />'
                if r.get("ImageUrl")
                else "No image"
            )
            row_html = f"""
            <tr>
                <td>{r.get("AmazonOrderId","")}</td>
                <td>{r.get("PurchaseDate","")}</td>
                <td>{r.get("OrderStatus","")}</td>
                <td>{r.get("ASIN","")}</td>
                <td>{r.get("SellerSKU","")}</td>
                <td>{r.get("QuantityOrdered","")}</td>
                <td>{img_cell}</td>
            </tr>
            """
            table_rows.append(row_html)

        rows_html = "\n".join(table_rows)

        generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        html = f"""
        <html>
        <head>
            <meta charset="utf-8" />
            <style>
                body {{
                    font-family: sans-serif;
                    font-size: 12px;
                }}
                h1 {{
                    text-align: center;
                    margin-bottom: 10px;
                }}
                p.subtitle {{
                    text-align: center;
                    font-size: 10px;
                    color: #555;
                }}
                table {{
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 15px;
                }}
                th, td {{
                    border: 1px solid #ccc;
                    padding: 4px;
                    text-align: left;
                }}
                th {{
                    background-color: #f2f2f2;
                }}
            </style>
        </head>
        <body>
            <h1>Pending MFN Orders Report</h1>
            <p class="subtitle">Generated at {generated_at}</p>
            <table>
                <thead>
                    <tr>
                        <th>AmazonOrderId</th>
                        <th>PurchaseDate</th>
                        <th>OrderStatus</th>
                        <th>ASIN</th>
                        <th>SellerSKU</th>
                        <th>Qty</th>
                        <th>Image</th>
                    </tr>
                </thead>
                <tbody>
                    {rows_html}
                </tbody>
            </table>
        </body>
        </html>
        """

    HTML(string=html).write_pdf(filename)
    print(f"✅ PDF file written: {os.path.abspath(filename)}")
    return os.path.abspath(filename)


# ==============================
# Main entry point
# ==============================

if __name__ == "__main__":
    try:
        df_orders = build_pending_orders_dataset()
        print(f"\nTotal rows (order items) collected: {len(df_orders)}")

        excel_path = export_to_excel(df_orders, OUTPUT_EXCEL)
        pdf_path = export_to_pdf(df_orders, OUTPUT_PDF)

        print("\nDone.")
        print("Excel:", excel_path)
        print("PDF:  ", pdf_path)

    except Exception as e:
        print("\n❌ Failed to fetch or export pending orders:")
        print(e)
