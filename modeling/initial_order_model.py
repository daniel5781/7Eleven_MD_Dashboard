"""Adapted from the local v6 InitialOrderModel; see SOURCE_MAP.md.

Preserves reservation-normalized LightGBM training, seed averaging,
train-only category vocabularies and recalibration, and validation-only alpha.
No original fitted parameters or business records are included.
"""
import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from .metrics import select_alpha
from .schema import ANCHOR, CATEGORICAL, NUMERIC, SEEDS, TARGET


def assert_training_window(train, validation):
    for frame in (train, validation):
        if frame.empty:
            raise ValueError("Training and validation sets must be nonempty.")
        if not {"DECISION_DATE", "LABEL_AVAILABLE_DATE", "ITEM_CODE"}.issubset(frame):
            raise ValueError("Temporal metadata and item identifiers are required.")
    if set(train.ITEM_CODE) & set(validation.ITEM_CODE):
        raise ValueError("A product cannot occur in both train and validation.")
    boundary = pd.to_datetime(validation.DECISION_DATE).min()
    if pd.to_datetime(train.LABEL_AVAILABLE_DATE).max() > boundary:
        raise ValueError("Training labels were not available at the validation cutoff.")
    if pd.to_datetime(train.DECISION_DATE).max() >= boundary:
        raise ValueError("Train must precede validation.")


class InitialOrderModel:
    """Five-seed multiplier model, with raw/log variants for blend experiments."""

    def __init__(self, feature_cols=None, categorical=None, anchor=ANCHOR,
                 target_mode="multiplier", seeds=SEEDS, n_estimators=3000,
                 stopping_rounds=80, formula_mult=2.5, under_cost=1.0, over_cost=0.7):
        self.feature_cols = list(NUMERIC if feature_cols is None else feature_cols)
        self.categorical = list(CATEGORICAL if categorical is None else categorical)
        self.anchor = anchor
        self.fe = self.feature_cols + self.categorical
        if TARGET in self.fe or len(set(self.fe)) != len(self.fe) or anchor not in self.feature_cols:
            raise ValueError("Features must be unique, include the anchor, and exclude the label.")
        if target_mode not in {"multiplier", "raw", "log"}:
            raise ValueError("Unknown target mode.")
        if not seeds or n_estimators < 1 or stopping_rounds < 1:
            raise ValueError("Seeds and boosting limits are required.")
        if not np.isfinite(formula_mult) or formula_mult <= 0:
            raise ValueError("The formula multiplier must be finite and positive.")
        self.target_mode = target_mode
        self.seeds = tuple(seeds)
        self.n_estimators = n_estimators
        self.stopping_rounds = stopping_rounds
        self.formula_mult = formula_mult
        self.under_cost, self.over_cost = under_cost, over_cost
        self.categories_ = {}
        self.boosters_ = []
        self.k_vol_, self.k_seg_, self.alpha_auto_ = formula_mult, {}, 1.0

    def _prep(self, frame):
        missing = sorted(set(self.fe) - set(frame.columns))
        if missing:
            raise ValueError("Missing features: " + ", ".join(missing))
        result = frame.copy()
        for column in self.feature_cols:
            result[column] = pd.to_numeric(result[column], errors="raise")
            if np.isinf(result[column].to_numpy(dtype=float)).any():
                raise ValueError("Infinite feature: " + column)
        anchor = result[self.anchor].to_numpy(dtype=float)
        if not np.isfinite(anchor).all() or (anchor <= 0).any():
            raise ValueError("Positive reservation anchors required; cold starts need a separate policy.")
        for column in self.categorical:
            # Unseen categories become missing, using only the training vocabulary.
            values = result[column].astype("string")
            result[column] = pd.Categorical(values, categories=self.categories_.get(column))
        return result

    def _target(self, frame):
        target = pd.to_numeric(frame[TARGET], errors="raise").to_numpy(dtype=float)
        if not np.isfinite(target).all() or (target < 0).any():
            raise ValueError("Labels must be finite, nonnegative observed outflow.")
        if self.target_mode == "multiplier":
            return np.clip(target / frame[self.anchor].to_numpy(), 0, 30)
        return np.log1p(target) if self.target_mode == "log" else target

    def _restore(self, values, frame):
        if self.target_mode == "multiplier":
            return np.maximum(values, 0) * frame[self.anchor].to_numpy()
        if self.target_mode == "log":
            return np.maximum(np.expm1(values), 0)
        return np.maximum(values, 0)

    def fit(self, train_df, val_df):
        assert_training_window(train_df, val_df)
        missing = sorted(set(self.fe + [TARGET]) - set(train_df)) + sorted(set(self.fe + [TARGET]) - set(val_df))
        if missing:
            raise ValueError("Missing training columns: " + ", ".join(sorted(set(missing))))
        self.categories_ = {
            c: sorted(train_df[c].dropna().astype(str).unique().tolist())
            for c in self.categorical
        }
        train, validation = self._prep(train_df), self._prep(val_df)
        y_train, y_val = self._target(train), self._target(validation)
        self.boosters_ = []
        for seed in self.seeds:
            model = lgb.LGBMRegressor(
                objective="regression", metric="rmse", learning_rate=0.04,
                num_leaves=63, min_child_samples=20, colsample_bytree=0.85,
                subsample=0.85, subsample_freq=5, n_estimators=self.n_estimators,
                verbosity=-1, random_state=seed, n_jobs=1, deterministic=True,
                force_col_wise=True, bagging_seed=seed,
                feature_fraction_seed=seed, data_random_seed=seed,
            )
            model.fit(
                train[self.fe], y_train, eval_X=validation[self.fe], eval_y=y_val,
                categorical_feature=self.categorical,
                callbacks=[lgb.early_stopping(self.stopping_rounds, verbose=False)],
            )
            self.boosters_.append(model.booster_)
        self.k_vol_ = float(train[TARGET].sum() / train[self.anchor].sum())
        grouped = train.groupby("issue_type", observed=True) if "issue_type" in train else None
        self.k_seg_ = (
            (grouped[TARGET].sum() / grouped[self.anchor].sum()).to_dict()
            if grouped is not None else {}
        )
        self.alpha_auto_ = select_alpha(
            validation[TARGET], self.predict(validation, alpha=1.0, round_int=False).model_qty,
            self.under_cost, self.over_cost,
        )
        return self

    def predict(self, frame, alpha=None, round_int=True):
        if not self.boosters_:
            raise ValueError("Fit or load the model before prediction.")
        alpha = self.alpha_auto_ if alpha is None else float(alpha)
        if not np.isfinite(alpha) or alpha <= 0:
            raise ValueError("Alpha must be finite and positive.")
        prepared = self._prep(frame)
        if prepared.empty:
            raise ValueError("Prediction input must be nonempty.")
        estimates = [self._restore(b.predict(prepared[self.fe], num_threads=1), prepared)
                     for b in self.boosters_]
        out = frame.copy()
        out["model_qty"] = np.mean(estimates, axis=0)
        anchor = prepared[self.anchor].to_numpy()
        out["formula_qty"] = anchor * self.formula_mult
        segment = prepared["issue_type"].astype("string").map(self.k_seg_).fillna(self.k_vol_) if "issue_type" in prepared else self.k_vol_
        out["formula_recal_qty"] = anchor * np.asarray(segment, dtype=float)
        out["calibrated_qty"] = out.model_qty * alpha
        out["alpha"] = alpha
        if round_int:
            columns = ["model_qty", "formula_qty", "formula_recal_qty", "calibrated_qty"]
            out[columns] = np.rint(out[columns]).astype("int64")
        return out

    def predict_one(self, feature_dict, alpha=None):
        return self.predict(pd.DataFrame([feature_dict]), alpha=alpha).iloc[0].to_dict()

    def save(self, artifact_dir):
        if not self.boosters_:
            raise ValueError("Cannot save an unfitted model.")
        folder = Path(artifact_dir)
        folder.mkdir(parents=True, exist_ok=True)
        for i, booster in enumerate(self.boosters_):
            booster.save_model(str(folder / f"booster_{i}.txt"))
        metadata = {
            "format_version": 1, "feature_cols": self.feature_cols,
            "categorical": self.categorical, "anchor": self.anchor,
            "target_mode": self.target_mode, "seeds": list(self.seeds),
            "n_estimators": self.n_estimators, "stopping_rounds": self.stopping_rounds,
            "formula_mult": self.formula_mult, "under_cost": self.under_cost,
            "over_cost": self.over_cost, "n_boosters": len(self.boosters_),
            "categories": self.categories_, "k_vol": self.k_vol_,
            "k_seg": self.k_seg_, "alpha_auto": self.alpha_auto_,
        }
        (folder / "meta.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        return folder

    @classmethod
    def load(cls, artifact_dir):
        folder = Path(artifact_dir)
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
        if meta.get("format_version") != 1:
            raise ValueError("Unsupported artifact version.")
        keys = ["feature_cols", "categorical", "anchor", "target_mode", "seeds",
                "n_estimators", "stopping_rounds", "formula_mult", "under_cost", "over_cost"]
        model = cls(**{key: meta[key] for key in keys})
        model.boosters_ = [lgb.Booster(model_file=str(folder / f"booster_{i}.txt"))
                           for i in range(meta["n_boosters"])]
        model.categories_ = meta["categories"]
        model.k_vol_, model.k_seg_, model.alpha_auto_ = meta["k_vol"], meta["k_seg"], meta["alpha_auto"]
        return model
