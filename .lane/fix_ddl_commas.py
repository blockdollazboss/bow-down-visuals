import re, glob
files = [
 "artifacts/api-server/src/routes/__tests__/storefront-lead-magnet.test.ts",
 "artifacts/api-server/src/routes/generate/__tests__/market-checkout.test.ts",
 "artifacts/api-server/src/routes/generate/__tests__/shop-discounts.test.ts",
 "artifacts/api-server/src/routes/generate/__tests__/shops.test.ts",
 "artifacts/api-server/src/routes/generate/__tests__/shop-merge-characterization.test.ts",
 "artifacts/api-server/src/lib/__tests__/payment-reversals.test.ts",
]
for path in files:
    s = open(path).read()
    # pattern: <line>\n  affiliate...,\n);  ->  <line>,\n  affiliate...\n);
    def repl(m):
        prev, add, close = m.group(1), m.group(2).rstrip().rstrip(','), m.group(3)
        return f"{prev},\n{add}\n{close}"
    s2 = re.sub(r"([^\n,])\n(  affiliate_(?:enabled|code)[^\n]*,\n)(\);)", lambda m: f"{m.group(1)},\n{m.group(2).rstrip()[:-1]}\n{m.group(3)}", s)
    # the lambda above: group2 ends with ",\n" -> strip newline then last comma
    if s2 != s:
        open(path, "w").write(s2); print("fixed", path)
    else:
        print("nochange", path)
