import { Bot, InlineKeyboard } from 'grammY';
import { env } from '../config/env.js';
import { logger } from '../monitoring/logger.js';
import { contentItemRepository } from '../db/repositories/content-item.repository.js';
import { reviewActionRepository } from '../db/repositories/review-action.repository.js';
import { prisma } from '../db/client.js';
import { publish } from '../linkedin/publish.js';
import { formatPostText } from '../linkedin/publishers/text.js';
import type { ContentItem } from '@prisma/client';

let bot: Bot | null = null;
const log = logger.child({ module: 'review-bot' });

// Maps telegram user ID string to content item ID string
const editingState = new Map<string, string>();

/**
 * Initialize the GrammY Telegram Bot.
 */
export function initBot(): Bot | null {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log.warn('TELEGRAM_BOT_TOKEN is not set. Telegram review bot is disabled.');
    return null;
  }

  bot = new Bot(token);

  // ── Commands ───────────────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    await ctx.reply(
      '🤖 *LinkedIn Content Automation Bot* is active!\n\nI will deliver draft posts for review and notify you of publish actions.',
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('status', async (ctx) => {
    const pendingCount = (await contentItemRepository.findByStatus('pending_review')).length;
    const manualCount = (await contentItemRepository.findByStatus('manual_required')).length;
    
    await ctx.reply(
      `📊 **Status Report**\n\n- Pending Review: ${pendingCount}\n- Manual Required (Polls): ${manualCount}`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Callback queries (Inline Buttons) ──────────────────────────────────
  bot.callbackQuery(/^approve_(.+)$/, async (ctx) => {
    const contentItemId = ctx.match[1];
    if (!contentItemId) return;

    await ctx.answerCallbackQuery({ text: 'Processing approval…' });

    try {
      const item = await contentItemRepository.findById(contentItemId);
      if (!item) {
        await ctx.editMessageText('❌ Error: Content item not found.');
        return;
      }

      if (item.status === 'published') {
        await ctx.editMessageText(`✅ Already published URN: ${item.linkedinUrn}`);
        return;
      }

      await ctx.editMessageText('🚀 Publishing to LinkedIn…');

      // Log review action
      await reviewActionRepository.create({
        contentItem: { connect: { id: contentItemId } },
        channel: 'telegram',
        action: 'approve',
        actor: String(ctx.from.id),
      });

      // Update status and publish
      await contentItemRepository.updateStatus(contentItemId, 'approved');
      const result = await publish(item);

      await ctx.editMessageText(
        `✅ **Published to LinkedIn!**\n\n🔗 [View Post](${result.url})\nURN: \`${result.urn}\``,
        { parse_mode: 'Markdown', link_preview: { disable_preview: true } } as any
      );
    } catch (err: any) {
      log.error({ err, contentItemId }, 'Callback approve failed');
      await ctx.editMessageText(`❌ **Publishing Failed:**\n\n${err.message}`);
    }
  });

  bot.callbackQuery(/^reject_(.+)$/, async (ctx) => {
    const contentItemId = ctx.match[1];
    if (!contentItemId) return;

    await ctx.answerCallbackQuery({ text: 'Post rejected.' });

    try {
      await contentItemRepository.updateStatus(contentItemId, 'rejected');
      
      await reviewActionRepository.create({
        contentItem: { connect: { id: contentItemId } },
        channel: 'telegram',
        action: 'reject',
        actor: String(ctx.from.id),
      });

      await ctx.editMessageText('🗑️ **Post Rejected.** Content will not be published.');
    } catch (err: any) {
      log.error({ err, contentItemId }, 'Callback reject failed');
      await ctx.editMessageText(`❌ Error processing rejection: ${err.message}`);
    }
  });

  bot.callbackQuery(/^edit_(.+)$/, async (ctx) => {
    const contentItemId = ctx.match[1];
    if (!contentItemId) return;

    await ctx.answerCallbackQuery();
    editingState.set(String(ctx.from.id), contentItemId);

    await ctx.reply(
      '📝 Please reply directly to this message with the *complete updated body* for the post.',
      { parse_mode: 'Markdown' }
    );
  });

  // ── Handle incoming messages for Editing ───────────────────────────────
  bot.on('message:text', async (ctx) => {
    const userId = String(ctx.from.id);
    const contentItemId = editingState.get(userId);

    if (!contentItemId) {
      // Not in editing mode, ignore or reply
      return;
    }

    editingState.delete(userId);
    const newBody = ctx.message.text;

    try {
      const item = await contentItemRepository.findById(contentItemId);
      if (!item) {
        await ctx.reply('❌ Error: Post not found.');
        return;
      }

      // Update database
      
      const updated = await prisma.contentItem.update({
        where: { id: contentItemId },
        data: { body: newBody },
      });

      // Log review action
      await reviewActionRepository.create({
        contentItem: { connect: { id: contentItemId } },
        channel: 'telegram',
        action: 'edit',
        actor: userId,
        payload: { oldBody: item.body, newBody },
      });

      await ctx.reply('🔄 **Content Updated!** Sending updated draft for approval…');
      await sendDraftToTelegram(updated);
    } catch (err: any) {
      log.error({ err, contentItemId }, 'Failed to edit content item');
      await ctx.reply(`❌ Failed to update content: ${err.message}`);
    }
  });

  // Start the bot
  if (env.TELEGRAM_USE_WEBHOOK) {
    log.info('Telegram Bot configured to use Webhooks');
  } else {
    log.info('Starting Telegram Bot long-polling');
    bot.start().catch((err) => {
      log.error({ err }, 'Error during Telegram Bot long polling');
    });
  }

  return bot;
}

/**
 * Format a content item for Telegram preview.
 */
function buildTelegramPreview(item: ContentItem): string {
  return `📝 **DRAFT POST (Pending Review)**

**Hook (see more preview):** 
\`${item.hook}\`

**Body:**
${item.body}

${item.cta ? `**CTA:**\n${item.cta}\n` : ''}
**Hashtags:** \`${item.hashtags.join(' ')}\`

Format: \`${item.format}\` | Pillar: \`${item.pillar}\`
Mode: \`${item.mode}\``;
}

/**
 * Send a generated draft post to Telegram.
 */
export async function sendDraftToTelegram(item: ContentItem): Promise<void> {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!bot || !chatId) {
    log.warn('Telegram bot not initialized or TELEGRAM_CHAT_ID missing. Skipping draft send.');
    return;
  }

  const text = buildTelegramPreview(item);
  const keyboard = new InlineKeyboard()
    .text('👍 Approve & Post', `approve_${item.id}`)
    .text('👎 Reject', `reject_${item.id}`)
    .row()
    .text('✏️ Edit Body', `edit_${item.id}`);

  await bot.api.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Send system/critical alerts to Telegram.
 */
export async function sendAlertToTelegram(
  message: string,
  level: 'info' | 'warning' | 'error' | 'critical' = 'error',
  context?: any
): Promise<void> {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!bot || !chatId) {
    log.warn('Telegram bot not initialized or TELEGRAM_CHAT_ID missing. Skipping alert send.');
    return;
  }

  const emojiMap = {
    info: 'ℹ️',
    warning: '⚠️',
    error: '🚨',
    critical: '🔥',
  };

  const text = `${emojiMap[level]} **SYSTEM ALERT [${level.toUpperCase()}]**\n\n${message}${
    context ? `\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`` : ''
  }`;

  await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

/**
 * Deliver manual required instruction (e.g. polls).
 */
export async function sendManualRequiredToTelegram(item: ContentItem): Promise<void> {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!bot || !chatId) {
    log.warn('Telegram bot not initialized or TELEGRAM_CHAT_ID missing. Skipping manual instruction.');
    return;
  }

  const meta = item.generationMeta as any;
  const pollQuestion = meta?.pollQuestion || 'N/A';
  const pollOptions = (meta?.pollOptions as string[]) || [];

  const text = `📋 **MANUAL POST REQUIRED (Poll Format)**
LinkedIn official API does not support publishing polls directly. Please publish this post manually:

**Step 1: Poll Question & Options**
Question: \`${pollQuestion}\`
Options:
${pollOptions.map((opt, i) => `${i + 1}. \`${opt}\``).join('\n')}

**Step 2: Copy Post commentary text**
\`\`\`
${formatPostText({
  hook: item.hook,
  body: item.body,
  cta: item.cta,
  hashtags: item.hashtags,
})}
\`\`\``;

  await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}
