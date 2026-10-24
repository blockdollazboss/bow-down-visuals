import re, sys
# Add migration-0205 columns to pg-mem DDL mirrors in existing test files,
# exactly as prior lanes did for their columns (0190 discount_code etc.).
FILES = {
 "artifacts/api-server/src/routes/__tests__/storefront-lead-magnet.test.ts": ["store_products"],
 "artifacts/api-server/src/routes/generate/__tests__/market-checkout.test.ts": ["shop_products","shop_events"],
 "artifacts/api-server/src/routes/generate/__tests__/shop-discounts.test.ts": ["shop_products","shop_events"],
 "artifacts/api-server/src/routes/generate/__tests__/shops.test.ts": ["shop_products","shop_events"],
 "artifacts/api-server/src/routes/generate/__tests__/shop-merge-characterization.test.ts": ["shop_products","shop_events"],
 "artifacts/api-server/src/lib/__tests__/payment-reversals.test.ts": ["shop_products","shop_events"],
 "artifacts/api-server/src/lib/__tests__/stripe-webhook-abandoned.test.ts": ["shop_products","shop_events"],
 "artifacts/api-server/src/lib/__tests__/stripe-webhook-reversals.test.ts": ["shop_products","shop_events"],
}
ADD = {
 "store_products": "  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer,\n",
 "shop_products":  "  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer,\n",
 "shop_events":    "  affiliate_code text,\n",
}
for path, tables in FILES.items():
    try: s = open(path).read()
    except FileNotFoundError: print("skip missing", path); continue
    orig = s
    for t in tables:
        if t == "shop_events" and "affiliate_code" in s: continue
        if t != "shop_events" and "affiliate_commission_bps" in s: continue
        # find CREATE TABLE <t> ( ... ); and insert before its closing paren line
        m = re.search(r"(CREATE TABLE " + t + r" \(.*?\n)(\);|`?\)?\s*;)", s, re.S)
        if not m:
            m = re.search(r"(CREATE TABLE " + t + r" \(.*?\n)(\))", s, re.S)
        if not m:
            print(f"NO BLOCK {path} {t}"); continue
        s = s[:m.start(2)] + ADD[t] + s[m.start(2):]
    if s != orig:
        open(path, "w").write(s); print("patched", path)
    else:
        print("unchanged", path)
