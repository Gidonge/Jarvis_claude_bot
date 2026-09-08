import { Client, GatewayIntentBits, Partials } from "discord.js";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const MODEL = "openrouter/free";
const SYSTEM_PROMPT = "너는 디스코드 서버에서 사용자들을 돕는 친절한 AI 어시스턴트야. 답변은 간결하게 해줘.";

// 관리자 유저 ID (.env의 ADMIN_USER_ID). 이 사람만 권한 부여/회수 명령어를 쓸 수 있음.
const ADMIN_USER_ID = process.env.ADMIN_USER_ID;

// 허용된 유저 목록을 파일에 저장해서 봇 재시작해도 유지되게 함.
const ALLOWLIST_FILE = "./allowed_users.json";

function loadAllowedUsers() {
  try {
    const raw = fs.readFileSync(ALLOWLIST_FILE, "utf-8");
    return new Set(JSON.parse(raw));
  } catch {
    // 파일이 없으면 관리자만 포함해서 시작
    return new Set(ADMIN_USER_ID ? [ADMIN_USER_ID] : []);
  }
}

function saveAllowedUsers(set) {
  fs.writeFileSync(ALLOWLIST_FILE, JSON.stringify([...set]));
}

const allowedUsers = loadAllowedUsers();

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
  console.log(`현재 허용된 유저: ${[...allowedUsers].join(", ") || "(없음)"}`);
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

  // --- 관리자 명령어 처리 (!허용, !허용해제, !허용목록) ---
  if (message.content.startsWith("!허용") || message.content.startsWith("!allow")) {
    if (message.author.id !== ADMIN_USER_ID) {
      await message.reply("관리자만 사용할 수 있는 명령어예요.");
      return;
    }

    const isRemove = message.content.startsWith("!허용해제") || message.content.startsWith("!disallow");
    const isList = message.content.trim() === "!허용목록" || message.content.trim() === "!allowlist";

    if (isList) {
      const names = [...allowedUsers].map((id) => `<@${id}>`).join(", ") || "(없음)";
      await message.reply(`현재 허용된 사용자: ${names}`);
      return;
    }

    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      await message.reply("사용법: `!허용 @사용자` 또는 `!허용해제 @사용자`");
      return;
    }

    if (isRemove) {
      allowedUsers.delete(targetUser.id);
      saveAllowedUsers(allowedUsers);
      await message.reply(`${targetUser.username}님의 사용 권한을 제거했어요.`);
    } else {
      allowedUsers.add(targetUser.id);
      saveAllowedUsers(allowedUsers);
      await message.reply(`${targetUser.username}님에게 사용 권한을 부여했어요.`);
    }
    return;
  }

  // 봇이 멘션되었을 때만 반응 (예: @봇이름 안녕)
  if (!message.mentions.has(client.user)) return;

  // 허용된 유저만 사용 가능
  if (!allowedUsers.has(message.author.id)) {
    await message.reply("이 봇은 권한이 있는 사용자만 사용할 수 있어요.");
    return;
  }

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
