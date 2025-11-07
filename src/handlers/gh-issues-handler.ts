import type { BotHandler } from "@towns-protocol/bot";
import { listIssues } from "../api/github-client";
import { stripMarkdown } from "../utils/stripper";

interface GhIssuesEvent {
  channelId: string;
  args: string[];
}

export async function handleGhIssues(
  handler: BotHandler,
  event: GhIssuesEvent
): Promise<void> {
  const { channelId, args } = event;

  if (args.length < 1) {
    await handler.sendMessage(
      channelId,
      "❌ Usage: `/gh_issues owner/repo [count]`\n\nExample: `/gh_issues facebook/react 5`"
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
    const issues = await listIssues(repo, count);

    if (issues.length === 0) {
      await handler.sendMessage(channelId, `No issues found for **${repo}**`);
      return;
    }

    // Filter out pull requests (GitHub API includes PRs in issues endpoint)
    const actualIssues = issues.filter(issue => !issue.pull_request);

    if (actualIssues.length === 0) {
      await handler.sendMessage(
        channelId,
        `No issues found for **${repo}** (only PRs available)`
      );
      return;
    }

    const issueList = actualIssues
      .map(issue => {
        const status = issue.state === "open" ? "🟢 Open" : "✅ Closed";
        const issueLink = `[#${issue.number}](${issue.html_url})`;
        return `• ${issueLink} ${status} - **${issue.title}** by ${issue.user.login}`;
      })
      .join("\n");

    const message =
      `**Recent Issues - ${repo}**\n` +
      `Showing ${actualIssues.length} most recent issues:\n\n` +
      issueList;

    await handler.sendMessage(channelId, message);
  } catch (error: any) {
    await handler.sendMessage(channelId, `❌ Error: ${error.message}`);
  }
}
