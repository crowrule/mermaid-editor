# Mermaid Editor

Mermaid 다이어그램을 시각적으로 편집하고 실시간 미리보기를 제공하는 웹 에디터입니다.

## 기능

- **비주얼 에디터** — 캔버스에서 노드와 엣지를 드래그로 배치하고 연결
- **실시간 미리보기** — 편집 내용이 Mermaid 렌더링 결과에 즉시 반영
- **코드 에디터** — Mermaid 구문을 직접 수정 가능
- **4가지 다이어그램 타입** — Flowchart, Sequence, ER Diagram, Class Diagram
- **내보내기** — SVG 및 PNG(2× 해상도) 다운로드

## 스크린샷

```
┌─────────────────────────────────────────────────────────┐
│  Mermaid Editor  [Flowchart ▼]               [Export ▼] │
├──────────────────────────────┬──────────────────────────┤
│                              │  Preview │ Code          │
│  Visual Editor (60%)         │                          │
│                              │  Mermaid 렌더링 결과      │
│  드래그로 노드 배치,          │  (40%)                   │
│  클릭으로 연결               │                          │
└──────────────────────────────┴──────────────────────────┘
```

## 기술 스택

| 항목 | 버전 |
|------|------|
| Vue 3 | `^3.5` |
| Vite | `^7.3` |
| Mermaid.js | `^11.12` |
| Tailwind CSS | `^3.4` |

## 시작하기

### 설치

```bash
npm install
```

### 개발 서버 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:5173` (또는 포트가 사용 중이면 `5174`)을 열어 확인합니다.

### 프로덕션 빌드

```bash
npm run build
```

빌드 결과물은 `dist/` 디렉토리에 생성됩니다.

## 프로젝트 구조

```
src/
├── App.vue                     # 루트 컴포넌트 — 상태 관리 및 레이아웃
└── components/
    ├── VisualEditor.vue        # 툴바 + DiagramCanvas 래퍼
    ├── DiagramCanvas.vue       # SVG 캔버스 (드래그, 연결, 삭제, 인라인 편집)
    ├── DiagramPreview.vue      # Mermaid 렌더링 패널 (400ms 디바운스)
    ├── DiagramEditor.vue       # 코드 편집 textarea
    ├── ToolBar.vue             # SVG/PNG 내보내기 버튼
    ├── codeGenerator.js        # nodes/edges → Mermaid 구문 생성
    └── templates.js            # 다이어그램 프리셋 (5종)
```

## 사용 방법

### 비주얼 에디터

1. 상단 드롭다운에서 다이어그램 타입을 선택합니다.
2. 좌측 패널 툴바에서 노드 타입(Process, Decision, Terminal 등)을 선택합니다.
3. 캔버스를 클릭하면 노드가 추가됩니다.
4. **Connect 모드**로 전환 후 노드를 순서대로 클릭하면 엣지가 연결됩니다.
5. 노드를 드래그해서 위치를 조정합니다.
6. 노드를 더블클릭하면 라벨을 인라인 편집할 수 있습니다.
7. 노드/엣지를 선택한 뒤 `Delete` 또는 `Backspace` 키로 삭제합니다.

### 코드 에디터

우측 탭에서 **Code**를 선택하면 생성된 Mermaid 코드를 직접 편집할 수 있습니다. 코드 변경은 즉시 미리보기에 반영됩니다.

> **참고:** 코드를 수동으로 수정하면 비주얼 캔버스에는 반영되지 않습니다.

### 내보내기

우측 상단 **Export** 버튼에서 SVG 또는 PNG를 다운로드할 수 있습니다.

## 라이선스

MIT
