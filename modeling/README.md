# 초기 출고량 예측 모델링 · 공개 실행 패키지

[← 프로젝트 홈](../README.md) · [코드 출처와 변경점](SOURCE_MAP.md) · [합성 실행 보고서](examples/synthetic-report.json)

로컬 v6 모델의 핵심 학습·추론 흐름을 **기업 파일 없이 실행할 수 있도록** 정리했습니다.
Python 코드가 실제로 모델을 학습합니다. 공개한 데이터 생성 규칙과 실행 점수는 모두 설명용입니다.

예측 타깃은 **출시일부터 4일간의 센터 → 점포 출고량**입니다.
모델 출력과 α 보정 수량은 발주 검토를 위한 비교값이며, 소비자 최종 수요나 최적 발주량을 뜻하지 않습니다.

## 무엇을 유지했나

- LightGBM으로 `OPT_D / RES_PREDEC_QTY`를 학습하고 예약량을 곱해 출고량으로 복원.
- 배수 타깃의 0~30 클리핑, 5개 시드 `42, 202, 404, 101, 777` 평균.
- 수치 30개 + 범주 3개로 구성된 [33개 피처](schema.py).
- 학습 데이터만으로 만드는 범주 사전과 재산정 배수.
- 검증 구간에서 α를 선택하고 이후 구간의 과소·과다 발주를 평가.
- 모델의 `fit / predict / predict_one / save / load` 흐름.

추가로 [3타깃 블렌드](blend.py)를 실행할 수 있습니다.
배수·원수량·로그 모델을 학습해 5% 간격의 가중치를 검증 데이터에서 선택합니다.
원본 전달 패키지의 기본 모델은 배수 앙상블입니다.

## 실행

Python 3.13, 저장소 루트 기준입니다.

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r modeling/requirements-lock.txt

# 기본 모델 + 월별 재학습 검증
python -m modeling.demo --trees 200 --walk-forward

# 추가 아키텍처 실험
python -m modeling.demo --mode blend --trees 200 --output modeling/output/blend

# 누수 방지, 저장/복원, 입력 조건, 재고 수량 보존 검사
python -m unittest discover -s modeling/tests -v
```

기본 모델 클래스는 원본처럼 최대 3,000트리를 허용합니다.
공개 실행 예제는 시간을 줄이기 위해 `--trees 200`을 사용합니다.
실험 규모는 `--items`, 재현 시드는 `--seed`, 가정한 비용 비중은 `--under-cost / --over-cost`로 조정합니다.
금액이나 기업의 실제 비용 비율을 입력한 것으로 해석하지 않습니다.

## 입력과 피처

[synthetic.py](synthetic.py)가 다음 정규화 테이블을 메모리에서 생성합니다.
외부 CSV·원본 데이터 경로를 자동으로 찾거나 읽지 않습니다.

| 테이블 | 핵심 필드 | 용도 |
| --- | --- | --- |
| items | ITEM_CODE, CATEGORY, NP_RLSE_YMD, DECISION_DATE, issue_type, box_size | 상품·결정 시점 |
| masters | ITEM_CODE, AVAILABLE_DATE, 가격·원가·장려금·규격 | 결정일 이전 마스터 |
| centers | CENTER_CODE, AVAILABLE_DATE, store_count | 결정일 이전 센터 규모 |
| reservations | ITEM_CODE, CENTER_CODE, STORE_CODE, EVENT_DATE, qty | 예약 수요와 참여 점포 |
| shipments | ITEM_CODE, CENTER_CODE, EVENT_DATE, qty | 출시 후 4일 출고 라벨 |
| store_orders | CATEGORY, STORE_CODE, EVENT_DATE, qty | 과거 점포·상품군 친화도 |

[features.py](features.py)는 이 테이블을 상품 × 센터별 피처로 바꿉니다.

| 피처군 | 예시 |
| --- | --- |
| 예약 규모·확산 | 예약량, 초기 4일 예약량, 예약 점포수, 센터 커버리지 |
| 예약 동역학 | 속도, 초기 집중도, 기간, 점포별 집중도, 최대 일자 비중 |
| 상품 경제성 | 발주 부담, 원가·마진, 장려금, 규격 |
| 센터·과거 이력 | 센터·분류별 과거 출고, 점포 친화도, 지역 수요 비중 |
| 공동예약 이웃 | 예약 점포 집합의 cosine 유사도, 과거 20개 이웃의 가중 중앙값 |

신규 상품 자신의 출시 후 출고량은 정답 열에만 들어갑니다.
과거 이웃의 출고량은 **4일 라벨이 모두 확정된 뒤**에만 참조합니다.
이력 부족은 NaN으로 남겨 LightGBM에서 처리하고, 검증·테스트 통계로 채우지 않습니다.
예약이 없는 상품은 이 모델의 범위 밖이며 별도 정책이 필요합니다.

## 검증 설계

1. 상품의 결정일 순서로 60% / 20% / 20% 구간을 정합니다.
2. 다음 구간의 첫 결정일까지 라벨이 확정되지 않은 경계 행을 제외합니다.
3. 상품 전체가 같은 구간에 남도록 하여 센터 행이 서로 다른 구간에 섞이지 않게 합니다.
4. 조기 종료, 블렌드 가중치와 α는 검증 구간에서 선택합니다.
5. 테스트에서 WMAPE, 양수 라벨 대상 MAPE, Bias, 과소·과다 발주 물량 비율을 보고합니다.
6. walk-forward에서는 매월 첫 예측 시점까지 확정된 데이터만 사용하고 직전 2개월을 검증 창으로 둡니다.

과거 라벨을 사용하는 피처는 각 예측 시점에 갱신됩니다.
따라서 앞선 테스트 상품의 실적이 충분히 확정된 뒤 다음 상품의 이력으로 활용될 수 있습니다.
이는 모든 테스트 라벨을 미리 사용하는 방식과 구별되는 순차적 평가입니다.

공개 예제는 일 단위 자료에서 라벨 확정을 출시일 +4일로 가정합니다.
실제 운영에서는 입수·정정 지연을 반영한 가용 시각이 필요합니다.
출고 실적은 재고 제약으로 억눌릴 수 있어, 검증 점수를 최종 수요 예측 정확도로 해석하지 않습니다.

## 재고 시나리오

[inventory.py](inventory.py)는 두 가지 비교를 제공합니다.

- **일별 수량 보존 시뮬레이션:** 초도 수량에 입고를 더하고 요청 출고를 차감합니다. 기본 예제는 추가 입고·백로그 없이 4일을 비교합니다.
- **초과 재고 부담:** 초과분 E가 일별 출고 r로 소진된다고 가정해 재고 면적을 적분합니다. 상한이 없으면 E²/(2r), 상한에 도달하면 남은 재고를 포함한 면적을 계산합니다.

출고 실적을 요청량의 대용치로 쓰므로 `unmet_request_units`는 가정 아래의 미충족 물량입니다.
실제 결품·판매 기회 손실이나 비용 절감액을 뜻하지 않습니다.
공개 예제의 정상기 출고율은 4일 평균으로 단순화했으며 원본의 장기 재고 분석과 동일하지 않습니다.

## 출력과 대시보드 연결

`modeling/output/`에 다음이 생깁니다. 생성 결과는 Git에서 제외합니다.

| 결과 | 내용 |
| --- | --- |
| report.json | 합성 데이터 표시, 분할·환경, 지표, 재고 시나리오, 선택적 월별 검증 |
| predictions.json | 테스트의 상품·센터별 예측 수량과 합성 데이터 출처 |
| artifact/ | 이번 실행에서 새로 학습한 모델 텍스트와 메타데이터 |

```python
from modeling.initial_order_model import InitialOrderModel

model = InitialOrderModel.load("modeling/output/artifact")
prediction = model.predict(feature_df)  # 33개 피처 필요, OPT_D는 필요 없음
# model_qty, formula_qty, formula_recal_qty, calibrated_qty, alpha
```

`model_qty`는 보정 전 예측, `calibrated_qty`는 α 보정 시나리오 수량입니다.
모두 EA 단위이며 화면의 박스 수량으로 표시할 때는 상품별 박스입수로 환산해야 합니다.
블렌드 실행은 세 하위 모델과 가중치 메타데이터를 저장하며 위 기본 모델의 단일 `load()` 대상과 다릅니다.

현재 웹의 12개 상품·5개 센터 fixture와 Python 예제의 가상 상품·4개 센터는 **독립된 예제**입니다.
웹은 고정 JSON을 읽습니다. Python 결과를 표시하려면 상품·센터 키와 단위를 매핑해
`mlRecommendQty` 및 센터 배분 구조로 변환해야 하며, 이 공개본은 자동 연결을 수행하지 않습니다.

## 재현 범위

원본과 달라진 전처리·추론 조건 및 시드 결합 순서는 [SOURCE_MAP.md](SOURCE_MAP.md)에 기록했습니다.
실제 데이터의 재현 성능이나 모델 가중치 일치성을 주장하지 않습니다.
구현에 사용한 API는 [LightGBM 공식 문서](https://lightgbm.readthedocs.io/en/stable/pythonapi/lightgbm.LGBMRegressor.html)를 참고했습니다.
