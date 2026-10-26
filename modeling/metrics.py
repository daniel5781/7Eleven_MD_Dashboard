"""Quantity errors and explicitly hypothetical under/over-order costs."""
import numpy as np


def paired(actual, predicted):
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    if actual.ndim != 1 or actual.shape != predicted.shape or not actual.size:
        raise ValueError("Expected nonempty, equally sized one-dimensional arrays.")
    if not np.isfinite(actual).all() or not np.isfinite(predicted).all():
        raise ValueError("Metrics require finite values.")
    if (actual < 0).any() or (predicted < 0).any():
        raise ValueError("Quantities must be nonnegative.")
    return actual, predicted


def metrics(actual, predicted):
    actual, predicted = paired(actual, predicted)
    total = float(actual.sum())
    if total <= 0:
        raise ValueError("Percentage metrics need positive total observed outflow.")
    error = predicted - actual
    positive = actual > 0
    return {
        "wmape_pct": float(np.abs(error).sum() / total * 100),
        "mape_positive_only_pct": float((np.abs(error[positive]) / actual[positive]).mean() * 100),
        "bias_pct": float(error.sum() / total * 100),
        "under_order_volume_pct": float(np.maximum(-error, 0).sum() / total * 100),
        "over_order_volume_pct": float(np.maximum(error, 0).sum() / total * 100),
    }


def select_alpha(actual, predicted, under_cost=1.0, over_cost=0.7):
    actual, predicted = paired(actual, predicted)
    if not np.isfinite([under_cost, over_cost]).all() or min(under_cost, over_cost) <= 0:
        raise ValueError("Scenario cost weights must be finite and positive.")
    grid = np.linspace(0.8, 1.5, 71)
    costs = [
        (np.maximum(actual - predicted * alpha, 0) * under_cost
         + np.maximum(predicted * alpha - actual, 0) * over_cost).sum()
        for alpha in grid
    ]
    return float(grid[int(np.argmin(costs))])
