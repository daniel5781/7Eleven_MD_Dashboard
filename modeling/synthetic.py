"""Generate fictional normalized event tables without reading any input files."""
import numpy as np
import pandas as pd


def generate_tables(n_items=120, seed=20261026):
    if n_items < 30:
        raise ValueError("Use at least 30 products for chronological splits.")
    rng = np.random.default_rng(seed)
    items, masters, reservations, shipments, store_orders, centers = [], [], [], [], [], []
    center_codes = [f"DEMO-C{i:02d}" for i in range(1, 5)]
    for j, center in enumerate(center_codes):
        centers.append({"CENTER_CODE": center, "AVAILABLE_DATE": pd.Timestamp("2022-12-01"),
                        "store_count": 24 + j * 3})
    for i in range(n_items):
        item = f"DEMO-SKU-{i + 1:04d}"
        release = pd.Timestamp("2023-01-15") + pd.Timedelta(days=i * 7)
        decision = release - pd.Timedelta(days=5)
        category = ["snack", "biscuit", "candy"][i % 3]
        issue = ["ordinary", "seasonal", "collaboration"][i % 3 if i % 5 == 0 else 0]
        price = float(rng.choice([1500, 1800, 2400, 3000]))
        cost = price * rng.uniform(0.55, 0.8)
        box = int(rng.choice([12, 16, 20]))
        items.append({"ITEM_CODE": item, "NP_RLSE_YMD": release, "DECISION_DATE": decision,
                      "CATEGORY": category, "issue_type": issue, "box_size": box})
        master = {"ITEM_CODE": item, "AVAILABLE_DATE": decision - pd.Timedelta(days=14),
                  "sale_price": price, "ST_CPM_AMT": cost, "PRF_RT": (price - cost) / price * 100,
                  "ITEM_CPCT_VAL": float(rng.choice([80, 100, 150])),
                  "ORD_SUPP_EVN_AMT": float(rng.choice([0, 100, 200])),
                  "ORD_SUPP_EVN_CND_QTY": float(box), "min_order_qty": float(box)}
        masters.append(master)
        # Deliberately add a later revision: preprocessing must never use it early.
        masters.append({**master, "AVAILABLE_DATE": release, "ST_CPM_AMT": cost * 1.5})
        latent = rng.lognormal(0, 0.13)
        for j, center in enumerate(center_codes):
            pool = 24 + j * 3
            chosen = rng.choice(pool, size=int(rng.integers(7, pool - 2)), replace=False)
            stores = [f"DEMO-S{j + 1:02d}-{s:03d}" for s in chosen]
            anchor = 0
            for d in range(6):
                for store in stores:
                    if rng.random() > 0.55:
                        continue
                    qty = int(rng.integers(2, 11))
                    anchor += qty
                    reservations.append({"ITEM_CODE": item, "CENTER_CODE": center,
                                         "STORE_CODE": store, "EVENT_DATE": decision - pd.Timedelta(days=5 - d),
                                         "qty": float(qty)})
            reservations.append({"ITEM_CODE": item, "CENTER_CODE": center, "STORE_CODE": stores[0],
                                 "EVENT_DATE": release - pd.Timedelta(days=1), "qty": 999.0})
            multiplier = (1.1 + 0.25 * (issue == "seasonal") + 0.12 * j
                          + 0.3 * (price - cost) / price + 0.12 * np.sin(i / 9))
            total = max(1, int(anchor * multiplier * latent * rng.lognormal(0, 0.06)))
            daily = rng.multinomial(total, [0.32, 0.28, 0.23, 0.17])
            for d, qty in enumerate(daily):
                date = release + pd.Timedelta(days=d)
                shipments.append({"ITEM_CODE": item, "CENTER_CODE": center,
                                  "EVENT_DATE": date, "qty": float(qty)})
                store_orders.append({"ITEM_CODE": item, "CATEGORY": category, "STORE_CODE": stores[d % len(stores)],
                                     "EVENT_DATE": date, "qty": float(qty)})
    return {name: pd.DataFrame(rows) for name, rows in {
        "items": items, "masters": masters, "centers": centers,
        "reservations": reservations, "shipments": shipments, "store_orders": store_orders,
    }.items()}
