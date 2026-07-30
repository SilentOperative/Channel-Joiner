import { Telegraf, Markup, type Context } from "telegraf";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./lib/logger";

// Channel where bot IS admin — verified via getChatMember
const CHANNEL_ADMIN = "@PWXCHATON";

// Channel where bot CANNOT be admin — verified via forwarded message
const CHANNEL_FORWARD = "pwxonrender"; // lowercase, no @

// __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Go up from artifacts/api-server/dist/ → workspace root → attached_assets
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../");
const ZIP_FILE = path.join(WORKSPACE_ROOT, "attached_assets/pwx-ads-skipper_1785406063000.zip");
const APK_LINK = "https://github.com/kiwibrowser/src.next/releases/tag/14310011181";

// Per-user verification state (in-memory)
interface UserState {
  pwxchatVerified: boolean;
  pwxrenderVerified: boolean;
}
const userState = new Map<number, UserState>();

function getState(userId: number): UserState {
  if (!userState.has(userId)) {
    userState.set(userId, { pwxchatVerified: false, pwxrenderVerified: false });
  }
  return userState.get(userId)!;
}

async function isChatMember(bot: Telegraf, userId: number, channel: string): Promise<boolean> {
  try {
    const member = await bot.telegram.getChatMember(channel, userId);
    logger.info({ channel, userId, status: member.status }, "getChatMember result");
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ channel, userId, err: msg }, "getChatMember failed");
    return false;
  }
}

async function sendFiles(ctx: Context): Promise<void> {
  await ctx.reply("✅ *Both channels verified!* Sending your files now…", {
    parse_mode: "Markdown",
  });

  try {
    await ctx.replyWithDocument(
      { source: ZIP_FILE, filename: "pwx-ads-skipper.zip" },
      { caption: "📦 *PWX Ads Skipper*", parse_mode: "Markdown" },
    );
  } catch (err) {
    logger.error({ err, ZIP_FILE }, "Failed to send ZIP file");
    await ctx.reply("⚠️ Could not send the ZIP file. Please try again later.");
  }

  await ctx.reply(
    `📱 *Kiwi Browser APK*\n\n` +
      `Download from the official GitHub release:\n` +
      `👉 ${APK_LINK}\n\n` +
      `Tap the link, then download the \`.apk\` from the Assets section.`,
    { parse_mode: "Markdown" },
  );
}

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  const startKeyboard = Markup.inlineKeyboard([
    [
      Markup.button.url("📢 Join @pwxonrender", "https://t.me/pwxonrender"),
      Markup.button.url("📢 Join @PWXCHATON", "https://t.me/PWXCHATON"),
    ],
    [Markup.button.callback("✅ Check @PWXCHATON membership", "check_pwxchaton")],
  ]);

  bot.start(async (ctx) => {
    userState.delete(ctx.from.id);
    await ctx.reply(
      `👋 *Welcome!*\n\n` +
        `To receive the files, join *both* channels:\n\n` +
        `📢 [pwxonrender](https://t.me/pwxonrender)\n` +
        `📢 [PWXCHATON](https://t.me/PWXCHATON)\n\n` +
        `Then follow the 2-step verification below.`,
      { parse_mode: "Markdown", ...startKeyboard },
    );
  });

  // Step 1 — verify @PWXCHATON via getChatMember (bot is admin there)
  bot.action("check_pwxchaton", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    await ctx.answerCbQuery("Checking @PWXCHATON…");

    const inChat = await isChatMember(bot, userId, CHANNEL_ADMIN);
    if (!inChat) {
      await ctx.reply(
        `❌ You haven't joined *@PWXCHATON* yet.\n\nJoin and try again.`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.url("📢 Join @PWXCHATON", "https://t.me/PWXCHATON")],
            [Markup.button.callback("🔄 Try again", "check_pwxchaton")],
          ]),
        },
      );
      return;
    }

    getState(userId).pwxchatVerified = true;

    if (getState(userId).pwxrenderVerified) {
      await sendFiles(ctx);
      return;
    }

    // Step 2 — verify @pwxonrender via forwarded message
    await ctx.reply(
      `✅ *@PWXCHATON verified!*\n\n` +
        `Now verify *@pwxonrender*:\n\n` +
        `1. Open the [@pwxonrender](https://t.me/pwxonrender) channel\n` +
        `2. Tap any message → *Forward*\n` +
        `3. Forward it *to this bot chat* (here)\n\n` +
        `The bot will detect it automatically ✨`,
      { parse_mode: "Markdown" },
    );
  });

  // Step 2 — detect forwarded message from @pwxonrender
  bot.on("message", async (ctx) => {
    const msg = ctx.message;
    const userId = ctx.from?.id;
    if (!userId) return;

    // Detect forward origin (Telegram API v6+ uses forward_origin, older uses forward_from_chat)
    type ForwardChat = { username?: string };
    type ForwardOrigin = { type?: string; chat?: ForwardChat };

    const fwdChat = "forward_from_chat" in msg
      ? (msg.forward_from_chat as ForwardChat | undefined)
      : undefined;
    const fwdOrigin = "forward_origin" in msg
      ? (msg.forward_origin as ForwardOrigin | undefined)
      : undefined;

    const forwardedUsername =
      fwdChat?.username?.toLowerCase() ??
      (fwdOrigin?.type === "channel" ? fwdOrigin?.chat?.username?.toLowerCase() : undefined);

    if (forwardedUsername === CHANNEL_FORWARD) {
      getState(userId).pwxrenderVerified = true;

      if (getState(userId).pwxchatVerified) {
        await sendFiles(ctx);
      } else {
        await ctx.reply(
          `✅ *@pwxonrender verified!*\n\n` +
            `Now verify *@PWXCHATON* by pressing the button below.`,
          {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("✅ Check @PWXCHATON membership", "check_pwxchaton")],
            ]),
          },
        );
      }
      return;
    }

    // Guide user if not yet verified
    const state = getState(userId);
    if (!state.pwxchatVerified || !state.pwxrenderVerified) {
      await ctx.reply("Use /start to begin the verification process.");
    }
  });

  // /checkbot — debug admin status
  bot.command("checkbot", async (ctx) => {
    const results: string[] = [`*ZIP path:* \`${ZIP_FILE}\``];
    for (const channel of [CHANNEL_ADMIN, `@${CHANNEL_FORWARD}`]) {
      try {
        const me = await bot.telegram.getChatMember(channel, ctx.botInfo.id);
        results.push(`${channel}: bot status = *${me.status}*`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push(`${channel}: ❌ ${msg}`);
      }
    }
    await ctx.reply(results.join("\n"), { parse_mode: "Markdown" });
  });

  bot.catch((err) => {
    logger.error({ err }, "Telegraf error");
  });

  return bot;
}
