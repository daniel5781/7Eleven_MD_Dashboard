"""Illustrative inventory scenarios; observed shipments are not uncensored demand."""
import numpy as np


def simulate(initial_units, requested_outflow, box_size=1, receipts=None):
    """Daily lost-request scenario: no backlog; arrivals occur before outflow.

    Default receipts are zero. The input is a scenario request series, not proof of
    customer demand. 'Unmet' does not establish realized lost sales or savings.
    """
    demand = np.asarray(requested_outflow, dtype=float)
    arrivals = np.zeros_like(demand) if receipts is None else np.asarray(receipts, dtype=float)
    if demand.ndim != 1 or not demand.size or arrivals.shape != demand.shape:
        raise ValueError("Demand and receipts must be equally sized daily series.")
    if not np.isfinite([initial_units, box_size]).all() or initial_units < 0 or box_size <= 0:
        raise ValueError("Initial stock must be nonnegative and box size positive.")
    if not np.isfinite(demand).all() or not np.isfinite(arrivals).all() or (demand < 0).any() or (arrivals < 0).any():
        raise ValueError("Daily quantities must be finite and nonnegative.")
    stock, served, unmet, stock_days = float(initial_units), 0.0, 0.0, 0.0
    for request, receipt in zip(demand, arrivals):
        stock += receipt
        dispatched = min(stock, request)
        stock -= dispatched
        served += dispatched
        unmet += request - dispatched
        stock_days += stock / box_size
    return {"served_units": served, "unmet_request_units": unmet,
            "ending_stock_units": stock, "closing_stock_box_days": stock_days}


def excess_burden(order, observed_outflow, normal_daily_outflow, box_size=1, cap_days=120):
    """Generalized v6 excess-inventory proxy: integrate max(E - r*t, 0).

    With no cap this is E^2/(2*r). Unlike the original triangular approximation,
    a binding cap integrates the remaining trapezoid; r=0 keeps stock constant.
    This is a retrospective scenario, not a forecast feature or cost estimate.
    """
    values = np.asarray([order, observed_outflow, normal_daily_outflow, box_size, cap_days], float)
    if not np.isfinite(values).all() or min(values[:3]) < 0 or min(values[3:]) <= 0:
        raise ValueError("Invalid inventory scenario parameters.")
    excess = max(order - observed_outflow, 0)
    duration = min(excess / normal_daily_outflow, cap_days) if normal_daily_outflow else cap_days
    return float((excess * duration - 0.5 * normal_daily_outflow * duration**2) / box_size)
