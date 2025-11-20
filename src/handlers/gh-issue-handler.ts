import type { BotHandler } from "@towns-protocol/bot";
import {
  getIssue,
  listIssues,
  classifyApiError,
  type GitHubIssueList,
} from "../api/github-client";
import { stripMarkdown } from "../utils/stripper";
import { parseCommandArgs, validateIssueFilters } from "../utils/arg-parser";
import { sendOAuthPrompt } from "../utils/oauth-helpers";
import type { GitHubOAuthService } from "../services/github-oauth-service";
import type { SlashCommandEvent } from "../types/bot";
import {
  formatIssueDetail,
  formatIssueList,
} from "../formatters/command-formatters";

export async function handleGhIssue(
  handler: BotHandler,
  event: SlashCommandEvent,
  oauthService: GitHubOAuthService
): Promise<void> {
  const { args } = event;

  // Check if this is a list subcommand
  if (args.length > 0 && args[0] === "list") {
    await handleListIssues(handler, event, args.slice(1), oauthService);
    return;
  }

  // Otherwise, handle as show single issue (backward compatible)
  await handleShowIssue(handler, event, args, oauthService);
}

async function handleShowIssue(
  handler: BotHandler,
  event: SlashCommandEvent,
  args: string[],
  oauthService: GitHubOAuthService
): Promise<void> {
  const { channelId, userId, spaceId } = event;

  // Check for --full flag
  const hasFullFlag = args.includes("--full");
  const cleanArgs = args.filter(arg => arg !== "--full");

  if (cleanArgs.length < 2) {
    await handler.sendMessage(
      channelId,
      "❌ Usage: `/gh_issue owner/repo #123 [--full]` or `/gh_issue owner/repo 123 [--full]`\n\n" +
        "Or use `/gh_issue list owner/repo [count] [--state=...] [--creator=...]` to list issues"
    );
    return;
  }

  // Strip markdown formatting from arguments
  const repo = stripMarkdown(cleanArgs[0]);
  const issueNumber = stripMarkdown(cleanArgs[1]).replace("#", "");

  try {
    // Try with bot token first (works for public repos)
    const issue = await getIssue(repo, issueNumber);
    await handler.sendMessage(
      channelId,
      formatIssueDetail(issue, repo, hasFullFlag)
    );
  } catch (error) {
    const errorType = classifyApiError(error);

    // Try OAuth fallback for private repos
    if (errorType === "forbidden" || errorType === "not_found") {
      const userOctokit = await oauthService.getUserOctokit(userId);

      if (userOctokit) {
        // User has OAuth token - retry with their token
        try {
          const issue = await getIssue(repo, issueNumber, userOctokit);
          await handler.sendMessage(
            channelId,
            formatIssueDetail(issue, repo, hasFullFlag)
          );
          return;
        } catch {
          // User token also failed - they don't have access
          await handler.sendMessage(
            channelId,
            `❌ You don't have access to this repository`
          );
          return;
        }
      }

      // No OAuth token - show connection prompt
      await sendOAuthPrompt(handler, channelId, oauthService, userId, spaceId);
      return;
    }

    // Handle other errors
    if (errorType === "rate_limited") {
      await handler.sendMessage(
        channelId,
        "❌ GitHub API rate limited. Try again in a few minutes."
      );
      return;
    }

    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    await handler.sendMessage(channelId, `❌ Error: ${message}`);
  }
}

async function handleListIssues(
  handler: BotHandler,
  event: SlashCommandEvent,
  args: string[],
  oauthService: GitHubOAuthService
): Promise<void> {
  const { channelId, userId, spaceId } = event;

  if (args.length < 1) {
    await handler.sendMessage(
      channelId,
      "❌ Usage: `/gh_issue list owner/repo [count] [--state=open|closed|all] [--creator=username]`\n\nExample: `/gh_issue list facebook/react 5 --state=open`"
    );
    return;
  }

  // Parse arguments with filters
  const { repo, count, filters } = parseCommandArgs(args);

  // Validate filters
  const validationError = validateIssueFilters(filters);
  if (validationError) {
    await handler.sendMessage(channelId, `❌ ${validationError}`);
    return;
  }

  if (isNaN(count) || count < 1 || count > 50) {
    await handler.sendMessage(
      channelId,
      "❌ Count must be a number between 1 and 50"
    );
    return;
  }

  try {
    // Try with bot token first (works for public repos)
    const actualIssues = await listIssues(repo, count, filters);
    await sendIssueList(handler, channelId, actualIssues, repo);
  } catch (error) {
    const errorType = classifyApiError(error);

    // Try OAuth fallback for private repos
    if (errorType === "forbidden" || errorType === "not_found") {
      const userOctokit = await oauthService.getUserOctokit(userId);

      if (userOctokit) {
        // User has OAuth token - retry with their token
        try {
          const actualIssues = await listIssues(
            repo,
            count,
            filters,
            userOctokit
          );
          await sendIssueList(handler, channelId, actualIssues, repo);
          return;
        } catch {
          // User token also failed - they don't have access
          await handler.sendMessage(
            channelId,
            `❌ You don't have access to this repository`
          );
          return;
        }
      }

      // No OAuth token - show connection prompt
      await sendOAuthPrompt(handler, channelId, oauthService, userId, spaceId);
      return;
    }

    // Handle other errors
    if (errorType === "rate_limited") {
      await handler.sendMessage(
        channelId,
        "❌ GitHub API rate limited. Try again in a few minutes."
      );
      return;
    }

    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    await handler.sendMessage(channelId, `❌ Error: ${message}`);
  }
}

async function sendIssueList(
  handler: BotHandler,
  channelId: string,
  issues: GitHubIssueList,
  repo: string
): Promise<void> {
  if (issues.length === 0) {
    await handler.sendMessage(channelId, `No issues found for **${repo}**`);
    return;
  }

  await handler.sendMessage(channelId, formatIssueList(issues, repo));
}
