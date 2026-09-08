import { Client, GatewayIntentBits, Partials } from "discord.js";
import dotenv from "dotenv";

dotenv.config();

// 무료 모델 자동 선택 라우터. 특정 모델을 고정하고 싶으면
// 예: "meta-llama/llama-3.1-405b-instruct:free" 처럼 :free로 끝나는 모델 ID로 바꾸세요.
const MODEL = "openrouter/free";
const SYSTEM_PROMPT = "너는 디스코드 서버에서 사용자들을 돕는 친절한 AI 어시스턴트야. 답변은 간결하게 해줘.";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// 채널별 최근 대화 기록 (메모리 저장, 봇 재시작 시 초기화됨)
const historyByChannel = new Map();
const MAX_HISTORY = 10; // 채널당 최근 10개 메시지까지만 기억

client.once("ready", () => {
  console.log(`로그인 완료: ${client.user.tag}`);
});

async function askOpenRouter(messages) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API 오류 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "(응답을 받지 못했어요)";
}

client.on("messageCreate", async (message) => {
  // 봇 자신의 메시지는 무시
  if (message.author.bot) return;

  // 봇이 멘션되었을 때만 반응 (예: @봇이름 안녕)
  if (!message.mentions.has(client.user)) return;

  const userText = message.content
    .replace(/<@!?\d+>/g, "") // 멘션 태그 제거
    .trim();

  if (!userText) {
    await message.reply("무엇을 도와드릴까요?");
    return;
  }

  const channelId = message.channel.id;
  const history = historyByChannel.get(channelId) ?? [];

  history.push({ role: "user", content: userText });

  try {
    await message.channel.sendTyping();

    const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history];
    const replyText = await askOpenRouter(messages);

    history.push({ role: "assistant", content: replyText });

    // 히스토리 길이 제한
    while (history.length > MAX_HISTORY) {
      history.shift();
    }
    historyByChannel.set(channelId, history);

    // 디스코드 메시지 길이 제한(2000자) 대응
    if (replyText.length > 2000) {
      const chunks = replyText.match(/[\s\S]{1,1900}/g) ?? [];
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    } else {
      await message.reply(replyText);
    }
  } catch (error) {
    console.error("OpenRouter API 에러:", error);
    await message.reply("응답을 생성하는 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.");
  }
});

client.login(process.env.DISCORD_TOKEN);
