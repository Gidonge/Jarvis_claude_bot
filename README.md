# Claude Discord 봇

## 사용법 (명령어 없음, 그냥 멘션하면 됨)
이 봇은 슬래시 커맨드가 없습니다. 디스코드 채널에서 봇을 **@멘션**하면서 말을 걸면 그게 곧 사용법이에요.

예:
```
@봇이름 안녕! 오늘 날씨 어때?
```

봇이 멘션을 감지하면 Claude API로 질문을 보내고, 답변을 채널에 그대로 출력합니다.
같은 채널 안에서는 최근 대화(최대 10개)를 기억해서 이어지는 대화처럼 답할 수 있어요. (봇을 재시작하면 기억은 초기화됩니다)

## 실행 방법

1. 이 폴더에서 의존성 설치
   ```
   npm install
   ```

2. `.env.example`을 `.env`로 이름 변경하고 값 채우기
   ```
   DISCORD_TOKEN=디스코드_봇_토큰
   ANTHROPIC_API_KEY=Anthropic_API_키
   ```
   - Discord 토큰: Discord Developer Portal → 내 애플리케이션 → Bot 탭에서 확인
   - Anthropic API 키: https://console.anthropic.com 에서 발급

3. 봇 실행
   ```
   npm start
   ```

4. 터미널에 `로그인 완료: 봇이름#0000` 이 뜨면 성공. 이제 디스코드 채널에서 봇을 멘션해보세요.

## 체크할 것 (막힐 때)
- Discord Developer Portal → Bot 탭 → **Privileged Gateway Intents**에서 **Message Content Intent**가 켜져 있어야 메시지 내용을 읽을 수 있습니다. 꺼져있으면 봇이 멘션에 반응하지 않아요.
- 봇을 서버에 초대할 때 권한에 "메시지 보내기(Send Messages)"가 포함되어 있어야 합니다.
- `npm install` 시 에러가 나면 Node.js 버전이 18 이상인지 확인하세요.

## 배포 (24시간 운영하려면)
로컬 PC를 껐을 때도 계속 켜두려면 Railway나 Render 같은 곳에 이 폴더를 그대로 올리고, 환경변수(DISCORD_TOKEN, ANTHROPIC_API_KEY)를 배포 플랫폼 설정에 등록하면 됩니다.
