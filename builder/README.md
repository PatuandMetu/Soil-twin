# builder: 실데이터 테이블 만들기

`frontend/public/data/chunks.json`과 `crops.json`을 만드는 스크립트. 원천 자료를 한 번 받아 `raw/`에 저장해 두고, 그다음은 오프라인으로 테이블을 만든다.

## 폴더

| 경로 | 내용 | git |
|---|---|---|
| `step1_sample_csb.py` | CSB에서 청크 표본 추출 → `raw/raw_csb_sample.json`, `raw/crops.json` | 포함 |
| `step2_fetch_remote.py` | NASA POWER(기후 칸별 2001~2025 일별), SSURGO SDA 토양 속성(청크별), 토양 구역별 청크와 겹친 넓이(청크별) 받기 → `raw/raw_power/`, `raw/raw_ssurgo.jsonl`, `raw/raw_ssurgo_area.jsonl` | 포함 |
| `step3_build_table.py` | 원천 응답으로 테이블 계산·검사 → `../frontend/public/data/chunks.json`, `crops.json` | 포함 |
| `source/` | CSB 원본 (`NationalCSB_2018-2025_rev23.zip`, 압축 푼 `CSB1825.gdb`, 메타데이터) | 제외 |
| `raw/` | 원천 응답 저장소 | 제외 |

## 원본 받기

CSB 2018~2025 전국 파일(3.76 GB)을 NASS에서 받아 `source/`에 풀어 둔다.

- 페이지: https://www.nass.usda.gov/research-and-science/crop-sequence-boundaries
- 파일: `NationalCSB_2018-2025_rev23.zip` → `source/CSB1825.gdb`

## 실행

저장소 루트에서 실행한다.

```sh
uv run --with-requirements builder/requirements.txt python builder/step1_sample_csb.py   # GDAL 내장 pyogrio 필요
python3 builder/step2_fetch_remote.py   # 네트워크. 이미 받은 칸·청크는 건너뛴다
python3 builder/step3_build_table.py    # 오프라인. 표준 라이브러리만 씀
```

2·3단계는 표준 라이브러리만 쓴다. 3단계만 다시 돌리면 `raw/`에서 같은 테이블이 다시 나온다.

## 1단계 표본 기준 (코드 기준)

- 본토 48개 주, 위도 25~49, 경도 −124.5~−67
- 면적 15~400 에이커
- 8년 작물 코드가 전부 작물 이름표에 있고, 주요 수확 작물이 2년 이상, 2번 이상 나온 작물이 있음(빈 패턴 아님)
- 조건을 만족하는 청크가 6개 이상인 기후 칸 중 280개를 본토에 고르게(위도 2° × 경도 2.5° 묶음 단위로 돌아가며) 고름
- 전국 파일의 40번째 행마다 속성을 읽어 후보로 씀
- 칸마다 최대 20개를 무작위로 고름(칸마다 시드 고정). 윤작 패턴과 상관없이 뽑아서, 카드의 윤작 비율이 표본 안에서 왜곡되지 않음
- 칸 고르기는 `random.seed(42)`

## 3단계 토양 값

청크의 토양 값 = Σ(토양 구역이 청크 경계와 겹친 넓이 비율 × 구역 안 토양 종류 구성비 × 그 토양의 0~30 cm 두께 가중 값). 흙이 아닌 땅(도시·물·기타)의 몫이 30%를 넘거나, 값을 쓸 수 있는 토양 종류의 몫이 60% 미만이면 그 청크를 뺀다.
