import { EventType } from "../constants";
import {
  formatCreate,
  formatDelete,
  formatFork,
  formatIssue,
  formatIssueComment,
  formatPullRequest,
  formatPullRequestReview,
  formatPush,
  formatRelease,
  formatWatch,
  formatWorkflowRun,
} from "../formatters/webhook-events";
import type { SubscriptionService } from "../services/subscription-service";
import type { TownsBot } from "../types/bot";
import type {
  CreatePayload,
  DeletePayload,
  ForkPayload,
  IssueCommentPayload,
  IssuesPayload,
  PullRequestPayload,
  PullRequestReviewPayload,
  PushPayload,
  ReleasePayload,
  WatchPayload,
  WorkflowRunPayload,
} from "../types/webhooks";

/**
 * EventProcessor - Routes webhook events to formatters and sends to subscribed channels
 *
 * Maps webhook event types to subscription event types and filters by user preferences.
 */
export class EventProcessor {
  private bot: TownsBot;
  private subscriptionService: SubscriptionService;

  constructor(bot: TownsBot, subscriptionService: SubscriptionService) {
    this.bot = bot;
    this.subscriptionService = subscriptionService;
  }

  /**
   * Generic helper to process GitHub webhook events
   * Handles channel filtering, message formatting, and distribution
   */
  private async processEvent<T extends { repository: { full_name: string } }>(
    event: T,
    eventType: EventType,
    formatter: (event: T) => string,
    logContext?: string
  ) {
    if (logContext) {
      console.log(`Processing ${logContext}`);
    }

    // Get subscribed channels for this repo (webhook mode only)
    const channels = await this.subscriptionService.getRepoSubscribers(
      event.repository.full_name,
      "webhook"
    );

    // Filter by event preferences
    const interestedChannels = channels.filter(ch =>
      ch.eventTypes.includes(eventType)
    );

    if (interestedChannels.length === 0) {
      console.log(`No interested channels for ${eventType} event`);
      return;
    }

    // Format message
    const message = formatter(event);

    if (!message) {
      console.log(
        "Formatter returned empty message (event action not handled)"
      );
      return;
    }

    // Send to all interested channels in parallel
    const results = await Promise.allSettled(
      interestedChannels.map(channel =>
        this.bot.sendMessage(channel.channelId, message)
      )
    );

    // Log failures
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(
          `Failed to send to ${interestedChannels[index].channelId}:`,
          result.reason
        );
      }
    });
  }

  /**
   * Process a pull request webhook event
   */
  async onPullRequest(event: PullRequestPayload) {
    const { pull_request, repository } = event;
    await this.processEvent(
      event,
      "pr",
      formatPullRequest,
      `PR event: ${event.action} - ${repository.full_name}#${pull_request.number}`
    );
  }

  /**
   * Process a push webhook event (commits)
   */
  async onPush(event: PushPayload) {
    const { repository, ref, commits } = event;
    await this.processEvent(
      event,
      "commits",
      formatPush,
      `push event: ${repository.full_name} - ${ref} (${commits?.length || 0} commits)`
    );
  }

  /**
   * Process an issues webhook event
   */
  async onIssues(event: IssuesPayload) {
    const { issue, repository } = event;
    await this.processEvent(
      event,
      "issues",
      formatIssue,
      `issue event: ${event.action} - ${repository.full_name}#${issue.number}`
    );
  }

  /**
   * Process a release webhook event
   */
  async onRelease(event: ReleasePayload) {
    const { release, repository } = event;
    await this.processEvent(
      event,
      "releases",
      formatRelease,
      `release event: ${event.action} - ${repository.full_name} ${release.tag_name}`
    );
  }

  /**
   * Process a workflow run webhook event (CI)
   */
  async onWorkflowRun(event: WorkflowRunPayload) {
    const { workflow_run, repository } = event;
    await this.processEvent(
      event,
      "ci",
      formatWorkflowRun,
      `workflow run event: ${event.action} - ${repository.full_name} ${workflow_run.name}`
    );
  }

  /**
   * Process an issue comment webhook event
   */
  async onIssueComment(event: IssueCommentPayload) {
    const { issue, repository } = event;
    await this.processEvent(
      event,
      "comments",
      formatIssueComment,
      `issue comment event: ${event.action} - ${repository.full_name}#${issue.number}`
    );
  }

  /**
   * Process a pull request review webhook event
   */
  async onPullRequestReview(event: PullRequestReviewPayload) {
    const { pull_request, repository } = event;
    await this.processEvent(
      event,
      "reviews",
      formatPullRequestReview,
      `PR review event: ${event.action} - ${repository.full_name}#${pull_request.number}`
    );
  }

  /**
   * Process branch create/delete events
   */
  async onBranchEvent(
    event: CreatePayload | DeletePayload,
    eventType: "create" | "delete"
  ) {
    const formatter = (e: CreatePayload | DeletePayload) =>
      eventType === "create"
        ? formatCreate(e as CreatePayload)
        : formatDelete(e as DeletePayload);

    await this.processEvent(
      event,
      "branches",
      formatter,
      `${eventType} event: ${event.repository.full_name}`
    );
  }

  /**
   * Process fork webhook event
   */
  async onFork(event: ForkPayload) {
    await this.processEvent(
      event,
      "forks",
      formatFork,
      `fork event: ${event.repository.full_name}`
    );
  }

  /**
   * Process watch webhook event (star)
   */
  async onWatch(event: WatchPayload) {
    await this.processEvent(
      event,
      "stars",
      formatWatch,
      `watch event: ${event.repository.full_name}`
    );
  }
}
