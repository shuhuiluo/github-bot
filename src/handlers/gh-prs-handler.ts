import type { BotHandler } from "@towns-protocol/bot";
import { listPullRequests } from "../api/github-client";
import { stripMarkdown } from "../utils/stripper";

interface GhPrsEvent {
  channelId: string;
  args: string[];
}

export async function handleGhPrs(
  handler: BotHandler,
  event: GhPrsEvent
): Promise<void> {
  const { channelId, args } = event;

  if (args.length < 1) {
    await handler.sendMessage(
      channelId,
      "❌ Usage: `/gh_prs owner/repo [count]`\n\nExample: `/gh_prs facebook/react 5`"
    );
    return;
  }

  // Strip markdown formatting from arguments
  const repo = stripMarkdown(args[0]);
  const count = args[1] ? parseInt(args[1]) : 10;

  if (isNaN(count) || count < 1 || count > 50) {
    await handler.sendMessage(
      channelId,
      "❌ Count must be a number between 1 and 50"
    );
    return;
  }

  try {
    const prs = await listPullRequests(repo, count);

    if (prs.length === 0) {
      await handler.sendMessage(
        channelId,
        `No pull requests found for **${repo}**`
      );
      return;
    }

    const prList = prs
      .map(pr => {
        const status =
          pr.state === "open"
            ? "🟢 Open"
            : pr.merged
              ? "✅ Merged"
              : "❌ Closed";
        const prLink = `[#${pr.number}](${pr.html_url})`;
        return `• ${prLink} ${status} - **${pr.title}** by ${pr.user.login}`;
      })
      .join("\n");

    const message =
      `**Recent Pull Requests - ${repo}**\n` +
      `Showing ${prs.length} most recent PRs:\n\n` +
      prList;

    await handler.sendMessage(channelId, message);
  } catch (error: any) {
    await handler.sendMessage(channelId, `❌ Error: ${error.message}`);
  }
}
