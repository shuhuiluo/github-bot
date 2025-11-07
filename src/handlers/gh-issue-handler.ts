import type { BotHandler } from "@towns-protocol/bot";
import { getIssue } from "../api/github-client";
import { stripMarkdown } from "../utils/stripper";
import { truncateText } from "../utils/text";

interface GhIssueEvent {
  channelId: string;
  args: string[];
}

export async function handleGhIssue(
  handler: BotHandler,
  event: GhIssueEvent
): Promise<void> {
  const { channelId, args } = event;

  // Check for --full flag
  const hasFullFlag = args.includes("--full");
  const cleanArgs = args.filter(arg => arg !== "--full");

  if (cleanArgs.length < 2) {
    await handler.sendMessage(
      channelId,
      "❌ Usage: `/gh_issue owner/repo #123 [--full]` or `/gh_issue owner/repo 123 [--full]`"
    );
    return;
  }

  // Strip markdown formatting from arguments
  const repo = stripMarkdown(cleanArgs[0]);
  const issueNumber = stripMarkdown(cleanArgs[1]).replace("#", "");

  try {
    const issue = await getIssue(repo, issueNumber);

    const labels = issue.labels.map((l: any) => l.name).join(", ");

    // Format description
    const description = hasFullFlag
      ? issue.body
      : truncateText(issue.body, 100);

    const message =
      `**Issue #${issue.number}**\n` +
      `**${repo}**\n\n` +
      `**${issue.title}**\n\n` +
      (description ? `${description}\n\n` : "") +
      `📊 Status: ${issue.state === "open" ? "🟢 Open" : "✅ Closed"}\n` +
      `👤 Author: ${issue.user.login}\n` +
      `💬 Comments: ${issue.comments}\n` +
      (labels ? `🏷️ Labels: ${labels}\n` : "") +
      `🔗 ${issue.html_url}`;

    await handler.sendMessage(channelId, message);
  } catch (error: any) {
    await handler.sendMessage(channelId, `❌ Error: ${error.message}`);
  }
}
