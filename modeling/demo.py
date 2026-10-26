"""Run the full public example using freshly generated fictional events."""
import argparse
import importlib.metadata
import json
from pathlib import Path

import numpy as np

from .blend import ThreeTargetBlend
from .evaluation import temporal_split, walk_forward
from .features import build_features
from .initial_order_model import InitialOrderModel
from .inventory import excess_burden, simulate
from .metrics import metrics
from .schema import NUMERIC, CATEGORICAL, SEEDS
from .synthetic import generate_tables


def run(args):
    tables = generate_tables(n_items=args.items, seed=args.seed)
    frame = build_features(tables)
    if not frame.ITEM_CODE.str.startswith("DEMO-").all() or not frame.CENTER_CODE.str.startswith("DEMO-").all():
        raise ValueError("The public demo accepts only its generated fictional identifiers.")
    train, validation, test = temporal_split(frame)
    options = {"seeds": SEEDS, "n_estimators": args.trees,
               "under_cost": args.under_cost, "over_cost": args.over_cost}
    cls = ThreeTargetBlend if args.mode == "blend" else InitialOrderModel
    model = cls(**options).fit(train, validation)
    pred = model.predict(test, round_int=False)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    if args.mode == "multiplier":
        model.save(output / "artifact")
        restored = InitialOrderModel.load(output / "artifact")
        np.testing.assert_allclose(restored.predict(test, round_int=False).model_qty, pred.model_qty,
                                   rtol=1e-12, atol=1e-9)
    else:
        for mode, component in zip(model.MODES, model.models_):
            component.save(output / "artifact" / mode)
        (output / "artifact" / "blend.json").write_text(
            json.dumps({"weights": model.weights_, "alpha": model.alpha_auto_}), encoding="utf-8")
    provenance = {
        "synthetic": True, "generator": "modeling.synthetic.generate_tables",
        "seed": args.seed, "original_data_read": False,
        "meaning": "Execution example only; not evidence of business accuracy or savings.",
    }
    score = {}
    inventory = {}
    for column in ["formula_qty", "formula_recal_qty", "model_qty", "calibrated_qty"]:
        score[column] = metrics(test.OPT_D, pred[column])
        scenarios = [simulate(float(p), row.daily_outflow, box_size=row.box_size)
                     for p, row in zip(pred[column], test.itertuples())]
        inventory[column] = {
            key: float(sum(s[key] for s in scenarios))
            for key in ["served_units", "unmet_request_units", "ending_stock_units", "closing_stock_box_days"]
        }
        inventory[column]["retrospective_excess_box_days_proxy"] = float(sum(
            excess_burden(float(p), row.OPT_D, max(row.OPT_D / 4, 0), row.box_size)
            for p, row in zip(pred[column], test.itertuples())
        ))
    report = {
        "provenance": provenance, "model": args.mode, "features": len(NUMERIC) + len(CATEGORICAL),
        "seed_ensemble": list(SEEDS), "boosting_limit": args.trees,
        "rows": len(frame), "products": frame.ITEM_CODE.nunique(),
        "split": {
            name: {"rows": len(part), "products": part.ITEM_CODE.nunique(),
                   "first_decision": str(part.DECISION_DATE.min().date()),
                   "last_decision": str(part.DECISION_DATE.max().date())}
            for name, part in [("train", train), ("validation", validation), ("test", test)]
        },
        "purged_boundary_rows": len(frame) - len(train) - len(validation) - len(test),
        "validation_selected_alpha": model.alpha_auto_,
        "hypothetical_cost_weights": {"under": args.under_cost, "over": args.over_cost},
        "test_metrics": score, "inventory_scenarios": inventory,
        "inventory_assumptions": {
            "horizon_days": 4, "receipts": 0, "backlog": False,
            "request_proxy": "Synthetic observed shipments; not uncensored customer demand.",
            "holding_measure": "Sum of end-of-day inventory / box size, not monetary cost.",
            "excess_proxy_rate": "Four-day mean used for this demo, not the original steady-state window.",
        },
        "versions": {name: importlib.metadata.version(name)
                     for name in ["numpy", "pandas", "lightgbm", "scikit-learn"]},
    }
    if args.mode == "blend":
        report["validation_blend_weights"] = dict(zip(model.MODES, model.weights_))
    if args.walk_forward:
        report["walk_forward"] = walk_forward(frame, test, lambda: cls(**options))
    # Deliberate allow-list: no feature snapshots, training rows or original artifacts are exported.
    records = []
    for row in pred.to_dict("records"):
        records.append({
            key: row[key] for key in ["ITEM_CODE", "CENTER_CODE", "box_size", "OPT_D",
                                      "model_qty", "formula_qty", "formula_recal_qty", "calibrated_qty", "alpha"]
        })
    (output / "predictions.json").write_text(
        json.dumps({"provenance": provenance, "rows": records}, indent=2, allow_nan=False), encoding="utf-8")
    (output / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    print(f"SYNTHETIC ONLY | {args.mode} | {len(frame)} rows | {len(NUMERIC) + len(CATEGORICAL)} features")
    print(f"Validation-selected alpha: {model.alpha_auto_:.2f}")
    for name, result in score.items():
        print(f"{name:20} WMAPE {result['wmape_pct']:.2f}% | Bias {result['bias_pct']:+.2f}%")
    print(f"Report: {output / 'report.json'} (not a business-performance claim)")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["multiplier", "blend"], default="multiplier")
    parser.add_argument("--items", type=int, default=120)
    parser.add_argument("--seed", type=int, default=20261026)
    parser.add_argument("--trees", type=int, default=300)
    parser.add_argument("--under-cost", type=float, default=1.0)
    parser.add_argument("--over-cost", type=float, default=0.7)
    parser.add_argument("--walk-forward", action="store_true")
    parser.add_argument("--output", default="modeling/output")
    run(parser.parse_args())


if __name__ == "__main__":
    main()
