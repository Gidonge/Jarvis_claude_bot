# OpenRouter Discord 봇

## 사용법 (명령어 없음, 그냥 멘션하면 됨)
이 봇은 슬래시 커맨드가 없습니다. 디스코드 채널에서 봇을 **@멘션**하면서 말을 걸면 그게 곧 사용법이에요.

예:
```
@봇이름 안녕! 오늘 날씨 어때?
```

봇이 멘션을 감지하면 OpenRouter API로 질문을 보내고, 답변을 채널에 그대로 출력합니다.
같은 채널 안에서는 최근 대화(최대 10개)를 기억해서 이어지는 대화처럼 답할 수 있어요. (봇을 재시작하면 기억은 초기화됩니다)

## API 키 발급 (무료)

1. https://openrouter.ai 접속 → 이메일 또는 GitHub 계정으로 가입 (카드 등록 필요 없음)
2. 우측 상단 프로필 → **Keys** 메뉴 → **Create Key** 클릭
3. 발급된 키를 복사해서 보관 (다시 안 보임)

이 봇은 기본적으로 `openrouter/free`라는 모델을 사용해요. 이건 그때그때 사용 가능한 무료 모델 중 하나를 자동으로 골라주는 라우터라서 관리가 편해요.
특정 모델을 고정하고 싶으면 `index.js`의 `MODEL` 값을 openrouter.ai/models 에서 `:free`로 끝나는 모델 ID로 바꾸면 됩니다.

**무료 모델 사용 제한**: 분당 20회, 하루 50회(계정에 크레딧을 한 번도 충전 안 한 경우) 또는 하루 1,000회(한 번이라도 $10 이상 충전한 적 있는 경우)로 제한됩니다. 개인/친구들끼리 쓰는 용도면 하루 50회도 충분한 경우가 많아요.

## 실행 방법

1. 이 폴더에서 의존성 설치
   ```
   npm install
   ```

2. `.env.example`을 `.env`로 이름 변경하고 값 채우기
   ```
   DISCORD_TOKEN=디스코드_봇_토큰
   OPENROUTER_API_KEY=OpenRouter_API_키
   ```

3. 봇 실행
   ```
   npm start
   ```

4. 터미널에 `로그인 완료: 봇이름#0000` 이 뜨면 성공. 이제 디스코드 채널에서 봇을 멘션해보세요.

## 체크할 것 (막힐 때)
- Discord Developer Portal → Bot 탭 → **Privileged Gateway Intents**에서 **Message Content Intent**가 켜져 있어야 메시지 내용을 읽을 수 있습니다.
- 봇을 서버에 초대할 때 권한에 "메시지 보내기(Send Messages)"가 포함되어 있어야 합니다.
- 무료 모델은 사용량이 몰리면 응답이 느리거나 일시적으로 막힐 수 있어요. 에러가 잦으면 `index.js`의 `MODEL`을 다른 `:free` 모델로 바꿔보세요.

## 배포 (Railway 기준)
1. 이 폴더의 파일들을 GitHub 리포지에 올림 (.env는 올리지 않기)
2. Railway → New Project → Deploy from GitHub repo → 해당 리포지 선택
3. Variables 탭에서 DISCORD_TOKEN, OPENROUTER_API_KEY 등록
4. Deploy Logs에서 "로그인 완료"가 뜨면 정상 작동
