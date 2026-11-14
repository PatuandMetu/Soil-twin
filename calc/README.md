# calc: 유사도 독립 계산기

Field Shift 유사도 계산을 앱과 따로 다시 짠 계산기. 앱 엔진(`frontend/src/engine/`)이 식대로 계산하는지 맞춰 보는 정답지로 쓴다.

> **이 폴더는 앱 개발과 별도로 관리한다.** 앱을 개발하는 쪽은 이 폴더의 파일을 고치지 않는다. 계산기와 앱 결과가 다르면 계산기를 맞추지 말고 그 차이를 보고한다.

- 앱 코드나 config를 가져오지 않는다. 숫자와 식은 기준 문서에서 직접 옮겼다.
- 파이썬 표준 라이브러리만 쓴다.
- `frontend/`는 읽기만 한다.

## 파일

| 파일 | 하는 일 |
|---|---|
| `fscalc.py` | 계산기. 항목 점수, 종합·블록 점수, 경고, 상태, 고르기, 기후 시프트, 윤작 집계 |
| `test_fscalc.py` | 손으로 계산한 값으로 계산기를 검사 |
| `crosscheck.py` | 앱 엔진과 계산기를 모든 기준 청크 × 두 모드에서 비교 |

## 쓰는 법

`calc/` 폴더에서 실행한다.

```sh
# 두 청크의 항목별 점수와 감점
python3 fscalc.py pair ../frontend/public/data/chunks.fake.json C01-01 C03-10 [--shift]

# 기준 청크 하나의 닮은 청크와 윤작 카드
python3 fscalc.py ref ../frontend/public/data/chunks.fake.json C01-01 [--shift] [--json]

# 계산기 테스트
python3 -m unittest -v test_fscalc

# 앱 엔진과 비교 (인자 없으면 ../frontend와 chunks.fake.json)
python3 crosscheck.py [<frontend 폴더>] [<chunks.json>]
```

`crops.json`은 데이터 파일과 같은 폴더에서 읽는다. `crosscheck.py`는 `frontend/node_modules`의 rolldown을 쓰므로 `frontend`에서 `npm install`이 되어 있어야 한다.

## 계산 경로

- 가우시안을 `exp(−ln2·r²)` 대신 `2^(−r²)`로 계산한다. 수학적으로 같은 식을 다른 경로로 계산해서, 앱과 같은 코드를 베낀 실수를 하지 않게 한다.
- 문턱·경계 비교(τ, 시프트 게이트, 상태, 경고)는 전부 소수 9자리에서 반올림한 값으로 한다. 계산 경로가 달라도 판정은 같아야 한다. 예: pH 7.3과 8.3의 차이는 1.0이라 "1.0 초과" 경고가 없다.

## 식이 바뀌면

`fscalc.py` 맨 위의 `P`와 해당 함수를 기준 문서에 맞춰 고치고, `test_fscalc.py`에 손으로 계산한 기대값을 추가한다. 앱 쪽 수정이 맞는지는 그다음 `crosscheck.py`로 본다.
