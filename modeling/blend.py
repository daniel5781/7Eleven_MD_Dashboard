"""Optional research variant adapted from local baseline/train_blend.py."""
import numpy as np

from .initial_order_model import InitialOrderModel
from .metrics import metrics, select_alpha


class ThreeTargetBlend:
    """Average seeds within each target, then select 5%-grid weights on validation."""

    MODES = ("multiplier", "raw", "log")

    def __init__(self, **model_options):
        self.options = model_options
        self.models_ = []
        self.weights_ = None
        self.alpha_auto_ = 1.0

    def fit(self, train, validation):
        self.models_ = [
            InitialOrderModel(target_mode=mode, **self.options).fit(train, validation)
            for mode in self.MODES
        ]
        predictions = np.column_stack([
            model.predict(validation, alpha=1.0, round_int=False).model_qty
            for model in self.models_
        ])
        candidates = [(i / 20, j / 20, (20 - i - j) / 20)
                      for i in range(21) for j in range(21 - i)]
        self.weights_ = min(candidates, key=lambda w: metrics(
            validation.OPT_D, predictions @ np.asarray(w))["wmape_pct"])
        self.alpha_auto_ = select_alpha(
            validation.OPT_D, predictions @ np.asarray(self.weights_),
            self.options.get("under_cost", 1.0), self.options.get("over_cost", 0.7))
        return self

    def predict(self, frame, alpha=None, round_int=True):
        if self.weights_ is None:
            raise ValueError("Fit the blend before prediction.")
        alpha = self.alpha_auto_ if alpha is None else float(alpha)
        if not np.isfinite(alpha) or alpha <= 0:
            raise ValueError("Alpha must be finite and positive.")
        components = [m.predict(frame, alpha=1.0, round_int=False) for m in self.models_]
        out = components[0].copy()
        out["model_qty"] = np.column_stack([c.model_qty for c in components]) @ np.asarray(self.weights_)
        out["calibrated_qty"] = out.model_qty * alpha
        out["alpha"] = alpha
        if round_int:
            columns = ["model_qty", "formula_qty", "formula_recal_qty", "calibrated_qty"]
            out[columns] = np.rint(out[columns]).astype("int64")
        return out
