"""Behavioral checks for leakage boundaries, inference, and inventory accounting."""
from pathlib import Path
import tempfile
import unittest

import numpy as np
import pandas as pd

from modeling.blend import ThreeTargetBlend
from modeling.evaluation import temporal_split
from modeling.features import build_features
from modeling.initial_order_model import InitialOrderModel
from modeling.inventory import excess_burden, simulate
from modeling.schema import CATEGORICAL, NUMERIC
from modeling.synthetic import generate_tables


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tables = generate_tables(n_items=40, seed=77)
        cls.frame = build_features(cls.tables)
        cls.train, cls.val, cls.test = temporal_split(cls.frame)
        cls.model = InitialOrderModel(seeds=(42,), n_estimators=20, stopping_rounds=5).fit(cls.train, cls.val)

    def test_feature_contract_and_matured_splits(self):
        self.assertEqual(len(NUMERIC) + len(CATEGORICAL), 33)
        self.assertTrue(set(NUMERIC + CATEGORICAL).issubset(self.frame))
        self.assertLessEqual(self.train.LABEL_AVAILABLE_DATE.max(), self.val.DECISION_DATE.min())
        self.assertLessEqual(self.val.LABEL_AVAILABLE_DATE.max(), self.test.DECISION_DATE.min())
        self.assertFalse(set(self.train.ITEM_CODE) & set(self.test.ITEM_CODE))
        self.assertFalse(set(self.val.ITEM_CODE) & set(self.test.ITEM_CODE))

    def test_future_information_cannot_change_current_features(self):
        target = self.test.iloc[0]
        changed = {name: table.copy(deep=True) for name, table in self.tables.items()}
        cutoff = target.DECISION_DATE
        for name in ("reservations", "shipments", "store_orders"):
            future = changed[name].EVENT_DATE > cutoff
            changed[name].loc[future, "qty"] *= 100
        changed["masters"].loc[changed["masters"].AVAILABLE_DATE > cutoff, "ST_CPM_AMT"] *= 100
        extra = changed["centers"].copy()
        extra["AVAILABLE_DATE"] = cutoff + pd.Timedelta(days=1)
        extra["store_count"] = 99999
        changed["centers"] = pd.concat([changed["centers"], extra], ignore_index=True)
        actual = build_features(changed)
        mask = self.frame.ITEM_CODE == target.ITEM_CODE
        pd.testing.assert_frame_equal(
            self.frame.loc[mask, NUMERIC + CATEGORICAL].reset_index(drop=True),
            actual.loc[actual.ITEM_CODE == target.ITEM_CODE, NUMERIC + CATEGORICAL].reset_index(drop=True),
        )

    def test_label_not_required_or_used_for_prediction(self):
        before = self.model.predict(self.test, alpha=1.0).model_qty
        after = self.model.predict(self.test.drop(columns="OPT_D"), alpha=1.0).model_qty
        np.testing.assert_array_equal(before, after)

    def test_zero_anchor_missing_features_and_unknown_category(self):
        cold = self.test.copy()
        cold.loc[cold.index[0], "RES_PREDEC_QTY"] = 0
        with self.assertRaises(ValueError):
            self.model.predict(cold)
        with self.assertRaises(ValueError):
            self.model.predict(self.test.drop(columns=NUMERIC[1]))
        unseen = self.test.copy()
        unseen["issue_type"] = "DEMO-UNSEEN"
        self.assertTrue(np.isfinite(self.model.predict(unseen).model_qty).all())
        self.assertNotIn("DEMO-UNSEEN", self.model.categories_["issue_type"])

    def test_fit_rejects_unavailable_training_labels(self):
        bad = self.train.copy()
        bad.loc[bad.index[-1], "LABEL_AVAILABLE_DATE"] = self.val.DECISION_DATE.min() + pd.Timedelta(days=1)
        with self.assertRaises(ValueError):
            InitialOrderModel(seeds=(42,), n_estimators=5).fit(bad, self.val)

    def test_model_round_trip(self):
        output = Path(__file__).resolve().parents[1] / "output"
        output.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output) as folder:
            self.model.save(folder)
            restored = InitialOrderModel.load(folder)
            np.testing.assert_allclose(self.model.predict(self.test, round_int=False).model_qty,
                                       restored.predict(self.test, round_int=False).model_qty, rtol=1e-12)

    def test_blend_validation_weights(self):
        blend = ThreeTargetBlend(seeds=(42,), n_estimators=15, stopping_rounds=5).fit(self.train, self.val)
        self.assertAlmostEqual(sum(blend.weights_), 1.0)
        self.assertTrue(all(0 <= weight <= 1 for weight in blend.weights_))
        self.assertTrue(np.isfinite(blend.predict(self.test).model_qty).all())
        # Changing held-out labels must not affect inference or selected weights.
        changed = self.test.copy()
        changed["OPT_D"] *= 1000
        np.testing.assert_allclose(blend.predict(changed).model_qty, blend.predict(self.test).model_qty)

    def test_inventory_conservation_and_capped_excess(self):
        result = simulate(10, [7, 8, 3], box_size=2, receipts=[0, 5, 0])
        self.assertAlmostEqual(15, result["served_units"] + result["ending_stock_units"])
        self.assertAlmostEqual(18, result["served_units"] + result["unmet_request_units"])
        self.assertAlmostEqual(excess_burden(100, 0, 1, cap_days=10), 950)
        self.assertAlmostEqual(excess_burden(100, 0, 0, cap_days=10), 1000)
        self.assertEqual(excess_burden(10, 20, 1), 0)


if __name__ == "__main__":
    unittest.main()
