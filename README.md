# island-review-tool

아이용 컬러링 앱 이미지 생성 파이프라인의 리뷰 도구입니다.
fal.ai 기반 5단계 파이프라인으로 이미지를 생성하고, 웹 UI에서 아이템별 pass/fail 리뷰 및 재생성을 수행합니다.

![screenshot](docs/screenshot-placeholder.png)

## 빠른 시작

```bash
git clone https://github.com/apsntian/island-review-tool.git
cd island-review-tool
pip install -r requirements.txt
cp .env.example .env
# .env 파일에서 FAL_KEY를 설정하세요
python app.py
```

브라우저에서 `http://localhost:7788` 접속

## 주요 기능

- **아이템 리뷰**: 카테고리별(fruits, vegetables, everyday) 이미지 pass/fail 판정
- **단일/일괄 재생성**: fail 아이템을 fal.ai 파이프라인으로 재생성
- **LLM 배경 프롬프트**: openclaw 에이전트(claude-haiku)가 아이템별 배경 설명 생성
- **코멘트 반영**: 재생성 시 한국어 코멘트로 방향 지정 가능

## openclaw 에이전트 셋업

자동 셋업 방법은 [AGENTS.md](AGENTS.md) 참조

## 파이프라인 상세

5단계 fal.ai 파이프라인 설명은 [PIPELINE.md](PIPELINE.md) 참조
