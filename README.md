# Holo Mint

이름이 곧 뽑기권인 WebGPU 홀로그래픽 카드 사이트.
이름을 넣고 포장을 찢으면, 이름에서 정해진 등급·재질·문양의 카드가 나옵니다.

## 기능
- **개봉 연출** — 카드를 아래로 드래그해 포장을 찢습니다. 높은 등급일수록 등급 색 빛이 새어 나오며 뜸을 들입니다.
- **희귀도 5단계** — Common 60% · Rare 25% · Epic 10% · Legendary 4.5% · 1 of 1 0.5%. 같은 이름은 어느 기기에서든 같은 카드.
- **도감** — 개봉한 카드를 브라우저에 저장.
- **듀얼** — 두 이름 대결(등급 → 앞선 에디션 번호 순). 링크로 공유.
- **저장** — 투명 배경 PNG, 4초 루프 MP4(WebCodecs).
- **모바일 자이로**, 효과음(Web Audio 합성), `prefers-reduced-motion` 대응.

## 실행
```bash
npm install
npm run dev      # http://localhost:5178
npm test         # vitest
npm run build    # dist/
```
WebGPU를 지원하는 브라우저(최신 Chrome·Edge·Safari)가 필요합니다.

## 구조
| 경로 | 역할 |
|---|---|
| `src/holographic-card/` | vgpu "Holographic Card" 예제 기반 셰이더·렌더러 |
| `src/rarity.ts` | 이름 해시 → 등급·재질·문양·에디션 |
| `src/opening.ts` | 포장 찢기 연출 |
| `src/export.ts` | PNG·MP4 오프스크린 렌더 |
| `src/duel.ts` | 듀얼 화면 |
| `src/bake.ts` | 카드 글자를 텍스처 마스크로 굽기 |

## 크레딧
`src/holographic-card/`는 [vercel-labs/vgpu](https://github.com/vercel-labs/vgpu)의 Holographic Card 예제(MIT)를 바탕으로 수정했습니다. 원본 라이선스는 `src/holographic-card/LICENSE`에 있습니다.
