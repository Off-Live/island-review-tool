# AGENTS.md — island-review-tool 자동 셋업

## 목적
이 레포는 아이용 컬러링 앱 이미지 생성 파이프라인의 리뷰 도구입니다.
fal.ai를 사용해 이미지를 생성하고, 웹 UI에서 아이템별 pass/fail 리뷰 및 재생성이 가능합니다.

## 셋업 (에이전트가 실행할 것)

### 1. 의존성 설치
```
pip install -r requirements.txt
```

### 2. .env 파일 생성
FAL_KEY를 사용자에게 요청하거나 환경에서 가져와서 `.env` 파일을 생성:
```
FAL_KEY=...
IMAGES_DIR=../island-images/island-images
PORT=7788
```

### 3. island-prompt 에이전트 등록 (LLM 배경 프롬프트 생성용)
```
openclaw agents create island-prompt --model anthropic/claude-haiku-4-5 --workspace workspace-island-prompt
```
이 에이전트가 없으면 배경 프롬프트 생성이 fallback으로 처리됩니다 (기본 프롬프트 사용).

### 4. 서버 실행
```
python app.py
```

### 5. (선택) Cloudflare 터널로 외부 접근
```
cloudflared tunnel --url http://localhost:7788
```

## 이미지 디렉토리 구조
IMAGES_DIR 아래에 다음 구조가 필요합니다:
```
{IMAGES_DIR}/
  fruits/
    apple-object.png
    apple-object-orig.png
    apple-scene.png
    apple-background.png
    ...
  vegetables/
    ...
  everyday/
    ...
```

## 파이프라인 상세
PIPELINE.md 참조
