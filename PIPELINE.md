# Island Images 생성 파이프라인

> 현재 확정된 방법 (2026-03-14 기준, apple로 검증 완료)

---

## 스타일 (STYLE)

모든 이미지에 공통 적용:

```
Children's coloring book illustration, clean black outlines, smooth flat colors
with subtle shading, moderate detail, appealing rounded shapes, slightly realistic
proportions, no face, no expression, no anthropomorphization.
```

---

## 출력물 (아이템당 4개 파일)

| 파일 | 설명 |
|------|------|
| `{item}-object-orig.png` | 흰 배경 원본 오브젝트 |
| `{item}-object.png` | 투명 배경 오브젝트 (BiRefNet 처리) |
| `{item}-scene.png` | 배경 포함 전체 씬 |
| `{item}-background.png` | 오브젝트 제거된 배경만 |

---

## 파이프라인 5단계

### Step 1 — 오브젝트 생성
**모델**: `fal-ai/nano-banana-2`  
**aspect_ratio**: `4:3`

```
{item}, centered, with at least 25% white margin on every side (top, bottom, left, right),
object occupies no more than 50% of image width and height,
single object only, plain white background.
{STYLE}
```

- item은 그냥 이름 그대로 (`apple`, `carrot` 등)
- 여백을 명시적으로 지정해서 오브젝트가 적당한 크기로 나오게 함

---

### Step 2 — 배경 제거
**모델**: `fal-ai/birefnet/v2`

- 흰 배경이므로 BiRefNet이 깔끔하게 분리
- → `object.png` (투명 배경)

---

### Step 3 — 씬 생성 (배경 채우기)
**모델**: `fal-ai/nano-banana-2/edit`  
**입력**: Step 1 원본(흰 배경) + 프롬프트

```
Keep the {item} exactly as is, do not modify it at all.
Close-up shot, zoomed in.
Fill the white background with {bg_desc}.
{STYLE}
```

- **핵심**: `Close-up shot, zoomed in` — 없으면 모델이 오브젝트를 자연스러운 비율로 축소시킴
- `bg_desc`는 LLM(`island-prompt` 에이전트, claude-haiku)이 아이템별로 생성
  - 코멘트 있으면 한국어 코멘트 반영
  - 예: `"a sunny orchard with apple trees and green grass"`

---

### Step 4 — 마스크 생성 (PIL)

- Step 2의 `object.png` 알파채널에서 오브젝트 영역 추출
- 씬 이미지 위에 오브젝트 영역을 **빨간색(반투명 60%)으로 오버레이** 합성
- → `scene_masked.png` (nano-banana에게 "어느 영역을 지울지" 알려주는 입력)

```python
# 핵심 로직
alpha = np.array(obj_img)[:, :, 3]
obj_mask = alpha > 30
# dilate로 경계 살짝 확장
blended[obj_mask] = (0.4 * scene_arr[obj_mask] + 0.6 * red_overlay[obj_mask])
```

---

### Step 5 — 배경 생성 (오브젝트 제거)
**모델**: `fal-ai/nano-banana-2/edit`  
**입력**: Step 4 마스크 합성 이미지 + 프롬프트

```
Remove the red-highlighted {item} and fill the area naturally
with {bg_desc}. Make it look like the {item} was never there.
{STYLE}
```

- → `background.png`

---

## 배경 프롬프트 생성 (LLM)

**에이전트**: `island-prompt` (openclaw, claude-haiku-4-5)  
**특징**: 호출마다 새 UUID 세션 → 완료 후 즉시 삭제 (세션 누적 없음)

```
You are a prompt engineer for a children's coloring book image generator.
Generate ONE background scene description (1-2 sentences, English) for "{item}"
in a {category} coloring book illustration.
The object is large and close-up, filling most of the frame.
The scene should be cheerful, simple, and child-friendly.
[User feedback (Korean): "{comment}"]  ← 코멘트 있을 때만 포함
Reply with ONLY the background scene description, nothing else.
```

---

## 핵심 발견 사항

| 시도 | 결과 |
|------|------|
| `nano-banana/edit`에 `fills most of the frame` | 오브젝트가 너무 커짐 |
| `nano-banana/edit`에 아무 크기 힌트 없음 | 모델이 오브젝트를 자연 비율로 축소 (30% 수준) |
| `Close-up shot, zoomed in` | ✅ 오브젝트 크기 잘 유지됨 |
| 오브젝트 생성에 `large and centered` | 오브젝트가 화면 80% 이상 차지, 너무 큼 |
| 오브젝트 생성에 `25% margin, 50% max` | ✅ 적당한 크기 |
| flux-pro/fill로 배경 생성 | 퀄리티 불만족, 사용 안 함 |
| SAM-3으로 씬→오브젝트 추출 | 퀄리티 불만족, 사용 안 함 |
| 복잡한 씬에서 BiRefNet 추출 | 배경 블리드, 사용 안 함 |

---

## fal.ai 모델 요금

| 모델 | 요금 |
|------|------|
| `nano-banana-2` (generate) | $0.08/image |
| `nano-banana-2/edit` | $0.08/image |
| `birefnet/v2` | 저렴 |
| `sam-3/image` | $0.005/req |
