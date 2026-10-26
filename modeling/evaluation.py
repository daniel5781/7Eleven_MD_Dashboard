"""Purged chronological holdout and rolling monthly evaluation."""
import numpy as np
import pandas as pd

from .metrics import metrics


def temporal_split(frame):
    dates = sorted(pd.to_datetime(frame.DECISION_DATE).unique())
    if len(dates) < 15:
        raise ValueError("Not enough distinct decision dates.")
    val_start, test_start = dates[int(len(dates) * 0.6)], dates[int(len(dates) * 0.8)]
    decision = pd.to_datetime(frame.DECISION_DATE)
    available = pd.to_datetime(frame.LABEL_AVAILABLE_DATE)
    train = frame[(decision < val_start) & (available <= val_start)].copy()
    val = frame[(decision >= val_start) & (decision < test_start) & (available <= test_start)].copy()
    test = frame[decision >= test_start].copy()
    if any(part.empty for part in (train, val, test)):
        raise ValueError("Purging left an empty split.")
    return train, val, test


def walk_forward(frame, test_frame, factory):
    periods = pd.to_datetime(frame.DECISION_DATE).dt.to_period("M")
    test_periods = sorted(pd.to_datetime(test_frame.DECISION_DATE).dt.to_period("M").unique())
    reports, predictions, actuals = [], [], []
    available = pd.to_datetime(frame.LABEL_AVAILABLE_DATE)
    decision = pd.to_datetime(frame.DECISION_DATE)
    for month in test_periods:
        test = test_frame[pd.to_datetime(test_frame.DECISION_DATE).dt.to_period("M") == month]
        cutoff = pd.to_datetime(test.DECISION_DATE).min()
        val_start = (month - 2).start_time
        val = frame[(decision >= val_start) & (periods < month) & (available <= cutoff)].copy()
        if val.empty:
            raise ValueError("No matured validation window.")
        train = frame[(decision < val_start) & (available <= val.DECISION_DATE.min())].copy()
        model = factory().fit(train, val)
        pred = model.predict(test, alpha=1.0, round_int=False).model_qty.to_numpy()
        predictions.extend(pred)
        actuals.extend(test.OPT_D.to_numpy())
        reports.append({"month": str(month), "train_rows": len(train), "validation_rows": len(val),
                        "test_rows": len(test), "cutoff": str(cutoff.date()),
                        **metrics(test.OPT_D, pred)})
    return {"monthly": reports, "aggregate": metrics(np.asarray(actuals), np.asarray(predictions))}
