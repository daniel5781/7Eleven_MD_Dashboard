# 7-Eleven MD · Inventory Decision Dashboard

**신상품 초도발주를 예측 결과와 연결하는 의사결정 대시보드**

[![Portfolio demo](https://github.com/daniel5781/7Eleven_MD_Dashboard/actions/workflows/pages.yml/badge.svg)](https://github.com/daniel5781/7Eleven_MD_Dashboard/actions/workflows/pages.yml)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)](https://vite.dev/)

[**데모 열기 →**](https://daniel5781.github.io/7Eleven_MD_Dashboard/) · [프로젝트 설명](docs/PROJECT.md) · [원본 팀 저장소](https://github.com/Geonhohoho/7Eleven_MD_Dashboard)

> **공개 포트폴리오 데모입니다.** 화면의 상품, 센터, 예약·판매·발주 수치와 예측값은 코드로 만든 합성 데이터입니다. 실제 운영 시스템이나 모델 성능을 나타내지 않습니다.

## 문제와 접근

신상품은 판매 이력이 짧아 일률적인 발주 배수만으로 상품과 센터의 차이를 반영하기 어렵습니다.
팀 프로젝트는 예약 수요와 예측 결과를 MD가 검토·조정할 수 있는 화면으로 연결했습니다.

| 단계 | 대시보드에서 확인하는 내용 |
| --- | --- |
| 수요 파악 | 출시 전 예약 추이, 유사상품 비교 |
| 추천량 검토 | 모델 추천량과 현재 입력량, 박스·EA 환산 |
| 센터 배분 | 센터별 예약·점포 비중과 배분 수량 |
| 의사결정 | 발주량 조정, 검토 사유, 화면 내 확정 |
| 사후 점검 | 과거 신상품의 발주·출고·판매 흐름 |

공개 데모의 확정 상태는 브라우저 안에서만 유지됩니다. 실제 발주 요청은 전송하지 않습니다.

## 실행

Node.js 24 이상을 권장합니다.

```bash
git clone https://github.com/daniel5781/7Eleven_MD_Dashboard.git
cd 7Eleven_MD_Dashboard
npm ci --ignore-scripts
npm run dev
```

이름은 자유롭게 입력하고, 데모 접속 코드 `711`로 들어갑니다.
접속 코드는 화면 흐름을 보여주는 장치이며 인증 기능이 아닙니다.
외부 API 키, Python 환경, 기업 원자료 없이 실행할 수 있습니다.

```bash
npm run demo:data    # 합성 데이터 재생성 — 원본 자료를 읽지 않음
npm run check:data   # 공개 데이터 식별자·용량·배분 합계 확인
npm run build       # 배포용 빌드
```

## 공개본 구성

```text
src/                         React 대시보드
public/data/                 직접 생성한 합성 JSON 3개
scripts/generate-demo-data.mjs
scripts/check-public-data.mjs
docs/PROJECT.md              문제 정의·모델 연결·공개 범위
.github/workflows/pages.yml  데이터 확인·빌드·데모 배포
```

원본 CSV·Parquet, 학습 데이터, 모델 가중치, 원본 화면 캡처, API 키와 원본 Git 이력은 포함하지 않았습니다.
지도는 외부 키 없이 예시 좌표를 사용하며 검토 코멘트는 로컬 규칙 기반 예시입니다.

## 출처와 기여 구분

**Daniel의 담당:** PM, 데이터 전처리, 예측 모델 검증, 재고 시뮬레이션, 대시보드 구현.
프로젝트 진행과 분석·검증을 맡고, 결과를 발주 의사결정 화면에 연결하는 구현에 참여했습니다.

이 대시보드의 원본 팀 구현은
[Geonhohoho/7Eleven_MD_Dashboard](https://github.com/Geonhohoho/7Eleven_MD_Dashboard)이며,
기준 커밋은 [`21c6455`](https://github.com/Geonhohoho/7Eleven_MD_Dashboard/commit/21c6455adc1a9995f5d4cbc49dec78166eca1a6c)입니다.
팀 결과와 개인 담당 범위를 함께 표기합니다.

이 저장소는 Daniel의 프로젝트 소개를 위해 합성 데이터, 공개용 설정, 설명 문서와 검증 절차를 추가한 별도 보관본입니다.
팀 프로젝트의 분석·모델링 맥락과 화면의 관계는 [프로젝트 설명](docs/PROJECT.md)에 정리했습니다.

원본 저장소에는 별도 라이선스 파일이 없습니다. 원본 코드에 새로운 오픈소스 라이선스를 임의로 부여하지 않았으며,
상표와 원본 구현에 대한 권리는 각 권리자에게 있습니다.
