"""Public normalized-table adapter for v6 feature families.

The original ERP file readers are intentionally excluded. Every history lookup is
limited to the product's shared decision cutoff and matured shipment labels.
"""
import numpy as np
import pandas as pd

from .schema import NUMERIC, CATEGORICAL


def weighted_median(values, weights):
    values, weights = np.asarray(values, float), np.asarray(weights, float)
    if not len(values) or weights.sum() <= 0:
        return np.nan
    order = np.argsort(values, kind="stable")
    cumulative = np.cumsum(weights[order])
    return float(values[order][np.searchsorted(cumulative, cumulative[-1] / 2)])


def latest_before(frame, key, cutoff):
    eligible = frame[frame.AVAILABLE_DATE <= cutoff]
    return eligible.sort_values("AVAILABLE_DATE").drop_duplicates(key, keep="last")


def build_features(tables):
    items = tables["items"].sort_values(["DECISION_DATE", "ITEM_CODE"]).copy()
    reservations = tables["reservations"].copy()
    shipments = tables["shipments"].copy()
    masters, centers, orders = (tables[name].copy() for name in ("masters", "centers", "store_orders"))
    if items.ITEM_CODE.duplicated().any():
        raise ValueError("One product-level decision cutoff is required per product.")
    if (pd.to_datetime(items.DECISION_DATE) >= pd.to_datetime(items.NP_RLSE_YMD)).any():
        raise ValueError("Decision cutoffs must precede release dates.")
    for frame, date_columns in [
        (items, ["DECISION_DATE", "NP_RLSE_YMD"]),
        (reservations, ["EVENT_DATE"]), (shipments, ["EVENT_DATE"]),
        (masters, ["AVAILABLE_DATE"]), (centers, ["AVAILABLE_DATE"]), (orders, ["EVENT_DATE"]),
    ]:
        for column in date_columns:
            frame[column] = pd.to_datetime(frame[column], errors="raise")
            if frame[column].isna().any():
                raise ValueError("Missing date: " + column)
    for frame in (reservations, shipments, orders):
        frame["qty"] = pd.to_numeric(frame.qty, errors="raise")
        if not np.isfinite(frame.qty).all() or (frame.qty < 0).any():
            raise ValueError("The public adapter expects nonnegative event quantities.")
    rows, history = [], []
    for item in items.to_dict("records"):
        code, cutoff, release = item["ITEM_CODE"], item["DECISION_DATE"], item["NP_RLSE_YMD"]
        observed = reservations[(reservations.ITEM_CODE == code) & (reservations.EVENT_DATE <= cutoff)]
        observed = observed[observed.qty > 0]
        if observed.empty:
            continue  # Explicit positive-reservation scope, not a zero-demand prediction.
        master_rows = latest_before(masters[masters.ITEM_CODE == code], "ITEM_CODE", cutoff)
        active_centers = latest_before(centers, "CENTER_CODE", cutoff).set_index("CENTER_CODE")
        if master_rows.empty or active_centers.empty:
            raise ValueError("As-of product and center snapshots are required.")
        master = master_rows.iloc[0]
        if not set(observed.CENTER_CODE).issubset(active_centers.index):
            raise ValueError("Reservation references a center without an as-of snapshot.")
        if (active_centers.store_count <= 0).any():
            raise ValueError("Center store counts must be positive.")
        first = observed.EVENT_DATE.min()
        total_reservation = float(observed.qty.sum())
        pool_total = float(active_centers.store_count.sum())
        current_stores = set(observed.STORE_CODE)
        # Stricter than launch-order eligibility: all four label days must be observable.
        eligible = [h for h in history if h["available"] <= cutoff]
        neighbors = []
        for past in eligible:
            overlap = len(current_stores & past["stores"])
            similarity = overlap / np.sqrt(len(current_stores) * len(past["stores"])) if overlap else 0
            if similarity:
                neighbors.append((similarity, past))
        neighbors = sorted(neighbors, key=lambda n: n[0], reverse=True)[:20]
        weights = [s for s, _ in neighbors]
        nb_dps = weighted_median([np.log1p(h["total_outflow"] / max(h["store_count"], 1))
                                  for _, h in neighbors], weights)
        nb_mult = weighted_median([np.log1p(h["total_outflow"]) - np.log1p(h["total_reservation"])
                                   for _, h in neighbors], weights)
        # Future outcomes are read only into labels and retrospective simulation series.
        label_events = shipments[(shipments.ITEM_CODE == code)
                                 & (shipments.EVENT_DATE >= release)
                                 & (shipments.EVENT_DATE < release + pd.Timedelta(days=4))]
        item_rows, label_by_center = [], {}
        for center, group in observed.groupby("CENTER_CODE", sort=True):
            qty = float(group.qty.sum())
            stores = set(group.STORE_CODE)
            early = group[group.EVENT_DATE <= first + pd.Timedelta(days=3)]
            daily = group.groupby("EVENT_DATE").qty.sum()
            store_share = group.groupby("STORE_CODE").qty.sum() / qty
            earliest, latest = group.EVENT_DATE.min(), group.EVENT_DATE.max()
            age = max((cutoff - earliest).days, 1)
            price, cost = float(master.sale_price), float(master.ST_CPM_AMT)
            if min(price, cost, float(master.min_order_qty)) <= 0:
                raise ValueError("Price, cost and minimum order quantity must be positive.")
            support = max(float(master.ORD_SUPP_EVN_AMT), 0) / max(float(master.ORD_SUPP_EVN_CND_QTY), 1)
            margin = (max(price - cost, 0) + support) / price
            burden = float(master.min_order_qty) * cost
            pool = float(active_centers.loc[center, "store_count"])
            prior = [h["by_center"][center] for h in eligible
                     if h["category"] == item["CATEGORY"] and center in h["by_center"]]
            historical_orders = orders[(orders.EVENT_DATE <= cutoff) & (orders.CATEGORY == item["CATEGORY"])
                                       & orders.STORE_CODE.isin(stores)]
            by_day = label_events[label_events.CENTER_CODE == center].groupby("EVENT_DATE").qty.sum()
            daily_outflow = [float(by_day.get(release + pd.Timedelta(days=d), 0)) for d in range(4)]
            label = sum(daily_outflow)
            label_by_center[center] = label
            row = {
                "ITEM_CODE": code, "CENTER_CODE": str(center), "CATEGORY": item["CATEGORY"],
                "NP_RLSE_YMD": release, "DECISION_DATE": cutoff,
                "LABEL_AVAILABLE_DATE": release + pd.Timedelta(days=4),
                "box_size": item["box_size"], "daily_outflow": daily_outflow, "OPT_D": label,
                "RES_PREDEC_QTY": qty, "RES4_REG_QTY": float(early.qty.sum()),
                "RES_PREDEC_STR": len(stores), "RES4_REG_STR": early.STORE_CODE.nunique(),
                "velocity": np.log1p(qty / len(daily)),
                "frontload": float(group[group.EVENT_DATE <= earliest + pd.Timedelta(days=1)].qty.sum()) / qty,
                "span": np.log1p((latest - earliest).days + 1), "hhi": float((store_share**2).sum()),
                "lead": np.log1p(min((cutoff - earliest).days, 30)), "maxday": float(daily.max()) / qty,
                "store_vel": np.log1p(len(stores) / age),
                "center_store_pool": pool, "center_reserve_coverage": len(stores) / pool,
                "reserve_qty_center_share": qty / total_reservation, "reserve_qty_per_store": qty / len(stores),
                "reserve4_qty_ratio": float(early.qty.sum()) / qty,
                "min_order_cost": burden, "owner_roi_score": margin / np.log1p(burden),
                "ST_CPM_AMT": cost, "PRF_RT": float(master.PRF_RT),
                "ITEM_CPCT_VAL": float(master.ITEM_CPCT_VAL),
                "ORD_SUPP_EVN_AMT": float(master.ORD_SUPP_EVN_AMT),
                "ORD_SUPP_EVN_CND_QTY": float(master.ORD_SUPP_EVN_CND_QTY),
                "support_per_unit": support, "effective_margin_rate": margin,
                "CENTER_AVG_OUTFLOW_CAT": float(np.mean(prior)) if prior else np.nan,
                "cf_prior_resv_scale": np.log1p(float(historical_orders.qty.sum())),
                "nb_demand_per_store": nb_dps, "nb_mult": nb_mult,
                "over_index_qty": np.log((qty / total_reservation + 1e-4) / (pool / pool_total + 1e-4)),
                "MDDV_X_CENTER_ENC": item["CATEGORY"] + "|" + str(center), "issue_type": item["issue_type"],
            }
            item_rows.append(row)
        rows.extend(item_rows)
        history.append({"available": release + pd.Timedelta(days=4), "stores": current_stores,
                        "category": item["CATEGORY"], "by_center": label_by_center,
                        "total_outflow": sum(label_by_center.values()),
                        "total_reservation": total_reservation,
                        "store_count": sum(r["RES_PREDEC_STR"] for r in item_rows)})
    result = pd.DataFrame(rows)
    if result.empty:
        raise ValueError("No positive-reservation product/center rows.")
    if not set(NUMERIC + CATEGORICAL).issubset(result):
        raise ValueError("Incomplete v6 feature contract.")
    return result
