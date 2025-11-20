import { dbService } from "../db";
import {
  formatPullRequest,
  formatIssue,
  formatPush,
  formatRelease,
  formatWorkflowRun,
  formatIssueComment,
  formatPullRequestReview,
} from "../formatters/webhook-events";
import type {
  PullRequestPayload,
  IssuesPayload,
  PushPayload,
  ReleasePayload,
  WorkflowRunPayload,
  IssueCommentPayload,
  PullRequestReviewPayload,
  CreatePayload,
  DeletePayload,
} from "../types/webhooks";
import type { TownsBot } from "../types/bot";

/**
 * EventProcessor - Routes webhook events to formatters and sends to subscribed channels
 *
 * Maps webhook event types to subscription event types and filters by user preferences.
 */
export class EventProcessor {
  private bot: TownsBot;

  constructor(bot: TownsBot) {
    this.bot = bot;
  }

  /**
   * Process a pull request webhook event
   */
  async processPullRequest(event: PullRequestPayload) {
    const { pull_request, repository } = event;

    console.log(
      `Processing PR event: ${event.action} - ${repository.full_name}#${pull_request.number}`
    );

    // Get subscribed channels for this repo
    const channels = await dbService.getRepoSubscribers(repository.full_name);

    // Filter by event preferences (pr event type)
    const interestedChannels = channels.filter(ch =>
      ch.eventTypes.includes("pr")
    );

    if (interestedChannels.length === 0) {
      console.log("No interested channels for PR event");
      return;
    }

    // Format message using existing formatter
    const message = formatPullRequest(event);

    if (!message) {
      console.log(
        "Formatter returned empty message (event action not handled)"
      );
      return;
    }

    // Send to all interested channels in parallel
    await Promise.all(
      interestedChannels.map(channel =>
        this.bot.sendMessage(channel.channelId, message).catch((err: Error) => {
          console.error(`Failed to send to ${channel.channelId}:`, err.message);
        })
      )
    );
  }

  /**
   * Process a push webhook event (commits)
   */
  async processPush(event: PushPayload) {
    const { repository, ref, commits } = event;

    console.log(
      `Processing push event: ${repository.full_name} - ${ref} (${commits?.length || 0} commits)`
    );

    // Get subscribed channels for this repo
    const channels = await dbService.getRepoSubscribers(repository.full_name);

    // Filter by event preferences (commits event type)
    const interestedChannels = channels.filter(ch =>
      ch.eventTypes.includes("commits")
    );

    if (interestedChannels.length === 0) {
      console.log("No interested channels for push event");
      return;
    }

    // Format message using existing formatter
    const message = formatPush(event);

    if (!message) {
      console.log("Formatter returned empty message (no commits)");
      return;
    }

    // Send to all interested channels in parallel
    await Promise.all(
      interestedChannels.map(channel =>
        this.bot.sendMessage(channel.channelId, message).catch((err: Error) => {
          console.error(`Failed to send to ${channel.channelId}:`, err.message);
        })
      )
    );
  }

  /**
   * Process an issues webhook event
   */
  async processIssues(event: IssuesPayload) {
    const { issue, repository } = event;

    console.log(
      `Processing issue event: ${event.action} - ${repository.full_name}#${issue.number}`
    );

    // Get subscribed channels for this repo
    const channels = await dbService.getRepoSubscribers(repository.full_name);

    // Filter by event preferences (issues event type)
    const interestedChannels = channels.filter(ch =>
      ch.eventTypes.includes("issues")
    );

    if (interestedChannels.length === 0) {
      console.log("No interested channels for issue event");
      return;
    }

    // Format message using existing formatter
    const message = formatIssue(event);

    if (!message) {
      console.log(
        "Formatter returned empty message (event action not handled)"
      );
      return;
    }

    // Send to all interested channels in parallel
    await Promise.all(
      interestedChannels.map(channel =>
        this.bot.sendMessage(channel.channelId, message).catch((err: Error) => {
          console.error(`Failed to send to ${channel.channelId}:`, err.message);
        })
      )
    );
  }

  /**
   * Process a release webhook event
   */
  async processRelease(event: ReleasePayload) {
    const { release, repository } = event;

    console.log(
      `Processing release event: ${event.action} - ${repository.full_name} ${release.tag_name}`
    );

    // Get subscribed channels for this repo
    const channels = await dbService.getRepoSubscribers(repository.full_name);

    // Filter by event preferences (releases event type)
    const interestedChannels = channels.filter(ch =>
      ch.eventTypes.includes("releases")
    );

    if (interestedChannels.length === 0) {
      console.log("No interested channels for release event");
      return;
    }

    // Format message using existing formatter
    const message = formatRelease(event);

    if (!message) {
      console.log(
        "Formatter returned empty message (event action not handled)"
      );
      return;
    }

    // Send to all interested channels in parallel
    await Promise.all(
      interestedChannels.map(channel =>
        this.bot.sendMessage(channel.channelId, message).catch((err: Error) => {
          console.error(`Failed to send to ${channel.channelId}:`, err.message);
        })
      )
    );
  }

  /**
   * Process a workflow run webhook event (CI)
   */
  async processWorkflowRun(event: WorkflowRunPayload) {
    const { workflow_run, repository } = event;

    console.log(
      `Processing workflow run event: ${event.action} - ${repository.full_name} ${workflow_run.name}`
    );

    // Get subscribed channels for this repo
    const channels = await dbService.getRepoSubscribers(repository.full_name);

    // Filter by event preferences (ci event type)
    const interestedChannels = channels.filter(ch =>
      ch.eventTypes.includes("ci")
    );

    if (interestedChannels.length === 0) {
      console.log("No interested channels for workflow run event");
      return;
    }

    // Format message using existing formatter
    const message = formatWorkflowRun(event);

    if (!message) {
      console.log(
        "Formatter returned empty message (event action not handled)"
      );
      return;
    }

    // Send to all interested channels in parallel
    await Promise.all(
      interestedChannels.map(channel =>
        this.bot.sendMessage(channel.channelId, message).catch((err: Error) => {
          console.error(`Failed to send to ${channel.channelId}:`, err.message);
        })
      )
    );
  }

  /**
   * Process an issue comment webhook event
   */
  async processIssueComment(event: IssueCommentPayload) {
    const { issue, repository } = event;

    console.log(
      `Processing issue comment event: ${event.action} - ${repository.full_name}#${issue.number}`
    );

    // Get subscribed channels for this repo
    const channels = await dbService.getRepoSubscribers(repository.full_name);

    // Filter by event preferences (comments event type)
    const interestedChannels = channels.filter(ch =>
      ch.eventTypes.includes("comments")
    );

    if (interestedChannels.length === 0) {
      console.log("No interested channels for comment event");
      return;
    }

    // Format message using existing formatter
    const message = formatIssueComment(event);

    if (!message) {
      console.log(
        "Formatter returned empty message (event action not handled)"
      );
      return;
    }

    // Send to all interested channels in parallel
    await Promise.all(
      interestedChannels.map(channel =>
        this.bot.sendMessage(channel.channelId, message).catch((err: Error) => {
          console.error(`Failed to send to ${channel.channelId}:`, err.message);
        })
      )
    );
  }

  /**
   * Process a pull request review webhook event
   */
  async processPullRequestReview(event: PullRequestReviewPayload) {
    const { pull_request, repository } = event;

    console.log(
      `Processing PR review event: ${event.action} - ${repository.full_name}#${pull_request.number}`
    );

    // Get subscribed channels for this repo
    const channels = await dbService.getRepoSubscribers(repository.full_name);

    // Filter by event preferences (reviews event type)
    const interestedChannels = channels.filter(ch =>
      ch.eventTypes.includes("reviews")
    );

    if (interestedChannels.length === 0) {
      console.log("No interested channels for PR review event");
      return;
    }

    // Format message using existing formatter
    const message = formatPullRequestReview(event);

    if (!message) {
      console.log(
        "Formatter returned empty message (event action not handled)"
      );
      return;
    }

    // Send to all interested channels in parallel
    await Promise.all(
      interestedChannels.map(channel =>
        this.bot.sendMessage(channel.channelId, message).catch((err: Error) => {
          console.error(`Failed to send to ${channel.channelId}:`, err.message);
        })
      )
    );
  }

  /**
   * Process branch create/delete events
   */
  async processBranchEvent(
    event: CreatePayload | DeletePayload,
    eventType: "create" | "delete"
  ) {
    const { repository } = event;

    console.log(`Processing ${eventType} event: ${repository.full_name}`);

    // Get subscribed channels for this repo
    const channels = await dbService.getRepoSubscribers(repository.full_name);

    // Filter by event preferences (branches event type)
    const interestedChannels = channels.filter(ch =>
      ch.eventTypes.includes("branches")
    );

    if (interestedChannels.length === 0) {
      console.log("No interested channels for branch event");
      return;
    }

    // Format message
    const ref = "ref" in event ? String(event.ref) : "unknown";
    const refType = "ref_type" in event ? String(event.ref_type) : "branch";
    const emoji = eventType === "create" ? "🌿" : "🗑️";
    const action = eventType === "create" ? "Created" : "Deleted";

    const message =
      `${emoji} **${action} ${refType}** in ${repository.full_name}\n` +
      `\`${ref}\`\n` +
      `${repository.html_url}`;

    // Send to all interested channels in parallel
    await Promise.all(
      interestedChannels.map(channel =>
        this.bot.sendMessage(channel.channelId, message).catch((err: Error) => {
          console.error(`Failed to send to ${channel.channelId}:`, err.message);
        })
      )
    );
  }
}
