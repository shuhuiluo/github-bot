/**
 * GitHub Events API formatters
 * Converts Events API responses into human-readable messages for Towns channels
 *
 * Note: Events API has different structure than webhooks
 * - Repository is event.repo.name (not repository.full_name)
 * - User is event.actor.login (not payload.sender.login)
 * - PR objects are minimal, full details passed via prDetailsMap
 */

import type { GitHubPullRequest } from "../api/github-client";
import type { GitHubEvent } from "../types/events-api";
import { buildMessage, getPrEventEmoji, getPrEventHeader } from "./shared";

/**
 * Format GitHub Events API events into human-readable messages
 * Events API has different structure than webhooks
 *
 * Note: Events API returns minimal PR objects without title/html_url.
 * Full PR details are passed via prDetailsMap (fetched upfront in parallel).
 */
export function formatEvent(
  event: GitHubEvent,
  prDetailsMap: Map<number, GitHubPullRequest>
): string {
  const { type, payload, actor, repo } = event;

  switch (type) {
    case "PullRequestEvent": {
      const { action, pull_request: pr, number } = payload;

      if (!pr || !number) return "";

      // HTML URL: https://github.com/{repo}/pull/{number}
      const htmlUrl = `https://github.com/${repo.name}/pull/${number}`;

      // Look up full PR details from map
      const fullPr = prDetailsMap.get(number);

      if (!fullPr) {
        // Fallback if PR details not available
        return (
          `🔔 **Pull Request ${action}**\n` +
          `**${repo.name}** #${number}\n` +
          `👤 ${actor.login}\n` +
          `🔗 ${htmlUrl}`
        );
      }

      const emoji = getPrEventEmoji(action, fullPr.merged);
      const header = getPrEventHeader(action, fullPr.merged);

      if (!emoji || !header) return "";

      return buildMessage({
        emoji,
        header,
        repository: repo.name,
        number,
        title: fullPr.title,
        user: actor.login,
        url: htmlUrl,
      });
    }

    case "IssuesEvent": {
      const { action, issue } = payload;

      if (!issue) return "";

      let emoji: string;
      let header: string;

      if (action === "opened") {
        emoji = "🐛";
        header = "Issue Opened";
      } else if (action === "closed") {
        emoji = "✅";
        header = "Issue Closed";
      } else {
        return "";
      }

      return buildMessage({
        emoji,
        header,
        repository: repo.name,
        number: issue.number,
        title: issue.title,
        user: actor.login,
        url: issue.html_url,
      });
    }

    case "PushEvent": {
      const { commits, ref } = payload;

      if (!commits || commits.length === 0) return "";

      const branch = ref?.replace("refs/heads/", "") || "unknown";
      const commitCount = commits.length;

      let message =
        `📦 **Push to ${repo.name}**\n` +
        `🌿 Branch: \`${branch}\`\n` +
        `👤 ${actor.login}\n` +
        `📝 ${commitCount} commit${commitCount > 1 ? "s" : ""}\n\n`;

      // Show first 3 commits
      const displayCommits = commits.slice(0, 3);
      for (const commit of displayCommits) {
        const shortSha = commit.sha.substring(0, 7);
        const firstLine = commit.message.split("\n")[0];
        const shortMessage =
          firstLine.length > 60
            ? firstLine.substring(0, 60) + "..."
            : firstLine;
        message += `\`${shortSha}\` ${shortMessage}\n`;
      }

      if (commitCount > 3) {
        message += `\n_... and ${commitCount - 3} more commit${commitCount - 3 > 1 ? "s" : ""}_`;
      }

      return message;
    }

    case "ReleaseEvent": {
      const { action, release } = payload;

      if (!release) return "";

      if (action === "published") {
        return buildMessage({
          emoji: "🚀",
          header: "Release Published",
          repository: repo.name,
          title: release.name || release.tag_name,
          user: actor.login,
          metadata: [`📦 ${release.tag_name}`],
          url: release.html_url,
        });
      }
      return "";
    }

    case "WorkflowRunEvent": {
      const { action, workflow_run: workflowRun } = payload;

      if (!workflowRun) return "";

      if (action === "completed") {
        const emoji = workflowRun.conclusion === "success" ? "✅" : "❌";
        const status =
          workflowRun.conclusion === "success" ? "Passed" : "Failed";

        return (
          `${emoji} **CI ${status}**\n` +
          `**${repo.name}**\n` +
          `🔧 ${workflowRun.name}\n` +
          `🌿 ${workflowRun.head_branch}\n` +
          `🔗 ${workflowRun.html_url}`
        );
      }
      return "";
    }

    case "IssueCommentEvent": {
      const { action, issue, comment } = payload;

      if (!issue || !comment || !comment.user) return "";

      if (action === "created") {
        const shortComment = comment.body.split("\n")[0].substring(0, 100);

        return (
          `💬 **New Comment on Issue #${issue.number}**\n` +
          `**${repo.name}**\n\n` +
          `"${shortComment}${comment.body.length > 100 ? "..." : ""}"\n` +
          `👤 ${comment.user.login}\n` +
          `🔗 ${comment.html_url}`
        );
      }
      return "";
    }

    case "PullRequestReviewEvent": {
      const { action, pull_request: pr, review } = payload;

      if (!pr || !review) return "";

      if (action === "created") {
        // Look up full PR details from map
        const fullPr = prDetailsMap.get(pr.number);

        // Construct review URL with fallback to PR URL
        const htmlUrl =
          review.html_url ||
          `https://github.com/${repo.name}/pull/${pr.number}`;

        let emoji = "👀";
        if (review.state === "approved") emoji = "✅";
        if (review.state === "changes_requested") emoji = "🔄";

        return buildMessage({
          emoji,
          header: `PR Review: ${review.state.replace("_", " ")}`,
          repository: repo.name,
          number: pr.number,
          title: fullPr?.title ?? `PR #${pr.number}`,
          user: actor.login,
          url: htmlUrl,
        });
      }
      return "";
    }

    case "CreateEvent": {
      const { ref, ref_type } = payload;

      if (!ref || !ref_type) return "";

      return (
        `🌿 **${ref_type === "tag" ? "Tag" : "Branch"} Created**\n` +
        `**${repo.name}**\n` +
        `📝 \`${ref}\`\n` +
        `👤 ${actor.login}`
      );
    }

    case "DeleteEvent": {
      const { ref, ref_type } = payload;

      if (!ref || !ref_type) return "";

      return (
        `🗑️ **${ref_type === "tag" ? "Tag" : "Branch"} Deleted**\n` +
        `**${repo.name}**\n` +
        `📝 \`${ref}\`\n` +
        `👤 ${actor.login}`
      );
    }

    case "PullRequestReviewCommentEvent": {
      const { action, pull_request: pr, comment } = payload;

      if (!pr || !comment || action !== "created") return "";

      const shortComment = comment.body.split("\n")[0].substring(0, 100);

      return (
        `💬 **Review Comment on PR #${pr.number}**\n` +
        `**${repo.name}**\n\n` +
        `"${shortComment}${comment.body.length > 100 ? "..." : ""}"\n` +
        `👤 ${comment.user?.login ?? actor.login}\n` +
        `🔗 ${comment.html_url}`
      );
    }

    case "WatchEvent": {
      if (payload.action !== "started") return "";

      return (
        `⭐ **Repository Starred**\n` +
        `**${repo.name}**\n` +
        `👤 ${actor.login}\n` +
        `🔗 https://github.com/${repo.name}`
      );
    }

    case "ForkEvent": {
      const { forkee } = payload;
      if (!forkee?.full_name) return "";

      const targetUrl =
        forkee.html_url ??
        `https://github.com/${forkee.full_name.replace(/^\/+/, "")}`;

      return (
        `🍴 **Repository Forked**\n` +
        `**${repo.name}** → **${forkee.full_name}**\n` +
        `👤 ${actor.login}\n` +
        `🔗 ${targetUrl}`
      );
    }

    // Ignore other event types for now
    default:
      return "";
  }
}
