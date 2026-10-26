"""The local v6 model's 30 numerical + 3 categorical feature contract."""
NUMERIC = [
    "RES_PREDEC_QTY", "RES4_REG_QTY", "RES_PREDEC_STR", "RES4_REG_STR",
    "velocity", "frontload", "span", "hhi", "lead", "maxday", "store_vel",
    "center_store_pool", "center_reserve_coverage", "reserve_qty_center_share",
    "reserve_qty_per_store", "reserve4_qty_ratio", "min_order_cost", "owner_roi_score",
    "ST_CPM_AMT", "PRF_RT", "ITEM_CPCT_VAL", "ORD_SUPP_EVN_AMT",
    "ORD_SUPP_EVN_CND_QTY", "support_per_unit", "effective_margin_rate",
    "CENTER_AVG_OUTFLOW_CAT", "cf_prior_resv_scale",
    "nb_demand_per_store", "nb_mult", "over_index_qty",
]
CATEGORICAL = ["CENTER_CODE", "MDDV_X_CENTER_ENC", "issue_type"]
TARGET = "OPT_D"
ANCHOR = "RES_PREDEC_QTY"
SEEDS = (42, 202, 404, 101, 777)
