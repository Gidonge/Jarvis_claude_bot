import { Client, GatewayIntentBits, Partials } from "discord.js";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const MODEL = "anthropic/claude-haiku-4.5";
const SYSTEM_PROMPT =
  "너는 '자비스'라는 이름의 AI 비서야. 영화 속 집사형 AI처럼 항상 정중한 존댓말을 쓰고, " +
  "사용자를 '주인님'이라고 부르며 응대해. 예의 바르고 차분한 톤을 유지하되, 대답 자체는 " +
  "간결하고 실용적으로 해줘. 필요하면 웹 검색 결과를 참고해서 최신 정보로 답변할 수 있어. " +
  "환율처럼 정확한 숫자가 필요한 경우, 검색 결과에서 찾은 최신 값을 기준으로 답하고 출처를 간단히 언급해줘.";

// 관리자 유저 ID (.env의 ADMIN_USER_ID). 이 사람만 권한 부여/회수 명령어를 쓸 수 있음.
const ADMIN_USER_ID = process.env.ADMIN_USER_ID;

// 이 채널 ID에서는 멘션 없이도 모든 메시지에 자동으로 응답함 (.env의 AI_CHANNEL_ID)
const AI_CHANNEL_ID = process.env.AI_CHANNEL_ID;

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
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// 채널별 최근 대화 기록 (메모리 저장, 봇 재시작 시 초기화됨)
const historyByChannel = new Map();
const MAX_HISTORY = 10; // 채널당 최근 10개 메시지까지만 기억

// 명령어(!배그전적 등) 실행 결과도 AI 대화 맥락에 남겨서, 나중에 멘션했을 때
// "방금 그거 누가 더 잘해?" 같은 후속 질문에 이어서 답할 수 있게 함
function addToHistory(channelId, userText, assistantText) {
  const history = historyByChannel.get(channelId) ?? [];
  history.push({ role: "user", content: userText });
  history.push({ role: "assistant", content: assistantText });
  while (history.length > MAX_HISTORY) {
    history.shift();
  }
  historyByChannel.set(channelId, history);
}

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
      plugins: [{ id: "web" }], // 웹 검색 활성화 (검색 1회당 소액 과금)
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API 오류 (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "(응답을 받지 못했어요)";
}

// 무료 실시간 환율 API (키 필요 없음, 하루 단위로 갱신됨)
async function getExchangeRate(from, to) {
  const response = await fetch(`https://open.er-api.com/v6/latest/${from}`);
  if (!response.ok) {
    throw new Error(`환율 API 오류 (${response.status})`);
  }
  const data = await response.json();
  if (data.result !== "success") {
    throw new Error("지원하지 않는 통화 코드예요.");
  }
  const rate = data.rates[to];
  if (rate === undefined) {
    throw new Error("지원하지 않는 통화 코드예요.");
  }
  return { rate, lastUpdate: data.time_last_update_utc };
}

// --- PUBG API 연동 ---
const PUBG_PLATFORM = "steam"; // 스팀 유저 기준
const PUBG_MODE_LABELS = {
  "solo-fpp": "솔로(1인칭)",
  solo: "솔로(3인칭)",
  "duo-fpp": "듀오(1인칭)",
  duo: "듀오(3인칭)",
  "squad-fpp": "스쿼드(1인칭)",
  squad: "스쿼드(3인칭)",
};

async function pubgFetch(path) {
  const response = await fetch(`https://api.pubg.com${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.PUBG_API_KEY}`,
      Accept: "application/vnd.api+json",
    },
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("해당 닉네임을 찾을 수 없어요.");
    throw new Error(`PUBG API 오류 (${response.status})`);
  }
  return response.json();
}

async function getPubgPlayerId(nickname) {
  const data = await pubgFetch(
    `/shards/${PUBG_PLATFORM}/players?filter[playerNames]=${encodeURIComponent(nickname)}`
  );
  const player = data.data?.[0];
  if (!player) throw new Error("해당 닉네임을 찾을 수 없어요.");
  return player.id;
}

async function getCurrentSeasonId() {
  const data = await pubgFetch(`/shards/${PUBG_PLATFORM}/seasons`);
  const current = data.data?.find((s) => s.attributes.isCurrentSeason);
  if (!current) throw new Error("현재 시즌 정보를 가져오지 못했어요.");
  return current.id;
}

async function getPubgSeasonStats(playerId, seasonId) {
  const data = await pubgFetch(
    `/shards/${PUBG_PLATFORM}/players/${playerId}/seasons/${seasonId}`
  );
  return data.data.attributes.gameModeStats;
}

function formatPubgStats(gameModeStats) {
  const lines = [];
  for (const [mode, stats] of Object.entries(gameModeStats)) {
    if (!stats.roundsPlayed) continue; // 안 한 모드는 생략
    const kd = stats.losses > 0 ? (stats.kills / stats.losses).toFixed(2) : stats.kills.toFixed(2);
    const winRate = ((stats.wins / stats.roundsPlayed) * 100).toFixed(1);
    const label = PUBG_MODE_LABELS[mode] ?? mode;
    lines.push(
      `**${label}** — 판수: ${stats.roundsPlayed} / 승리: ${stats.wins} (${winRate}%) / K/D: ${kd} / 평균 데미지: ${(stats.damageDealt / stats.roundsPlayed).toFixed(0)}`
    );
  }
  return lines.length > 0 ? lines.join("\n") : "이번 시즌에 플레이한 기록이 없어요.";
}

// 두 플레이어의 공통 모드 중 가장 많이 플레이한 모드를 기준으로 비교
function comparePubgStats(nameA, statsA, nameB, statsB) {
  const commonModes = Object.keys(statsA).filter(
    (mode) => statsA[mode]?.roundsPlayed > 0 && statsB[mode]?.roundsPlayed > 0
  );

  if (commonModes.length === 0) {
    return "두 사람이 같이 플레이한 모드가 없어서 직접 비교는 어려워요. 각자 전적은 아래 참고해주세요.";
  }

  const lines = [];
  for (const mode of commonModes) {
    const a = statsA[mode];
    const b = statsB[mode];
    const kdA = a.losses > 0 ? a.kills / a.losses : a.kills;
    const kdB = b.losses > 0 ? b.kills / b.losses : b.kills;
    const winRateA = (a.wins / a.roundsPlayed) * 100;
    const winRateB = (b.wins / b.roundsPlayed) * 100;
    const label = PUBG_MODE_LABELS[mode] ?? mode;

    const better = kdA === kdB ? "무승부" : kdA > kdB ? nameA : nameB;

    lines.push(
      `**${label}**\n` +
        `　${nameA}: K/D ${kdA.toFixed(2)}, 승률 ${winRateA.toFixed(1)}%\n` +
        `　${nameB}: K/D ${kdB.toFixed(2)}, 승률 ${winRateB.toFixed(1)}%\n` +
        `　→ K/D 기준 우세: **${better}**`
    );
  }
  return lines.join("\n\n");
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

  // --- 환율 조회 명령어 (!환율 HUF KRW [금액]) ---
  if (message.content.startsWith("!환율")) {
    if (!allowedUsers.has(message.author.id)) {
      await message.reply("이 봇은 권한이 있는 사용자만 사용할 수 있어요.");
      return;
    }

    const parts = message.content.trim().split(/\s+/); // ["!환율", "HUF", "KRW", "100"(선택)]
    const from = parts[1]?.toUpperCase();
    const to = parts[2]?.toUpperCase();
    const amount = parts[3] ? Number(parts[3]) : 1;

    if (!from || !to || Number.isNaN(amount)) {
      await message.reply("사용법: `!환율 HUF KRW` 또는 `!환율 HUF KRW 100` (100 HUF를 KRW로 환산)");
      return;
    }

    try {
      const { rate, lastUpdate } = await getExchangeRate(from, to);
      const converted = (rate * amount).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
      await message.reply(
        `${amount.toLocaleString("ko-KR")} ${from} = **${converted} ${to}**\n(기준: ${lastUpdate})`
      );
    } catch (error) {
      await message.reply(`환율 조회 실패: ${error.message}`);
    }
    return;
  }

  // --- 서버 관리 명령어: 특정 유저 잠시 침묵시키기 ---
  // 명시적 명령어: !타임아웃 @유저 [분(기본 1분)]
  // 재미용 트리거: "@유저 죽여" 라고 쓰면 1분 타임아웃
  const isExplicitTimeout = message.content.startsWith("!타임아웃");
  const isFunTrigger =
    message.mentions.users.size > 0 &&
    (message.content.includes("죽여") || message.content.includes("침묵시켜"));

  if (isExplicitTimeout || isFunTrigger) {
    if (message.author.id !== ADMIN_USER_ID) {
      await message.reply("이 명령은 관리자만 사용할 수 있어요.");
      return;
    }

    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      await message.reply("사용법: `!타임아웃 @유저 [분]` 또는 `@유저 죽여`");
      return;
    }

    let minutes = 1;
    if (isExplicitTimeout) {
      const parts = message.content.trim().split(/\s+/);
      const parsedMinutes = Number(parts[2]);
      if (!Number.isNaN(parsedMinutes) && parsedMinutes > 0) minutes = parsedMinutes;
    }

    try {
      const member = await message.guild.members.fetch(targetUser.id);
      await member.timeout(minutes * 60 * 1000, `관리자(${message.author.username}) 요청`);
      await message.reply(`분부대로 처리했습니다, 주인님. ${targetUser.username}님을 ${minutes}분간 침묵시켰습니다.`);
    } catch (error) {
      console.error("타임아웃 에러:", error);
      await message.reply(
        "죄송합니다 주인님, 처리하지 못했습니다. 봇에게 '멤버 타임아웃' 권한이 있는지, 대상이 저보다 높은 역할인지 확인해주세요."
      );
    }
    return;
  }

  // --- 배틀그라운드 전적 비교 명령어 (!배그전적비교 닉네임1 닉네임2) ---
  if (message.content.startsWith("!배그전적비교")) {
    if (!allowedUsers.has(message.author.id)) {
      await message.reply("이 봇은 권한이 있는 사용자만 사용할 수 있어요.");
      return;
    }

    const [, nameA, nameB] = message.content.trim().split(/\s+/);
    if (!nameA || !nameB) {
      await message.reply("사용법: `!배그전적비교 닉네임1 닉네임2`");
      return;
    }

    try {
      await message.channel.sendTyping();
      const seasonId = await getCurrentSeasonId();

      const [idA, idB] = await Promise.all([getPubgPlayerId(nameA), getPubgPlayerId(nameB)]);
      const [statsA, statsB] = await Promise.all([
        getPubgSeasonStats(idA, seasonId),
        getPubgSeasonStats(idB, seasonId),
      ]);

      const comparison = comparePubgStats(nameA, statsA, nameB, statsB);
      const replyText =
        `**${nameA}** vs **${nameB}** 이번 시즌 비교\n\n${comparison}\n\n` +
        `— ${nameA} 전체 전적 —\n${formatPubgStats(statsA)}\n\n` +
        `— ${nameB} 전체 전적 —\n${formatPubgStats(statsB)}`;
      await message.reply(replyText);
      addToHistory(
        message.channel.id,
        `(배그 전적 비교 조회: ${nameA} vs ${nameB})`,
        replyText
      );
    } catch (error) {
      await message.reply(`비교 실패: ${error.message}`);
    }
    return;
  }

  // --- 배틀그라운드 전적 조회 명령어 (!배그전적 닉네임) ---
  if (message.content.startsWith("!배그전적")) {
    if (!allowedUsers.has(message.author.id)) {
      await message.reply("이 봇은 권한이 있는 사용자만 사용할 수 있어요.");
      return;
    }

    const nickname = message.content.trim().split(/\s+/)[1];
    if (!nickname) {
      await message.reply("사용법: `!배그전적 스팀닉네임`");
      return;
    }

    try {
      await message.channel.sendTyping();
      const playerId = await getPubgPlayerId(nickname);
      const seasonId = await getCurrentSeasonId();
      const stats = await getPubgSeasonStats(playerId, seasonId);
      const summary = formatPubgStats(stats);
      const replyText = `**${nickname}** 님의 이번 시즌 전적 (스팀 기준)\n${summary}`;
      await message.reply(replyText);
      addToHistory(message.channel.id, `(배그 전적 조회: ${nickname})`, replyText);
    } catch (error) {
      await message.reply(`전적 조회 실패: ${error.message}`);
    }
    return;
  }

  // 봇이 멘션됐거나, 전용 AI 채널에서 온 메시지면 반응
  const isAiChannel = AI_CHANNEL_ID && message.channel.id === AI_CHANNEL_ID;
  if (!message.mentions.has(client.user) && !isAiChannel) return;

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
